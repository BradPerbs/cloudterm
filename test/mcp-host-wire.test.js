/**
 * The tool server as a real MCP client meets it, over a loopback socket.
 *
 * The other mcp-host test stubs the transport to prove conversations stay
 * apart. This one keeps it, because the things it checks only exist on the
 * wire: a progress heartbeat a client can see, a cancellation that arrives as
 * a request of its own and has to find the call it names, and the count of
 * calls still open while a card waits on the user.
 *
 * The catalog is replaced with two in-memory tools, so nothing here loads the
 * SSH handlers or touches a server.
 */
const assert = require('assert');

const ran = [];
const catalogPath = require.resolve('../src/main/ai/tools');
require.cache[catalogPath] = { exports: {
    TOOLS: [
        {
            name: 'probe', title: 'Probe', description: 'Needs approval', shape: {},
            handler: async () => { ran.push('probe'); return { text: 'probed' }; },
        },
        {
            name: 'ask', title: 'Ask', description: 'Runs without a card', shape: {},
            handler: async (input, context) => {
                ran.push('ask');
                return { text: context.signal instanceof AbortSignal ? 'has a signal' : 'no signal' };
            },
        },
    ],
    blockedReason: () => '',
    isAutoApproved: name => name === 'ask',
} };

const mcpHost = require('../src/main/ai/mcp-host');

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

async function waitFor(condition, label) {
    for (let waited = 0; waited < 300; waited += 1) {
        if (condition()) return;
        await tick();
    }
    throw new Error(`timed out waiting for ${label}`);
}

let passed = 0;
async function check(label, fn) {
    await fn();
    console.log(`  ok   ${label}`);
    passed += 1;
}

async function connect(lease) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(lease.url), {
        requestInit: { headers: { Authorization: `Bearer ${lease.token}` } },
    }));
    return client;
}

async function main() {
    console.log('\nmcp host on the wire');
    mcpHost._test.setHeartbeat(40);

    // An approval the test answers by hand, and that records the signal it
    // was given and whether that signal ever fired.
    let decide = null;
    let seenSignal = null;
    let aborted = false;
    const lease = await mcpHost.acquire({
        toolContext: () => ({ settings: {} }),
        requestApproval: ({ signal }) => new Promise((resolve) => {
            seenSignal = signal;
            aborted = false;
            decide = resolve;
            signal?.addEventListener('abort', () => {
                aborted = true;
                resolve({ approved: false, message: 'The runtime stopped waiting for this approval.' });
            }, { once: true });
        }),
    });
    const client = await connect(lease);

    await check('a call waiting on the user is counted, and sends a heartbeat', async () => {
        assert.strictEqual(mcpHost.pending(lease.token), 0, 'nothing open before a call');
        const beats = [];
        const call = client.callTool({ name: 'probe', arguments: {} }, undefined, {
            onprogress: progress => beats.push(progress.progress),
            resetTimeoutOnProgress: true,
        });

        await waitFor(() => decide, 'the approval to be asked');
        assert.strictEqual(mcpHost.pending(lease.token), 1, 'the call is open while it waits');
        assert.strictEqual(lease.pending(), 1, 'and the lease says the same');
        await waitFor(() => beats.length >= 2, 'two heartbeats');
        assert.ok(beats[1] > beats[0], 'each beat counts up');

        decide({ approved: true });
        const result = await call;
        assert.strictEqual(result.content[0].text, 'probed');
        await waitFor(() => mcpHost.pending(lease.token) === 0, 'the count to drop');
        decide = null;
    });

    await check('a runtime that gives up on a call takes its card down, and nothing runs', async () => {
        ran.length = 0;
        const controller = new AbortController();
        const call = client.callTool({ name: 'probe', arguments: {} }, undefined, { signal: controller.signal })
            .then(() => 'answered', () => 'rejected');

        await waitFor(() => decide, 'the approval to be asked');
        assert.ok(seenSignal instanceof AbortSignal, 'the approval is handed a signal');
        assert.strictEqual(aborted, false);

        // The SDK client sends notifications/cancelled as a request of its
        // own, which lands on a fresh server. It still has to reach this call.
        controller.abort();
        assert.strictEqual(await call, 'rejected', 'the client stopped waiting');
        await waitFor(() => aborted, 'the cancellation to reach the waiting call');

        // A click after that is too late to run anything.
        decide({ approved: true });
        await waitFor(() => mcpHost.pending(lease.token) === 0, 'the count to drop');
        assert.deepStrictEqual(ran, [], 'the handler never ran');
        decide = null;
    });

    await check('a tool is handed the call\'s signal, so a question knows it is served over the wire', async () => {
        ran.length = 0;
        const result = await client.callTool({ name: 'ask', arguments: {} });
        assert.strictEqual(result.content[0].text, 'has a signal');
        assert.deepStrictEqual(ran, ['ask']);
    });

    await check('closing the conversation takes down a card that is still waiting', async () => {
        const call = client.callTool({ name: 'probe', arguments: {} }).then(() => 'answered', () => 'rejected');
        await waitFor(() => decide, 'the approval to be asked');
        await lease.release();
        await waitFor(() => aborted, 'the release to reach the waiting call');
        assert.strictEqual(mcpHost.pending(lease.token), 0, 'a released token counts nothing');
        // The client only learns its server went away when it is closed.
        await client.close().catch(() => {});
        await call;
    });

    console.log(`\n${passed} passed`);
}

// No forced exit on success: the server may still be closing its socket, and
// tearing the loop down under it trips a libuv assertion on Windows.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
