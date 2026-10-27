/**
 * Each conversation's own agent, model, effort and mode, and what new chats
 * start on.
 *
 * The composer's chips used to write the app's settings, so moving one in a
 * tab moved every tab. They now pin the conversation instead (see
 * `ai/conversation-settings.js`), and a pick is also what the next new chat
 * starts on (see `ai/start-model.js`). What is checked here is that a pin
 * stays in its own conversation, decides which agent answers, survives being
 * written out, and that the settings page still moves what follows it.
 *
 * Two agents are stand-ins that record what they were started with, so no
 * runtime is spawned. `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-pins-'));

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

/** An agent that records each start, and each live model or effort change. */
function fakeAgent(name) {
    const record = { name, starts: [], models: [], efforts: [] };
    record.exports = {
        supportsImages: true,
        findClaude: () => 'claude',
        start: async (options) => {
            record.starts.push(options);
            return {
                send: () => {},
                setModel: async (model) => record.models.push(model),
                setEffort: async (effort) => record.efforts.push(effort),
                interrupt: async () => {},
                close: async () => {},
            };
        },
    };
    return record;
}

const claude = fakeAgent('claude-code');
const codex = fakeAgent('codex');
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'))] = { loaded: true, exports: claude.exports };
require.cache[require.resolve(path.join(ROOT, 'ai', 'providers', 'codex'))] = { loaded: true, exports: codex.exports };

const assistant = require(path.join(ROOT, 'ai'));
const archive = require(path.join(ROOT, 'ai', 'archive'));
const startModel = require(path.join(ROOT, 'ai', 'start-model'));
const pinRules = require(path.join(ROOT, 'ai', 'conversation-settings'));

const notified = [];
assistant.setNotifier((channel, payload) => notified.push({ channel, ...payload }));

const eventsOf = (conversationId) => notified
    .filter(entry => entry.channel === 'ai-event' && entry.conversationId === conversationId)
    .map(entry => entry.event);

/** Back to a profile where nothing has been picked yet. */
function forgetStart() {
    fs.rmSync(path.join(userData, 'start-model.json'), { force: true });
    startModel._test.reset();
}

/** A conversation that starts on the settings alone, with nothing picked before it. */
function blank() {
    forgetStart();
    return assistant.create({ scope: 'global' }).conversationId;
}

