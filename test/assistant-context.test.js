/**
 * How full the model's context is, for the ring beside the composer's model
 * chip.
 *
 * Each runtime says it differently. Claude Code puts tokens on every reply
 * and the window only on a turn's result; OpenCode puts tokens on each reply
 * and the window in its model catalogue; Grok Build puts tokens on a line
 * per model call and the window in the CLI's own model cache. What every one
 * of them has to come out as is one reading per reply, of that reply's
 * tokens over the window, never the turn's sum, which counts the same prefix
 * again on every tool round.
 *
 * Then the conversation layer, which keeps only the latest reading and says
 * whose it is, and the panel's fold, which holds it for the ring.
 *
 * `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-context-'));

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

// The real runtimes' readers, taken before the conversation layer below is
// given a stand-in Claude Code to talk to.
const CLAUDE = require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'));
const claudeCode = require(CLAUDE);
const opencode = require(path.join(ROOT, 'ai', 'providers', 'opencode'));
const grok = require(path.join(ROOT, 'ai', 'providers', 'grok'));

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

const readings = events => events.filter(event => event.type === 'context');

async function main() {
    console.log('\nassistant context');

    await check('Claude Code: the first reading comes with the turn\'s result, then each reply moves it', () => {
        const events = [];
        const meter = claudeCode.createContextMeter(event => events.push(event));
        const reply = (input, read, output) => ({
            type: 'assistant',
            parent_tool_use_id: null,
            message: {
                model: 'claude-opus-4-5',
                usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: output },
            },
        });

        meter.see(reply(1000, 40000, 500));
        assert.strictEqual(readings(events).length, 0, 'no window known yet');

        meter.see({ type: 'result', modelUsage: { 'claude-opus-4-5': { inputTokens: 1000, contextWindow: 200000 } } });
        assert.deepStrictEqual(readings(events)[0], {
            type: 'context', used: 41500, limit: 200000, percent: 21, model: 'claude-opus-4-5', cached: 40000,
        });

        meter.see(reply(2000, 150000, 1000));
        assert.strictEqual(readings(events).at(-1).used, 153000);
        assert.strictEqual(readings(events).at(-1).percent, 77);

        meter.see(reply(2000, 150000, 1000));
        assert.strictEqual(readings(events).length, 2, 'the same reading is not said twice');
    });

    await check('Claude Code: a subagent\'s replies are its own context, not this one\'s', () => {
        const events = [];
        const meter = claudeCode.createContextMeter(event => events.push(event));
        meter.see({ type: 'result', modelUsage: { 'claude-opus-4-5': { inputTokens: 1, contextWindow: 200000 } } });
        meter.see({
            type: 'assistant',
            parent_tool_use_id: 'toolu_1',
            message: { model: 'claude-opus-4-5', usage: { input_tokens: 90000, output_tokens: 10 } },
        });
        assert.strictEqual(readings(events).length, 0);
    });

    await check('Claude Code: the window is the model\'s own, with the [1m] suffix ignored', () => {
        const usage = {
            'claude-haiku-4-5': { inputTokens: 900000, contextWindow: 200000 },
            'claude-opus-4-5[1m]': { inputTokens: 10, contextWindow: 1000000 },
        };
        assert.strictEqual(claudeCode.contextWindowOf(usage, 'claude-opus-4-5'), 1000000);
        assert.strictEqual(claudeCode.contextWindowOf(usage, ''), 200000, 'the busiest when none matches');
        assert.strictEqual(claudeCode.contextWindowOf({}, 'x'), 0);
    });

    await check('OpenCode: a reply\'s tokens, cache included, over the catalogue\'s window', async () => {
        const events = [];
        const translator = opencode.createTranslator('s-1', event => events.push(event), {
            contextLimit: (provider, model) => (provider === 'anthropic' && model === 'sonnet' ? 100000 : 0),
        });
        await translator.event({
            type: 'message.updated',
            properties: { info: {
                id: 'm-1', sessionID: 's-1', role: 'assistant', providerID: 'anthropic', modelID: 'sonnet',
                tokens: { input: 1000, output: 200, reasoning: 300, cache: { read: 8000, write: 500 } },
            } },
        });
        assert.deepStrictEqual(readings(events)[0], {
            type: 'context', used: 10000, limit: 100000, percent: 10, model: 'anthropic/sonnet', cached: 8000,
        });
    });

    await check('OpenCode: without a window the tokens still come, with no share', async () => {
        const events = [];
        const translator = opencode.createTranslator('s-1', event => events.push(event));
        await translator.event({
            type: 'message.updated',
            properties: { info: { id: 'm-1', sessionID: 's-1', role: 'assistant', tokens: { input: 50, output: 5 } } },
        });
        await translator.event({
            type: 'message.updated',
            properties: { info: { id: 'm-2', sessionID: 'other', role: 'assistant', tokens: { input: 9, output: 9 } } },
        });
        assert.strictEqual(readings(events).length, 1, 'another session\'s reply is not this one\'s');
        assert.strictEqual(readings(events)[0].used, 55);
        assert.strictEqual(readings(events)[0].percent, null);
    });

    await check('Grok Build: each model call is a reading, over the window in the CLI\'s cache', () => {
        const events = [];
        const translator = grok.createTranslator(event => events.push(event), {
            model: 'grok-4',
            contextLimit: name => (name === 'grok-4' ? 256000 : 0),
        });
        translator.event({ type: 'usage', usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 10000 } });
        translator.event({ type: 'usage', usage: { input_tokens: 2500, output_tokens: 400, cache_read_input_tokens: 12000 } });
        // The closing line sums both calls: the bill, not the window.
        translator.event({ type: 'end', num_turns: 2, usage: { input_tokens: 4500, output_tokens: 700 } });
        assert.deepStrictEqual(readings(events).map(event => event.used), [12300, 14900]);
        assert.strictEqual(readings(events).at(-1).limit, 256000);
        assert.strictEqual(readings(events).at(-1).cached, 12000);
    });

    await check('Grok Build: a single call\'s closing total is the window when nothing else said', () => {
        const events = [];
        const translator = grok.createTranslator(event => events.push(event), {
            model: 'grok-4',
            contextLimit: () => 256000,
        });
        translator.event({ type: 'end', num_turns: 1, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 5120 } });
        assert.strictEqual(readings(events)[0].used, 5120);
        assert.strictEqual(readings(events)[0].percent, 2);
    });

    await check('Grok Build: no window, no reading', () => {
        const events = [];
        const translator = grok.createTranslator(event => events.push(event));
        translator.event({ type: 'usage', usage: { input_tokens: 2000, output_tokens: 300 } });
        assert.strictEqual(readings(events).length, 0);
    });

    await check('Grok Build: the windows are read from the CLI\'s model cache under every spelling', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-grok-home-'));
        fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify({
            models: {
                'grok-4-latest': { info: { id: 'grok-4', context_window: 256000 } },
                'grok-code': { info: { contextWindows: [131072] } },
                'grok-mystery': { info: {} },
            },
        }));
        const windows = grok.contextWindows({ source: home });
        assert.strictEqual(windows.get('grok-4-latest'), 256000);
        assert.strictEqual(windows.get('grok-4'), 256000);
        assert.strictEqual(windows.get('grok-code'), 131072);
        assert.strictEqual(windows.has('grok-mystery'), false);
    });

    // The conversation layer, with a stand-in Claude Code whose events the
    // test decides.
    const agent = { onEvent: null };
    require.cache[CLAUDE] = { id: CLAUDE, filename: CLAUDE, loaded: true, exports: {
        findClaude: () => 'claude',
        start: async (options) => {
            agent.onEvent = options.onEvent;
            return { send: () => {}, interrupt: async () => {}, close: async () => {} };
        },
    } };
    const assistant = require(path.join(ROOT, 'ai'));
    const notified = [];
    assistant.setNotifier((channel, payload) => notified.push({ channel, ...payload }));
    assistant.settings.set({ providers: ['claude-code'], provider: 'claude-code' });

    await check('a conversation keeps only the latest reading, marked with whose it is', async () => {
        const { conversationId } = assistant.create({ scope: 'global' });
        await assistant.send(conversationId, 'how big is /var/log on web-01');
        agent.onEvent({ type: 'context', used: 1000, limit: 200000, percent: 1 });
        agent.onEvent({ type: 'context', used: 3000, limit: 200000, percent: 2 });
        const kept = readings(assistant.history(conversationId).events);
        assert.strictEqual(kept.length, 1);
        assert.strictEqual(kept[0].used, 3000);
        assert.strictEqual(kept[0].provider, 'claude-code');
        const sent = notified.filter(entry => entry.channel === 'ai-event' && entry.event.type === 'context');
        assert.strictEqual(sent.length, 2, 'every window still hears each one');
    });

    const reducer = await import(pathToFileURL(
        path.join(__dirname, '..', 'src', 'renderer', 'lib', 'transcript-reducer.js')
    ).href);

    await check('the panel holds the latest reading and the agent\'s name for the chat', () => {
        const state = reducer.replay([
            { type: 'user-message', text: 'hello', at: 1 },
            { type: 'context', used: 10, limit: 100, percent: 10, provider: 'claude-code', at: 2 },
            { type: 'title', title: 'Check web-01 logs', at: 3 },
            { type: 'context', used: 40, limit: 100, percent: 40, provider: 'claude-code', at: 4 },
        ]);
        assert.strictEqual(state.context.percent, 40);
        assert.strictEqual(state.title, 'Check web-01 logs');
        assert.strictEqual(state.items.length, 1, 'neither is a row in the transcript');
        assert.strictEqual(reducer.INITIAL.context, null);
        assert.strictEqual(reducer.INITIAL.title, '');
    });

    await check('a switch line carries what moved, for the divider to say', () => {
        const state = reducer.replay([
            { type: 'model-changed', text: 'Switched to Opus on Claude Code', change: { model: 'Opus', agent: 'Claude Code', agentChanged: true }, at: 5 },
        ]);
        assert.deepStrictEqual(state.items[0].change, { model: 'Opus', agent: 'Claude Code', agentChanged: true });
        assert.strictEqual(state.items[0].text, 'Switched to Opus on Claude Code');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
