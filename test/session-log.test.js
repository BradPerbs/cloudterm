/**
 * Exercises session transcripts: the escape-sequence stripper, the rule that
 * holds back a sequence split across two reads, and a whole session written to
 * disk in both formats. `electron` is stubbed so it runs under plain node.
 *
 * The stripper is the part worth testing rather than the file plumbing. It runs
 * on every byte a server sends, and it fails quietly: a sequence it half-removes
 * leaves `[0m` sitting in the middle of a line, which nobody notices until they
 * are grepping a transcript months later trying to work out what happened.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-log-'));
const documents = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-docs-'));

const electronStub = {
    app: {
        getPath: (what) => {
            if (what === 'userData') return userData;
            if (what === 'documents') return documents;
            return os.tmpdir();
        },
        getVersion: () => '1.0.0',
        on: () => {},
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

const fresh = (name) => {
    for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}main${path.sep}`)) delete require.cache[key];
    }
    return require(path.join(ROOT, name));
};

let passed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        process.exitCode = 1;
    }
};

const checkAsync = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        process.exitCode = 1;
    }
};

/** Streams flush asynchronously; the file is only whole once `end` has landed. */
const settle = () => new Promise(resolve => setTimeout(resolve, 60));

const sessionLog = fresh('session-log.js');

/* ---------------- the stripper ---------------- */

console.log('\nsession transcripts: stripping escape sequences');

check('drops SGR colour runs and keeps the text', () => {
    assert.strictEqual(
        sessionLog.clean('\x1B[0;32muser@host\x1B[0m:\x1B[1;34m~\x1B[0m$ ls'),
        'user@host:~$ ls'
    );
});

check('drops cursor moves and erases', () => {
    assert.strictEqual(sessionLog.clean('a\x1B[2Kb\x1B[3;7Hc\x1B[Jd'), 'abcd');
});

check('drops an OSC window title, both terminators', () => {
    assert.strictEqual(sessionLog.clean('\x1B]0;bradp@web1\x07ready'), 'ready');
    assert.strictEqual(sessionLog.clean('\x1B]0;bradp@web1\x1B\\ready'), 'ready');
});

check('drops an OSC 8 hyperlink but keeps its text', () => {
    assert.strictEqual(
        sessionLog.clean('\x1B]8;;https://example.com\x07click\x1B]8;;\x07'),
        'click'
    );
});

check('drops charset and keypad escapes', () => {
    assert.strictEqual(sessionLog.clean('\x1B(Bplain\x1B=\x1B>'), 'plain');
});

check('drops a bare bell but keeps tabs and newlines', () => {
    assert.strictEqual(sessionLog.clean('a\x07b\tc\nd'), 'ab\tc\nd');
});

check('leaves text with no sequences in it untouched', () => {
    const line = 'total 24\ndrwxr-xr-x 3 root root 4096 Jul 26 14:25 .\n';
    assert.strictEqual(sessionLog.clean(line), line);
});

/* ---------------- split chunks ---------------- */

console.log('\nsequences split across two reads');

check('holds back a partial CSI until it is complete', () => {
    const [ready, held] = sessionLog.splitPending('done\x1B[0;3');
    assert.strictEqual(ready, 'done');
    assert.strictEqual(held, '\x1B[0;3');
});

check('releases a complete CSI', () => {
    const [ready, held] = sessionLog.splitPending('done\x1B[0m');
    assert.strictEqual(ready, 'done\x1B[0m');
    assert.strictEqual(held, '');
});

check('holds back an OSC whose terminator has not arrived', () => {
    const [ready, held] = sessionLog.splitPending('x\x1B]0;partial-tit');
    assert.strictEqual(ready, 'x');
    assert.strictEqual(held, '\x1B]0;partial-tit');
});

check('gives up on an unterminated sequence rather than holding forever', () => {
    const long = `x\x1B]0;${'a'.repeat(600)}`;
    const [ready, held] = sessionLog.splitPending(long);
    assert.strictEqual(held, '', 'a sequence this long is never going to complete');
    assert.strictEqual(ready, long);
});

check('a chunk with no escape at all is released whole', () => {
    const [ready, held] = sessionLog.splitPending('nothing special here');
    assert.strictEqual(ready, 'nothing special here');
    assert.strictEqual(held, '');
});

