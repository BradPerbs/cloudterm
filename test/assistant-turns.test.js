/**
 * What goes under a reply, as the conversation layer in `ai/index.js` makes
 * it: the change an edit carries, how fast a turn wrote its answer, and a new
 * chat branched from the end of a turn.
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

    // Two turns, the second with a call still waiting when the branch is made.
    const first = await started('Which port does it listen on?');
    first.say({ type: 'text-delta', text: 'Port ' });
    first.say({ type: 'assistant-text', text: 'Port 80.' });
    first.say({ type: 'result', costUsd: 0 });
    const turnOne = first.events().find(event => event.type === 'user-message').at;
    // Stamps are milliseconds, and a turn is named by its message's.
    await new Promise(resolve => setTimeout(resolve, 5));
    await assistant.send(first.conversationId, 'Move it to 8080');
    first.say({ type: 'tool-call', id: 'pending_1', name: 'Bash', rawName: 'Bash', local: true, input: { command: 'sed' } });

    let branchId = '';
    await check('a branch holds the conversation up to the end of that turn, and nothing after', async () => {
        const made = assistant.branch(first.conversationId, turnOne);
        assert.strictEqual(made.success, true, made.message);
        branchId = made.conversationId;
        const copied = assistant.history(branchId);
        assert.deepStrictEqual(
            copied.events.filter(event => event.type === 'user-message').map(event => event.text),
            ['Which port does it listen on?'],
        );
        assert.ok(copied.events.some(event => event.type === 'assistant-text' && event.text === 'Port 80.'));
        assert.ok(!copied.events.some(event => event.type === 'text-delta'), 'the stream previews stay behind');
        assert.strictEqual(copied.title, assistant.history(first.conversationId).title);
        assert.strictEqual(copied.scope, 'global', 'the copy is about the same servers');
        assert.strictEqual(copied.busy, false);
    });

    await check('the source is still there, untouched, with its later turn', async () => {
        const source = assistant.history(first.conversationId);
        assert.strictEqual(source.found, true);
        assert.strictEqual(source.events.filter(event => event.type === 'user-message').length, 2);
    });

    await check('the branch\'s first message carries what was said, and only the first', async () => {
        agent.sent = [];
        const result = await assistant.send(branchId, 'Make it 9090 instead');
        assert.ok(result.success, result.message);
        assert.ok(agent.sent[0].includes('<earlier-conversation>'), 'the agent is told what came before');
        assert.ok(agent.sent[0].includes('Which port does it listen on?'));
        assert.ok(agent.sent[0].includes('Port 80.'));
        assert.ok(!agent.sent[0].includes('Move it to 8080'), 'nothing after the branch point');
        assert.ok(agent.sent[0].trim().endsWith('Make it 9090 instead'), 'the message itself comes last');
        await assistant.send(branchId, 'Thanks');
        assert.ok(!agent.sent[1].includes('<earlier-conversation>'));
    });

    await check('a turn that is not in the conversation cannot be branched from', async () => {
        assert.strictEqual(assistant.branch(first.conversationId, 12345).success, false);
        assert.strictEqual(assistant.branch('no-such-conversation', turnOne).success, false);
    });

    await check('nothing left waiting is copied, and a long past is cut from the front', async () => {
        const branching = require(path.join(ROOT, 'ai', 'branch'));
        const copied = branching.copyEvents([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'tool-call', id: 'done', at: 2 },
            { type: 'tool-result', id: 'done', at: 3 },
            { type: 'tool-call', id: 'open', at: 4 },
            { type: 'approval-request', requestId: 'asked', at: 5 },
            { type: 'turn-changes', turnId: 1, files: [], at: 6 },
        ], 6, 'source-1');
        assert.deepStrictEqual(copied.map(event => event.type), ['user-message', 'tool-call', 'tool-result', 'turn-changes']);
        assert.strictEqual(copied[3].from, 'source-1', 'a copied files card is marked as not the copy\'s own');

        const long = Array.from({ length: 400 }, (unused, index) => ({ type: 'user-message', text: `${index} ${'x'.repeat(300)}` }));
        const said = branching.carryOver(long);
        assert.strictEqual(said.length, branching.MAX_CARRY_OVER);
        assert.ok(said.includes('399 '), 'the newest is kept');
    });

    await check('what a branch is still to carry survives the app closing', async () => {
        const archive = require(path.join(ROOT, 'ai', 'archive'));
        const packed = archive.pack({ id: 'b1', events: [], carryOver: '## User\n\nhello' });
        assert.strictEqual(archive.unpack(JSON.parse(JSON.stringify(packed)), 'claude-code').carryOver, '## User\n\nhello');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
