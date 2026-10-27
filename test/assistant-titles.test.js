/**
 * Chat titles: a few words from the agent once the first exchange is over,
 * and the first message cut at eighty characters whenever there are none.
 *
 * The name is asked for off to the side of the chat, so what is checked here
 * is when it is asked (after the reply, never before it), what is sent (the
 * person's own messages, masked, and nothing the app added), and what is left
 * when the agent cannot answer, fails, or answers with something that is not
 * a title.
 *
 * Two agents are stand-ins: one that can be asked for a name and one that
 * cannot. `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-titles-'));

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

// The agent that can name a chat. `answer` decides what it says; every
// question it was asked is kept, with the turn that was running at the time.
const claude = { asked: [], answer: async () => 'Fix 502 errors on web-01', onEvent: null, busy: false };
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'))] = { loaded: true, exports: {
    supportsImages: true,
    findClaude: () => 'claude',
    start: async (options) => {
        claude.onEvent = options.onEvent;
        return {
            send: () => { claude.busy = true; },
            interrupt: async () => {},
            close: async () => {},
        };
    },
    title: async (request) => {
        claude.asked.push({ ...request, duringTurn: claude.busy });
        return claude.answer(request);
    },
} };

// The agent with no way to ask.
const codex = { onEvent: null };
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'codex'))] = { loaded: true, exports: {
    start: async (options) => {
        codex.onEvent = options.onEvent;
        return { send: () => {}, interrupt: async () => {}, close: async () => {} };
    },
} };

const assistant = require(path.join(ROOT, 'ai'));
const titles = require(path.join(ROOT, 'ai', 'titles'));

const notified = [];
assistant.setNotifier((channel, payload) => notified.push({ channel, ...payload }));

const eventsOf = (conversationId) => notified
    .filter(entry => entry.channel === 'ai-event' && entry.conversationId === conversationId)
    .map(entry => entry.event);

const titleOf = conversationId => assistant.list().find(entry => entry.conversationId === conversationId)?.title;

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

/** The turn on the Claude stand-in ends. */
async function reply(onEvent = claude.onEvent) {
    claude.busy = false;
    onEvent({ type: 'assistant-text', text: 'Looking now.' });
    onEvent({ type: 'result', subtype: 'success', isError: false, costUsd: 0 });
    await settle();
}

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

const LONG = 'hey can you have a look at the web box, it has been throwing 502s since the deploy this morning and nobody knows why';