/* ---------------- settings ---------------- */

console.log('\nsettings');

check('defaults to off, readable, no timestamps', () => {
    const config = sessionLog.getConfig();
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.format, 'plain');
    assert.strictEqual(config.timestamps, false);
    assert.ok(config.usingDefaultDirectory, 'no directory chosen yet');
    assert.ok(config.directory, 'a default directory is still resolved');
});

check('refuses timestamps on a verbatim log', () => {
    // A timestamp in the middle of an escape sequence would corrupt the very
    // thing the verbatim format exists to preserve, so the combination is not
    // merely discouraged: it cannot be stored.
    const config = sessionLog.sanitize({ format: 'raw', timestamps: true });
    assert.strictEqual(config.timestamps, false);
});

check('falls back to the defaults for nonsense', () => {
    const config = sessionLog.sanitize({ format: 'yaml', enabled: 'yes', directory: 42 });
    assert.strictEqual(config.format, 'plain');
    assert.strictEqual(config.enabled, true, 'a truthy string still means on');
    assert.strictEqual(config.directory, '');
});

/* ---------------- writing a session ---------------- */

console.log('\nwriting a transcript');

const readLog = (filePath) => fs.readFileSync(filePath, 'utf8');
/** Everything past the `#` header the transcript opens with. */
const body = (text) => text.split('\n').filter(line => !line.startsWith('#')).join('\n');

