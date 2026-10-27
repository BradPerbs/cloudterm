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
// A first run ticks Claude Code only when it can be found, so the stub has to
// say it is installed or the conversation has no agent to send to.
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'))] = { exports: {
    supportsImages: true,
    findClaude: () => 'claude',
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
const catalog = require(path.join(ROOT, 'ai', 'tools'));
const pasted = require(path.join(ROOT, 'ai', 'pasted-secrets'));
const activity = require(path.join(ROOT, 'activity'));

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

    await check('ask_user puts up the card Claude Code\'s question draws, and hands back the pick', async () => {
        const { conversationId, toolContext } = await started();
        const ask = catalog.BY_NAME.get('ask_user');
        const reply = ask.handler(
            { question: 'Which port should nginx listen on?', options: ['80', '8080'] },
            toolContext()
        );
        await tick();

        const card = eventsOf(conversationId).find(event => event.type === 'approval-request');
        assert.strictEqual(card.question, true, 'drawn as a question, not an approval');
        assert.strictEqual(card.name, 'ask_user');
        assert.strictEqual(card.sessionId, '', 'a question is not drawn against a server');
        assert.deepStrictEqual(card.input, {
            questions: [{
                question: 'Which port should nginx listen on?',
                header: '',
                multiSelect: false,
                options: [{ label: '80', description: '' }, { label: '8080', description: '' }],
            }],
        });

        // Exactly what the card sends back for a pick.
        assert.strictEqual(assistant.respondToApproval({
            requestId: card.requestId,
            approved: true,
            input: { answers: { 'Which port should nginx listen on?': '8080' } },
        }), true);

        const result = await reply;
        assert.ok(!result.isError);
        assert.deepStrictEqual(JSON.parse(result.text), { answer: '8080', chosen: true });
        assert.ok(eventsOf(conversationId).some(event => event.type === 'approval-settled'
            && event.requestId === card.requestId && event.status === 'approved'));
    });

    await check('a question with no options takes a typed answer, and a skip is an answer too', async () => {
        const { conversationId, toolContext } = await started();
        const ask = catalog.BY_NAME.get('ask_user');

        const typed = ask.handler({ question: 'What is the database called?' }, toolContext());
        await tick();
        let card = eventsOf(conversationId).filter(event => event.type === 'approval-request').pop();
        assert.deepStrictEqual(card.input.questions[0].options, [], 'free text has nothing to pick');
        assistant.respondToApproval({
            requestId: card.requestId, approved: true,
            input: { answers: { 'What is the database called?': 'billing_prod' } },
        });
        assert.deepStrictEqual(JSON.parse((await typed).text), { answer: 'billing_prod' });

        const skipped = ask.handler({ question: 'Restart now?', options: ['Yes', 'No'] }, toolContext());
        await tick();
        card = eventsOf(conversationId).filter(event => event.type === 'approval-request').pop();
        assistant.respondToApproval({ requestId: card.requestId, approved: false, message: 'The user skipped the question.' });
        const result = await skipped;
        assert.strictEqual(result.isError, true);
        assert.ok(/skipped/.test(result.text));
    });

    await check('a question outlasts a runtime that stops waiting, and the answer goes as the next message', async () => {
        const { conversationId, toolContext, onEvent } = await started();
        const ask = catalog.BY_NAME.get('ask_user');
        const question = 'Which of the two replicas should go first?';

        // The row the agent's own stream draws for the call.
        onEvent({ type: 'tool-call', id: 'call-7', name: 'ask_user', input: { question, options: ['db-1', 'db-2'] } });
        const controller = new AbortController();
        const reply = ask.handler({ question, options: ['db-1', 'db-2'] }, { ...toolContext(), signal: controller.signal });
        await tick();
        const card = eventsOf(conversationId).filter(event => event.type === 'approval-request').pop();

        controller.abort();
        const result = await reply;
        assert.ok(!result.isError, 'handing the turn back is not a failure');
        assert.ok(/End your turn now/.test(result.text), 'the agent is told what to do next');
        assert.ok(!eventsOf(conversationId).some(event => event.type === 'approval-settled'
            && event.requestId === card.requestId), 'the card stays up');

        const before = agent.sent.length;
        assert.strictEqual(assistant.respondToApproval({
            requestId: card.requestId, approved: true, input: { answers: { [question]: 'db-2' } },
        }), true, 'the card can still be answered');
        await tick();
        await tick();

        const events = eventsOf(conversationId);
        assert.ok(events.some(event => event.type === 'approval-settled' && event.requestId === card.requestId));
        const closed = events.filter(event => event.type === 'tool-result' && event.id === 'call-7').pop();
        assert.strictEqual(closed?.text, 'db-2', 'the row is closed out with the answer');
        const message = events.filter(event => event.type === 'user-message').pop();
        assert.strictEqual(message.text, 'db-2', 'the answer is the user\'s next message');
        assert.ok(agent.sent.slice(before).some(text => text.endsWith('db-2')), 'and it reaches the agent');
    });

    await check('stopping the run takes down a question still waiting', async () => {
        const { conversationId, toolContext } = await started();
        const reply = catalog.BY_NAME.get('ask_user').handler({ question: 'Go on?' }, toolContext());
        await tick();
        await assistant.interrupt(conversationId);
        const result = await reply;
        assert.strictEqual(result.isError, true);
        assert.ok(/stopped the run/.test(result.text));
    });

    await check('closing a conversation takes down a question whose turn already ended', async () => {
        const { conversationId, toolContext } = await started();
        const controller = new AbortController();
        const reply = catalog.BY_NAME.get('ask_user').handler(
            { question: 'Which one?' },
            { ...toolContext(), signal: controller.signal }
        );
        await tick();
        const card = eventsOf(conversationId).filter(event => event.type === 'approval-request').pop();
        controller.abort();
        await reply;

        await assistant.close(conversationId);
        assert.ok(eventsOf(conversationId).some(event => event.type === 'approval-settled'
            && event.requestId === card.requestId), 'the card is settled');
        assert.strictEqual(assistant.respondToApproval({
            requestId: card.requestId, approved: true, input: { answers: { 'Which one?': 'that one' } },
        }), false, 'and an answer has nowhere to go');
    });

    await check('a key pasted into chat reaches the agent, and is masked everywhere the chat is kept', async () => {
        const key = 'ghp_Zq81LmNoPqRsTuVwXyZa0123456789abcd';
        const { conversationId } = assistant.create({ scope: 'global' });

        // Recorded before the key was pasted: the same value printed by a
        // tool, which must not survive in the history either.
        const early = await assistant.send(conversationId, 'what is in the deploy env file?');
        assert.ok(early.success);
        agent.options.onEvent({ type: 'tool-result', id: 'call-1', text: `GITHUB_TOKEN=${key}\n` });

        const before = agent.sent.length;
        const sent = await assistant.send(conversationId, `use ${key} for the deploy`);
        assert.ok(sent.success);
        assert.ok(agent.sent[before].includes(key), 'the agent is sent the value, so the turn can use it');

        // The agent using it in a command, and quoting it back.
        agent.options.onEvent({
            type: 'tool-call', id: 'call-2', name: 'run_command',
            input: { command: `gh auth login --with-token <<< ${key}` },
        });
        agent.options.onEvent({ type: 'assistant-text', text: `Logged in with ${key}.` });
        agent.options.onEvent({ type: 'result', costUsd: 0 });

        const live = eventsOf(conversationId);
        assert.ok(!JSON.stringify(live.slice(-4)).includes(key), 'what the window is sent is masked');
        const history = assistant.history(conversationId);
        assert.ok(!JSON.stringify(history.events).includes(key), 'and so is what a reload replays, earlier events too');
        assert.ok(history.events.some(event => event.type === 'user-message' && event.text === `use ${pasted.MASK} for the deploy`));

        // Written to disk: the history file and the activity log.
        await assistant.shutdown();
        const saved = fs.readFileSync(path.join(userData, 'assistant-history.json'), 'utf8');
        assert.ok(saved.includes('for the deploy'), 'the conversation was written');
        assert.ok(!saved.includes(key), 'without the key');
        activity.flush();
        const logged = fs.readFileSync(path.join(userData, 'activity.json'), 'utf8');
        assert.ok(logged.includes('gh auth login'), 'the command was logged');
        assert.ok(!logged.includes(key), 'without the key');
    });

    await check('a title taken from a message with a key in it is masked', async () => {
        const key = 'sk-ant-api03-Qw3rTy8UiOp0AsDfGhJkLzXcVbNm12';
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, `${key} is the key`);
        const listed = assistant.list().find(entry => entry.conversationId === conversationId);
        assert.strictEqual(listed.title, `${pasted.MASK} is the key`);
    });

    await assistant.shutdown();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
