/**
 * Reading a stretch of a remote file, and editing one passage of it.
 *
 * Two things here fail quietly. An edit that matched line endings literally
 * refused every passage copied out of a file with Windows endings, which sent
 * the agent off to rewrite whole files; and an edit that wrote back text it
 * could not round-trip would change bytes nobody asked it to touch. A read by
 * line has to say where it stopped, or the agent cannot ask for the next part.
 *
 * SFTP is a fake held in memory, reached through the same `withSftp` the tools
 * use. `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { Readable } = require('stream');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-files-'));

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

const fileText = require(path.join(ROOT, 'ai', 'file-text'));
const tools = require(path.join(ROOT, 'ai', 'tools'));
const settingsModule = require(path.join(ROOT, 'ai', 'settings'));
const sftp = require(path.join(ROOT, 'sftp'));
const transcript = require(path.join(ROOT, 'transcript'));

/* A server's files, in memory, behind the handle `withSftp` hands a tool. */
const files = new Map();
let streamed = 0;
const handle = {
    stat: (file, done) => {
        const entry = files.get(file);
        if (!entry) return done(Object.assign(new Error('No such file'), { code: 2 }));
        return done(null, { size: entry.size ?? entry.data.length });
    },
    readFile: (file, done) => done(null, files.get(file).data),
    writeFile: (file, content, options, done) => {
        files.set(file, { data: Buffer.from(content, 'utf8') });
        done(null);
    },
    createReadStream: (file) => {
        // Small chunks, so lines and characters are split across them.
        const data = files.get(file).data;
        const chunks = [];
        for (let at = 0; at < data.length; at += 7) chunks.push(data.subarray(at, at + 7));
        const stream = Readable.from(chunks);
        stream.on('data', (chunk) => { streamed += chunk.length; });
        return stream;
    },
};
sftp.withSftp = async (sessionId, fn) => new Promise(resolve => fn(handle, resolve));
transcript.info = sessionId => (sessionId === 's1' ? { sessionId: 's1', hostName: 'web-01', address: '10.0.0.1' } : null);

