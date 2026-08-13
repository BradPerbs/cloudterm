const http = require('http');
const crypto = require('crypto');

const catalog = require('./tools');

/**
 * The remote toolset, served over the loopback interface.
 *
 * Claude Code takes our tools as JavaScript functions and runs them inside its
 * own SDK, in this process. Codex cannot: it connects to MCP servers by URL or
 * by spawning a command, so the tools have to be reachable from outside.
 *
 * Outside, but not far. The handlers hold live ssh sessions and the app's
 * settings, so moving them into a subprocess would mean inventing a second
 * protocol to talk back here for every call. Instead this serves them over
 * http on 127.0.0.1: the tools stay exactly where they are, and the agent gets
 * a URL.
 *
 * Three things keep that from being a hole in the side of the app:
 *
 *   - it binds to 127.0.0.1 with an OS-assigned port, so nothing off this
 *     machine can reach it and the port is not guessable from run to run
 *   - every request must carry a token generated at startup, in the
 *     Authorization header or in the URL path, compared in constant time.
 *     Anything else gets 401 before it is parsed
 *   - it is started on demand by a provider that needs it, and stopped when
 *     the last one is done
 *
 * The approval policy is the same one the other provider uses, applied in the
 * same place it matters: before the handler runs. A call that needs a person
 * parks here until the panel answers, so "may I restart this service" reaches
 * the user whichever agent asked it.
 */

let server = null;
let ready = null;
let token = '';
let users = 0;

/** Constant time, because a token check that returns early leaks the token. */
function tokenMatches(offered) {
    const a = Buffer.from(String(offered || ''));
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The token a request is offering, from the header or from the path.
 *
 * The header is how an agent that can be told to send one does it, and it is
 * still what Codex and OpenCode use. The path is for the ones that take a URL
 * and nothing else: an address is the one thing every MCP client can be given,
 * and on a loopback socket an unguessable path in it is the same secret in a
 * different envelope. It buys nothing to be strict about which envelope, and
 * it costs a provider that then cannot reach its own tools.
 */
function offeredToken(request) {
    const header = String(request.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (header) return header;
    const [, fromPath = ''] = /^\/mcp\/([^/?#]+)/.exec(String(request.url || '')) || [];
    return decodeURIComponent(fromPath);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
            size += chunk.length;
            // A tool call is a few hundred bytes. Anything of this order is
            // either a bug or someone playing, and neither gets a buffer.
            if (size > 4 * 1024 * 1024) {
                reject(new Error('The request body is too large'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

/**
 * Start the server, or hand back the one already running.
 *
 * `context` is read per call rather than captured, so a tool always acts on
 * the session in front of the user now and under the settings as they are now,
 * exactly as the in-process path does.
 */
async function acquire({ toolContext, requestApproval, onEvent = () => {} }) {
    users += 1;

    if (ready) return ready;

    token = crypto.randomBytes(32).toString('hex');

    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StreamableHTTPServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );

    /**
     * A server per request.
     *
     * This looked like something to hoist: the tool definitions never change,
     * so why rebuild them per call. Because the transport is what a server is
     * connected to, and connecting a second one replaces the first: a shared
     * server answers each request into whichever transport connected last, and
     * the call that was actually waiting is left to time out as cancelled.
     * Stateless means stateless. Building ten closures per request is nothing
     * next to the ssh round trip they are about to make.
     */
    const buildServer = () => {
        const mcp = new McpServer({ name: 'remote', version: '1.0.0' });

        for (const definition of catalog.TOOLS) {
            mcp.registerTool(
            definition.name,
            {
                title: definition.title,
                description: definition.description,
                inputSchema: definition.shape,
            },
            async (input) => {
                const context = toolContext();
                const settings = context.settings;

                // Refused outright, before the approval path rather than
                // inside it: there is no answer the user could give that would
                // let this run, so asking would only be a card whose buttons
                // both mean no.
                const blocked = catalog.blockedReason(definition.name, input || {}, settings);
                if (blocked) {
                    onEvent({ type: 'tool-blocked', name: definition.name, rule: blocked });
                    return {
                        content: [{ type: 'text', text: catalog.blockedMessage(blocked) }],
                        isError: true,
                    };
                }

                // The gate. Not in the agent's own permission system, which is
                // a different set of promises on every agent, but here, once,
                // in front of the thing that actually touches a server.
                if (!catalog.isAutoApproved(definition.name, input || {}, settings)) {
                    const verdict = await requestApproval({
                        toolName: definition.name,
                        name: definition.name,
                        input: input || {},
                        local: false,
                    });
                    if (!verdict.approved) {
                        return {
                            content: [{ type: 'text', text: verdict.message || 'The user declined that.' }],
                            isError: true,
                        };
                    }
                }

                try {
                    const result = await definition.handler(input || {}, context);
                    return {
                        content: [{ type: 'text', text: String(result.text ?? '') }],
                        isError: Boolean(result.isError),
                    };
                } catch (error) {
                    onEvent({ type: 'tool-failed', name: definition.name, message: error.message });
                    return {
                        content: [{ type: 'text', text: `The ${definition.name} tool failed: ${error.message}` }],
                        isError: true,
                    };
                }
                }
            );
        }

        return mcp;
    };

    // Stateless: a server and a transport per request, torn down with the
    // response. There is no session id to track and nothing to leak between
    // turns, which for a socket this process is hosting is the point.
    ready = new Promise((resolve, reject) => {
        server = http.createServer(async (request, response) => {
            if (!tokenMatches(offeredToken(request))) {
                if (process.env.CLOUDBLAST_MCP_DEBUG) console.error('[mcp] 401', request.method, request.url);
                response.writeHead(401).end();
                return;
            }

            try {
                const body = request.method === 'POST'
                    ? JSON.parse(await readBody(request) || '{}')
                    : undefined;

                if (process.env.CLOUDBLAST_MCP_DEBUG) {
                    console.error('[mcp]', request.method, request.url, body?.method || '', 'accept=', request.headers.accept || '');
                }

                const mcp = buildServer();
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                response.on('close', () => {
                    transport.close();
                    mcp.close();
                });

                await mcp.connect(transport);
                await transport.handleRequest(request, response, body);
            } catch (error) {
                if (!response.headersSent) response.writeHead(500).end();
                onEvent({ type: 'tool-failed', name: 'mcp', message: error.message });
            }
        });

        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/mcp`,
                token,
                // The same endpoint with the token already in it, for a client
                // that can only be handed an address. See `offeredToken`.
                tokenUrl: `http://127.0.0.1:${port}/mcp/${token}`,
            });
        });
    });

    return ready;
}

/** Let go. The last one out closes the door. */
async function release() {
    users = Math.max(0, users - 1);
    if (users > 0 || !server) return;

    const closing = server;
    server = null;
    ready = null;
    token = '';
    await new Promise(resolve => closing.close(resolve));
}

module.exports = { acquire, release, _test: { offeredToken } };
