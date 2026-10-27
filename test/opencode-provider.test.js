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

    // OpenCode Desktop, which ships no CLI.
    const desktopExe = 'C:\\Users\\Mario\\AppData\\Local\\Programs\\@opencode-aidesktop\\OpenCode.exe';
    const desktopAsar = 'C:\\Users\\Mario\\AppData\\Local\\Programs\\@opencode-aidesktop\\resources\\app.asar';
    const desktops = provider.desktopCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local' },
    });
    assert(desktops.some(entry => entry.exe === desktopExe && entry.asar === desktopAsar), 'the Windows install is a candidate');
    assert(provider.desktopCandidates({ platform: 'darwin', home: '/Users/mario', env: {} })
        .some(entry => entry.exe === '/Applications/OpenCode.app/Contents/MacOS/OpenCode'));

    // Only the desktop app is there: the launch runs its bundle under its own
    // Electron as Node, through our serve script, on the reserved port.
    const onlyDesktop = {
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local' },
        accessSync(candidate) {
            if (candidate !== desktopExe && candidate !== desktopAsar) throw new Error('missing');
        },
    };
    assert.strictEqual(provider.findOpenCode(onlyDesktop), '', 'no CLI');
    const launch = provider.findOpenCodeLaunch(onlyDesktop);
    assert.strictEqual(launch.kind, 'desktop');
    assert.strictEqual(launch.command, desktopExe);
    assert.strictEqual(launch.env.ELECTRON_RUN_AS_NODE, '1');
    const launchArgs = launch.args(51234);
    assert(launchArgs[0].endsWith('opencode-desktop-serve.mjs'));
    assert(require('fs').existsSync(launchArgs[0]), 'the serve script ships beside the provider');
    assert.strictEqual(launchArgs[1], desktopAsar);
    assert.deepStrictEqual(launchArgs.slice(2), ['127.0.0.1', '51234']);

    // Under Electron an app.asar answers ENOENT to accessSync and is a
    // directory to statSync; that still counts as there.
    assert(provider.findOpenCodeDesktop({
        ...onlyDesktop,
        accessSync(candidate) {
            if (candidate !== desktopExe) throw new Error('ENOENT');
        },
        statSync(candidate) {
            if (candidate !== desktopAsar) throw new Error('ENOENT');
            return { isDirectory: () => true };
        },
    }), 'an archive Electron reads as a folder is found');

    // The CLI wins when both are there.
    const cli = provider.findOpenCodeLaunch({
        ...onlyDesktop,
        accessSync(candidate) {
            if (candidate !== npmShim && candidate !== desktopExe && candidate !== desktopAsar) throw new Error('missing');
        },
        env: { APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local' },
    });
    assert.strictEqual(cli.kind, 'cli');
    assert.strictEqual(cli.command, npmShim);
    assert.deepStrictEqual(cli.args(7), ['serve', '--hostname=127.0.0.1', '--port=7']);

    // Nothing at all is null, not a guess.
    assert.strictEqual(provider.findOpenCodeLaunch({ ...onlyDesktop, accessSync() { throw new Error('missing'); } }), null);

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
    await permissionTests();

    console.log('opencode-provider tests passed');
}

// OpenCode raised a card for every one of its own tools whatever the approval
// mode said, and its shell was never checked against the blocked list.
async function permissionTests() {
    const { localApproved } = provider._test;
    const base = { allowLocalTools: true, autoApproveCommands: ['ls'], blockedCommands: ['rm -rf'] };
    const cards = [];
    const events = [];
    const decide = (permission, current, answer = true) => localApproved({
        permission,
        current,
        requestApproval: async (request) => {
            cards.push(request.name);
            return { approved: answer };
        },
        onEvent: event => events.push(event),
    });

    const read = { id: 'p1', type: 'read', title: 'a.js', metadata: { filePath: 'a.js' } };
    const edit = { id: 'p2', type: 'edit', title: 'a.js', metadata: { filePath: 'a.js' } };
    const shell = command => ({ id: 'p3', type: 'bash', title: command, pattern: command, metadata: { command } });

    assert.strictEqual(await decide(read, { ...base, approval: 'never' }), true);
    assert.strictEqual(await decide(edit, { ...base, approval: 'never' }), true);
    assert.deepStrictEqual(cards, [], 'Yolo puts up no card');

    assert.strictEqual(await decide(read, { ...base, approval: 'writes' }), true);
    assert.strictEqual(await decide(shell('ls -la'), { ...base, approval: 'writes' }), true);
    assert.deepStrictEqual(cards, [], 'a read and a listed command run under the default');
    assert.strictEqual(await decide(edit, { ...base, approval: 'writes' }, false), false);
    assert.deepStrictEqual(cards, ['edit'], 'a change asks');

    cards.length = 0;
    assert.strictEqual(await decide(read, { ...base, approval: 'always' }), true);
    assert.deepStrictEqual(cards, ['read'], '"always" asks for a read too');

    cards.length = 0;
    assert.strictEqual(await decide(shell('rm -rf /srv'), { ...base, approval: 'never' }), false);
    assert.deepStrictEqual(cards, [], 'a blocked command is refused without a card');
    assert.deepStrictEqual(events, [{ type: 'tool-blocked', name: 'bash', rule: 'rm -rf', local: true }]);

    // A release that only puts the command in the pattern is still checked.
    const patternOnly = { id: 'p4', type: 'bash', title: '', pattern: ['rm -rf /srv'], metadata: {} };
    assert.strictEqual(await decide(patternOnly, { ...base, approval: 'never' }), false);
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
