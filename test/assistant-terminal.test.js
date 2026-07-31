/**
 * Exercises how a command typed into a visible terminal is judged finished.
 *
 * A PTY has no concept of a command ending, so this is a heuristic: the screen
 * goes quiet and the last line looks like a prompt again. Worth testing
 * precisely because it fails quietly in both directions. Too eager and the
 * assistant reports half an answer as the whole one; too strict and every
 * command waits out its full timeout before returning perfectly good output.
 *
 * `electron` is stubbed so it runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-terminal-'));

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

const { looksFinished, tidy, lastLine } = require(path.join(ROOT, 'ai', 'terminal-run'));
const settingsModule = require(path.join(ROOT, 'ai', 'settings'));

const PROMPT = 'root@web-01:~#';

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

console.log('\nassistant terminal commands');

check('commands go to the visible terminal by default', () => {
    // The point of the default: work you cannot see is work you have to take
    // on faith. Running out of sight is a choice someone makes deliberately.
    assert.strictEqual(settingsModule.DEFAULTS.commandMode, 'terminal');
    assert.ok(settingsModule.COMMAND_MODES.has('background'), 'the other mode is still available');
});

check('nothing has come back yet', () => {
    assert.strictEqual(looksFinished('', PROMPT), false);
    // Not even the echo of what was typed has completed a line.
    assert.strictEqual(looksFinished('systemctl status ngin', PROMPT), false);
});

check('output still arriving is not finished', () => {
    const streaming = `${PROMPT} systemctl status nginx\n`
        + '● nginx.service - A high performance web server\n'
        + '   Loaded: loaded (/lib/systemd/system/nginx.service; enabled)\n'
        + '   Active: active (running) since Mon 2026-07-27 09:14:02 UTC';
    assert.strictEqual(looksFinished(streaming, PROMPT), false);
});

check('the prompt coming back means finished', () => {
    const done = `${PROMPT} uptime\n 14:02:11 up 31 days,  2:11,  1 user\n${PROMPT} `;
    assert.strictEqual(looksFinished(done, PROMPT), true);
});

check('a prompt that carries a clock or a branch still counts', () => {
    // Captured before the command, so it will not be byte-identical after.
    const before = '[14:01] root@web-01 ~ (main) $';
    const after = `${before} ls\nfile-a  file-b\n[14:02] root@web-01 ~ (main) $ `;
    // Not equal to the captured line, but it still looks like a shell waiting.
    assert.strictEqual(looksFinished(after, before), true);
});

check('an unknown prompt shape still resolves on the usual endings', () => {
    // No prompt was captured, which happens when the pane had been cleared.
    assert.strictEqual(looksFinished('ls\na  b\nuser@box:/srv$ ', ''), true);
    assert.strictEqual(looksFinished('ls\na  b\nPS C:\\Users\\me> ', ''), true);
    assert.strictEqual(looksFinished('whoami\nroot\nsh-5.2# ', ''), true);
});

check('a line of plain output is not mistaken for a prompt', () => {
    const running = 'tail -f app.log\n2026-07-27 14:02:11 INFO request handled in 31ms';
    assert.strictEqual(looksFinished(running, PROMPT), false);
});

check('the echoed command and the fresh prompt are stripped', () => {
    const raw = `${PROMPT} uptime\n 14:02:11 up 31 days,  2:11,  1 user\n${PROMPT} `;
    const cleaned = tidy(raw, 'uptime', PROMPT);

    assert.strictEqual(cleaned, ' 14:02:11 up 31 days,  2:11,  1 user');
    assert.ok(!cleaned.includes(PROMPT), 'no prompt survives into the result');
});

check('multi-line output keeps its shape', () => {
    const raw = `${PROMPT} df -h\nFilesystem      Size  Used Avail\n/dev/sda1        40G   31G  6.8G\n${PROMPT} `;
    const cleaned = tidy(raw, 'df -h', PROMPT);

    assert.deepStrictEqual(cleaned.split('\n'), [
        'Filesystem      Size  Used Avail',
        '/dev/sda1        40G   31G  6.8G',
    ]);
});

check('a command that printed nothing tidies to nothing', () => {
    const raw = `${PROMPT} touch /tmp/x\n${PROMPT} `;
    assert.strictEqual(tidy(raw, 'touch /tmp/x', PROMPT), '');
});

check('the last line with anything on it is what gets read', () => {
    assert.strictEqual(lastLine('a\nb\n\n\n'), 'b');
    assert.strictEqual(lastLine('   \n\n'), '');
    assert.strictEqual(lastLine(''), '');
});

console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
