/**
 * The system prompt's order, and the few rules in it that tools depend on.
 *
 * The order is a cost, not a style: the agents cache a prompt by its prefix,
 * so whatever changes as the user works has to come after the long text that
 * never does, or every tab opened mid-conversation pays for the whole prompt
 * again.
 *
 * `electron` is stubbed so it runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-prompt-'));

const electronStub = {
    app: { getPath: () => userData, getVersion: () => '1.0.0', on: () => {}, whenReady: () => new Promise(() => {}) },
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

const prompt = require(path.join(ROOT, 'ai', 'prompt'));
const tools = require(path.join(ROOT, 'ai', 'tools'));

let passed = 0;
let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        failed += 1;
    }
};

console.log('\nassistant prompt');

const built = prompt.build({ scope: 'global', boundSessionId: '', blockedCommands: ['rm -rf', 'shutdown'] });

check('the fixed text comes first, then the blocked list, then the moment', () => {
    assert.ok(built.startsWith(prompt.BASE), 'the static text is the prefix');
    const blocked = built.indexOf('## Commands you may not run');
    const now = built.indexOf('## Right now');
    assert.ok(blocked > prompt.BASE.length - 1, 'the blocked list follows the static text');
    assert.ok(now > blocked, 'and what is open right now comes after it');
    assert.ok(built.indexOf('`shutdown`') < now);
});

check('without a blocked list, the moment follows the fixed text directly', () => {
    const plain = prompt.build({ scope: 'global', boundSessionId: '', blockedCommands: [] });
    assert.ok(plain.startsWith(`${prompt.BASE}\n\n## Right now`));
    assert.ok(!plain.includes('## Commands you may not run'));
});

check('it tells the model to ask with ask_user rather than stop on a question', () => {
    assert.ok(/ask them with ask_user and offer the answers/.test(prompt.BASE));
    assert.ok(/do everything up to it, ask for it with ask_user, and carry on/.test(prompt.BASE));
});

check('it keeps secrets off command lines, out of files and out of replies', () => {
    assert.ok(prompt.BASE.includes('## Secrets'));
    assert.ok(/never goes into a command line, a file you write, a snippet or your reply/.test(prompt.BASE));
});

check('it prefers an edit to a rewrite, and a stretch to a whole big file', () => {
    assert.ok(/prefer edit_file over rewriting it whole/.test(prompt.BASE));
    assert.ok(/offset and limit of read_file/.test(prompt.BASE));
});

check('every tool the prompt names is one the model has', () => {
    const named = new Set(prompt.BASE.match(/\b[a-z]+(?:_[a-z]+)+\b/g));
    for (const name of named) {
        assert.ok(tools.BY_NAME.has(name), `${name} is named in the prompt but is not a tool`);
    }
});

check('no em dashes in what the model reads', () => {
    assert.ok(!built.includes('—'));
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