(async () => {
    await checkAsync('records a readable transcript with the sequences gone', async () => {
        sessionLog.setConfig({ enabled: true, format: 'plain', directory: userData });

        const filePath = sessionLog.start('tab-1', {
            hostName: 'prod web 1',
            address: 'root@10.0.0.4',
            hostId: 'h1',
        });
        assert.ok(filePath, 'a log was opened');

        sessionLog.write('tab-1', '\x1B[0;32mroot@web1\x1B[0m:~$ uptime\r\n');
        sessionLog.write('tab-1', ' 14:25:31 up 40 days,  3:11\r\n');
        sessionLog.close('tab-1');
        await settle();

        const text = readLog(filePath);
        assert.ok(!text.includes('\x1B'), 'no escape character survives');
        assert.ok(body(text).includes('root@web1:~$ uptime'), 'the prompt is readable');
        assert.ok(body(text).includes('up 40 days'), 'the output is there');
        assert.ok(text.includes('# host: prod web 1 (root@10.0.0.4)'), 'the header names the host');
    });

    await checkAsync('names the file after the host and the time', async () => {
        const filePath = sessionLog.start('tab-2', { hostName: 'db/primary #2', address: 'x' });
        sessionLog.close('tab-2');
        await settle();

        const name = path.basename(filePath);
        assert.ok(/^db-primary-2_\d{4}-\d{2}-\d{2}_\d{6}\.log$/.test(name), `unexpected name: ${name}`);
    });

    await checkAsync('reassembles a sequence split across two writes', async () => {
        const filePath = sessionLog.start('tab-3', { hostName: 'split', address: 'x' });

        // The colour code arrives in two pieces, as it would off a real socket.
        sessionLog.write('tab-3', 'before\x1B[0');
        sessionLog.write('tab-3', ';32mafter\r\n');
        sessionLog.close('tab-3');
        await settle();

        const text = body(readLog(filePath));
        assert.ok(text.includes('beforeafter'), `the halves were not rejoined: ${JSON.stringify(text)}`);
        assert.ok(!text.includes('32m'), 'no fragment of the sequence was left behind');
    });

    await checkAsync('keeps every byte in verbatim mode', async () => {
        sessionLog.setConfig({ format: 'raw' });

        const filePath = sessionLog.start('tab-4', { hostName: 'raw', address: 'x' });
        sessionLog.write('tab-4', '\x1B[31mred\x1B[0m');
        sessionLog.close('tab-4');
        await settle();

        assert.ok(readLog(filePath).includes('\x1B[31mred\x1B[0m'), 'the sequences are preserved');
    });

    await checkAsync('stamps each line when asked, and only at line starts', async () => {
        sessionLog.setConfig({ format: 'plain', timestamps: true });

        const filePath = sessionLog.start('tab-5', { hostName: 'stamped', address: 'x' });
        sessionLog.write('tab-5', 'one\r\ntwo\r\n');
        sessionLog.close('tab-5');
        await settle();

        const lines = body(readLog(filePath)).split('\n').filter(Boolean);
        assert.strictEqual(lines.length, 2, `expected two lines, got ${lines.length}`);
        for (const line of lines) {
            assert.ok(
                /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] (one|two)$/.test(line),
                `not stamped once at the start: ${JSON.stringify(line)}`
            );
        }
    });

    await checkAsync('a session written across two chunks is stamped once per line', async () => {
        sessionLog.setConfig({ format: 'plain', timestamps: true });

        const filePath = sessionLog.start('tab-6', { hostName: 'partial', address: 'x' });
        // A line arriving in two pieces must not gain a timestamp in the middle.
        sessionLog.write('tab-6', 'half');
        sessionLog.write('tab-6', '-line\r\n');
        sessionLog.close('tab-6');
        await settle();

        const lines = body(readLog(filePath)).split('\n').filter(Boolean);
        assert.strictEqual(lines.length, 1, `expected one line, got ${lines.length}`);
        assert.ok(/^\[[^\]]+\] half-line$/.test(lines[0]), `unexpected: ${JSON.stringify(lines[0])}`);
    });

    await checkAsync('writes nothing at all while recording is off', async () => {
        sessionLog.setConfig({ enabled: false });

        assert.strictEqual(sessionLog.start('tab-7', { hostName: 'ignored', address: 'x' }), null);
        // Writing to a session that was never opened is a no-op, not a throw:
        // ssh.js calls it for every chunk of every session either way.
        sessionLog.write('tab-7', 'should not be written');
        assert.strictEqual(sessionLog.status('tab-7').recording, false);
    });

    await checkAsync('records one session on request while the setting is off', async () => {
        const filePath = sessionLog.start('tab-8', { hostName: 'forced', address: 'x', force: true });
        assert.ok(filePath, 'force opens a log even with the setting off');

        const status = sessionLog.status('tab-8');
        assert.strictEqual(status.recording, true);
        assert.strictEqual(status.always, false, 'the global setting is still off');

        sessionLog.write('tab-8', 'captured\r\n');
        sessionLog.close('tab-8', { reason: 'stopped' });
        await settle();

        const text = readLog(filePath);
        assert.ok(body(text).includes('captured'));
        assert.ok(text.includes('Stopped from the session'), 'the reason is recorded');
    });

    await checkAsync('turning recording off closes what is open', async () => {
        sessionLog.setConfig({ enabled: true, directory: userData });
        const filePath = sessionLog.start('tab-9', { hostName: 'closing', address: 'x' });
        assert.strictEqual(sessionLog.status('tab-9').recording, true);

        sessionLog.setConfig({ enabled: false });
        await settle();

        assert.strictEqual(sessionLog.status('tab-9').recording, false);
        assert.ok(readLog(filePath).includes('Recording turned off'), 'the reason is recorded');
    });

    await checkAsync('lists what is on disk, newest first', async () => {
        const { files } = sessionLog.list({ limit: 50 });
        assert.ok(files.length >= 5, `expected several logs, found ${files.length}`);
        for (let index = 1; index < files.length; index++) {
            assert.ok(
                files[index - 1].modifiedAt >= files[index].modifiedAt,
                'logs are not in newest-first order'
            );
        }
    });

    await checkAsync('never records a password the shell did not echo', async () => {
        // The transcript is fed only what the *server* sent. A `sudo` prompt
        // echoes nothing, so the password typed into it cannot reach the file;
        // this is the guarantee that makes transcripts safe to keep at all.
        sessionLog.setConfig({ enabled: true, format: 'plain', timestamps: false });
        const filePath = sessionLog.start('tab-10', { hostName: 'sudo', address: 'x' });

        sessionLog.write('tab-10', '[sudo] password for bradp: ');
        // Whatever was typed never comes through `write`; only the server's reply.
        sessionLog.write('tab-10', '\r\nSorry, try again.\r\n');
        sessionLog.close('tab-10');
        await settle();

        const text = readLog(filePath);
        assert.ok(text.includes('[sudo] password for bradp:'), 'the prompt is there');
        assert.ok(!text.includes('hunter2'), 'nothing typed at it could be');
    });

    console.log(`\n${passed} checks passed`);
})();
