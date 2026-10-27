/**
 * The conversation layer in `ai/index.js`, driven through a fake agent.
 *
 * What is checked here lives between the provider and the panel: the cards a
 * conversation puts in front of the user, what happens to them when the
 * runtime that asked stops waiting, and what of a conversation is written to
 * disk.
 *
 * The agent is a stand-in that records what it was started with and what it
 * was sent, so no runtime is spawned and no model is asked anything.
 * `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-conversation-'));

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
    start: async (options) => {
        agent.options = options;
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

const tick = () => new Promise(resolve => setImmediate(resolve));

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

/** A conversation with its agent started, and the hooks it was handed. */
async function started() {
    const { conversationId } = assistant.create({ scope: 'global' });
    const result = await assistant.send(conversationId, 'hello');
    assert.ok(result.success, result.message);
    return { conversationId, ...agent.options };
}

async function main() {
    console.log('\nassistant conversations');

    await check('an approval card comes down when the runtime stops waiting for it', async () => {
        const { conversationId, requestApproval } = await started();
        const controller = new AbortController();
        const verdict = requestApproval({
            toolName: 'run_command',
            name: 'run_command',
            input: { command: 'systemctl restart nginx' },
            local: false,
            signal: controller.signal,
        });
        await tick();

        const asked = eventsOf(conversationId).find(event => event.type === 'approval-request');
        assert.ok(asked, 'the card went up');

        controller.abort();
        const answer = await verdict;
        assert.strictEqual(answer.approved, false);
        assert.ok(/stopped waiting/.test(answer.message));

        const settled = eventsOf(conversationId).find(event => event.type === 'approval-settled');
        assert.deepStrictEqual(
            { requestId: settled.requestId, status: settled.status },
            { requestId: asked.requestId, status: 'expired' },
            'and is recorded as settled, so a reload does not draw it again'
        );

        // A click arriving afterwards finds nothing to answer.
        assert.strictEqual(assistant.respondToApproval({ requestId: asked.requestId, approved: true }), false);
    });

    await check('a call the runtime already gave up on never puts a card up', async () => {
        const { conversationId, requestApproval } = await started();
        const controller = new AbortController();
        controller.abort();
        const answer = await requestApproval({
            toolName: 'write_file', name: 'write_file', input: { path: '/etc/x', content: '' }, local: false,
            signal: controller.signal,
        });
        assert.strictEqual(answer.approved, false);
        assert.ok(!eventsOf(conversationId).some(event => event.type === 'approval-request'));
    });

    await assistant.shutdown();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
