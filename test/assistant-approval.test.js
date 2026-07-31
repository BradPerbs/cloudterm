/**
 * Exercises the rule that decides whether a tool call runs on its own or stops
 * in front of a person.
 *
 * This is the whole safety story of the assistant in one function, and it is
 * the kind of thing that gets quietly widened by a later change: a tool added
 * to the catalog without a `readOnly` flag, a convenience prefix added to the
 * safe list, a shell metacharacter nobody thought about. The cases below are
 * the ones where getting it wrong hands a model an unattended root shell.
 *
 * `electron` is stubbed so it runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-assistant-'));

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
    MessageChannelMain: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    ipcMain: { handle: () => {}, on: () => {} },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const tools = require(path.join(ROOT, 'ai', 'tools'));
const settingsModule = require(path.join(ROOT, 'ai', 'settings'));

/** The shipped defaults, which is what almost every install actually runs. */
const defaults = {
    ...settingsModule.DEFAULTS,
    autoApproveCommands: [...settingsModule.DEFAULTS.autoApproveCommands],
};

const asking = { ...defaults, approval: 'always' };
const balanced = { ...defaults, approval: 'writes' };
const open = { ...defaults, approval: 'never' };

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

console.log('\nassistant approvals');

check('the default is to ask before anything that changes a system', () => {
    assert.strictEqual(defaults.approval, 'writes');
    assert.strictEqual(defaults.allowLocalTools, false, 'local tools are off out of the box');
});

check('every tool declares whether it only reads', () => {
    for (const tool of tools.TOOLS) {
        assert.strictEqual(
            typeof tool.readOnly, 'boolean',
            `${tool.name} must say whether it only reads`
        );
    }
});

check('the tools that change things are not marked read only', () => {
    const mutating = ['run_command', 'send_input', 'write_file', 'connect_host', 'disconnect_session'];
    for (const name of mutating) {
        const tool = tools.BY_NAME.get(name);
        assert.ok(tool, `${name} is in the catalog`);
        assert.strictEqual(tool.readOnly, false, `${name} must not be treated as a read`);
    }
});

check('under "ask every time" nothing runs unattended', () => {
    assert.strictEqual(tools.isAutoApproved('list_hosts', {}, asking), false);
    assert.strictEqual(tools.isAutoApproved('read_terminal', {}, asking), false);
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'ls' }, asking), false);
});

check('under the default, reads run and writes stop', () => {
    assert.strictEqual(tools.isAutoApproved('read_terminal', {}, balanced), true);
    assert.strictEqual(tools.isAutoApproved('list_hosts', {}, balanced), true);
    assert.strictEqual(tools.isAutoApproved('read_file', { path: '/etc/hosts' }, balanced), true);

    assert.strictEqual(tools.isAutoApproved('write_file', { path: '/etc/hosts' }, balanced), false);
    assert.strictEqual(tools.isAutoApproved('disconnect_session', { session: 'a' }, balanced), false);
    assert.strictEqual(tools.isAutoApproved('connect_host', { hostId: 'h' }, balanced), false);
});

check('a plainly read-only command runs without asking', () => {
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'ls -la /var/log' }, balanced), true);
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'systemctl status nginx' }, balanced), true);
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'df' }, balanced), true);
});

check('a command that only starts with a safe word still asks', () => {
    // The prefix has to be the whole first word, or `lsof`, `catastrophe.sh`
    // and anything else beginning with those letters would ride in free.
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'lsof -i' }, balanced), false);
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'psql -c "drop table users"' }, balanced), false);
});

check('anything chained, piped or substituted asks, whatever it starts with', () => {
    // This is the case that matters most: `ls` is on the safe list, and
    // judging only the first word would wave all of these through.
    const sneaky = [
        'ls; rm -rf /',
        'ls && shutdown -h now',
        'ls | xargs rm',
        'cat /etc/passwd > /tmp/leak',
        'echo $(rm -rf /tmp/x)',
        'ls `reboot`',
        'grep x file & rm -rf /',
    ];
    for (const command of sneaky) {
        assert.strictEqual(
            tools.isAutoApproved('run_command', { command }, balanced), false,
            `"${command}" must stop for approval`
        );
    }
});

check('an unknown tool is never auto approved', () => {
    // The case that happens when a tool is added and this rule is not
    // revisited. The safe answer is to ask.
    assert.strictEqual(tools.isAutoApproved('some_new_tool', {}, balanced), false);
    assert.strictEqual(tools.isAutoApproved('Bash', { command: 'ls' }, balanced), false);
});

check('"never ask" really does mean never', () => {
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'rm -rf /' }, open), true);
    assert.strictEqual(tools.isAutoApproved('some_new_tool', {}, open), true);
});

check('a saved host never carries a secret into the model', () => {
    const shaped = tools.publicHost({
        id: 'host-1',
        name: 'web-01',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        password: 'hunter2',
        privateKey: 'BEGIN OPENSSH PRIVATE KEY',
        passphrase: 'letmein',
        vncPassword: 'vnc',
        rdpPassword: 'rdp',
        tags: ['prod'],
    });

    const serialised = JSON.stringify(shaped);
    for (const secret of ['hunter2', 'PRIVATE KEY', 'letmein', 'vnc', 'rdp']) {
        assert.ok(!serialised.includes(secret), `${secret} must not reach the model`);
    }
    assert.strictEqual(shaped.address, '10.0.0.1:22', 'the address is still usable');
});

console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
