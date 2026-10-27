/**
 * What the composer sends, as the conversation layer in `ai/index.js` takes
 * it: documents read into words, things tagged with `@`, skills invoked with
 * `/`, and the runtime started while a message is still being typed.
 *
 * The agent is a stand-in that records what it was sent, so no runtime is
 * spawned and no model is asked anything. `electron` is stubbed and the store
 * lives in a temporary folder, so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-composer-'));

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

// The agent: how often it was started, and every message it was sent.
const agent = { starts: 0, sent: [], onEvent: null };
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'))] = { exports: {
    supportsImages: true,
    findClaude: () => 'claude',
    start: async (options) => {
        agent.starts += 1;
        agent.onEvent = options.onEvent;
        return {
            send: (text) => agent.sent.push(text),
            interrupt: async () => {},
            close: async () => {},
        };
    },
} };

const assistant = require(path.join(ROOT, 'ai'));

const notified = [];
assistant.setNotifier((channel, payload) => notified.push({ channel, ...payload }));

/** The events one conversation has emitted, in order. */
const eventsOf = (conversationId) => notified
    .filter(entry => entry.channel === 'ai-event' && entry.conversationId === conversationId)
    .map(entry => entry.event);

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

async function main() {
    console.log('\nattached files');

    await check('a file goes to the agent as words and to the history as a name', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        const result = await assistant.send(conversationId, 'why does this fail?', [], [], [
            { name: 'nginx.log', mediaType: 'text/plain', text: 'connect() failed (111: Connection refused)' },
        ]);
        assert.ok(result.success, result.message);

        const prompt = agent.sent.at(-1);
        assert.ok(prompt.includes('<attached-file name="nginx.log" type="text/plain">\nconnect() failed'), prompt);
        assert.ok(prompt.indexOf('</attached-file>') < prompt.indexOf('why does this fail?'), 'the question comes last');

        const message = eventsOf(conversationId).find(event => event.type === 'user-message');
        assert.deepStrictEqual(message.files, [{ name: 'nginx.log', mediaType: 'text/plain' }]);
        assert.ok(!JSON.stringify(message).includes('Connection refused'), 'the words are not kept');
    });

    await check('a file on its own is a message, and names the conversation', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        const result = await assistant.send(conversationId, '', [], [], [{ name: 'plan.md', text: '# Plan' }]);
        assert.ok(result.success, result.message);
        const listed = assistant.list().find(entry => entry.conversationId === conversationId);
        assert.strictEqual(listed.title, 'plan.md');
    });

    await check('a file over the limit refuses the message before anything is recorded', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        const result = await assistant.send(conversationId, 'read this', [], [], [
            { name: 'huge.log', text: 'x'.repeat(200 * 1024) },
        ]);
        assert.strictEqual(result.success, false);
        assert.match(result.message, /huge\.log is larger/);
        assert.strictEqual(eventsOf(conversationId).length, 0);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await assistant.shutdown?.();
    fs.rmSync(userData, { recursive: true, force: true });
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
