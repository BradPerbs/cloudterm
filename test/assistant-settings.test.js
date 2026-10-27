/**
 * Which agents are switched on, on a fresh machine and after.
 *
 * A fresh install used to tick Claude Code whether or not it was installed, and
 * as the only agent it could not be unticked. The first run now ticks it only
 * when it is found, and an empty list is a real answer rather than something to
 * be filled in with an agent that is not there.
 *
 * `electron` is stubbed so it runs under plain node, and the Claude Code lookup
 * is stubbed so the answer does not depend on the machine running the test.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
let userData = '';

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
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const SETTINGS = require.resolve(path.join(ROOT, 'ai', 'settings'));
const CLAUDE = require.resolve(path.join(ROOT, 'ai', 'providers', 'claude-code'));

/** A fresh settings module on an empty profile, with Claude Code there or not. */
function freshSettings({ claudeInstalled }) {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-settings-'));
    delete require.cache[SETTINGS];
    require.cache[CLAUDE] = {
        id: CLAUDE,
        filename: CLAUDE,
        loaded: true,
        exports: { findClaude: () => (claudeInstalled ? 'C:\\Users\\Mario\\.local\\bin\\claude.exe' : '') },
    };
    return require(SETTINGS);
}

let passed = 0;
let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        failed++;
    }
};

console.log('\nassistant settings');

check('nothing is ticked by default', () => {
    const settings = freshSettings({ claudeInstalled: false });
    assert.deepStrictEqual(settings.DEFAULTS.providers, []);
});

check('the first run ticks Claude Code when it is installed', () => {
    const settings = freshSettings({ claudeInstalled: true });
    assert.deepStrictEqual(settings.get().providers, ['claude-code']);
    assert.strictEqual(settings.get().provider, 'claude-code');
});

check('and ticks nothing when it is not', () => {
    const settings = freshSettings({ claudeInstalled: false });
    assert.deepStrictEqual(settings.get().providers, []);
});

check('an empty list is kept as it is', () => {
    const { sanitize } = freshSettings({ claudeInstalled: true })._test;
    const next = sanitize({ provider: 'codex', providers: [] });
    assert.deepStrictEqual(next.providers, []);
    assert.strictEqual(next.provider, 'codex', 'the selected agent keeps its value');
});

check('the answering agent is still one that is switched on', () => {
    const { sanitize } = freshSettings({ claudeInstalled: true })._test;
    const next = sanitize({ provider: 'claude-code', providers: ['codex', 'grok'] });
    assert.strictEqual(next.provider, 'codex');
});

check('a config from before the list existed keeps the agent it ran', () => {
    const { sanitize } = freshSettings({ claudeInstalled: false })._test;
    assert.deepStrictEqual(sanitize({ provider: 'opencode' }).providers, ['opencode']);
});

check('a list that loses every name to the filter falls back to the selected agent', () => {
    const { sanitize } = freshSettings({ claudeInstalled: false })._test;
    assert.deepStrictEqual(sanitize({ provider: 'kimi', providers: ['some-future-agent'] }).providers, ['kimi']);
});

check('a saved choice is read back, not replaced by the first-run tick', () => {
    const settings = freshSettings({ claudeInstalled: true });
    settings.set({ providers: ['codex'], provider: 'codex' });
    delete require.cache[SETTINGS];
    const reread = require(SETTINGS);
    assert.deepStrictEqual(reread.get().providers, ['codex']);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
