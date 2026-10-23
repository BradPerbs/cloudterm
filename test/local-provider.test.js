const assert = require('assert');

const engine = require('../src/main/ai/providers/openai-compatible');
const local = require('../src/main/ai/providers/local');
const settings = require('../src/main/ai/settings');
const catalog = require('../src/main/ai/tools');

/**
 * The local model provider, and the agent loop underneath it.
 *
 * Nothing here talks to a server. `fetch` is replaced for the duration of each
 * case, which is enough to drive the whole loop: the loop's job is to turn a
 * stream of chunks into transcript events and tool calls, and a stream of
 * chunks is a thing a test can write.
 */

/** A streamed answer, as the reader `complete` pulls from. */
function sseResponse(lines) {
    const body = lines.map(line => `data: ${JSON.stringify(line)}\n`).join('') + 'data: [DONE]\n';
    const chunks = [Buffer.from(body, 'utf8')];
    let index = 0;

    return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
            getReader: () => ({
                read: async () => (index < chunks.length
                    ? { value: chunks[index++], done: false }
                    : { value: undefined, done: true }),
            }),
        },
    };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        headers: { get: () => 'application/json' },
        json: async () => payload,
        text: async () => JSON.stringify(payload),
    };
}

/** Runs `body` with `fetch` answered by `handler`, and always puts it back. */
async function withFetch(handler, body) {
    const original = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options: options || {} });
        return handler(url, options || {}, calls.length);
    };
    try {
        return await body(calls);
    } finally {
        global.fetch = original;
    }
}

const BASE_SETTINGS = {
    provider: 'local',
    localBaseUrl: 'http://localhost:1234/v1',
    model: 'qwen3-8b',
    effort: 'high',
    approval: 'writes',
    commandMode: 'terminal',
    maxTurns: 5,
    transcriptLines: 240,
    allowLocalTools: false,
    autoApproveCommands: [],
    blockedCommands: ['rm -rf'],
    apiKey: '',
};

/** One conversation, collecting every event it produced. */
async function conversation({ handler, text = 'hello', settings: current = BASE_SETTINGS }) {
    const events = [];
    let finished;
    const done = new Promise((resolve) => { finished = resolve; });

    const session = await withFetch(handler, async () => engine.start({
        label: 'The test server',
        prefix: 'test',
        endpoint: () => ({ baseUrl: current.localBaseUrl, apiKey: '', label: 'The test server' }),
        model: () => current.model,
        settings: current,
        getSettings: () => current,
        systemPrompt: 'You operate servers.',
        toolContext: () => ({ settings: current, scope: 'global', boundSessionId: '' }),
        requestApproval: async () => ({ approved: false, message: 'Not in this test.' }),
        onEvent: (event) => {
            events.push(event);
            if (event.type === 'result' || event.type === 'error') finished();
        },
    }));

    // The fetch stub has to stand for the whole turn, not just the start.
    await withFetch(handler, async () => {
        session.send(text);
        await done;
    });

    return { events, session };
}

