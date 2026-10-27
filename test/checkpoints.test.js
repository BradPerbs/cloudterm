/**
 * What a turn did to files, and taking it back.
 *
 * Real files in a temporary folder, because the point is what ends up on
 * disk: a file put back, a file the turn created gone again, a file that has
 * moved on since left alone, and a store that stays inside its bounds and goes
 * with its conversation.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const checkpoints = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'checkpoints'));

let passed = 0;
let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failed += 1;
        console.log(`  FAIL ${name}\n       ${error.stack || error.message}`);
    }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-checkpoints-'));
const store = path.join(root, 'store');
const work = path.join(root, 'work');
fs.mkdirSync(work, { recursive: true });
checkpoints.setDirectory(store);

const file = name => path.join(work, name);
const read = name => fs.readFileSync(file(name), 'utf8');
const write = (name, text) => fs.writeFileSync(file(name), text, 'utf8');
const local = name => ({ where: 'local', path: file(name) });
const stored = conversation => path.join(store, `${conversation}.json`);

/** One of our own tools, recording on either side of its write. */
function ourWrite(conversation, name, text) {
    checkpoints.before(conversation, local(name), checkpoints.readLocal(file(name)));
    write(name, text);
    checkpoints.after(conversation, local(name), checkpoints.readLocal(file(name)));
}

