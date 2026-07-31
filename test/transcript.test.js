/**
 * Exercises the in-memory session tail the assistant reads.
 *
 * Three things here are worth a test because all three fail quietly. The ring
 * buffer has to stay bounded no matter how much a server prints, or a session
 * left running `tail -f` eventually takes the app down. The cursor has to be
 * honest about having lost data, because "here is everything since you asked"
 * and "here is what I still had" are different answers and only one of them is
 * safe to reason from. And a control sequence split across two socket reads
 * must not leave its tail behind as literal text, which is the bug that puts
 * `[0m` in the middle of what the model reads as a filename.
 *
 * `electron` is stubbed so this runs under plain node, the same way the session
 * log's test does.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-transcript-'));

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

const transcript = require(path.join(ROOT, 'transcript'));

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

console.log('\ntranscript');

check('records plain text with the escape sequences gone', () => {
    transcript.open('pane-1', { hostName: 'web-01', address: '10.0.0.1:22', protocol: 'ssh' });
    transcript.record('pane-1', '\x1B[32mroot@web-01\x1B[0m:~# uptime\r\n');

    const read = transcript.read('pane-1');
    assert.ok(read.available, 'the session is being recorded');
    assert.strictEqual(read.text, 'root@web-01:~# uptime\n');
});

check('a sequence split across two reads leaves nothing behind', () => {
    transcript.open('pane-split', {});
    // The colour code is cut in half, exactly as a socket read can cut it.
    transcript.record('pane-split', 'before\x1B[3');
    transcript.record('pane-split', '2mafter');

    const read = transcript.read('pane-split');
    assert.strictEqual(read.text, 'beforeafter', 'no fragment of the sequence survived');
});

check('the buffer stays bounded however much arrives', () => {
    transcript.open('pane-2', {});
    // Comfortably past the cap, in chunks, the way real output arrives.
    for (let index = 0; index < 200; index += 1) {
        transcript.record('pane-2', `${'x'.repeat(1000)}\n`);
    }

    const read = transcript.read('pane-2', { maxChars: Number.MAX_SAFE_INTEGER });
    assert.ok(
        read.text.length <= transcript.MAX_CHARS,
        `held ${read.text.length} characters, cap is ${transcript.MAX_CHARS}`
    );
});

check('a cursor returns only what landed after it', () => {
    transcript.open('pane-3', {});
    transcript.record('pane-3', 'first\n');

    const mark = transcript.cursor('pane-3');
    transcript.record('pane-3', 'second\n');

    const read = transcript.read('pane-3', { since: mark });
    assert.strictEqual(read.text, 'second\n');
    assert.strictEqual(read.truncated, false);
});

check('a cursor with nothing after it returns nothing', () => {
    transcript.open('pane-4', {});
    transcript.record('pane-4', 'only\n');

    const read = transcript.read('pane-4', { since: transcript.cursor('pane-4') });
    assert.strictEqual(read.text, '');
});

check('a cursor older than the buffer says so', () => {
    transcript.open('pane-5', {});
    transcript.record('pane-5', 'start\n');
    const mark = transcript.cursor('pane-5');

    // Push the marked position out of the window entirely.
    for (let index = 0; index < 200; index += 1) {
        transcript.record('pane-5', `${'y'.repeat(1000)}\n`);
    }

    const read = transcript.read('pane-5', { since: mark, maxChars: Number.MAX_SAFE_INTEGER });
    assert.strictEqual(read.truncated, true, 'the gap is reported rather than hidden');
});

check('a line limit returns the most recent lines', () => {
    transcript.open('pane-6', {});
    transcript.record('pane-6', 'one\ntwo\nthree\nfour\n');

    const read = transcript.read('pane-6', { lines: 2 });
    assert.ok(read.text.includes('four'), 'the last line is there');
    assert.ok(!read.text.includes('one'), 'the first line was dropped');
});

check('open sessions are listed with the host that owns them', () => {
    const listed = transcript.list().find(entry => entry.sessionId === 'pane-1');
    assert.ok(listed, 'pane-1 is in the list');
    assert.strictEqual(listed.hostName, 'web-01');
    assert.strictEqual(listed.protocol, 'ssh');

    const info = transcript.info('pane-1');
    assert.strictEqual(info.address, '10.0.0.1:22');
    assert.strictEqual(transcript.info('nope'), null, 'an unknown session has no info');
});

check('closing a session forgets it', () => {
    transcript.open('pane-7', {});
    transcript.record('pane-7', 'gone\n');
    transcript.close('pane-7');

    assert.strictEqual(transcript.has('pane-7'), false);
    assert.strictEqual(transcript.read('pane-7').available, false);
});

check('recording into a session that was never opened is harmless', () => {
    transcript.record('never-opened', 'stray output\n');
    assert.strictEqual(transcript.has('never-opened'), false);
});

console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