async function run() {
    /* ---------------- The tools, as JSON Schema ---------------- */

    const tools = engine.functionTools();
    assert.strictEqual(tools.length, catalog.TOOLS.length, 'every tool is offered');

    const command = tools.find(tool => tool.function.name === 'run_command');
    assert.ok(command, 'run_command is in the list');
    assert.strictEqual(command.type, 'function');
    assert.strictEqual(command.function.parameters.type, 'object');
    assert.ok(
        command.function.parameters.properties.command.description,
        'the argument descriptions survive the conversion'
    );
    assert.deepStrictEqual(command.function.parameters.required, ['command']);
    assert.ok(
        !('$schema' in command.function.parameters),
        'the dialect line is stripped, since several servers refuse unknown keys'
    );

    // Every schema has to be an object schema: a function call is named
    // arguments, and a tool that declared anything else could not be called.
    for (const tool of tools) {
        assert.strictEqual(tool.function.parameters.type, 'object', `${tool.function.name} takes an object`);
        assert.ok(tool.function.description, `${tool.function.name} says what it does`);
    }

    /* ---------------- Reading the stream ---------------- */

    const reader = engine.createSseReader();
    // Split mid-payload, which is what a socket actually hands over.
    assert.deepStrictEqual(reader.push('data: {"a":'), [], 'half a payload yields nothing');
    assert.deepStrictEqual(reader.push('1}\ndata: [DONE]\n'), [{ a: 1 }], 'the rest completes it');
    assert.deepStrictEqual(reader.push(': keep-alive\n\n'), [], 'comments are not payloads');
    assert.deepStrictEqual(reader.push('data: not json\n'), [], 'junk does not throw');

    /* ---------------- Assembling one completion ---------------- */

    const seen = [];
    const collector = engine.createCollector(event => seen.push(event));
    collector.chunk({ choices: [{ delta: { content: 'Check' } }] });
    collector.chunk({ choices: [{ delta: { reasoning_content: 'thinking' } }] });
    collector.chunk({ choices: [{ delta: { content: 'ing.' } }] });
    collector.chunk({
        choices: [{
            delta: {
                tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: '{"comm' } }],
            },
        }],
    });
    collector.chunk({
        choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"uptime"}' } }] },
            finish_reason: 'tool_calls',
        }],
        usage: { total_tokens: 42 },
    });

    const assembled = collector.result();
    assert.strictEqual(assembled.content, 'Checking.', 'text arrives in pieces and is joined');
    assert.strictEqual(assembled.finish, 'tool_calls');
    assert.deepStrictEqual(assembled.usage, { total_tokens: 42 });
    assert.strictEqual(assembled.toolCalls.length, 1);
    assert.deepStrictEqual(assembled.toolCalls[0], {
        id: 'c1',
        name: 'run_command',
        args: '{"command":"uptime"}',
    });
    assert.deepStrictEqual(
        seen.map(event => event.type),
        ['text-delta', 'thinking-delta', 'text-delta'],
        'deltas are announced as they arrive'
    );

    // The shape a server that ignores `stream` answers with.
    const whole = engine.createCollector(() => {});
    whole.chunk({ choices: [{ message: { content: 'All done.', reasoning: 'hmm' } }] });
    assert.strictEqual(whole.result().content, 'All done.', 'a non-streamed answer reads the same');

    // A call the stream was cut off in the middle of naming is not a call.
    const cut = engine.createCollector(() => {});
    cut.chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x' }] } }] });
    assert.strictEqual(cut.result().toolCalls.length, 0, 'a nameless fragment is dropped');

    /* ---------------- Keeping the conversation inside the window ---------------- */

    const history = [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'one' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'a' }] },
        { role: 'tool', tool_call_id: 'a', content: 'result' },
        { role: 'user', content: 'two' },
    ];
    const trimmed = engine.trimHistory(history, 3);
    assert.strictEqual(trimmed[0].role, 'system', 'the system message is never dropped');
    assert.ok(
        trimmed.every(message => message.role !== 'tool' || trimmed.some(other => other.tool_calls)),
        'no tool result is left answering a call that was dropped'
    );
    assert.notStrictEqual(trimmed[1].role, 'tool', 'the kept run does not open on an orphan');
    assert.strictEqual(
        engine.trimHistory(history, 80),
        history,
        'a conversation inside the window is left exactly as it is'
    );

    /* ---------------- One turn, end to end ---------------- */

    const plain = await conversation({
        handler: () => sseResponse([
            { choices: [{ delta: { content: 'Nothing ' } }] },
            { choices: [{ delta: { content: 'is wrong.' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ]),
    });

    const types = plain.events.map(event => event.type);
    assert.deepStrictEqual(
        types,
        ['session', 'text-delta', 'text-delta', 'assistant-text', 'result'],
        'a turn with no tool calls is one session, the deltas, the block and a result'
    );
    assert.strictEqual(
        plain.events.find(event => event.type === 'assistant-text').text,
        'Nothing is wrong.'
    );
    assert.strictEqual(plain.events.at(-1).subtype, 'success');

    /* ---------------- A tool call the user refuses ---------------- */

    const refused = await conversation({
        handler: (url, options, call) => (call === 1
            ? sseResponse([
                {
                    choices: [{
                        delta: {
                            tool_calls: [{
                                index: 0,
                                id: 'call-1',
                                function: { name: 'run_command', arguments: '{"command":"reboot"}' },
                            }],
                        },
                        finish_reason: 'tool_calls',
                    }],
                },
            ])
            : sseResponse([
                { choices: [{ delta: { content: 'Understood.' } }, { finish_reason: 'stop' }] },
            ])),
    });

    const call = refused.events.find(event => event.type === 'tool-call');
    assert.ok(call, 'the call is announced before it is run');
    assert.strictEqual(call.name, 'run_command');
    assert.deepStrictEqual(call.input, { command: 'reboot' });
    assert.strictEqual(call.local, false, 'these tools only ever reach a server');

    const result = refused.events.find(event => event.type === 'tool-result');
    assert.ok(result.isError, 'a refusal comes back as an error');
    assert.match(result.text, /Not in this test/);
    assert.ok(
        refused.events.some(event => event.type === 'result'),
        'the turn carries on after the refusal rather than ending'
    );

    /* ---------------- A blocked command never becomes a question ---------------- */

    const blocked = await conversation({
        handler: (url, options, call) => (call === 1
            ? sseResponse([
                {
                    choices: [{
                        delta: {
                            tool_calls: [{
                                index: 0,
                                id: 'call-2',
                                function: { name: 'run_command', arguments: '{"command":"rm -rf /"}' },
                            }],
                        },
                        finish_reason: 'tool_calls',
                    }],
                },
            ])
            : sseResponse([{ choices: [{ delta: { content: 'Right.' } }] }])),
    });

    assert.ok(
        blocked.events.some(event => event.type === 'tool-blocked' && event.rule === 'rm -rf'),
        'the blocked rule is recorded'
    );
    assert.ok(
        !blocked.events.some(event => event.type === 'approval-request'),
        'nothing is put to the user, because no answer would let it run'
    );

    /* ---------------- Stop, while a tool call is on screen ---------------- */

    // The case that matters: a turn spends its time in tool calls, not in the
    // request, so stopping during one has to stop the loop rather than only the
    // fetch that is not currently running.
    {
        const seenEvents = [];
        const calls = [];
        const original = global.fetch;
        let session;

        global.fetch = async () => {
            calls.push(1);
            return sseResponse([
                {
                    choices: [{
                        delta: {
                            tool_calls: [{
                                index: 0,
                                id: 'call-3',
                                function: { name: 'run_command', arguments: '{"command":"uptime"}' },
                            }],
                        },
                        finish_reason: 'tool_calls',
                    }],
                },
            ]);
        };

        try {
            session = await engine.start({
                label: 'The test server',
                prefix: 'test',
                endpoint: () => ({ baseUrl: 'http://localhost:1234/v1', apiKey: '', label: 'x' }),
                model: () => 'qwen3-8b',
                settings: BASE_SETTINGS,
                getSettings: () => BASE_SETTINGS,
                systemPrompt: 'You operate servers.',
                toolContext: () => ({ settings: BASE_SETTINGS, scope: 'global', boundSessionId: '' }),
                requestApproval: async () => {
                    await session.interrupt();
                    return { approved: false, message: 'The user stopped the run.' };
                },
                onEvent: event => seenEvents.push(event),
            });

            session.send('go');
            await session.close();
        } finally {
            global.fetch = original;
        }

        assert.strictEqual(calls.length, 1, 'the model is not asked again after stop');
        assert.ok(
            !seenEvents.some(event => event.type === 'result'),
            'a stopped turn does not report itself as finished'
        );
        assert.ok(
            !seenEvents.some(event => event.type === 'error'),
            'and does not report itself as failed either'
        );
    }

    /* ---------------- Arguments that are not arguments ---------------- */

    const broken = await engine._test.runTool({
        call: { id: 'x', name: 'run_command', args: '{"command": ' },
        toolContext: () => ({ settings: BASE_SETTINGS }),
        requestApproval: async () => ({ approved: true }),
        onEvent: () => {},
    });
    assert.match(broken, /not valid JSON/, 'a half-written call is reported rather than guessed at');

    const unknown = await engine._test.runTool({
        call: { id: 'x', name: 'sudo_everything', args: '{}' },
        toolContext: () => ({ settings: BASE_SETTINGS }),
        requestApproval: async () => ({ approved: true }),
        onEvent: () => {},
    });
    assert.match(unknown, /no tool called/, 'a tool nobody has is answered, not thrown');

    /* ---------------- What the server says it has ---------------- */

    const rows = await withFetch(
        () => jsonResponse({
            data: [
                { id: 'lmstudio-community/Qwen3-8B-GGUF', owned_by: 'lmstudio' },
                { id: 'llama-3.1-8b' },
                { id: '' },
            ],
        }),
        () => local.listModels({ settings: BASE_SETTINGS })
    );

    assert.strictEqual(rows.length, 2, 'a row with no id is not a model');
    assert.strictEqual(rows[0].value, 'lmstudio-community/Qwen3-8B-GGUF');
    assert.strictEqual(rows[0].short, 'Qwen3-8B-GGUF', 'the chip shows the name, not the whole path');
    assert.strictEqual(rows[0].preferred, true, 'the first row is what an unpinned conversation gets');
    assert.strictEqual(rows[1].preferred, false);
    assert.deepStrictEqual(rows[0].effort, [], 'no effort dial, because there is no such field here');

    const nothing = await withFetch(
        () => jsonResponse({ data: [] }),
        () => local.listModels({ settings: BASE_SETTINGS })
    );
    assert.strictEqual(nothing, null, 'an empty server reads as "not asked yet", not as a menu');

    // The address is what the request is built from, and the key travels with it.
    await withFetch(
        (url, options) => {
            assert.strictEqual(url, 'https://192.168.1.9:8080/v1/models');
            assert.strictEqual(options.headers.Authorization, 'Bearer secret');
            return jsonResponse({ data: [{ id: 'm' }] });
        },
        () => local.listModels({
            settings: { ...BASE_SETTINGS, localBaseUrl: 'https://192.168.1.9:8080/v1', apiKey: 'secret' },
        })
    );

    // A key is a credential: it does not travel unencrypted to something that is
    // not this machine. The check is made where the request is built, not where
    // the address is typed, because the address can change after a key is saved.
    await assert.rejects(
        () => local.listModels({
            settings: { ...BASE_SETTINGS, localBaseUrl: 'http://192.168.1.9:8080/v1', apiKey: 'secret' },
        }),
        /not encrypted/i,
        'a plain http address that is not loopback is refused rather than sent the key'
    );

    await assert.rejects(
        () => local.resolveModel({
            ...BASE_SETTINGS, model: '', localBaseUrl: 'http://192.168.1.9:8080/v1', apiKey: 'secret',
        }),
        /not encrypted/i,
        'and the completion path refuses it too, not only the menu'
    );

    // The loopback test is a dotted quad and not a prefix: `127.evil.example`
    // is a DNS name the URL parser hands back as a hostname, so a prefix match
    // would wave it through and the key would leave the machine in the clear.
    for (const sneaky of ['http://127.evil.example/v1', 'http://127.0.0.1.evil.com/v1']) {
        await assert.rejects(
            () => local.listModels({ settings: { ...BASE_SETTINGS, localBaseUrl: sneaky, apiKey: 'secret' } }),
            /not encrypted/i,
            `${sneaky} must not be mistaken for loopback`
        );
    }

    await withFetch(
        () => jsonResponse({ data: [{ id: 'm' }] }),
        async () => {
            // The two that stay allowed: loopback http, which is what a model
            // server you started yourself looks like, and a remote http server
            // that wants no key at all.
            await local.listModels({
                settings: { ...BASE_SETTINGS, localBaseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'secret' },
            });
            // Anywhere in 127.0.0.0/8, not only .0.1.
            await local.listModels({
                settings: { ...BASE_SETTINGS, localBaseUrl: 'http://127.1.2.3:1234/v1', apiKey: 'secret' },
            });
            await local.listModels({
                settings: { ...BASE_SETTINGS, localBaseUrl: 'http://192.168.1.9:8080/v1', apiKey: '' },
            });
        }
    );

    assert.strictEqual(
        local.endpoint({}).baseUrl,
        settings.DEFAULT_LOCAL_URL,
        'with nothing set, the default address is used rather than an empty one'
    );

    /* ---------------- The address, as the settings accept it ---------------- */

    const { cleanUrl } = settings._test;
    assert.strictEqual(cleanUrl('http://localhost:1234/v1/', 'fallback'), 'http://localhost:1234/v1');
    assert.strictEqual(cleanUrl('  http://127.0.0.1:11434/v1  ', 'fallback'), 'http://127.0.0.1:11434/v1');
    assert.strictEqual(cleanUrl('file:///etc/passwd', 'fallback'), 'fallback', 'only http and https');
    assert.strictEqual(cleanUrl('http://user:pass@host/v1', 'fallback'), 'fallback', 'no credentials in it');
    assert.strictEqual(cleanUrl('not a url', 'fallback'), 'fallback');
    assert.strictEqual(cleanUrl('', 'fallback'), 'fallback');

    /* ---------------- Failures that say what to do ---------------- */

    assert.match(
        engine.describeFailure(new Error('connect ECONNREFUSED 127.0.0.1:1234'), 'LM Studio'),
        /could not be reached/
    );
    assert.match(
        engine.describeFailure(new Error('this model does not support tools'), 'LM Studio'),
        /tool support/
    );
    assert.match(engine.describeFailure(new Error('401 Unauthorized'), 'xAI'), /credentials/);
    assert.strictEqual(
        engine.describeFailure(new Error('something else entirely'), 'x'),
        'something else entirely',
        'anything unrecognised is passed through rather than dressed up'
    );

    /* ---------------- Which models are offered ---------------- */

    // A catalogue far longer than the menu. The panel keeps the first hundred
    // rows of whatever it is told, so the models someone actually wants can sit
    // past the cut — which is why the filter is applied before it, not after.
    const catalogue = Array.from({ length: 160 }, (_, index) => ({
        id: `vendor/model-${String(index).padStart(3, '0')}`,
    }));
    catalogue.push({ id: 'deepseek/deepseek-flash-latest' });
    catalogue.push({ id: 'openai/gpt-6-luna-pro' });

    await withFetch(
        () => jsonResponse({ data: catalogue }),
        async () => {
            const rows = await local.listModels({ settings: BASE_SETTINGS });

            assert.strictEqual(rows.length, 100, 'unfiltered, the menu is the first hundred rows');
            assert.strictEqual(
                rows.some(row => row.value.includes('deepseek-flash')),
                false,
                'and the model past that cut is not in it at all'
            );
        }
    );

    await withFetch(
        () => jsonResponse({ data: catalogue }),
        async () => {
            const rows = await local.listModels({
                settings: { ...BASE_SETTINGS, localModelFilter: ['deepseek-flash', 'gpt-6-luna'] },
            });

            assert.deepStrictEqual(
                rows.map(row => row.value),
                ['deepseek/deepseek-flash-latest', 'openai/gpt-6-luna-pro'],
                'filtered, the two named models are the whole list, in the server order'
            );
            assert.strictEqual(rows[0].preferred, true, 'the first match is what an unpinned chat gets');
        }
    );

    await withFetch(
        () => jsonResponse({ data: catalogue }),
        async () => {
            const rows = await local.listModels({
                settings: { ...BASE_SETTINGS, localModelFilter: ['nothing-matches-this'] },
            });

            assert.strictEqual(rows, null, 'a filter matching nothing is an empty menu, not every model');
        }
    );

    // And the model a conversation runs on follows the same list.
    local._test.forget();
    const unpinned = await withFetch(
        () => jsonResponse({ data: catalogue }),
        () => local.resolveModel({ ...BASE_SETTINGS, model: '', localModelFilter: ['gpt-6-luna'] })
    );
    assert.strictEqual(
        unpinned,
        'openai/gpt-6-luna-pro',
        'an unpinned conversation takes the first match, not the first row of the catalogue'
    );

    console.log('local provider tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