(async () => {
    console.log('\ncheckpoints');

    await check('a turn that edits a file is summed up, and undo puts it back', async () => {
        write('a.conf', 'one\ntwo\nthree\n');
        checkpoints.begin('c1', 100);
        ourWrite('c1', 'a.conf', 'one\nTWO\nthree\nfour\n');
        const summary = checkpoints.finish('c1');
        assert.strictEqual(summary.turnId, 100);
        assert.strictEqual(summary.files.length, 1);
        assert.strictEqual(summary.files[0].added, 2);
        assert.strictEqual(summary.files[0].removed, 1);
        assert.strictEqual(summary.files[0].kept, true);
        // The contents stay in the main process; the card gets the counts.
        assert.strictEqual(summary.files[0].before, undefined);

        const result = await checkpoints.revert('c1', 100);
        assert.deepStrictEqual(result.failed, []);
        assert.deepStrictEqual(result.reverted, [file('a.conf')]);
        assert.strictEqual(read('a.conf'), 'one\ntwo\nthree\n');
    });

    await check('a turn that changed nothing has no card', async () => {
        write('b.conf', 'same\n');
        checkpoints.begin('c2', 200);
        ourWrite('c2', 'b.conf', 'same\n');
        assert.strictEqual(checkpoints.finish('c2'), null);
    });

    await check('a file the turn created is removed by undo', async () => {
        checkpoints.begin('c3', 300);
        ourWrite('c3', 'new.txt', 'hello\n');
        const summary = checkpoints.finish('c3');
        assert.strictEqual(summary.files[0].created, true);
        await checkpoints.revert('c3', 300);
        assert.strictEqual(fs.existsSync(file('new.txt')), false);
    });

    await check('the first reading before and the last after are the ones kept', async () => {
        write('c.conf', 'v1\n');
        checkpoints.begin('c4', 400);
        ourWrite('c4', 'c.conf', 'v2\n');
        ourWrite('c4', 'c.conf', 'v3\n');
        checkpoints.finish('c4');
        await checkpoints.revert('c4', 400);
        assert.strictEqual(read('c.conf'), 'v1\n');
    });

    await check('a runtime\'s own edit is read when announced and when answered', async () => {
        write('d.js', 'const a = 1;\nconst b = 2;\n');
        const turn = checkpoints.track('c5', { type: 'user-message', at: 500 });
        assert.strictEqual(turn, null, 'a message starts a turn and has no card of its own');
        checkpoints.track('c5', {
            type: 'tool-call',
            id: 'toolu_1',
            name: 'Edit',
            local: true,
            input: { file_path: file('d.js'), old_string: 'const b = 2;', new_string: 'const b = 3;' },
        });
        write('d.js', 'const a = 1;\nconst b = 3;\n');
        checkpoints.track('c5', { type: 'tool-result', id: 'toolu_1', isError: false });
        const card = checkpoints.track('c5', { type: 'result' });
        assert.strictEqual(card.type, 'turn-changes');
        assert.strictEqual(card.turnId, 500);
        assert.strictEqual(card.files.length, 1);
        await checkpoints.revert('c5', 500);
        assert.strictEqual(read('d.js'), 'const a = 1;\nconst b = 2;\n');
    });

    await check('a call on a relative path, or one that is not ours to read, is not tracked', async () => {
        checkpoints.track('c5b', { type: 'user-message', at: 550 });
        checkpoints.track('c5b', {
            type: 'tool-call', id: 'r1', name: 'Edit', local: true,
            input: { file_path: 'relative.js', old_string: 'a', new_string: 'b' },
        });
        checkpoints.track('c5b', { type: 'tool-result', id: 'r1', isError: false });
        assert.strictEqual(checkpoints.track('c5b', { type: 'interrupted' }), null);
    });

    await check('an edit read too late is undone by putting its passage back', async () => {
        // The runtime ran the edit before the app saw the call: both readings
        // are of the edited file, and only the passage says what changed.
        write('e.js', 'let x = "new";\n');
        checkpoints.begin('c6', 600);
        checkpoints.callStarted('c6', {
            id: 'call_1',
            name: 'edit',
            local: true,
            input: { filePath: file('e.js'), oldString: 'let x = "old";', newString: 'let x = "new";' },
        });
        checkpoints.callFinished('c6', { id: 'call_1', isError: false });
        const summary = checkpoints.finish('c6');
        assert.strictEqual(summary.files.length, 1);
        assert.strictEqual(summary.files[0].added, 1);
        await checkpoints.revert('c6', 600);
        assert.strictEqual(read('e.js'), 'let x = "old";\n');
    });

    await check('a refused edit changes nothing and leaves no card', async () => {
        write('f.js', 'untouched\n');
        checkpoints.begin('c7', 700);
        checkpoints.callStarted('c7', {
            id: 'call_2',
            name: 'Edit',
            local: true,
            input: { file_path: file('f.js'), old_string: 'untouched', new_string: 'touched' },
        });
        checkpoints.callFinished('c7', { id: 'call_2', isError: true });
        assert.strictEqual(checkpoints.finish('c7'), null);
    });

    await check('a file that moved on since is refused, and the others still go back', async () => {
        write('g1.txt', 'g1 before\n');
        write('g2.txt', 'g2 before\n');
        checkpoints.begin('c8', 800);
        ourWrite('c8', 'g1.txt', 'g1 after\n');
        ourWrite('c8', 'g2.txt', 'g2 after\n');
        const summary = checkpoints.finish('c8');
        write('g2.txt', 'someone else wrote this\n');

        const result = await checkpoints.revert('c8', 800);
        assert.deepStrictEqual(result.reverted, [file('g1.txt')]);
        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].path, file('g2.txt'));
        assert.strictEqual(result.failed[0].reason, 'changed');
        assert.strictEqual(result.failed[0].id, summary.files[1].id, 'named the way the card names it');
        assert.strictEqual(read('g1.txt'), 'g1 before\n');
        assert.strictEqual(read('g2.txt'), 'someone else wrote this\n');
    });

    await check('trying again after a partial undo touches only what is not back yet', async () => {
        write('g2.txt', 'g2 after\n');
        write('g1.txt', 'g1 edited after the undo\n');
        const again = await checkpoints.revert('c8', 800);
        assert.deepStrictEqual(again.failed, []);
        assert.deepStrictEqual(again.reverted, [file('g2.txt')]);
        assert.strictEqual(read('g1.txt'), 'g1 edited after the undo\n', 'the one already back is left alone');
        assert.strictEqual(read('g2.txt'), 'g2 before\n');
    });

    await check('a file deleted since is refused rather than brought back', async () => {
        write('h0.txt', 'before\n');
        checkpoints.begin('c8b', 850);
        ourWrite('c8b', 'h0.txt', 'after\n');
        checkpoints.finish('c8b');
        fs.unlinkSync(file('h0.txt'));
        const result = await checkpoints.revert('c8b', 850);
        assert.strictEqual(result.failed[0].reason, 'gone');
        assert.strictEqual(fs.existsSync(file('h0.txt')), false);
    });

    await check('a passage still there is put back even when the file moved on', async () => {
        write('h.conf', 'port 80\nhost a\n');
        checkpoints.begin('c9', 900);
        checkpoints.before('c9', local('h.conf'), checkpoints.readLocal(file('h.conf')));
        write('h.conf', 'port 8080\nhost a\n');
        checkpoints.after('c9', local('h.conf'), checkpoints.readLocal(file('h.conf')));
        checkpoints.passage('c9', local('h.conf'), { old: 'port 80', new: 'port 8080' });
        checkpoints.finish('c9');
        write('h.conf', 'port 8080\nhost b\n');

        const result = await checkpoints.revert('c9', 900);
        assert.deepStrictEqual(result.failed, []);
        assert.strictEqual(read('h.conf'), 'port 80\nhost b\n');
    });

    await check('undo is kept on disk, and asking twice does nothing twice', async () => {
        write('i.txt', 'i before\n');
        checkpoints.begin('c10', 1000);
        ourWrite('c10', 'i.txt', 'i after\n');
        checkpoints.finish('c10');

        // A fresh start of the app: nothing in memory.
        checkpoints.setDirectory(store);
        const changes = checkpoints.changes('c10', 1000);
        assert.strictEqual(changes.found, true);
        assert.strictEqual(changes.files[0].diff.added, 1);

        await checkpoints.revert('c10', 1000);
        assert.strictEqual(read('i.txt'), 'i before\n');
        write('i.txt', 'written again\n');
        const again = await checkpoints.revert('c10', 1000);
        assert.strictEqual(again.already, true);
        assert.strictEqual(read('i.txt'), 'written again\n');
    });

    await check('a server file goes back over its own channel, and not with no way to reach it', async () => {
        const remote = { '/etc/app.conf': { existed: true, content: 'remote after\n' } };
        const io = () => ({
            read: async entry => remote[entry.path],
            write: async (entry, content) => { remote[entry.path] = { existed: true, content }; },
            remove: async (entry) => { remote[entry.path] = { existed: false, content: '' }; },
        });
        const server = { where: 'remote', sessionId: 's1', path: '/etc/app.conf', host: 'web-01', hostId: 'h1' };
        checkpoints.begin('c11', 1100);
        checkpoints.before('c11', server, { existed: true, content: 'remote before\n' });
        checkpoints.after('c11', server, { existed: true, content: 'remote after\n' });
        const summary = checkpoints.finish('c11');
        assert.strictEqual(summary.files[0].host, 'web-01');
        assert.strictEqual(summary.files[0].where, 'remote');

        const closed = () => ({ read: async () => { const error = new Error('closed'); throw error; } });
        const refused = await checkpoints.revert('c11', 1100, { remote: closed });
        assert.strictEqual(refused.failed[0].reason, 'failed');
        assert.strictEqual(remote['/etc/app.conf'].content, 'remote after\n');

        const result = await checkpoints.revert('c11', 1100, { remote: io });
        assert.deepStrictEqual(result.failed, []);
        assert.strictEqual(remote['/etc/app.conf'].content, 'remote before\n');
    });

    await check('a file too big or not text is not held at all', async () => {
        assert.strictEqual(checkpoints.stateOf(Buffer.alloc(checkpoints.MAX_BYTES + 1, 97)), null);
        assert.strictEqual(checkpoints.stateOf(Buffer.from([0, 1, 2, 0, 255])), null);
        assert.strictEqual(checkpoints.stateOfText('x'.repeat(checkpoints.MAX_BYTES + 1)), null);
        assert.deepStrictEqual(checkpoints.stateOfText('ok'), { existed: true, content: 'ok' });

        fs.writeFileSync(file('big.log'), 'a'.repeat(checkpoints.MAX_BYTES + 10));
        checkpoints.begin('c12', 1200);
        ourWrite('c12', 'big.log', 'small now\n');
        assert.strictEqual(checkpoints.finish('c12'), null, 'never held, so neither shown nor offered');
    });

    await check('a turn keeps what fits and lists the rest without promising to undo it', async () => {
        const size = Math.floor(checkpoints.MAX_BYTES * 0.9);
        checkpoints.begin('c13', 1300);
        for (let index = 0; index < 4; index += 1) {
            write(`many-${index}.txt`, `${'b'.repeat(size)}\n`);
            ourWrite('c13', `many-${index}.txt`, `${'a'.repeat(size)}\n`);
        }
        const summary = checkpoints.finish('c13');
        assert.strictEqual(summary.files.length, 4, 'every file is listed');
        const kept = summary.files.filter(entry => entry.kept);
        assert.ok(kept.length >= 1 && kept.length < 4, `kept ${kept.length} of 4`);
        assert.ok(fs.statSync(stored('c13')).size <= checkpoints.MAX_TURN_BYTES + 64 * 1024, 'the turn stays in its bound');

        const result = await checkpoints.revert('c13', 1300);
        assert.strictEqual(result.reverted.length, kept.length);
        assert.ok(result.failed.every(entry => entry.reason === 'notKept'));
    });

    await check('a conversation\'s store drops its oldest turns to stay in its bound', async () => {
        const size = Math.floor(checkpoints.MAX_BYTES * 0.9);
        for (let turn = 0; turn < 8; turn += 1) {
            write('rolling.txt', `${String(turn).repeat(size)}\n`);
            checkpoints.begin('c14', 1400 + turn);
            ourWrite('c14', 'rolling.txt', `${String(turn + 1).repeat(size)}\n`);
            checkpoints.finish('c14');
        }
        assert.ok(fs.statSync(stored('c14')).size <= checkpoints.MAX_STORE_BYTES, 'within the bound on disk');
        assert.strictEqual(checkpoints.changes('c14', 1400).found, false, 'the oldest turn lost its undo');
        assert.strictEqual(checkpoints.changes('c14', 1407).found, true, 'the newest kept it');
    });

    await check('a snapshot holding a pasted key is kept in memory only', async () => {
        const secret = 'sk-test-0123456789abcdef';
        write('env', 'KEY=\n');
        checkpoints.begin('c15', 1500);
        ourWrite('c15', 'env', `KEY=${secret}\n`);
        checkpoints.finish('c15', { secrets: new Set([secret]) });
        assert.ok(!fs.readFileSync(stored('c15'), 'utf8').includes(secret), 'not on disk');

        // Undo still works for as long as this run of the app.
        const result = await checkpoints.revert('c15', 1500, { secrets: new Set([secret]) });
        assert.deepStrictEqual(result.failed, []);
        assert.strictEqual(read('env'), 'KEY=\n');
    });

    await check('forgetting a conversation drops its snapshots, and pruning drops the strays', async () => {
        checkpoints.forget('c10');
        assert.strictEqual(checkpoints.changes('c10', 1000).found, false);
        assert.strictEqual(fs.existsSync(stored('c10')), false);

        checkpoints.prune(['c1', 'c8']);
        assert.ok(fs.existsSync(stored('c1')), 'a conversation still held keeps its file');
        assert.ok(fs.existsSync(stored('c8')));
        assert.strictEqual(fs.existsSync(stored('c11')), false, 'one no longer held loses it');
    });

    await check('the note the agent gets after an undo names the files', () => {
        const note = checkpoints.revertNote(['/etc/a.conf', '/etc/b.conf']);
        assert.ok(note.includes('- /etc/a.conf') && note.includes('- /etc/b.conf'));
    });

    fs.rmSync(root, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exitCode = 1;
})();
