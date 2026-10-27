const assert = require('assert');

const provider = require('../src/main/ai/providers/opencode');

async function run() {
    const windowsCandidates = provider.openCodeCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: {
            Path: 'C:\\Tools;D:\\Bin',
            APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming',
            LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local',
            ChocolateyInstall: 'C:\\ProgramData\\chocolatey',
            SCOOP: 'D:\\Scoop',
        },
    });
    assert(windowsCandidates.includes('C:\\Tools\\opencode.exe'));
    assert(windowsCandidates.includes('C:\\Users\\Mario\\AppData\\Roaming\\npm\\opencode.cmd'));
    assert(windowsCandidates.includes('D:\\Scoop\\shims\\opencode.exe'));
    assert(windowsCandidates.includes('C:\\ProgramData\\chocolatey\\bin\\opencode.exe'));

    const npmShim = 'C:\\Users\\Mario\\AppData\\Roaming\\npm\\opencode.cmd';
    assert.strictEqual(provider.findOpenCode({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming' },
        accessSync(candidate) {
            if (candidate !== npmShim) throw new Error('missing');
        },
    }), npmShim);

    let killed = false;
    let taskkill = null;
    provider._test.closeProcess({
        pid: 42,
        exitCode: null,
        signalCode: null,
        kill() { killed = true; },
    }, {
        platform: 'win32',
        spawnSyncFn(command, args, options) {
            taskkill = { command, args, options };
            return { status: 0 };
        },
    });
    assert.deepStrictEqual(taskkill, {
        command: 'taskkill',
        args: ['/pid', '42', '/T', '/F'],
        options: { windowsHide: true },
    });
    assert.strictEqual(killed, false);

    provider._test.closeProcess({
        pid: 43,
        exitCode: null,
        signalCode: null,
        kill() { killed = true; },
    }, {
        platform: 'win32',
        spawnSyncFn: () => ({ status: 1 }),
    });
    assert.strictEqual(killed, true);

    assert.deepStrictEqual(provider.parseModel('anthropic/claude-sonnet-4'), {
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4',
    });
    assert.deepStrictEqual(provider.parseModel('custom/team/model'), {
        providerID: 'custom',
        modelID: 'team/model',
    });
    assert.strictEqual(provider.parseModel('not-a-model'), undefined);
    assert.deepStrictEqual(provider.permissions(false), { '*': 'deny', 'remote_*': 'allow' });
    assert.deepStrictEqual(provider.permissions(true), { '*': 'ask', 'remote_*': 'allow' });

    const emitted = [];
    const translator = provider.createTranslator('session-1', event => emitted.push(event));
    translator.beginTurn();

    await translator.event({
        type: 'message.part.updated',
        properties: {
            delta: 'Hello',
            part: {
                id: 'text-1',
                sessionID: 'session-1',
                messageID: 'message-1',
                type: 'text',
                text: 'Hello',
                time: { start: 1 },
            },
        },
    }, async () => {});

    await translator.event({
        type: 'message.part.updated',
        properties: {
            part: {
                id: 'text-1',
                sessionID: 'session-1',
                messageID: 'message-1',
                type: 'text',
                text: 'Hello world',
                time: { start: 1, end: 2 },
            },
        },
    }, async () => {});

    const pendingTool = {
        id: 'tool-part-1',
        sessionID: 'session-1',
        messageID: 'message-1',
        type: 'tool',
        callID: 'call-1',
        tool: 'remote_run_command',
        state: { status: 'pending', input: {}, raw: '' },
    };
    await translator.event({
        type: 'message.part.updated', properties: { part: pendingTool },
    }, async () => {});
    await translator.event({
        type: 'message.part.updated',
        properties: {
            part: {
                ...pendingTool,
                state: { status: 'running', input: { command: 'uptime' }, time: { start: 3 } },
            },
        },
    }, async () => {});
    await translator.event({
        type: 'message.part.updated',
        properties: {
            part: {
                ...pendingTool,
                state: {
                    status: 'completed',
                    input: { command: 'uptime' },
                    output: 'up 4 days',
                    title: 'run_command',
                    metadata: {},
                    time: { start: 3, end: 4 },
                },
            },
        },
    }, async () => {});

    await translator.event({
        type: 'message.updated',
        properties: {
            info: {
                id: 'message-1',
                sessionID: 'session-1',
                role: 'assistant',
                cost: 0.012,
                time: { created: 1, completed: 5 },
            },
        },
    }, async () => {});
    await translator.event({
        type: 'session.idle', properties: { sessionID: 'session-1' },
    }, async () => {});

    assert.deepStrictEqual(emitted.map(event => event.type), [
        'text-delta', 'assistant-text', 'tool-call', 'tool-result', 'result',
    ]);
    assert.deepStrictEqual(emitted[2], {
        type: 'tool-call',
        id: 'call-1',
        name: 'run_command',
        rawName: 'remote_run_command',
        local: false,
        input: { command: 'uptime' },
    });
    assert.strictEqual(emitted[4].costUsd, 0.012);
    assert.strictEqual(emitted[4].isError, false);

    await loopbackFetchTests();

    console.log('opencode-provider tests passed');
}

// The client talks to its server over plain http so a turn longer than
// Node's 300 second fetch limit survives. Check that the replacement carries
// a body both ways, streams a response, and honours an abort signal.
async function loopbackFetchTests() {
    const http = require('http');
    const { loopbackFetch } = provider._test;
    const server = http.createServer((request, response) => {
        if (request.url.startsWith('/echo')) {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                response.writeHead(201, { 'content-type': 'application/json', 'x-seen': request.headers['x-test'] || '' });
                response.end(JSON.stringify({ method: request.method, url: request.url, body }));
            });
            return;
        }
        if (request.url === '/stream') {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write('data: one\n\n');
            setTimeout(() => response.end('data: two\n\n'), 20);
            return;
        }
        if (request.url === '/empty') {
            response.writeHead(204);
            response.end();
        }
        // /hang never answers, for the abort check.
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
        const echoed = await loopbackFetch(new Request(`${base}/echo?x=1`, {
            method: 'POST',
            headers: { 'x-test': 'yes', 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        }));
        assert.strictEqual(echoed.status, 201);
        assert.strictEqual(echoed.headers.get('x-seen'), 'yes');
        assert.deepStrictEqual(await echoed.json(), {
            method: 'POST',
            url: '/echo?x=1',
            body: '{"hello":"world"}',
        });

        const streamed = await loopbackFetch(new Request(`${base}/stream`));
        assert.strictEqual(await streamed.text(), 'data: one\n\ndata: two\n\n');

        const empty = await loopbackFetch(new Request(`${base}/empty`));
        assert.strictEqual(empty.status, 204);

        const controller = new AbortController();
        const pending = loopbackFetch(new Request(`${base}/hang`, { signal: controller.signal }));
        setTimeout(() => controller.abort(), 20);
        await assert.rejects(pending, error => error.name === 'AbortError');
    } finally {
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
