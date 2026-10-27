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
 *     that conversation is done
 *
 * The approval policy is the same one the other provider uses, applied in the
 * same place it matters: before the handler runs. A call that needs a person
 * parks here until the panel answers, so "may I restart this service" reaches
 * the user whichever agent asked it.
 */

/** Constant time, because a token check that returns early leaks the token. */
function tokenMatches(offered, token) {
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
 * Say we are still here, every few seconds, while a call is open.
 *
 * A call that waits for a person can be open for minutes, and a client gives a
 * request far less than that: OpenCode drops a tool call after twenty seconds,
 * tells the agent it failed, and stops listening. A progress notification
 * resets that clock on any client that follows the protocol, which is the fix
 * at the right level. It can only be sent when the client asked for progress
 * by handing us a token. When it did not, the cancellation below is what tells
 * this side the call is no longer wanted.
 */
const HEARTBEAT_MS = 5000;
let heartbeatMs = HEARTBEAT_MS;

function heartbeat(extra) {
    const progressToken = extra?._meta?.progressToken;
    if (progressToken === undefined || typeof extra?.sendNotification !== 'function') return null;
    let beats = 0;
    return setInterval(() => {
        beats += 1;
        extra.sendNotification({
            method: 'notifications/progress',
            // No total: this is "still working", not a fraction of anything.
            params: { progressToken, progress: beats },
        }).catch(() => {
            // The client has gone; the signal is what acts on that.
        });
    }, heartbeatMs);
}

/**
 * One signal for "nobody is waiting for this call any more", from either of
 * the two ways a client says so: dropping the connection, which the SDK turns
 * into its own abort, or a cancellation sent as a request of its own, which
 * only this file can route. See `acquire`.
 */
function eitherSignal(signals) {
    const live = signals.filter(Boolean);
    if (live.length <= 1) return live[0] || null;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
    const controller = new AbortController();
    for (const signal of live) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
}

/** A JSON-RPC id as a map key, so the number 1 and the string "1" stay apart. */
const idKey = (id) => JSON.stringify(id);

/**
 * How many tool calls are open on each endpoint right now, by token.
 *
 * A call is open from the request arriving until its answer leaves, which
 * covers the whole time an approval card or a question waits on the user. A
 * runtime that ends a turn after a stretch of silence can read this to tell a
 * person away from the keyboard from a process that has hung.
 */
const openCounts = new Map();

function pending(token) {
    return openCounts.get(token)?.() || 0;
}

/**
 * Each provider session owns its endpoint and callbacks. Sharing these across
 * tabs sends approvals and server scope to whichever conversation started first.
 * The context getter still reads that conversation's current selection/settings.
 */
async function acquire({ toolContext, requestApproval, onEvent = () => {} }) {
    const token = crypto.randomBytes(32).toString('hex');
    let closed = false;
    let closing = null;
    let open = 0;
    openCounts.set(token, () => open);

    /**
     * The calls in flight on this endpoint, by JSON-RPC id.
     *
     * Every request here gets a server of its own, so a client's cancellation,
     * which arrives as a request of its own, lands on a fresh server that has
     * never heard of the call it names. The call it meant goes on waiting, and
     * an approval card for a call the runtime has already reported as failed
     * stays on screen, where a late click would still run the command. So the
     * cancellation is read here, before any server sees it, and routed to the
     * call by id.
     */
    const inflight = new Map();

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
    /** One tool call: the block list, the approval gate, then the handler. */
    const call = async (definition, input, signal) => {
        const context = toolContext();
        const settings = context.settings;

        // Refused outright, before the approval path rather than inside it:
        // there is no answer the user could give that would let this run, so
        // asking would only be a card whose buttons both mean no.
        const blocked = catalog.blockedReason(definition.name, input, settings);
        if (blocked) {
            onEvent({ type: 'tool-blocked', name: definition.name, rule: blocked });
            return {
                content: [{ type: 'text', text: catalog.blockedMessage(blocked) }],
                isError: true,
            };
        }

        // The gate. Not in the agent's own permission system, which is a
        // different set of promises on every agent, but here, once, in front
        // of the thing that actually touches a server.
        if (!catalog.isAutoApproved(definition.name, input, settings)) {
            const verdict = await requestApproval({
                toolName: definition.name,
                name: definition.name,
                input,
                local: false,
                // A card for a call the client has given up on is a question
                // nobody is listening to the answer of, so it comes down.
                signal,
            });
            if (!verdict.approved) {
                return {
                    content: [{ type: 'text', text: verdict.message || 'The user declined that.' }],
                    isError: true,
                };
            }
        }

        if (closed) {
            return {
                content: [{ type: 'text', text: 'This assistant conversation has closed.' }],
                isError: true,
            };
        }

        // Approved in the same moment the runtime gave up. The agent has
        // already been told this call failed, so running it now would be a
        // change on a server that nothing on the other side knows happened.
        if (signal?.aborted) {
            return {
                content: [{ type: 'text', text: 'The runtime stopped waiting for this call, so it was not run.' }],
                isError: true,
            };
        }

        try {
            // The signal rides with the context, so a tool that waits on a
            // person knows when the client stopped waiting.
            const result = await definition.handler(input, { ...context, signal });
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
    };

    const buildServer = (cancelled = null) => {
        const mcp = new McpServer({ name: 'remote', version: '1.0.0' });

        for (const definition of catalog.TOOLS) {
            mcp.registerTool(
                definition.name,
                {
                    title: definition.title,
                    description: definition.description,
                    inputSchema: definition.shape,
                },
                async (input, extra) => {
                    // Counted for as long as the call is open, approval and
                    // question waits included. See `pending`.
                    open += 1;
                    const beating = heartbeat(extra);
                    try {
                        return await call(definition, input || {}, eitherSignal([extra?.signal, cancelled]));
                    } finally {
                        clearInterval(beating);
                        open = Math.max(0, open - 1);
                    }
                }
            );
        }

        return mcp;
    };

    // Stateless: a server and a transport per request, torn down with the
    // response. There is no session id to track and nothing to leak between
    // turns, which for a socket this process is hosting is the point.
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (request, response) => {
            if (closed || !tokenMatches(offeredToken(request), token)) {
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

                // A body may be one message or a batch of them.
                const messages = Array.isArray(body) ? body : (body ? [body] : []);

                // A runtime giving up on a call. See `inflight`.
                for (const message of messages) {
                    if (message?.method !== 'notifications/cancelled') continue;
                    inflight.get(idKey(message.params?.requestId))?.abort();
                }

                // The calls this request carries, registered so a cancellation
                // arriving on a later request can find them.
                const cancel = new AbortController();
                const calls = messages
                    .filter(message => message?.method === 'tools/call' && message.id !== undefined && message.id !== null)
                    .map(message => idKey(message.id));
                for (const id of calls) inflight.set(id, cancel);

                const mcp = buildServer(calls.length > 0 ? cancel.signal : null);
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                response.on('close', () => {
                    for (const id of calls) {
                        if (inflight.get(id) === cancel) inflight.delete(id);
                    }
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
                // How many of this endpoint's calls are open. See `pending`.
                pending: () => open,
                release() {
                    if (closing) return closing;
                    closed = true;
                    openCounts.delete(token);
                    // Anything still waiting on the user is waiting for a
                    // conversation that has gone, so its card comes down.
                    for (const controller of inflight.values()) controller.abort();
                    inflight.clear();
                    closing = new Promise((done) => {
                        server.close(done);
                        // An idle stream or approval must not keep a closed tab alive.
                        server.closeAllConnections();
                    });
                    return closing;
                },
                // The same endpoint with the token already in it, for a client
                // that can only be handed an address. See `offeredToken`.
                tokenUrl: `http://127.0.0.1:${port}/mcp/${token}`,
            });
        });
    });
}

module.exports = {
    acquire,
    pending,
    _test: {
        offeredToken,
        // A heartbeat of five seconds would make every test of it five
        // seconds long.
        setHeartbeat: (ms) => { heartbeatMs = ms || HEARTBEAT_MS; },
    },
};
