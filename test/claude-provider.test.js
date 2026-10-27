const assert = require('assert');

const provider = require('../src/main/ai/providers/claude-code');

/** A readdir that answers from a map and 404s everywhere else. */
function readdirMap(directories) {
    return (asked) => {
        if (Object.prototype.hasOwnProperty.call(directories, asked)) return directories[asked];
        throw new Error('ENOENT');
    };
}

const NONE = () => { throw new Error('ENOENT'); };

async function run() {
    const windowsCandidates = provider.claudeCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: {
            Path: 'C:\\Tools;D:\\Bin',
            LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local',
        },
        readdirSync: NONE,
    });
    assert(windowsCandidates.includes('C:\\Tools\\claude.exe'));
    assert(windowsCandidates.includes('D:\\Bin\\claude.exe'));
    // Where the native installer puts it, which is the copy most machines have.
    assert(windowsCandidates.includes('C:\\Users\\Mario\\.local\\bin\\claude.exe'));
    assert(windowsCandidates.includes('C:\\Users\\Mario\\AppData\\Local\\Programs\\claude\\claude.exe'));
    assert(windowsCandidates.includes('C:\\Users\\Mario\\.claude\\local\\claude.exe'));

    // An npm shim is deliberately not a candidate: the SDK spawns without a
    // shell, and Node will not start a .cmd that way.
    assert(!windowsCandidates.some(candidate => candidate.endsWith('.cmd')));
    assert(!windowsCandidates.some(candidate => candidate.endsWith('.bat')));

    const posixCandidates = provider.claudeCandidates({
        platform: 'darwin',
        home: '/Users/mario',
        env: { PATH: '/opt/tools/bin' },
        readdirSync: NONE,
    });
    assert(posixCandidates.includes('/opt/tools/bin/claude'));
    assert(posixCandidates.includes('/Users/mario/.local/bin/claude'));
    assert(posixCandidates.includes('/opt/homebrew/bin/claude'));
    assert(posixCandidates.includes('/usr/local/bin/claude'));
    assert(!posixCandidates.some(candidate => candidate.endsWith('.exe')));

    // The copy an editor extension carries comes first, and among several the
    // newest wins. 2.1.221 over 2.1.99 is the case a string sort gets wrong.
    const extensions = provider.claudeCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Tools' },
        readdirSync: readdirMap({
            'C:\\Users\\Mario\\.vscode\\extensions': [
                'anthropic.claude-code-2.1.99-win32-x64',
                'anthropic.claude-code-2.1.221-win32-x64',
                'ms-python.python-2024.1.0',
            ],
        }),
    });
    const base = 'C:\\Users\\Mario\\.vscode\\extensions\\anthropic.claude-code-';
    assert.deepStrictEqual(extensions.slice(0, 3), [
        `${base}2.1.221-win32-x64\\resources\\native-binary\\claude.exe`,
        `${base}2.1.99-win32-x64\\resources\\native-binary\\claude.exe`,
        'C:\\Tools\\claude.exe',
    ]);
    // Extensions that are not Claude Code are left alone.
    assert(!extensions.some(candidate => candidate.includes('ms-python')));

    // The extension keeps its binary under one of two layouts, and prefers a
    // directory per platform and architecture over the flat one. The musl
    // suffix on the Linux builds is why those names are read off the disk
    // rather than reconstructed.
    const extensions2 = 'anthropic.claude-code-2.1.221-linux-x64';
    const resources = `/home/mario/.vscode/extensions/${extensions2}/resources`;
    const linux = provider.claudeCandidates({
        platform: 'linux',
        home: '/home/mario',
        env: { PATH: '/usr/bin' },
        readdirSync: readdirMap({
            '/home/mario/.vscode/extensions': [extensions2],
            [`${resources}/native-binaries`]: ['linux-x64-musl', 'linux-x64'],
        }),
    });
    assert.deepStrictEqual(linux.slice(0, 4), [
        `${resources}/native-binaries/linux-x64-musl/claude`,
        `${resources}/native-binaries/linux-x64/claude`,
        `${resources}/native-binary/claude`,
        '/usr/bin/claude',
    ]);

    // A build that is not platform-specific has no suffix after the version,
    // and still reads as one of these.
    const universal = provider.claudeCandidates({
        platform: 'darwin',
        home: '/Users/mario',
        env: {},
        readdirSync: readdirMap({
            '/Users/mario/.vscode/extensions': ['anthropic.claude-code-2.1.221'],
        }),
    });
    assert(universal.includes(
        '/Users/mario/.vscode/extensions/anthropic.claude-code-2.1.221/resources/native-binary/claude'
    ));

    // An npm install leaves only .cmd shims on PATH; the real binary is the
    // package's bin/claude.exe, looked for under every PATH folder (an npm
    // prefix) and under npm's default prefix even when PATH predates it.
    const npmInstall = provider.claudeCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: {
            Path: 'C:\\nvm4w\\nodejs',
            APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming',
        },
        readdirSync: NONE,
    });
    const npmDefault = 'C:\\Users\\Mario\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    assert(npmInstall.includes('C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'));
    assert(npmInstall.includes(npmDefault));
    // The native installer's copy is still preferred to an npm one.
    assert(npmInstall.indexOf('C:\\Users\\Mario\\.local\\bin\\claude.exe') < npmInstall.indexOf(npmDefault));

    // winget: the link under Links, and the portable package's own folder,
    // per user and machine-wide. Other packages there are left alone.
    const wingetPackages = 'C:\\Users\\Mario\\AppData\\Local\\Microsoft\\WinGet\\Packages';
    const winget = provider.claudeCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: {
            LOCALAPPDATA: 'C:\\Users\\Mario\\AppData\\Local',
            ProgramFiles: 'C:\\Program Files',
        },
        readdirSync: readdirMap({
            [wingetPackages]: [
                'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe',
                'BurntSushi.ripgrep.MSVC_Microsoft.Winget.Source_8wekyb3d8bbwe',
            ],
        }),
    });
    assert(winget.includes('C:\\Users\\Mario\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe'));
    assert(winget.includes(`${wingetPackages}\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe`));
    assert(winget.includes('C:\\Program Files\\WinGet\\Links\\claude.exe'));
    assert(!winget.some(candidate => candidate.includes('ripgrep')));

    // The Claude desktop app's own copy, for a machine that has nothing else.
    // The Store build keeps it inside its package (its %APPDATA% is
    // redirected there); the downloaded installer in the real %APPDATA%.
    // Newest version first, the build-hash folder before the flat layout,
    // and all of it after the user's own installs.
    const localData = 'C:\\Users\\Mario\\AppData\\Local';
    const msixStore = `${localData}\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude-code`;
    const exeStore = 'C:\\Users\\Mario\\AppData\\Roaming\\Claude\\claude-code';
    const desktop = provider.claudeCandidates({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { LOCALAPPDATA: localData, APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming' },
        readdirSync: readdirMap({
            [`${localData}\\Packages`]: ['Claude_pzs8sxrjxfjjc', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe'],
            [msixStore]: ['2.1.99', '2.1.295', 'downloads'],
            [`${msixStore}\\2.1.295`]: ['d2e29494ec83', 'claude.exe.zst'],
            [`${msixStore}\\2.1.99`]: ['claude.exe'],
            [exeStore]: ['2.1.280'],
            [`${exeStore}\\2.1.280`]: ['claude.exe'],
        }),
    });
    const fromDesktop = desktop.filter(candidate => candidate.includes('\\Claude\\claude-code\\'));
    assert.deepStrictEqual(fromDesktop, [
        `${msixStore}\\2.1.295\\d2e29494ec83\\claude.exe`,
        `${msixStore}\\2.1.295\\claude.exe`,
        `${exeStore}\\2.1.280\\claude.exe`,
        `${msixStore}\\2.1.99\\claude.exe`,
    ]);
    assert(desktop.indexOf('C:\\Users\\Mario\\.local\\bin\\claude.exe') < desktop.indexOf(fromDesktop[0]),
        'an install of the user\'s own comes first');
    assert(!desktop.some(candidate => candidate.includes('WindowsCalculator') || candidate.includes('downloads')));

    // The same store on a Mac, where the binary is inside an app bundle.
    const macStore = '/Users/mario/Library/Application Support/Claude/claude-code';
    const mac = provider.claudeCandidates({
        platform: 'darwin',
        home: '/Users/mario',
        env: { PATH: '/usr/bin' },
        readdirSync: readdirMap({ [macStore]: ['2.1.78'], [`${macStore}/2.1.78`]: ['claude.app'] }),
    });
    assert(mac.includes(`${macStore}/2.1.78/claude.app/Contents/MacOS/claude`));

    // There is no desktop app on Linux, so nothing is looked for there, and
    // none of the npm and winget lookups either: npm and Homebrew put a real
    // `claude` on PATH on the other platforms.
    const linuxDesktop = provider.claudeCandidates({
        platform: 'linux',
        home: '/home/mario',
        env: { PATH: '/usr/bin', APPDATA: '/nope', LOCALAPPDATA: '/nope' },
        readdirSync: readdirMap({ '/home/mario/Library/Application Support/Claude/claude-code': ['2.1.78'] }),
    });
    assert(!linuxDesktop.some(candidate => candidate.includes('claude-code/')));
    assert(!linuxDesktop.some(candidate => candidate.includes('node_modules') || candidate.includes('WinGet')));

    // A real Windows binary, for the lookups below: anything under 4 KB is
    // the npm package's placeholder, not Claude Code.
    const BINARY = 250 * 1024 * 1024;

    // PATH wins over the installer locations, so a copy the user put somewhere
    // of their own is the one that runs.
    const native = 'C:\\Users\\Mario\\.local\\bin\\claude.exe';
    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Tools' },
        readdirSync: NONE,
        accessSync(candidate) {
            if (candidate !== 'C:\\Tools\\claude.exe' && candidate !== native) throw new Error('missing');
        },
        statSync: () => ({ size: BINARY }),
    }), 'C:\\Tools\\claude.exe');

    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Tools' },
        readdirSync: NONE,
        accessSync(candidate) {
            if (candidate !== native) throw new Error('missing');
        },
        statSync: () => ({ size: BINARY }),
    }), native);

    // A stalled self-update leaves a real file of zero bytes, which exists and
    // will not launch. It gets skipped rather than chosen.
    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Tools' },
        readdirSync: NONE,
        accessSync() {},
        statSync: candidate => ({ size: candidate === 'C:\\Tools\\claude.exe' ? 0 : BINARY }),
    }), native);

    // An npm install is found with nothing on PATH but its shims.
    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming' },
        readdirSync: NONE,
        accessSync(candidate) {
            if (candidate !== npmDefault) throw new Error('missing');
        },
        statSync: () => ({ size: BINARY }),
    }), npmDefault);

    // Unless its postinstall never ran, which leaves a ~500 byte script where
    // the binary should be. That is not an install, and nothing is found.
    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\Mario\\AppData\\Roaming' },
        readdirSync: NONE,
        accessSync(candidate) {
            if (candidate !== npmDefault) throw new Error('missing');
        },
        statSync: () => ({ size: 500 }),
    }), '');

    // A small `claude` elsewhere can be a real launcher script, and is kept.
    assert.strictEqual(provider.findClaude({
        platform: 'linux',
        home: '/home/mario',
        env: { PATH: '/usr/bin' },
        readdirSync: NONE,
        accessSync(candidate) {
            if (candidate !== '/home/mario/.claude/local/claude') throw new Error('missing');
        },
        statSync: () => ({ size: 120 }),
    }), '/home/mario/.claude/local/claude');

    // Nothing installed is an empty string, not a throw and not a guess.
    assert.strictEqual(provider.findClaude({
        platform: 'linux',
        home: '/home/mario',
        env: { PATH: '/usr/bin' },
        readdirSync: NONE,
        accessSync() { throw new Error('missing'); },
        statSync: () => ({ size: 1 }),
    }), '');

    // The question tool.
    //
    // Its answers ride back on the tool's own input, keyed by the exact text of
    // the question the model wrote. The runtime pairs them on that text, so a
    // key that does not match one of the questions asked is an answer to
    // nothing, and a call allowed with no answers on it comes back as "the user
    // did not answer the questions", which is the bug this was written for.
    assert.strictEqual(provider.QUESTION_TOOL, 'AskUserQuestion');
    assert(!provider.LOCAL_TOOLS.includes(provider.QUESTION_TOOL),
        'asking a question is not a tool that touches this machine');

    const asked = {
        questions: [
            { question: 'Which database?', header: 'Database', multiSelect: false, options: [] },
            { question: 'Which region?', header: 'Region', multiSelect: false, options: [] },
        ],
    };

    assert.deepStrictEqual(
        provider.questionAnswers(asked, { 'Which database?': 'Postgres', 'Which region?': 'eu-west-1' }),
        { 'Which database?': 'Postgres', 'Which region?': 'eu-west-1' }
    );

    // A question left alone is left out rather than sent back empty.
    assert.deepStrictEqual(
        provider.questionAnswers(asked, { 'Which database?': 'Postgres' }),
        { 'Which database?': 'Postgres' }
    );

    // Nothing that was not asked gets through, so the input handed back to the
    // model is the one it wrote plus answers to its own questions.
    assert.deepStrictEqual(
        provider.questionAnswers(asked, { 'Which database?': 'Postgres', 'rm -rf /': 'yes' }),
        { 'Which database?': 'Postgres' }
    );

    // Null rather than an empty map, which is what the caller turns into a
    // decline: a call allowed with no answers is worse than one refused.
    assert.strictEqual(provider.questionAnswers(asked, {}), null);
    assert.strictEqual(provider.questionAnswers(asked, { 'Which region?': '   ' }), null);
    assert.strictEqual(provider.questionAnswers(asked, null), null);
    assert.strictEqual(provider.questionAnswers(asked, { 'Which region?': 3 }), null);

    await nativeVerdictTests();

    // Signed out, the CLI answers with a canned "Not logged in" message marked
    // `authentication_failed` and a result that says success. That is an
    // error, not an answer, and the result counts as a failure.
    const signedOut = [];
    provider._test.translate({
        type: 'assistant',
        error: 'authentication_failed',
        message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
    }, event => signedOut.push(event));
    provider._test.translate({
        type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login',
    }, event => signedOut.push(event));
    assert.deepStrictEqual(signedOut.map(event => event.type), ['error', 'result']);
    assert.match(signedOut[0].message, /authenticate/);
    assert.strictEqual(signedOut[1].isError, true);

    const fine = [];
    provider._test.translate({ type: 'result', subtype: 'success', result: 'ok' }, event => fine.push(event));
    assert.strictEqual(fine[0].isError, false);

    console.log('claude-provider tests passed');
}