/** Change the settings the way the settings page does. */
function settingsPage(patch) {
    const before = assistant.settings.get();
    const after = assistant.settings.set(patch);
    assistant.reconfigure(before, after);
    startModel.follow(before, after);
    return after;
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

async function main() {
    console.log('\nassistant pins');

    assistant.settings.set({
        providers: ['claude-code', 'codex'],
        provider: 'claude-code',
        model: '',
        effort: 'high',
        approval: 'writes',
    });
    forgetStart();

    await check('a mode picked in one conversation leaves the other and the settings alone', async () => {
        const a = assistant.create({ scope: 'global' }).conversationId;
        const b = assistant.create({ scope: 'global' }).conversationId;
        const result = assistant.setConversationModel(a, { approval: 'never' });
        assert.deepStrictEqual(result.pinned, { approval: 'never' });
        assert.strictEqual(assistant.effectiveSettings(assistant.get(a)).approval, 'never');
        assert.strictEqual(assistant.effectiveSettings(assistant.get(b)).approval, 'writes');
        assert.strictEqual(assistant.settings.get().approval, 'writes');
    });

    await check('a mode that moved is said, from and to, for the activity log', async () => {
        const id = assistant.create({ scope: 'global' }).conversationId;
        const moved = assistant.setConversationModel(id, { approval: 'always' });
        assert.deepStrictEqual(moved.mode, { from: 'writes', to: 'always' });
        const same = assistant.setConversationModel(id, { effort: 'low' });
        assert.strictEqual(same.mode, undefined, 'an effort pick moves no mode');
    });

    await check('the conversation answers on the agent and model it was pinned to', async () => {
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { provider: 'codex', model: 'gpt-5.5', effort: 'medium' });
        const result = await assistant.send(id, 'how full is the disk on web-01');
        assert.ok(result.success, result.message);
        const started = codex.starts.at(-1);
        assert.strictEqual(started.settings.provider, 'codex');
        assert.strictEqual(started.settings.model, 'gpt-5.5');
        assert.strictEqual(started.settings.effort, 'medium');
        assert.strictEqual(started.getSettings().provider, 'codex', 'and reads it again on every call');
    });

    await check('a model named on its own is pinned with the agent answering', async () => {
        const id = blank();
        const { pinned } = assistant.setConversationModel(id, { model: 'opus' });
        assert.strictEqual(pinned.provider, 'claude-code');
        assert.strictEqual(pinned.model, 'opus');
    });

    await check('another agent picked with no model lets go of the old model', async () => {
        const id = blank();
        assistant.setConversationModel(id, { model: 'opus' });
        const { pinned } = assistant.setConversationModel(id, { provider: 'codex' });
        assert.strictEqual(pinned.provider, 'codex');
        assert.strictEqual(pinned.model, undefined);
    });

    await check('a pick on a running query is pushed at it, not restarted', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        await assistant.send(id, 'check nginx on web-01');
        const starts = claude.starts.length;
        assistant.setConversationModel(id, { model: 'sonnet', effort: 'max' });
        assert.strictEqual(claude.models.at(-1), 'sonnet');
        assert.strictEqual(claude.efforts.at(-1), 'max');
        await assistant.send(id, 'and on web-02');
        assert.strictEqual(claude.starts.length, starts, 'the same query carried on');
    });

    await check('a change of agent after something was said leaves a line in the chat', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        await assistant.send(id, 'what is using port 443');
        assistant.setConversationModel(id, { provider: 'codex', model: 'gpt-5.5', effort: 'low' });
        const line = eventsOf(id).find(event => event.type === 'model-changed');
        assert.ok(line, 'the line went in');
        assert.strictEqual(line.change.model, 'gpt-5.5');
        assert.strictEqual(line.change.agent, 'Codex');
        assert.strictEqual(line.change.agentChanged, true);
        assert.strictEqual(line.change.effort, 'low');
        assert.ok(/^Switched to gpt-5\.5 on Codex/.test(line.text), line.text);

        await assistant.send(id, 'and port 80');
        assert.strictEqual(codex.starts.at(-1).settings.provider, 'codex', 'the next message went to Codex');
    });

    await check('an empty chat gets no line for a pick', async () => {
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { model: 'haiku' });
        assert.ok(!eventsOf(id).some(event => event.type === 'model-changed'));
    });

    await check('every window hears about a pick, for its chips', async () => {
        const id = blank();
        assistant.setConversationModel(id, { approval: 'always' });
        const told = eventsOf(id).filter(event => event.type === 'pinned').at(-1);
        assert.deepStrictEqual(told.pinned, { approval: 'always' });
        assert.deepStrictEqual(assistant.history(id).pinned, { approval: 'always' });
    });

    await check('an agent switched off hands its conversations back to the settings', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { provider: 'codex', model: 'gpt-5.5' });
        await assistant.send(id, 'uptime on db-01');
        const claudeStarts = claude.starts.length;

        settingsPage({ providers: ['claude-code'] });
        const now = assistant.effectiveSettings(assistant.get(id));
        assert.strictEqual(now.provider, 'claude-code');
        assert.strictEqual(now.model, '', 'the Codex model does not go with it');

        await assistant.send(id, 'and on db-02');
        assert.strictEqual(claude.starts.length, claudeStarts + 1, 'restarted on Claude Code');
        settingsPage({ providers: ['claude-code', 'codex'], provider: 'claude-code' });
    });

    await check('a settings page change moves a conversation following it and not a pinned one', async () => {
        forgetStart();
        const following = assistant.create({ scope: 'global' }).conversationId;
        const pinned = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(pinned, { model: 'opus', effort: 'low' });
        await assistant.send(following, 'free memory on web-01');
        const followingSession = claude.starts.length;
        await assistant.send(pinned, 'free memory on web-02');
        assert.strictEqual(claude.starts.length, followingSession + 1);

        claude.models.length = 0;
        claude.efforts.length = 0;
        settingsPage({ model: 'sonnet', effort: 'max' });
        assert.deepStrictEqual(claude.models, ['sonnet'], 'one session told, not two');
        assert.deepStrictEqual(claude.efforts, ['max']);
        assert.strictEqual(assistant.effectiveSettings(assistant.get(pinned)).model, 'opus');
        assert.strictEqual(assistant.effectiveSettings(assistant.get(following)).model, 'sonnet');
        settingsPage({ model: '', effort: 'high' });
    });

    await check('a pick is what the next new chat starts on', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { provider: 'codex', model: 'gpt-5.5' }, { remember: true });
        assistant.setConversationModel(id, { approval: 'always' }, { remember: true });
        const next = assistant.create({ scope: 'global' });
        assert.strictEqual(next.pinned.provider, 'codex');
        assert.strictEqual(next.pinned.model, 'gpt-5.5');
        assert.strictEqual(next.pinned.approval, 'always');
    });

    await check('what a message was sent with is what the next new chat starts on', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { model: 'opus', effort: 'max', approval: 'never' });
        await assistant.send(id, 'restart nginx on web-01');
        const next = assistant.create({ scope: 'global' });
        assert.deepStrictEqual(
            next.pinned,
            { provider: 'claude-code', model: 'opus', effort: 'max', approval: 'never' }
        );
    });

    await check('the star beats the last pick for new chats', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { provider: 'codex', model: 'gpt-5.5' }, { remember: true });
        const state = assistant.starModel({ provider: 'claude-code', model: 'sonnet' });
        assert.deepStrictEqual(state.starred, { provider: 'claude-code', model: 'sonnet' });
        assert.strictEqual(assistant.create({ scope: 'global' }).pinned.model, 'sonnet');
        assert.ok(notified.some(entry => entry.channel === 'ai-start-model'), 'every window hears of the star');
        assistant.starModel(null);
        assert.strictEqual(assistant.create({ scope: 'global' }).pinned.model, 'gpt-5.5');
    });

    await check('a settings page change is what new chats start on, over an older pick', async () => {
        forgetStart();
        const id = assistant.create({ scope: 'global' }).conversationId;
        assistant.setConversationModel(id, { model: 'opus', approval: 'never' }, { remember: true });
        settingsPage({ model: 'sonnet', approval: 'always' });
        const next = assistant.create({ scope: 'global' });
        assert.strictEqual(next.pinned.model, 'sonnet');
        assert.strictEqual(next.pinned.approval, 'always');

        // An agent switched there with no model takes that agent's default.
        settingsPage({ provider: 'codex' });
        const after = assistant.create({ scope: 'global' });
        assert.ok(!after.pinned?.model, 'no model is carried over to another agent');
        assert.strictEqual(assistant.effectiveSettings(assistant.get(after.conversationId)).provider, 'codex');
        settingsPage({ provider: 'claude-code', model: '', approval: 'writes' });
    });

    await check('a pick on an agent switched off since is passed over', async () => {
        forgetStart();
        startModel.remember({ provider: 'codex', model: 'gpt-5.5', effort: 'low' });
        const pick = startModel.pickFor({ provider: 'claude-code', providers: ['claude-code'] });
        assert.deepStrictEqual(pick, { effort: 'low' });
    });

    await check('a pin is written out with the conversation and read back', async () => {
        const record = archive.pack({
            id: 'conv-pinned',
            scope: 'global',
            boundSessionId: '',
            sessionIds: [],
            hostIds: [],
            events: [{ type: 'user-message', text: 'hello', at: 1 }],
            title: 'hello',
            titleSource: 'naming',
            settingsPatch: { provider: 'codex', model: 'gpt-5.5', approval: 'always' },
            createdAt: 1,
            updatedAt: 2,
        });
        const back = archive.unpack(JSON.parse(JSON.stringify(record)), 'claude-code');
        assert.deepStrictEqual(back.settingsPatch, { provider: 'codex', model: 'gpt-5.5', approval: 'always' });
        assert.strictEqual(back.titleSource, 'draft', 'a name still being asked for is asked again');
    });

    await check('a stored pin keeps only what this build understands', async () => {
        const back = archive.unpack({
            id: 'conv-odd',
            scope: 'global',
            events: [],
            title: 'x',
            settingsPatch: { effort: 'enormous', approval: 'sometimes', model: 'opus', provider: 'claude-code' },
        }, 'claude-code');
        assert.deepStrictEqual(back.settingsPatch, { provider: 'claude-code', model: 'opus' });
    });

    await check('the rules read a pin the same way on both sides', async () => {
        const base = { provider: 'claude-code', providers: ['claude-code', 'codex'], model: 'opus', effort: 'high', approval: 'writes' };
        const { shownSettings } = await import(pathToFileURL(
            path.join(__dirname, '..', 'src', 'renderer', 'lib', 'conversation-settings.js')
        ).href);
        const pins = [
            null,
            { approval: 'never' },
            { provider: 'codex' },
            { provider: 'codex', model: 'gpt-5.5', effort: 'low' },
            { provider: 'claude-code', model: 'sonnet' },
            { provider: 'kimi', model: 'k2' },
        ];
        for (const pin of pins) {
            const main = pinRules.effective(base, pin);
            const shown = shownSettings(base, pin);
            for (const field of ['provider', 'model', 'effort', 'approval']) {
                assert.strictEqual(shown[field], main[field], `${field} under ${JSON.stringify(pin)}`);
            }
        }
    });

    await check('models hidden from the menu are kept per agent, and an unknown agent\'s are dropped', async () => {
        const { sanitize } = assistant.settings._test;
        const next = sanitize({
            hiddenModels: { codex: ['gpt-5.1-codex-mini', 'gpt-5.1-codex-mini', ' '], nobody: ['x'], grok: [] },
        });
        assert.deepStrictEqual(next.hiddenModels, { codex: ['gpt-5.1-codex-mini'] });
        assert.deepStrictEqual(sanitize({}).hiddenModels, {});
        const saved = assistant.settings.set({ hiddenModels: { 'claude-code': ['haiku'] } });
        assert.deepStrictEqual(saved.hiddenModels, { 'claude-code': ['haiku'] });
        assert.deepStrictEqual(assistant.settings.set({ effort: 'low' }).hiddenModels, { 'claude-code': ['haiku'] },
            'and kept through other changes');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
