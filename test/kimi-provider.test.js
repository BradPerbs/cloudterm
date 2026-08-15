const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const provider = require('../src/main/ai/providers/kimi');

/**
 * The Kimi Code provider: where its CLI is found, how one headless run is
 * described, what it is configured with, and what its stream turns into.
 *
 * The configuration is worth testing as hard as the stream here, which is not
 * true of the other agents. This CLI takes no flag for an MCP server and no
 * flag for a tool denylist, so the file written below is the only thing
 * standing between the local-tools switch and a shell on the user's machine.
 */

/**
 * A filesystem made of nothing but the paths given.
 *
 * Files may be listed as an array, in which case they all have a byte in them,
 * or as a map of path to size, which is how a half-finished self-update is
 * described: a real file that every existence check passes and nothing runs.
 */
function fakeDisk(files, directories = {}) {
    const known = new Map(
        Array.isArray(files) ? files.map(file => [file, 1]) : Object.entries(files)
    );
    return {
        accessSync(file) {
            if (!known.has(file)) throw new Error(`ENOENT: ${file}`);
        },
        statSync(file) {
            if (!known.has(file)) throw new Error(`ENOENT: ${file}`);
            return { size: known.get(file) };
        },
        readdirSync(directory) {
            if (!(directory in directories)) throw new Error(`ENOENT: ${directory}`);
            return directories[directory];
        },
    };
}

/** Nothing on disk, for the root lists that only care about the paths. */
const NO_DIRS = { readdirSync: () => { throw new Error('ENOENT'); } };

const WINDOWS_HOME = 'C:\\Users\\Mario';
const UNIX_HOME = '/Users/mario';

function collect() {
    const events = [];
    return { events, onEvent: event => events.push(event) };
}

