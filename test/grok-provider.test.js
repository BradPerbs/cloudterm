const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const provider = require('../src/main/ai/providers/grok');
const mcpHost = require('../src/main/ai/mcp-host');

/**
 * The Grok Build provider: where its CLI is found, how one headless run is
 * described, and what its stream turns into.
 *
 * The stream is the part worth testing hardest. Everything the panel draws for
 * this agent comes out of `createTranslator`, and it is reading a format that
 * is not this app's to define, so the cases below are the shapes it has to
 * survive rather than one blessed spelling.
 */

/** A filesystem made of nothing but the paths given. */
function fakeAccess(files) {
    const known = new Set(files);
    return {
        accessSync(file) {
            if (!known.has(file)) throw new Error(`ENOENT: ${file}`);
        },
    };
}

const WINDOWS_HOME = 'C:\\Users\\Mario';
const UNIX_HOME = '/Users/mario';

function collect() {
    const events = [];
    return { events, onEvent: event => events.push(event) };
}

async function run() {
    /* ---------------- Finding the CLI ---------------- */

    const windowsRoots = provider.grokRoots({
        platform: 'win32',
        home: WINDOWS_HOME,
        env: { PATH: 'C:\\tools;C:\\other', LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local' },
    });
    assert.strictEqual(windowsRoots[0], 'C:\\tools', 'a PATH the user arranged comes first');
    assert.ok(
        windowsRoots.includes('C:\\Users\\Mario\\.grok\\bin'),
        'the install script\'s own folder is looked in, since a packaged app has a short PATH'
    );
    assert.ok(windowsRoots.includes('C:\\Users\\Mario\\AppData\\Local\\Programs\\grok'));

    const unixRoots = provider.grokRoots({
        platform: 'darwin',
        home: UNIX_HOME,
        env: { PATH: '/usr/local/bin' },
    });
    assert.ok(unixRoots.includes('/Users/mario/.grok/bin'));
    assert.ok(unixRoots.includes('/opt/homebrew/bin'));

    assert.strictEqual(
        provider.findGrok({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeAccess(['/Users/mario/.grok/bin/grok']),
        }),
        '/Users/mario/.grok/bin/grok'
    );

    assert.strictEqual(
        provider.findGrok({
            platform: 'win32',
            home: WINDOWS_HOME,
            env: { PATH: 'C:\\tools', APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming' },
            ...fakeAccess(['C:\\Users\\Mario\\AppData\\Roaming\\npm\\grok.cmd']),
        }),
        'C:\\Users\\Mario\\AppData\\Roaming\\npm\\grok.cmd',
        'an npm shim counts, because this provider spawns through cross-spawn'
    );

    assert.strictEqual(
        provider.findGrok({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeAccess(['/usr/local/bin/codex']),
        }),
        '',
        'a machine without it says so rather than guessing at a path'
    );

    /* ---------------- One headless run ---------------- */

    const base = {
        maxTurns: 25,
        model: 'grok-build-0.1',
        effort: 'high',
        allowLocalTools: false,
    };

    const first = provider.runArguments({
        current: base,
        sessionId: 'abc-123',
        resume: false,
        directory: '/tmp/work',
        prompt: 'do the thing',
    });

    assert.deepStrictEqual(first.slice(0, 2), ['-p', 'do the thing']);
    assert.ok(first.includes('--output-format') && first.includes('streaming-json'));
    assert.strictEqual(first[first.indexOf('--session-id') + 1], 'abc-123', 'a new session gets our id');
    assert.ok(!first.includes('--resume'));
    assert.strictEqual(first[first.indexOf('--max-turns') + 1], '25');
    assert.strictEqual(first[first.indexOf('--model') + 1], 'grok-build-0.1');
    assert.strictEqual(first[first.indexOf('--effort') + 1], 'high');
    assert.ok(first.includes('--always-approve'), 'our own gate is the one that asks');
    assert.ok(first.includes('--no-auto-update'), 'no downloads in the middle of a turn');
    assert.strictEqual(
        first[first.indexOf('--disallowed-tools') + 1],
        provider.LOCAL_TOOLS.join(','),
        'the agent\'s own tools on this machine are denied while the switch is off'
    );

    const later = provider.runArguments({
        current: { ...base, allowLocalTools: true, model: '', effort: 'ultra' },
        sessionId: 'abc-123',
        resume: true,
        directory: '/tmp/work',
        prompt: 'and again',
    });
    assert.strictEqual(later[later.indexOf('--resume') + 1], 'abc-123', 'the second turn resumes');
    assert.ok(!later.includes('--session-id'));
    assert.ok(!later.includes('--model'), 'nothing pinned means whatever the agent is set to');
    assert.ok(!later.includes('--disallowed-tools'), 'the switch being on lets its own tools through');
    assert.strictEqual(later[later.indexOf('--effort') + 1], 'max', 'a level above this scale rounds down');

    assert.strictEqual(provider.effortFor({ effort: 'medium' }), 'medium');
    assert.strictEqual(provider.effortFor({ effort: 'ultra' }), 'max');
    assert.strictEqual(provider.effortFor({ effort: '' }), '', 'no setting means no flag');

    /* ---------------- Naming our tools apart from its own ---------------- */

    assert.strictEqual(provider.stripServer('remote__run_command'), 'run_command');
    assert.strictEqual(provider.stripServer('mcp__remote__read_file'), 'read_file');
    assert.strictEqual(provider.stripServer('remote.list_hosts'), 'list_hosts');
    assert.strictEqual(provider.stripServer('Bash'), 'Bash', 'its own tools keep their names');

    /* ---------------- The stream, as a transcript ---------------- */

    const { events, onEvent } = collect();
    const translator = provider.createTranslator(onEvent);

    translator.event({ type: 'text', text: 'Looking' });
    translator.event({ type: 'thought', content: 'which host' });
    translator.event({ type: 'text', text: ' at it.' });
    translator.event({
        type: 'tool_call',
        toolCallId: 't1',
        toolName: 'remote__run_command',
        status: 'in_progress',
        rawInput: { command: 'uptime' },
    });
    translator.event({
        type: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'up 3 days' } }],
    });
    translator.event({ type: 'usage', costUsd: 0.02 });
    translator.event({ type: 'plan', entries: [] });
    translator.event({ type: 'text', text: 'It is fine.' });
    translator.finish();

    assert.deepStrictEqual(
        events.map(event => event.type),
        [
            'text-delta', 'thinking-delta', 'text-delta',
            'assistant-text', 'tool-call', 'tool-result',
            'text-delta', 'assistant-text', 'result',
        ],
        'text is flushed as a block before the call it precedes, and again at the end'
    );

    assert.strictEqual(events[3].text, 'Looking at it.', 'the deltas make one block');
    assert.strictEqual(events[4].name, 'run_command', 'the server prefix is taken off');
    assert.strictEqual(events[4].local, false, 'a prefixed call is one of ours');
    assert.deepStrictEqual(events[4].input, { command: 'uptime' });
    assert.strictEqual(events[5].text, 'up 3 days', 'the result is read out of the content blocks');
    assert.strictEqual(events[5].isError, false);
    assert.strictEqual(events.at(-1).costUsd, 0.02, 'what the run cost is carried through');
    assert.strictEqual(events.at(-1).isError, false);

    /* ---------------- The spelling the CLI actually uses ---------------- */

    // Replayed verbatim from `grok -p ... --output-format streaming-json` on
    // 1.0.4. Every line here was captured off the wire rather than written from
    // the shape this file expected, which is how the two came to disagree: the
    // words arrive under `data`, and while nothing read that key a turn ran to
    // a clean exit and put nothing on the screen at all.
    const wire = collect();
    const real = provider.createTranslator(wire.onEvent);

    real.event({ type: 'available_commands', tools: ['read_file'], commands: ['compact'] });
    real.event({ type: 'thought', data: 'The user wants me to say ok.' });
    real.event({ type: 'text', data: 'ok' });
    real.event({
        type: 'tool_call',
        toolCallId: 'call-1',
        title: 'list_dir',
        kind: 'list',
        status: 'pending',
        toolName: 'list_dir',
        rawInput: { target_directory: '.' },
        content: [],
        locations: [],
    });
    // The CLI sends one of these with no status at all before the real one.
    real.event({ type: 'tool_call_update', toolCallId: 'call-1', status: null, content: [], rawOutput: null });
    real.event({
        type: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        content: [],
        rawOutput: { type: 'ListDir', Content: { content: '- note.txt', absolute_root_path: 'C:\\tmp' } },
    });
    real.event({ type: 'usage', usage: { input_tokens: 8455, output_tokens: 67 } });
    real.event({
        type: 'end',
        stopReason: 'end_turn',
        sessionId: '01a0',
        usage: { input_tokens: 11256, output_tokens: 111, total_tokens: 28647 },
        num_turns: 2,
        total_cost_usd: 0.00540906,
    });
    real.finish();

    assert.deepStrictEqual(
        wire.events.map(event => event.type),
        ['thinking-delta', 'text-delta', 'assistant-text', 'tool-call', 'tool-result', 'result'],
        'the answer reaches the panel, which is what a turn is for'
    );
    assert.strictEqual(wire.events[1].text, 'ok', 'the words are under `data` on this CLI');
    assert.strictEqual(
        wire.events.find(event => event.type === 'tool-result').text,
        '- note.txt',
        'a result is unwrapped out of the struct the tool names it with'
    );
    assert.strictEqual(
        wire.events.at(-1).costUsd,
        0.00540906,
        'the cost is stated once, on the last line, and nowhere else'
    );
    assert.strictEqual(
        wire.events.at(-1).usage.total_tokens,
        28647,
        'and so is the total for the turn, rather than the last call of several'
    );

    /* ---------------- The same events, spelled differently ---------------- */

    const other = collect();
    const lenient = provider.createTranslator(other.onEvent);
    lenient.event({ type: 'text', content: 'Hello.' });
    lenient.event({
        type: 'tool_call',
        id: 'x1',
        tool: 'Bash',
        status: 'running',
        input: { command: 'ls' },
    });
    lenient.event({ type: 'tool_call_update', id: 'x1', status: 'failed', output: 'permission denied' });
    lenient.finish();

    const call = other.events.find(event => event.type === 'tool-call');
    assert.strictEqual(call.name, 'Bash');
    assert.strictEqual(call.local, true, 'an unprefixed call acts on this machine, and the panel says so');
    assert.strictEqual(call.id, 'x1', 'the id is read from whichever key carries it');

    const failure = other.events.find(event => event.type === 'tool-result');
    assert.strictEqual(failure.isError, true);
    assert.strictEqual(failure.text, 'permission denied');

    /* ---------------- A run that reported an error ---------------- */

    const bad = collect();
    const failing = provider.createTranslator(bad.onEvent);
    failing.event({ type: 'text', text: 'Trying.' });
    failing.event({ type: 'error', message: 'not logged in' });
    failing.finish();

    const notice = bad.events.find(event => event.type === 'error');
    assert.match(notice.message, /sign in|signed in/i, 'the fix is in the message, not just the failure');
    assert.strictEqual(bad.events.at(-1).isError, true, 'the turn ends as a failure');

    // A call announced twice is still one row, or the transcript grows a
    // duplicate for every progress update the agent sends.
    const repeated = collect();
    const once = provider.createTranslator(repeated.onEvent);
    once.event({ type: 'tool_call', toolCallId: 'r1', toolName: 'remote__read_file', status: 'pending' });
    once.event({ type: 'tool_call_update', toolCallId: 'r1', status: 'in_progress' });
    once.event({ type: 'tool_call_update', toolCallId: 'r1', status: 'completed', output: 'contents' });
    once.finish();
    assert.strictEqual(
        repeated.events.filter(event => event.type === 'tool-call').length,
        1,
        'progress updates land on the call that is already there'
    );

    /* ---------------- Pointing it at our tools ---------------- */

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-config-'));
    try {
        const url = 'http://127.0.0.1:51234/mcp/deadbeef';
        provider.writeMcpConfig(directory, url);

        const toml = fs.readFileSync(path.join(directory, '.grok', 'config.toml'), 'utf8');
        assert.match(toml, /\[mcp_servers\.remote\]/);
        assert.match(toml, /type = "http"/);
        assert.ok(toml.includes(url), 'the address carries the token, so no header has to be spelled');

        const json = JSON.parse(fs.readFileSync(path.join(directory, '.mcp.json'), 'utf8'));
        assert.strictEqual(json.mcpServers.remote.url, url);
        assert.strictEqual(json.mcpServers.remote.type, 'http');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }

    /* ---------------- The token, however it is offered ---------------- */

    const { offeredToken } = mcpHost._test;
    assert.strictEqual(
        offeredToken({ headers: { authorization: 'Bearer abc123' }, url: '/mcp' }),
        'abc123',
        'the header is still what the other providers use'
    );
    assert.strictEqual(
        offeredToken({ headers: {}, url: '/mcp/abc123' }),
        'abc123',
        'a client that can only be given an address carries it in the path'
    );
    assert.strictEqual(offeredToken({ headers: {}, url: '/mcp' }), '', 'no token offered is no token');
    assert.strictEqual(offeredToken({ headers: {}, url: '/mcp/abc123?x=1' }), 'abc123');

    /* ---------------- Failures that say what to do ---------------- */

    assert.match(provider.describeFailure('401 unauthorized'), /sign in|signed in/i);
    assert.match(provider.describeFailure('spawn grok ENOENT'), /could not be started/);
    assert.match(provider.describeFailure('error: unexpected argument --effort'), /Update the CLI/);
    assert.match(provider.describeFailure('429 rate limit exceeded'), /rate limiting/);
    assert.strictEqual(provider.describeFailure('a plain failure'), 'a plain failure');

    /* ---------------- The models, read from the CLI's own home ---------- */

    assert.strictEqual(
        provider.grokHome({ env: {}, home: UNIX_HOME }),
        path.join(UNIX_HOME, '.grok'),
        'the CLI\'s own default is where its setup is expected to be'
    );
    assert.strictEqual(
        provider.grokHome({ env: { GROK_HOME: '/elsewhere' }, home: UNIX_HOME }),
        '/elsewhere',
        'a home they moved is the one the CLI would read, so it is the one we read'
    );

    const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
    try {
        assert.strictEqual(provider.signedIn({ source: grokHome }), false, 'no auth file is no login');
        assert.strictEqual(provider.cachedModels({ source: grokHome }), null, 'and nothing to offer');

        fs.writeFileSync(path.join(grokHome, 'auth.json'), '{}', 'utf8');
        assert.strictEqual(provider.signedIn({ source: grokHome }), true);

        fs.writeFileSync(path.join(grokHome, 'config.toml'), [
            '[cli]',
            'installer = "internal"',
            '',
            '[models]',
            'default = "grok-4.6"',
            'default_reasoning_effort = "xhigh"',
            '',
            '[ui]',
            'yolo = false',
        ].join('\n'), 'utf8');
        assert.strictEqual(
            provider.configuredModel(grokHome),
            'grok-4.6',
            'the model it is set to is the row the menu should land on'
        );

        fs.writeFileSync(path.join(grokHome, 'models_cache.json'), JSON.stringify({
            models: {
                'grok-4.6': {
                    info: {
                        id: 'grok-4.6',
                        model: 'grok-4.6',
                        name: 'Grok 4.6',
                        description: 'The frontier one',
                        hidden: false,
                        supports_reasoning_effort: true,
                        reasoning_efforts: [
                            { value: 'xhigh' }, { value: 'high' }, { value: 'medium' },
                            { value: 'low' }, { value: 'glacial' },
                        ],
                    },
                },
                'grok-4.5': {
                    info: {
                        id: 'grok-4.5',
                        name: 'Grok 4.5',
                        hidden: false,
                        supports_reasoning_effort: true,
                        reasoning_efforts: [{ value: 'high' }, { value: 'low' }],
                    },
                },
                'grok-internal': { info: { id: 'grok-internal', name: 'Internal', hidden: true } },
            },
        }), 'utf8');

        const rows = provider.cachedModels({ source: grokHome });
        assert.deepStrictEqual(
            rows.map(row => row.value),
            ['grok-4.6', 'grok-4.5'],
            'a model the CLI hides is not one this app offers'
        );
        assert.strictEqual(rows[0].short, 'Grok 4.6', 'the name it goes by is the name shown');
        assert.deepStrictEqual(
            rows[0].effort,
            ['xhigh', 'high', 'medium', 'low'],
            'a level this app has no name for is not a stop it can offer'
        );
        assert.deepStrictEqual(
            rows[1].effort,
            ['high', 'low'],
            'the scale is the model\'s own, not the union of every model\'s'
        );
        // Which is the bug this reader exists for: with the CLI on the machine
        // and no key stored, the only list came from an API there was nothing
        // to ask with, so the menu offered one row and never filled in.
        assert.strictEqual(rows[0].preferred, true);
        assert.strictEqual(rows[1].preferred, false);
    } finally {
        fs.rmSync(grokHome, { recursive: true, force: true });
    }

    console.log('grok provider tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
