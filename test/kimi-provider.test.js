const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const provider = require('../src/main/ai/providers/kimi');

/**
 * The Kimi Code provider: where its CLI is found, where the user's own login
 * is, how one headless run is described, what it is configured with, and what
 * its stream turns into.
 *
 * The configuration is worth testing as hard as the stream here, which is not
 * true of the other agents, and for two reasons. This CLI takes no flag for an
 * MCP server and no flag for a tool denylist, so the file written below is the
 * only thing standing between the local-tools switch and a shell on the user's
 * machine. And that file is built from theirs: these runs go out on the login
 * they already have, so the tests below check both that it is carried across
 * whole and that it is linked rather than copied, since a copy of a credential
 * that refreshes on its own is a copy that logs them out of their own CLI.
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

    /* ---------------- The environment, which is one variable now ---------- */

    const env = provider.environment({ home: '/data/kimi-code' });
    assert.strictEqual(env.KIMI_CODE_HOME, '/data/kimi-code', 'the user\'s own ~/.kimi-code is not written to');
    assert.ok(
        !Object.keys(env).some(name => name.startsWith('KIMI_MODEL_')),
        'no key and no synthesised provider: the login in the home does all of it'
    );

    assert.strictEqual(provider.effortFor({ effort: 'medium' }), 'medium');
    assert.strictEqual(provider.effortFor({ effort: 'ultra' }), 'max');
    assert.strictEqual(provider.effortFor({ effort: '' }), '');

    /* ---------------- Reading the user's own configuration ---------------- */

    const THEIRS = [
        'default_model = "kimi-code/k3"',
        '',
        '[providers."managed:kimi-code"]',
        'type = "kimi"',
        'api_key = "theirs"',
        '',
        '[providers."managed:kimi-code".oauth]',
        'storage = "file"',
        'key = "kimi-code"',
        '',
        '[models."kimi-code/k3"]',
        'provider = "managed:kimi-code"',
        'model = "k3-0710"',
        'display_name = "K3"',
        'support_efforts = ["low", "high", "elephant"]',
        '',
        '[models."kimi-code/kimi-for-coding"]',
        'model = "kfc-1"',
        'display_name = "Kimi for Coding"',
        '',
        '[thinking]',
        'enabled = true',
        'effort = "low"',
        '',
        '[loop_control]',
        'max_steps_per_turn = 3',
    ].join('\n');

    const rows = provider.modelsFrom(THEIRS);
    assert.deepStrictEqual(
        rows.map(row => row.value),
        ['kimi-code/k3', 'kimi-code/kimi-for-coding'],
        'every model their configuration defines is offered, and nothing else'
    );
    assert.strictEqual(rows[0].resolved, 'k3-0710', 'the alias carries the id it stands for');
    assert.strictEqual(rows[0].short, 'K3', 'the name they gave it is the name shown');
    assert.deepStrictEqual(
        rows[0].effort,
        ['low', 'high'],
        'a level this app has no name for is not a stop it can offer'
    );
    assert.strictEqual(rows[0].preferred, true, 'their default_model is the row the menu lands on');
    assert.deepStrictEqual(rows[1].effort, [], 'a model that declares no scale gets no dial');
    assert.strictEqual(provider.modelsFrom('default_model = "x"'), null, 'no models is not an empty list');

    const carried = provider.withoutTables(THEIRS, ['loop_control', 'thinking']);
    assert.ok(carried.includes('[providers."managed:kimi-code".oauth]'), 'their login goes through untouched');
    assert.ok(carried.includes('[models."kimi-code/k3"]'), 'so do their models');
    assert.ok(!carried.includes('max_steps_per_turn'), 'a table we write ourselves is taken out of theirs');
    assert.ok(!carried.includes('effort = "low"'), 'and so is the one under it');

    /* ---------------- What it is configured with ---------------- */

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-config-'));
    try {
        const url = 'http://127.0.0.1:51234/mcp/deadbeef';
        provider.writeConfig({
            home,
            base: THEIRS,
            url,
            current: { maxTurns: 25, allowLocalTools: false },
            effort: 'high',
        });

        const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
        assert.match(toml, /max_steps_per_turn = 25/, 'the app\'s ceiling is the agent\'s ceiling');
        assert.ok(
            toml.includes('[providers."managed:kimi-code".oauth]'),
            'their login is carried across, which is the whole point of this directory'
        );
        assert.strictEqual(
            toml.match(/max_steps_per_turn/g).length,
            1,
            'their answer to a question we also answer is taken out, not left to be picked between'
        );
        assert.match(toml, /\[thinking\]\nenabled = true\neffort = "high"/, 'the dial lands in their file');
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

        provider.writeConfig({ home, base: THEIRS, url, current: { maxTurns: 40, allowLocalTools: true } });
        const opened = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
        assert.ok(!opened.includes('pattern = "Bash"'), 'the switch being on lets its own tools through');
        assert.ok(
            opened.includes('pattern = "AskUserQuestion"'),
            'that one is denied either way: there is still nobody reading the answer'
        );
        assert.ok(
            opened.includes('effort = "low"'),
            'with no level of ours to set, the one they chose for themselves stays'
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
    assert.match(notice.message, /sign in/i, 'the fix is in the message, not just the failure');
    assert.strictEqual(bad.events.at(-1).isError, true, 'the turn ends as a failure');

    /* ---------------- Failures that say what to do ---------------- */

    assert.match(provider.describeFailure('401 unauthorized'), /rejected that login/i);
    assert.match(provider.describeFailure('spawn kimi ENOENT'), /could not be started/);
    assert.match(provider.describeFailure('error: unknown option --effort'), /Update the CLI/);
    assert.match(provider.describeFailure('429 rate limit exceeded'), /rate limiting/);
    assert.match(provider.describeFailure('KIMI_MODEL_API_KEY is required'), /without a usable login/);
    assert.match(provider.describeFailure('could not find bash.exe'), /Git for Windows/);
    assert.strictEqual(provider.describeFailure('a plain failure'), 'a plain failure');

    /* ---------------- Where the login is looked for ---------------- */

    assert.strictEqual(
        provider.userHome({ env: {}, home: UNIX_HOME }),
        path.join(UNIX_HOME, '.kimi-code'),
        'the CLI\'s own default is where a login is expected to be'
    );
    assert.strictEqual(
        provider.userHome({ env: { KIMI_CODE_HOME: '/elsewhere' }, home: UNIX_HOME }),
        '/elsewhere',
        'a home they moved is the one the CLI would read, so it is the one we read'
    );

    const login = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-login-'));
    try {
        assert.strictEqual(provider.signedIn({ source: login }), false, 'an empty home is not a login');

        fs.writeFileSync(path.join(login, 'config.toml'), 'default_model = "x"\n', 'utf8');
        assert.strictEqual(
            provider.signedIn({ source: login }),
            false,
            'a configuration with no credential beside it is a CLI that has been run, not signed in'
        );

        fs.mkdirSync(path.join(login, 'credentials'));
        fs.writeFileSync(path.join(login, 'credentials', 'kimi-code.json'), '{}', 'utf8');
        assert.strictEqual(provider.signedIn({ source: login }), true);

        /* ------------ The login is linked, never copied ------------ */

        const borrowed = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-home-'));
        try {
            provider._test.borrowLogin({ home: borrowed, source: login });
            const linked = path.join(borrowed, 'credentials');
            assert.ok(fs.lstatSync(linked).isSymbolicLink(), 'a link, so a refreshed token is refreshed once');

            // What the CLI would do with a rotated token, done from their side.
            fs.writeFileSync(path.join(login, 'credentials', 'kimi-code.json'), '{"v":2}', 'utf8');
            assert.strictEqual(
                fs.readFileSync(path.join(linked, 'kimi-code.json'), 'utf8'),
                '{"v":2}',
                'their login and the one these runs use are the same login'
            );

            // Twice is not an error: every conversation start asks for it.
            provider._test.borrowLogin({ home: borrowed, source: login });
            assert.ok(fs.lstatSync(linked).isSymbolicLink(), 'asking again leaves it as it was');
        } finally {
            fs.rmSync(borrowed, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(login, { recursive: true, force: true });
    }

    console.log('kimi provider tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
