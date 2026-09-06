const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');

// Replace the entire tool catalog before loading the host. These tests cannot
// load SSH handlers, open network sockets, or touch any real server sessions.
const calls = [];
const catalogPath = require.resolve('../src/main/ai/tools');
require.cache[catalogPath] = { exports: {
    TOOLS: [{
        name: 'probe', title: 'Test probe', description: 'In-memory test', shape: {},
        handler: async (input, context) => {
            calls.push(context.scope);
            if (input.fail) throw new Error('test failure');
            return { text: context.scope };
        },
    }],
    blockedReason: () => false,
    isAutoApproved: () => false,
} };

async function run() {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const original = {
        createServer: http.createServer,
        registerTool: McpServer.prototype.registerTool,
        connect: McpServer.prototype.connect,
        handleRequest: StreamableHTTPServerTransport.prototype.handleRequest,
    };
    const servers = [];
    const handlers = new WeakMap();
    const transports = new WeakMap();
    const leases = [];

    http.createServer = (handler) => {
        const server = new EventEmitter();
        server.handler = handler;
        server.listen = (port, host, ready) => {
            assert.strictEqual(host, '127.0.0.1');
            ready();
        };
        server.address = () => ({ port: 50000 + servers.indexOf(server) });
        server.closeCount = 0;
        server.close = (done) => { server.closeCount += 1; done(); };
        server.closeAllConnections = () => {};
        servers.push(server);
        return server;
    };
    McpServer.prototype.registerTool = function (name, metadata, handler) {
        handlers.set(this, handler);
    };
    McpServer.prototype.connect = async function (transport) {
        transports.set(transport, handlers.get(this));
    };
    StreamableHTTPServerTransport.prototype.handleRequest = async function (request, response) {
        response.result = await transports.get(this)(request.input);
    };

    const request = async (index, token, input = {}) => {
        const response = new EventEmitter();
        response.writeHead = (status) => { response.status = status; return response; };
        response.end = () => {};
        await servers[index].handler({
            method: 'GET', headers: { authorization: `Bearer ${token}` }, url: '/mcp', input,
        }, response);
        return response;
    };

    try {
        const host = require('../src/main/ai/mcp-host');
        const approvals = [];
        const events = [];
        let scopeA = 'server-a';
        let approveA;
        const a = await host.acquire({
            toolContext: () => ({ scope: scopeA, settings: {} }),
            requestApproval: () => {
                approvals.push('a');
                return new Promise(resolve => { approveA = resolve; });
            },
            onEvent: event => events.push(['a', event]),
        });
        leases.push(a);
        const b = await host.acquire({
            toolContext: () => ({ scope: 'server-b', settings: {} }),
            requestApproval: async () => { approvals.push('b'); return { approved: true }; },
            onEvent: event => events.push(['b', event]),
        });
        leases.push(b);
        assert.notStrictEqual(a.url, b.url);
        assert.notStrictEqual(a.token, b.token);
        assert.strictEqual((await request(1, a.token)).status, 401);
        assert.deepStrictEqual(approvals, []);

        const pendingA = request(0, a.token);
        const resultB = await request(1, b.token);
        assert.deepStrictEqual(approvals, ['a', 'b']);
        assert.strictEqual(resultB.result.content[0].text, 'server-b');
        assert.deepStrictEqual(calls, ['server-b'], 'B runs while A waits for its own approval');
        approveA({ approved: true });
        assert.strictEqual((await pendingA).result.content[0].text, 'server-a');

        scopeA = 'server-a-updated';
        const updatedA = request(0, a.token);
        await new Promise(resolve => setImmediate(resolve));
        approveA({ approved: true });
        assert.strictEqual((await updatedA).result.content[0].text, scopeA);

        await request(1, b.token, { fail: true });
        assert.deepStrictEqual(events.map(([owner]) => owner), ['b']);

        const closingA = request(0, a.token);
        await new Promise(resolve => setImmediate(resolve));
        await a.release();
        const before = calls.length;
        approveA({ approved: true });
        assert.strictEqual((await closingA).result.isError, true);
        assert.strictEqual(calls.length, before, 'closing a tab prevents a pending approval from executing');
        assert.strictEqual((await request(0, a.token)).status, 401);
        await a.release();
        assert.strictEqual(servers[0].closeCount, 1, 'release is idempotent');
        assert.strictEqual((await request(1, b.token)).result.content[0].text, 'server-b');
        assert.strictEqual(servers[1].closeCount, 0, 'closing A leaves B available');
        console.log('MCP conversation isolation tests passed (no sockets or SSH handlers)');
    } finally {
        await Promise.all(leases.map(lease => lease.release()));
        http.createServer = original.createServer;
        McpServer.prototype.registerTool = original.registerTool;
        McpServer.prototype.connect = original.connect;
        StreamableHTTPServerTransport.prototype.handleRequest = original.handleRequest;
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
