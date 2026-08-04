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
        statSync: () => ({ size: 1 }),
    }), 'C:\\Tools\\claude.exe');

    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Tools' },
        readdirSync: NONE,
        accessSync(candidate) {
            if (candidate !== native) throw new Error('missing');
        },
        statSync: () => ({ size: 1 }),
    }), native);

    // A stalled self-update leaves a real file of zero bytes, which exists and
    // will not launch. It gets skipped rather than chosen.
    assert.strictEqual(provider.findClaude({
        platform: 'win32',
        home: 'C:\\Users\\Mario',
        env: { Path: 'C:\\Tools' },
        readdirSync: NONE,
        accessSync() {},
        statSync: candidate => ({ size: candidate === 'C:\\Tools\\claude.exe' ? 0 : 1 }),
    }), native);

    // Nothing installed is an empty string, not a throw and not a guess.
    assert.strictEqual(provider.findClaude({
        platform: 'linux',
        home: '/home/mario',
        env: { PATH: '/usr/bin' },
        readdirSync: NONE,
        accessSync() { throw new Error('missing'); },
        statSync: () => ({ size: 1 }),
    }), '');

    console.log('claude-provider tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