const ctx = { scope: 'session', boundSessionId: 's1', sessionIds: [], hostIds: [], settings: settingsModule.DEFAULTS };
const run = (name, input) => tools.BY_NAME.get(name).handler(input, ctx);

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
    console.log('\nassistant files');

    await check('an edit replaces one exact passage and refuses an ambiguous or missing one', () => {
        const once = fileText.applyEdit('a = 1\nb = 2\n', 'b = 2', 'b = 3');
        assert.deepStrictEqual(once, { content: 'a = 1\nb = 3\n', replaced: 1 });

        const twice = fileText.applyEdit('x\nx\n', 'x', 'y');
        assert.ok(/appears 2 times/.test(twice.error), 'two matches is not a guess to make');
        assert.deepStrictEqual(fileText.applyEdit('x\nx\n', 'x', 'y', { all: true }), { content: 'y\ny\n', replaced: 2 });

        assert.ok(/not found/.test(fileText.applyEdit('a\n', 'b', 'c').error));
        assert.ok(/empty/.test(fileText.applyEdit('a\n', '', 'c').error));
        assert.deepStrictEqual(fileText.applyEdit('keep\ndrop\n', 'drop\n', ''), { content: 'keep\n', replaced: 1 });
    });

    await check('an edit matches across line endings and keeps the file\'s own', () => {
        const windows = 'listen 80;\r\nserver_name a;\r\nroot /srv;\r\n';
        // What a model writes is `\n`, whatever the file uses.
        const spanning = fileText.applyEdit(windows, 'listen 80;\nserver_name a;', 'listen 8080;\nserver_name b;');
        assert.strictEqual(spanning.content, 'listen 8080;\r\nserver_name b;\r\nroot /srv;\r\n', 'every ending is still CRLF');

        const unix = fileText.applyEdit('a\nb\nc\n', 'b', 'B\nB2');
        assert.strictEqual(unix.content, 'a\nB\nB2\nc\n', 'a file that is LF stays LF');
    });

    await check('a stretch of text comes back by line, saying where it is', () => {
        const body = Array.from({ length: 200 }, (unused, index) => `line ${index + 1}`).join('\n') + '\n';

        const middle = fileText.sliceLines(body, { offset: 100, limit: 3 });
        assert.deepStrictEqual(middle, { content: 'line 100\nline 101\nline 102', from: 100, to: 102, lines: 200 },
            'a final newline is not a line of its own');

        assert.strictEqual(fileText.sliceLines(body, { offset: 199 }).content, 'line 199\nline 200', 'no limit is the rest');
        assert.strictEqual(fileText.sliceLines(body, { limit: 2 }).content, 'line 1\nline 2', 'no offset is the start');

        const past = fileText.sliceLines(body, { offset: 500, limit: 10 });
        assert.strictEqual(past.past, true, 'asking past the end says so');
        assert.strictEqual(past.lines, 200);

        const crlf = fileText.sliceLines('a\r\nb\r\nc\r\n', { offset: 2, limit: 1 });
        assert.strictEqual(crlf.content, 'b\r', 'a line keeps its own ending, so it matches when quoted back');
    });

    await check('a stretch of a stream stops reading once it has its lines', async () => {
        // Multi-byte characters split across the 7-byte chunks below.
        const body = Array.from({ length: 1000 }, (unused, index) => `ligne ${index + 1} été`).join('\n');
        files.set('/var/log/big.log', { data: Buffer.from(body, 'utf8') });

        streamed = 0;
        const head = await fileText.streamLines(handle.createReadStream('/var/log/big.log'), { offset: 2, limit: 2 });
        assert.strictEqual(head.content, 'ligne 2 été\nligne 3 été');
        assert.deepStrictEqual([head.from, head.to], [2, 3]);
        assert.strictEqual(head.lines, undefined, 'the length is not guessed when the read stopped early');
        assert.ok(streamed < 200, `the read stopped early (read ${streamed} bytes)`);

        const tail = await fileText.streamLines(handle.createReadStream('/var/log/big.log'), { offset: 999 });
        assert.strictEqual(tail.content, 'ligne 999 été\nligne 1000 été');
        assert.strictEqual(tail.lines, 1000, 'a read that reached the end knows the length');

        const past = await fileText.streamLines(handle.createReadStream('/var/log/big.log'), { offset: 5000 });
        assert.strictEqual(past.past, true);

        const capped = await fileText.streamLines(handle.createReadStream('/var/log/big.log'), { offset: 900, maxBytes: 50 });
        assert.strictEqual(capped.scanLimit, true, 'a scan has a ceiling');
        assert.strictEqual(capped.past, true, 'and says when the line asked for is beyond it');
    });

    await check('read_file takes offset and limit, on a small file and on one too big to bring over whole', async () => {
        files.set('/etc/app.conf', { data: Buffer.from('one\ntwo\nthree\nfour\n') });
        const stretch = await run('read_file', { path: '/etc/app.conf', offset: 2, limit: 2 });
        assert.ok(!stretch.isError, stretch.text);
        assert.strictEqual(stretch.text, '/etc/app.conf, lines 2-3 of 4:\n\ntwo\nthree');

        const whole = await run('read_file', { path: '/etc/app.conf' });
        assert.strictEqual(whole.text, '/etc/app.conf:\n\none\ntwo\nthree\nfour\n', 'no offset or limit reads it as before');

        const past = await run('read_file', { path: '/etc/app.conf', offset: 10 });
        assert.ok(/has 4 lines/.test(past.text));

        // Reported as bigger than one read may hold, so it has to stream.
        files.set('/var/log/huge.log', {
            data: Buffer.from('first\nsecond\nthird\n'),
            size: 50 * 1024 * 1024,
        });
        const refused = await run('read_file', { path: '/var/log/huge.log' });
        assert.strictEqual(refused.isError, true);
        assert.ok(/offset and limit/.test(refused.text), 'the refusal says how to read part of it');
        const part = await run('read_file', { path: '/var/log/huge.log', offset: 2, limit: 1 });
        assert.strictEqual(part.text, '/var/log/huge.log, lines 2-2:\n\nsecond');
    });

    await check('edit_file changes one passage on the server and keeps its line endings', async () => {
        files.set('/etc/nginx/site.conf', { data: Buffer.from('server {\r\n    listen 80;\r\n}\r\n') });
        const done = await run('edit_file', { path: '/etc/nginx/site.conf', old: 'listen 80;', new: 'listen 8080;' });
        assert.ok(!done.isError, done.text);
        assert.strictEqual(done.text, 'Replaced 1 occurrence in /etc/nginx/site.conf.');
        assert.strictEqual(files.get('/etc/nginx/site.conf').data.toString(), 'server {\r\n    listen 8080;\r\n}\r\n');

        const missing = await run('edit_file', { path: '/etc/nginx/site.conf', old: 'listen 443;', new: 'x' });
        assert.strictEqual(missing.isError, true);
        assert.ok(/was not changed/.test(missing.text));
    });

    await check('edit_file refuses a file it could not write back unchanged outside the passage', async () => {
        // Latin-1, which UTF-8 decoding would turn into replacement characters.
        const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x78, 0x0a]);
        files.set('/etc/latin.conf', { data: latin });
        const refused = await run('edit_file', { path: '/etc/latin.conf', old: 'x', new: 'y' });
        assert.strictEqual(refused.isError, true);
        assert.ok(/not UTF-8/.test(refused.text));
        assert.ok(files.get('/etc/latin.conf').data.equals(latin), 'and left it alone');
    });

    await check('edit_file is a write, so it stops at the card under the default', () => {
        const edit = tools.BY_NAME.get('edit_file');
        assert.strictEqual(edit.readOnly, false);
        const balanced = { ...settingsModule.DEFAULTS, approval: 'writes' };
        assert.strictEqual(tools.isAutoApproved('edit_file', { path: '/etc/x', old: 'a', new: 'b' }, balanced), false);
        assert.strictEqual(tools.isAutoApproved('read_file', { path: '/etc/x', offset: 3 }, balanced), true);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
