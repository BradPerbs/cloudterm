/**
 * The assistant's hand on the snippet library: finding a spec the user wrote
 * for the job, reading what a package actually sends, and keeping a command
 * that worked.
 *
 * Runs against the real store in a scratch directory. `electron` is stubbed so
 * this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-assistant-snippets-'));

const electronStub = {
    app: { getPath: () => userData, getVersion: () => '1.0.0', on: () => {}, whenReady: () => new Promise(() => {}) },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
    ipcMain: { handle: () => {}, on: () => {} },
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const tools = require(path.join(ROOT, 'ai', 'tools'));
const settingsModule = require(path.join(ROOT, 'ai', 'settings'));
const store = require(path.join(ROOT, 'store'));

let changed = 0;
const ctx = { settings: settingsModule.DEFAULTS, snippetsChanged: () => { changed += 1; } };
const run = async (name, input) => {
    const result = await tools.BY_NAME.get(name).handler(input, ctx);
    return { ...result, data: result.isError ? null : JSON.parse(result.text) };
};

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
    console.log('\nassistant snippets');

    const restart = store.saveSnippet({ name: 'Restart app', kind: 'command', command: 'systemctl restart {{service}}', tags: ['ops'] });
    const pull = store.saveSnippet({ name: 'Pull', kind: 'command', command: 'git pull' });
    const deploy = store.saveSnippet({
        name: 'Deploy', kind: 'package', chain: true,
        steps: [{ ref: pull.id }, { command: 'npm ci' }, { ref: 'gone-since' }],
    });
    const runbook = store.saveSnippet({ name: 'Disk full runbook', kind: 'spec', command: '# When a disk fills\n\n1. Check /var/log first.' });

    await check('list_snippets finds them by name, tag and kind, without their text', async () => {
        const all = await run('list_snippets', {});
        assert.strictEqual(all.data.total, 4);
        assert.ok(all.data.snippets.every(entry => entry.text === undefined), 'a list is names, not bodies');

        const specs = await run('list_snippets', { kind: 'spec' });
        assert.deepStrictEqual(specs.data.snippets.map(entry => entry.name), ['Disk full runbook']);

        const tagged = await run('list_snippets', { query: 'ops' });
        assert.deepStrictEqual(tagged.data.snippets.map(entry => entry.id), [restart.id]);
    });

    await check('read_snippet returns a spec whole, a command with its fields, and a package as it sends', async () => {
        const spec = await run('read_snippet', { id: runbook.id });
        assert.ok(spec.data.text.includes('Check /var/log first'));

        const command = await run('read_snippet', { id: restart.id });
        assert.deepStrictEqual(command.data.fields, ['service'], 'the {{fields}} are named');

        const pack = await run('read_snippet', { id: deploy.id });
        assert.strictEqual(pack.data.text, 'git pull && npm ci');
        assert.strictEqual(pack.data.chain, true);
        assert.deepStrictEqual(pack.data.missingSteps.map(step => step.ref), ['gone-since'],
            'a step whose snippet is gone is named, not dropped');

        const missing = await run('read_snippet', { id: 'nope' });
        assert.strictEqual(missing.isError, true);
    });

    await check('save_snippet creates and updates, and tells the windows', async () => {
        changed = 0;
        const created = await run('save_snippet', { name: 'Free space', text: 'df -h', tags: ['Disk'] });
        assert.strictEqual(created.data.saved, 'created');
        assert.strictEqual(created.data.kind, 'command');
        assert.ok(store.getSnippets().some(entry => entry.id === created.data.id && entry.command === 'df -h'));

        const updated = await run('save_snippet', { id: created.data.id, text: 'df -h /' });
        assert.strictEqual(updated.data.saved, 'updated');
        const stored = store.getSnippets().find(entry => entry.id === created.data.id);
        assert.strictEqual(stored.command, 'df -h /');
        assert.strictEqual(stored.name, 'Free space', 'what was not given is kept');
        assert.deepStrictEqual(stored.tags, ['disk']);
        assert.strictEqual(changed, 2);

        const steps = await run('save_snippet', { name: 'Ship', steps: [{ ref: pull.id }, { command: 'make' }], chain: true });
        assert.strictEqual(steps.data.kind, 'package', 'steps make a package');
    });

    await check('save_snippet refuses what the library cannot hold, and writes nothing', async () => {
        changed = 0;
        const before = store.getSnippets().length;
        const nameless = await run('save_snippet', { text: 'ls' });
        assert.strictEqual(nameless.isError, true);
        assert.strictEqual((await run('save_snippet', { id: 'nope', text: 'ls' })).isError, true);
        assert.strictEqual((await run('save_snippet', { name: 'x', kind: 'package', text: 'ls' })).isError, true);
        assert.strictEqual((await run('save_snippet', { name: 'x', steps: [{ ref: runbook.id }] })).isError, true,
            'a step cannot run a spec');
        assert.strictEqual(store.getSnippets().length, before);
        assert.strictEqual(changed, 0);
    });

    await check('reading the library runs free, saving to it stops at the card', () => {
        const balanced = { ...settingsModule.DEFAULTS, approval: 'writes' };
        assert.strictEqual(tools.BY_NAME.get('list_snippets').readOnly, true);
        assert.strictEqual(tools.BY_NAME.get('read_snippet').readOnly, true);
        assert.strictEqual(tools.BY_NAME.get('save_snippet').readOnly, false);
        assert.strictEqual(tools.isAutoApproved('list_snippets', {}, balanced), true);
        assert.strictEqual(tools.isAutoApproved('save_snippet', { name: 'x', text: 'ls' }, balanced), false);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