async function run() {
    /* ---------------- Finding the CLI ---------------- */

    const windowsRoots = provider.kimiRoots({
        platform: 'win32',
        home: WINDOWS_HOME,
        ...NO_DIRS,
        env: {
            PATH: 'C:\\tools;C:\\other',
            APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming',
            LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local',
            ProgramFiles: 'C:\\Program Files',
            PNPM_HOME: 'C:\\Users\\Mario\\AppData\\Local\\pnpm',
        },
    });
    assert.strictEqual(windowsRoots[0], 'C:\\tools', 'a PATH the user arranged comes first');
    for (const root of [
        'C:\\Users\\Mario\\.kimi-code\\bin',
        // uv and pipx put the Python CLI here, and this is a real Windows path
        // rather than a Unix one. Missing it is the whole bug.
        'C:\\Users\\Mario\\.local\\bin',
        'C:\\Users\\Mario\\AppData\\Roaming\\npm',
        'C:\\Users\\Mario\\AppData\\Local\\Programs\\kimi-code',
        'C:\\Users\\Mario\\AppData\\Local\\kimi-code\\bin',
        'C:\\Users\\Mario\\AppData\\Local\\pnpm',
        'C:\\Users\\Mario\\.bun\\bin',
        'C:\\Users\\Mario\\.volta\\bin',
        'C:\\Users\\Mario\\scoop\\shims',
        'C:\\Program Files\\kimi-code\\bin',
    ]) {
        assert.ok(windowsRoots.includes(root), `${root} is searched`);
    }

    const unixRoots = provider.kimiRoots({
        platform: 'linux',
        home: UNIX_HOME,
        ...NO_DIRS,
        env: { PATH: '/usr/local/bin', KIMI_INSTALL_DIR: '/opt/kimi', npm_config_prefix: '/opt/node' },
    });
    for (const root of [
        '/opt/kimi/bin',
        '/Users/mario/.kimi-code/bin',
        '/Users/mario/.local/bin',
        '/Users/mario/.npm-global/bin',
        '/Users/mario/.yarn/bin',
        '/Users/mario/.bun/bin',
        '/Users/mario/.volta/bin',
        '/opt/node/bin',
        '/opt/homebrew/bin',
        '/home/linuxbrew/.linuxbrew/bin',
        '/opt/kimi-code/bin',
    ]) {
        assert.ok(unixRoots.includes(root), `${root} is searched`);
    }

    assert.strictEqual(
        provider.findKimi({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeDisk(['/Users/mario/.kimi-code/bin/kimi']),
        }),
        '/Users/mario/.kimi-code/bin/kimi'
    );

    assert.strictEqual(
        provider.findKimi({
            platform: 'win32',
            home: WINDOWS_HOME,
            env: { PATH: 'C:\\tools', APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming' },
            ...fakeDisk(['C:\\Users\\Mario\\AppData\\Roaming\\npm\\kimi.cmd']),
        }),
        'C:\\Users\\Mario\\AppData\\Roaming\\npm\\kimi.cmd',
        'an npm shim counts, because this provider spawns through cross-spawn'
    );

    assert.strictEqual(
        provider.findKimi({
            platform: 'win32',
            home: WINDOWS_HOME,
            env: { PATH: 'C:\\tools' },
            ...fakeDisk(['C:\\Users\\Mario\\.local\\bin\\kimi.exe']),
        }),
        'C:\\Users\\Mario\\.local\\bin\\kimi.exe',
        'a uv or pipx install on Windows is found'
    );

    /* ---------------- What an editor extension carries ---------------- */

    assert.strictEqual(
        provider.findKimi({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeDisk(
                ['/Users/mario/.cursor/extensions/moonshot-ai.kimi-code-0.9.1/resources/bin/kimi'],
                {
                    '/Users/mario/.cursor/extensions': [
                        'moonshot-ai.kimi-code-0.9.1',
                        'some.other-extension-1.0.0',
                    ],
                }
            ),
        }),
        '/Users/mario/.cursor/extensions/moonshot-ai.kimi-code-0.9.1/resources/bin/kimi',
        'a marketplace install is found when nothing else on the machine has one'
    );

    assert.strictEqual(
        provider.findKimi({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeDisk(
                [
                    '/Users/mario/.vscode/extensions/moonshot-ai.kimi-code-0.9.1/bin/kimi',
                    '/Users/mario/.vscode/extensions/moonshot-ai.kimi-code-0.10.0/bin/kimi',
                ],
                {
                    '/Users/mario/.vscode/extensions': [
                        'moonshot-ai.kimi-code-0.9.1',
                        'moonshot-ai.kimi-code-0.10.0',
                    ],
                }
            ),
        }),
        '/Users/mario/.vscode/extensions/moonshot-ai.kimi-code-0.10.0/bin/kimi',
        'the newest version wins, compared as numbers rather than as strings'
    );

    assert.strictEqual(
        provider.findKimi({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeDisk(
                ['/usr/local/bin/kimi', '/Users/mario/.vscode/extensions/moonshot-ai.kimi-code-9.9.9/bin/kimi'],
                { '/Users/mario/.vscode/extensions': ['moonshot-ai.kimi-code-9.9.9'] }
            ),
        }),
        '/usr/local/bin/kimi',
        'a Kimi Code the user installed themselves comes before one an editor brought along'
    );

    /* ---------------- An update that died part way through ------------- */

    assert.strictEqual(
        provider.findKimi({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeDisk({
                '/usr/local/bin/kimi': 0,
                '/Users/mario/.kimi-code/bin/kimi': 4096,
            }),
        }),
        '/Users/mario/.kimi-code/bin/kimi',
        'a zero-byte file is what a stalled self-update leaves, and it will not run'
    );

    assert.strictEqual(
        provider.findKimi({
            platform: 'darwin',
            home: UNIX_HOME,
            env: { PATH: '/usr/local/bin' },
            ...fakeDisk(['/usr/local/bin/grok']),
        }),
        '',
        'a machine without it says so rather than guessing at a path'
    );

    /* ---------------- One headless run ---------------- */

    const first = provider.runArguments({ sessionId: '', prompt: 'do the thing' });
    assert.deepStrictEqual(
        first,
        ['-p', 'do the thing', '--output-format', 'stream-json'],
        'a first turn names no session, because the id is whatever the run reports back'
    );

    const later = provider.runArguments({ sessionId: 'abc-123', prompt: 'and again' });
    assert.strictEqual(later[later.indexOf('--session') + 1], 'abc-123', 'the second turn resumes');

    /* ---------------- The model and the effort, which travel in the env ---- */

    const env = provider.environment({
        home: '/data/kimi-code',
        current: { apiKey: 'sk-secret', effort: 'high' },
        model: 'kimi-k2-latest',
    });
    assert.strictEqual(env.KIMI_CODE_HOME, '/data/kimi-code', 'the user\'s own ~/.kimi-code is left alone');
    assert.strictEqual(env.KIMI_MODEL_NAME, 'kimi-k2-latest');
    assert.strictEqual(env.KIMI_MODEL_API_KEY, 'sk-secret', 'the key goes in the env, never into a file');
    assert.strictEqual(env.KIMI_MODEL_BASE_URL, provider.API_URL);
    assert.strictEqual(env.KIMI_MODEL_THINKING_EFFORT, 'high');

    assert.strictEqual(
        provider.environment({
            home: '/data/kimi-code',
            current: { apiKey: 'k', effort: 'ultra' },
            model: 'm',
        }).KIMI_MODEL_THINKING_EFFORT,
        'max',
        'a level above this scale rounds down rather than being dropped'
    );

    assert.ok(
        !('KIMI_MODEL_THINKING_EFFORT' in provider.environment({
            home: '/h',
            current: { apiKey: 'k', effort: '' },
            model: 'm',
        })),
        'no setting means the variable is not set at all'
    );

    assert.strictEqual(provider.effortFor({ effort: 'medium' }), 'medium');
    assert.strictEqual(provider.effortFor({ effort: 'ultra' }), 'max');
    assert.strictEqual(provider.effortFor({ effort: '' }), '');

    /* ---------------- What it is configured with ---------------- */

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-config-'));
    try {
        const url = 'http://127.0.0.1:51234/mcp/deadbeef';
        provider.writeConfig({
            home,
            url,
            current: { maxTurns: 25, allowLocalTools: false },
        });

        const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
        assert.match(toml, /max_steps_per_turn = 25/, 'the app\'s ceiling is the agent\'s ceiling');
        assert.match(
            toml,
            /decision = "allow"\npattern = "mcp__remote__\*"/,
            'ours are allowed outright, since the gate that asks is our own'
        );
        for (const name of provider.LOCAL_TOOLS) {
            assert.ok(
                toml.includes(`pattern = "${name}"`),
                `${name} is denied while the local-tools switch is off`
            );
        }
        assert.ok(toml.includes('pattern = "AskUserQuestion"'), 'a question nobody can answer stops a turn');

        const json = JSON.parse(fs.readFileSync(path.join(home, 'mcp.json'), 'utf8'));
        assert.strictEqual(json.mcpServers.remote.url, url);
        assert.ok(
            !('transport' in json.mcpServers.remote),
            'a url and no transport is how this CLI spells an HTTP server'
        );

        assert.match(
            fs.readFileSync(path.join(home, 'tui.toml'), 'utf8'),
            /auto_install = false/,
            'no downloads in the middle of somebody\'s turn'
        );

        provider.writeConfig({ home, url, current: { maxTurns: 40, allowLocalTools: true } });
        const opened = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
        assert.ok(!opened.includes('pattern = "Bash"'), 'the switch being on lets its own tools through');
        assert.ok(
            opened.includes('pattern = "AskUserQuestion"'),
            'that one is denied either way: there is still nobody reading the answer'
        );
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }

    /* ---------------- Naming our tools apart from its own ---------------- */

    assert.strictEqual(provider.stripServer('mcp__remote__run_command'), 'run_command');
    assert.strictEqual(provider.stripServer('remote__read_file'), 'read_file');
    assert.strictEqual(provider.stripServer('Bash'), 'Bash', 'its own tools keep their names');

    /* ---------------- The stream, as a transcript ---------------- */

    const { events, onEvent } = collect();
    const translator = provider.createTranslator(onEvent);

    translator.event({ role: 'meta', type: 'system.version', version: '0.36.1' });
    translator.event({
        role: 'assistant',
        content: 'Looking at it.',
        tool_calls: [{
            type: 'function',
            id: 't1',
            function: { name: 'mcp__remote__run_command', arguments: '{"command":"uptime"}' },
        }],
    });
    translator.event({ role: 'tool', tool_call_id: 't1', content: 'up 3 days' });
    translator.event({ role: 'assistant', content: 'It is fine.' });
    translator.event({
        role: 'meta',
        type: 'session.resume_hint',
        session_id: 'ses_01',
        command: 'kimi -r ses_01',
    });
    translator.finish();

    assert.deepStrictEqual(
        events.map(event => event.type),
        ['assistant-text', 'tool-call', 'tool-result', 'assistant-text', 'result'],
        'the text of a message lands before the calls made with it'
    );
    assert.strictEqual(events[0].text, 'Looking at it.');
    assert.strictEqual(events[1].name, 'run_command', 'the server prefix is taken off');
    assert.strictEqual(events[1].local, false, 'a prefixed call is one of ours');
    assert.deepStrictEqual(events[1].input, { command: 'uptime' });
    assert.strictEqual(events[2].text, 'up 3 days');
    assert.strictEqual(events.at(-1).isError, false);
    assert.strictEqual(
        translator.sessionId,
        'ses_01',
        'the resume hint is the only place the session id is published'
    );

    /* ---------------- Shapes it has to survive ---------------- */

    const odd = collect();
    const lenient = provider.createTranslator(odd.onEvent);

    // One of the agent's own tools, which the panel has to mark as local.
    lenient.event({
        role: 'assistant',
        tool_calls: [{ id: 'b1', function: { name: 'Bash', arguments: '{"command":"ls"}' } }],
    });
    assert.strictEqual(odd.events[0].local, true, 'an unprefixed call acts on this machine');

    // A call the stream never finished writing. The name is still worth drawing.
    lenient.event({
        role: 'assistant',
        tool_calls: [{ id: 'b2', function: { name: 'mcp__remote__read_file', arguments: '{"pa' } }],
    });
    assert.strictEqual(odd.events[1].name, 'read_file');
    assert.deepStrictEqual(odd.events[1].input, { arguments: '{"pa' });

    // A message with neither text nor calls, and a result for a call that was
    // never announced. Neither is worth an entry in the transcript.
    const before = odd.events.length;
    lenient.event({ role: 'assistant', content: '   ' });
    lenient.event({ role: 'tool', content: 'orphaned' });
    lenient.event({ role: 'meta', type: 'turn.step.retrying', next_attempt: 2 });
    assert.strictEqual(odd.events.length, before, 'nothing that says nothing reaches the panel');

    // A call announced twice is still one row.
    lenient.event({
        role: 'assistant',
        tool_calls: [{ id: 'b1', function: { name: 'Bash', arguments: '{}' } }],
    });
    assert.strictEqual(
        odd.events.filter(event => event.type === 'tool-call' && event.id === 'b1').length,
        1,
        'a call already drawn is not drawn again'
    );

    /* ---------------- A failed run ---------------- */

    const bad = collect();
    const failing = provider.createTranslator(bad.onEvent);
    failing.event({ role: 'assistant', content: 'Trying.' });
    failing.fail('401 unauthorized');
    failing.finish('error');

    const notice = bad.events.find(event => event.type === 'error');
    assert.match(notice.message, /key/i, 'the fix is in the message, not just the failure');
    assert.strictEqual(bad.events.at(-1).isError, true, 'the turn ends as a failure');

    /* ---------------- Failures that say what to do ---------------- */

    assert.match(provider.describeFailure('401 unauthorized'), /rejected that key/i);
    assert.match(provider.describeFailure('spawn kimi ENOENT'), /could not be started/);
    assert.match(provider.describeFailure('error: unknown option --effort'), /Update the CLI/);
    assert.match(provider.describeFailure('429 rate limit exceeded'), /rate limiting/);
    assert.match(provider.describeFailure('KIMI_MODEL_API_KEY is required'), /without a usable key/);
    assert.match(provider.describeFailure('could not find bash.exe'), /Git for Windows/);
    assert.strictEqual(provider.describeFailure('a plain failure'), 'a plain failure');

    /* ---------------- Which model an unpinned conversation gets ---------- */

    const { preferred } = provider._test;
    assert.strictEqual(
        preferred([{ value: 'moonshot-v1-8k' }, { value: 'kimi-k2-latest' }]),
        'kimi-k2-latest',
        'the same account reaches the older chat models, and this card is not about those'
    );
    assert.strictEqual(
        preferred([{ value: 'moonshot-v1-8k' }, { value: 'moonshot-v1-32k' }]),
        'moonshot-v1-8k',
        'with nothing of the family listed, the first row is still an honest answer'
    );

    console.log('kimi provider tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