async function main() {
    console.log('\nassistant titles');

    assistant.settings.set({ providers: ['claude-code', 'codex'], provider: 'claude-code', model: '' });

    await check('the first message, cut at eighty, is the name until the agent has named the chat', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, LONG);
        assert.strictEqual(titleOf(conversationId), LONG.slice(0, 80));
        assert.strictEqual(claude.asked.length, 0, 'not asked while the reply is coming');
        await reply();
        assert.strictEqual(claude.asked.length, 1, 'asked once the reply is in');
        assert.strictEqual(claude.asked[0].duringTurn, false);
        assert.strictEqual(titleOf(conversationId), 'Fix 502 errors on web-01');
        const named = eventsOf(conversationId).filter(event => event.type === 'title');
        assert.deepStrictEqual(named.map(event => event.title), ['Fix 502 errors on web-01']);
        assert.ok(assistant.history(conversationId).events.some(event => event.type === 'title'),
            'kept in the log, so a panel rebuilt from it gets the same name');
    });

    await check('asked once, not after every turn', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        const before = claude.asked.length;
        await assistant.send(conversationId, LONG);
        await reply();
        await assistant.send(conversationId, 'and check the load balancer too');
        await reply();
        assert.strictEqual(claude.asked.length, before + 1);
    });

    await check('only the person\'s own words are sent, with a pasted key masked', async () => {
        const key = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, `rotate the key ${key} on the staging api box please`);
        await reply();
        const question = claude.asked.at(-1);
        assert.ok(question.prompt.includes('rotate the key'), 'the message is in it');
        assert.ok(!question.prompt.includes(key), 'the key is not');
        assert.ok(!question.prompt.includes('app-context'), 'nothing the app adds to a turn is in it');
        assert.ok(!question.prompt.includes('Looking now'), 'nor the reply');
        assert.ok(!titleOf(conversationId).includes(key), 'and the draft name is masked too');
    });

    await check('a name the agent quotes a key in is masked on the way back', async () => {
        const key = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
        claude.answer = async () => `Rotate ${key} on staging`;
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, `the token ${key} leaked, rotate it on staging`);
        await reply();
        assert.ok(!titleOf(conversationId).includes(key));
        claude.answer = async () => 'Fix 502 errors on web-01';
    });

    await check('a failed question leaves the eighty-character name', async () => {
        claude.answer = async () => { throw new Error('rate limited'); };
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, LONG);
        await reply();
        assert.strictEqual(titleOf(conversationId), LONG.slice(0, 80));
        assert.ok(!eventsOf(conversationId).some(event => event.type === 'title'));
        claude.answer = async () => 'Fix 502 errors on web-01';
    });

    await check('an answer that is not a title leaves the eighty-character name', async () => {
        claude.answer = async () => 'Sure! I would be happy to help you look into the 502 errors on your web server. First, let us check';
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, LONG);
        await reply();
        assert.strictEqual(titleOf(conversationId), LONG.slice(0, 80));
        claude.answer = async () => 'Fix 502 errors on web-01';
    });

    await check('an agent with no way to ask keeps the eighty-character name', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        assistant.setConversationModel(conversationId, { provider: 'codex' });
        const before = claude.asked.length;
        await assistant.send(conversationId, LONG);
        codex.onEvent({ type: 'result', subtype: 'success', isError: false, costUsd: 0 });
        await settle();
        assert.strictEqual(titleOf(conversationId), LONG.slice(0, 80));
        assert.strictEqual(claude.asked.length, before, 'nobody else is asked in its place');
    });

    await check('a first message too thin to name waits for the next exchange', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        const before = claude.asked.length;
        await assistant.send(conversationId, 'hi');
        await reply();
        assert.strictEqual(claude.asked.length, before, 'not asked after "hi"');
        assert.strictEqual(titleOf(conversationId), 'hi');
        await assistant.send(conversationId, 'the backups on db-02 failed last night');
        await reply();
        assert.strictEqual(claude.asked.length, before + 1);
        assert.ok(claude.asked.at(-1).prompt.includes('backups on db-02'));
    });

    await check('a chat closed while the question is out is left alone', async () => {
        let release;
        claude.answer = () => new Promise((resolve) => { release = resolve; });
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, LONG);
        await reply();
        await assistant.close(conversationId);
        release('Too late');
        await settle();
        assert.ok(!eventsOf(conversationId).some(event => event.type === 'title'));
        claude.answer = async () => 'Fix 502 errors on web-01';
    });

    await check('the answer is cleaned of the dressing models put on it', () => {
        const { clean } = titles._test;
        assert.strictEqual(clean('Title: "Rotate SSH keys on staging."'), 'Rotate SSH keys on staging');
        assert.strictEqual(clean('**Title:** Disk space alert on db-02'), 'Disk space alert on db-02');
        assert.strictEqual(clean('<think>they want a name</think>\nSet up nightly backups'), 'Set up nightly backups');
        assert.strictEqual(clean(''), '');
        assert.ok(clean('a '.repeat(40)).length <= titles.MAX_LENGTH);
    });

    await check('a question that is never answered gives up', async () => {
        // The give-up timer does not hold the app open, so the test does.
        const hold = setTimeout(() => {}, 5000);
        const name = await titles.generate(
            { title: () => new Promise(() => {}) },
            { settings: {}, messages: ['the backups failed'], timeout: 20 }
        );
        clearTimeout(hold);
        assert.strictEqual(name, '');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
