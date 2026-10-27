/**
 * What goes under a reply, as the conversation layer in `ai/index.js` makes
 * it: the change an edit carries, and how fast a turn wrote its answer.
 *
 * The events are played through the stub agent's `onEvent`, the road a
 * runtime's events take, so what is checked is the log a panel rebuilds
 * itself from. `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-turns-'));

const electronStub = {
    app: {
        getPath: () => userData,
        getVersion: () => '1.0.0',
        on: () => {},
        whenReady: () => new Promise(() => {}),
    },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
    ipcMain: { handle: () => {}, on: () => {} },
    BrowserWindow: { getAllWindows: () => [] },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

// The agent: whatever it was started with, and every message it was sent.
const agent = { options: null, sent: [] };
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'))] = { exports: {
    supportsImages: true,
    findClaude: () => 'claude',
    start: async (options) => {
        agent.options = options;
        return {
            send: text => agent.sent.push(text),
            interrupt: async () => {},
            close: async () => {},
        };
    },
} };

const assistant = require(path.join(ROOT, 'ai'));

let passed = 0;
let failed = 0;
async function check(label, fn) {
    try {
        await fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.stack}`);
        failed += 1;
    }
}

/** A conversation with its agent started on a first message. */
async function started(text = 'hello') {
    const { conversationId } = assistant.create({ scope: 'global' });
    const result = await assistant.send(conversationId, text);
    assert.ok(result.success, result.message);
    const events = () => assistant.history(conversationId).events;
    return { conversationId, events, say: agent.options.onEvent, toolContext: agent.options.toolContext };
}

async function main() {
    console.log('\nassistant turns');

    await check('an edit\'s call carries its change, worked out from its arguments', async () => {
        const { events, say } = await started('Move it to 8080');
        say({
            type: 'tool-call',
            id: 'toolu_1',
            name: 'Edit',
            rawName: 'Edit',
            local: true,
            input: { file_path: '/srv/app.conf', old_string: 'listen 80', new_string: 'listen 8080' },
        });
        const call = events().find(event => event.type === 'tool-call');
        assert.strictEqual(call.diff.path, '/srv/app.conf');
        assert.strictEqual(call.diff.added, 1);
        assert.strictEqual(call.diff.removed, 1);
    });

    await check('a call that is not an edit carries none', async () => {
        const { events, say } = await started('List it');
        say({ type: 'tool-call', id: 'toolu_2', name: 'Bash', rawName: 'Bash', local: true, input: { command: 'ls' } });
        assert.strictEqual(events().find(event => event.type === 'tool-call').diff, undefined);
    });

    await check('a finished turn\'s result carries its answer rate', async () => {
        const realNow = Date.now;
        let clock = realNow();
        Date.now = () => clock;
        try {
            const { events, say } = await started('Explain it');
            clock += 4000;
            say({ type: 'result', costUsd: 0, usage: { output_tokens: 80 } });
            const result = events().find(event => event.type === 'result');
            assert.strictEqual(result.outputTokens, 80);
            assert.strictEqual(result.durationMs, 4000);
            assert.strictEqual(result.tokensPerSec, 20);
        } finally {
            Date.now = realNow;
        }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