/**
 * The approval mode on the CLI's own tools.
 *
 * With the local tools on, Yolo used to put up a card for every Read and every
 * Grep, and the blocked list was never read for the CLI's own shell. The mode
 * now means the same thing there as it does for the app's tools.
 */
async function nativeVerdictTests() {
    const base = {
        allowLocalTools: true,
        autoApproveCommands: ['ls', 'git status'],
        blockedCommands: ['rm -rf'],
    };
    const never = { ...base, approval: 'never' };
    const always = { ...base, approval: 'always' };
    const writes = { ...base, approval: 'writes' };

    const cards = [];
    const events = [];
    const ask = (answer) => async (request) => {
        cards.push(request.toolName);
        return { approved: answer, message: answer ? '' : 'No.' };
    };
    const verdict = (toolName, toolInput, current, answer = true) => provider.nativeVerdict({
        toolName, toolInput, current, requestApproval: ask(answer), onEvent: event => events.push(event),
    });

    // Yolo waits for nothing.
    assert.deepStrictEqual(await verdict('Read', { file_path: 'a.js' }, never), {
        behavior: 'allow', updatedInput: { file_path: 'a.js' },
    });
    assert.strictEqual((await verdict('Edit', {}, never)).behavior, 'allow');
    assert.strictEqual((await verdict('Bash', { command: 'npm test' }, never)).behavior, 'allow');
    assert.deepStrictEqual(cards, [], 'no card under "never"');

    // The default: a read runs, a change asks, the shell goes by the allow list.
    assert.strictEqual((await verdict('Grep', { pattern: 'x' }, writes)).behavior, 'allow');
    assert.strictEqual((await verdict('Bash', { command: 'git status' }, writes)).behavior, 'allow');
    assert.deepStrictEqual(cards, []);
    assert.strictEqual((await verdict('Edit', {}, writes)).behavior, 'allow', 'approved on the card');
    assert.strictEqual((await verdict('Bash', { command: 'git push' }, writes, false)).behavior, 'deny');
    assert.strictEqual((await verdict('WebFetch', { url: 'https://example.com' }, writes)).behavior, 'allow');
    assert.deepStrictEqual(cards, ['Edit', 'Bash', 'WebFetch'], 'a change, an unlisted command and a web call ask');

    // "Always" asks for a read too.
    cards.length = 0;
    await verdict('Read', {}, always);
    assert.deepStrictEqual(cards, ['Read']);

    // The blocked list reaches the CLI's own shell, and Yolo does not open it.
    cards.length = 0;
    const blocked = await verdict('Bash', { command: 'sudo rm -rf /srv' }, never);
    assert.strictEqual(blocked.behavior, 'deny');
    assert.match(blocked.message, /blocked command list/);
    assert.deepStrictEqual(cards, [], 'refused without a card');
    assert.deepStrictEqual(events, [{ type: 'tool-blocked', name: 'Bash', rule: 'rm -rf', local: true }]);

    // With the local tools off, only the tools that do not touch this machine.
    const off = { ...never, allowLocalTools: false };
    assert.strictEqual((await verdict('Read', {}, off)).behavior, 'deny');
    assert.strictEqual((await verdict('WebSearch', { query: 'x' }, off)).behavior, 'allow');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
