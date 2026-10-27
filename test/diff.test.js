/**
 * The change an edit makes, worked out from the call's own arguments.
 *
 * The point of the module is that one rule covers every runtime, so much of
 * this is the same edit spelled the ways the runtimes spell it: a pair of
 * passages, a whole new file, a unified diff and a patch envelope.
 */
const path = require('path');
const assert = require('assert');

const diff = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'diff'));

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failed += 1;
        console.log(`  FAIL ${name}\n       ${error.message}`);
    }
}

console.log('\ndiff');

const shape = change => change.hunks.flatMap(hunk => hunk.lines.map(line => `${line.type[0]} ${line.text}`));
const lines = count => Array.from({ length: count }, (unused, index) => `line ${index + 1}`).join('\n');

check('a changed line reads as one removed and one added, in place', () => {
    const change = diff.between('a\nb\nc', 'a\nB\nc');
    assert.strictEqual(change.added, 1);
    assert.strictEqual(change.removed, 1);
    assert.deepStrictEqual(shape(change), ['s a', 'r b', 'a B', 's c']);
});

check('an unchanged passage is no change at all, not an empty one', () => {
    assert.strictEqual(diff.between('same\ntext', 'same\ntext'), null);
});

check('the newline that ends a file is not a line, and CRLF is not a change', () => {
    assert.strictEqual(diff.between('', 'one\ntwo\n').added, 2);
    assert.strictEqual(diff.between('a\r\nb\r\n', 'a\nb\n'), null);
});

check('the lines are numbered on both sides', () => {
    const change = diff.between('a\nb', 'a\nb\nc');
    const last = change.hunks[0].lines[change.hunks[0].lines.length - 1];
    assert.strictEqual(last.type, 'add');
    assert.strictEqual(last.before, null, 'an added line is on no line of the old file');
    assert.strictEqual(last.after, 3);
});

check('untouched stretches are dropped, leaving context around each change', () => {
    const before = lines(40);
    const after = before.replace('line 6\n', 'LINE 6\n').replace('line 31\n', 'LINE 31\n');
    const change = diff.between(before, after);
    assert.strictEqual(change.hunks.length, 2, 'two changes, two hunks, not forty lines');
    for (const hunk of change.hunks) {
        assert.ok(hunk.lines.length <= 2 + diff.CONTEXT * 2, 'a hunk is its change plus context');
    }
    assert.strictEqual(change.hunks[0].lines.find(line => line.type === 'remove').before, 6);
    assert.strictEqual(change.hunks[1].lines.find(line => line.type === 'add').after, 31);
});

check('a small edit to a long file is drawn, numbered where it is', () => {
    const before = lines(diff.MAX_LINES * 3);
    const after = before.replace('line 4000\n', 'line four thousand\n');
    const change = diff.between(before, after);
    assert.ok(!change.tooLarge, 'the cap is on the change, not on the file');
    assert.strictEqual(change.added, 1);
    assert.strictEqual(change.removed, 1);
    assert.strictEqual(change.hunks[0].before, 3997, 'three lines of context above line 4000');
    assert.strictEqual(change.hunks[0].lines.find(line => line.type === 'add').after, 4000);
});

check('a change too big to read is reported as such rather than drawn', () => {
    const change = diff.between(lines(10), lines(diff.MAX_LINES + 20).replace(/line/g, 'row'));
    assert.strictEqual(change.tooLarge, true);
    assert.deepStrictEqual(change.hunks, []);
});

check('the same edit is found however the runtime spells its tool', () => {
    const calls = [
        ['edit_file', { path: 'a.js', old: 'const a = 1;', new: 'const a = 2;' }],
        ['Edit', { file_path: 'a.js', old_string: 'const a = 1;', new_string: 'const a = 2;' }],
        ['edit', { filePath: 'a.js', oldString: 'const a = 1;', newString: 'const a = 2;' }],
        ['search_replace', { file_path: 'a.js', old_string: 'const a = 1;', new_string: 'const a = 2;' }],
        ['str_replace_editor', { command: 'str_replace', path: 'a.js', old_str: 'const a = 1;', new_str: 'const a = 2;' }],
        ['StrReplaceFile', { path: 'a.js', edit: { old: 'const a = 1;', new: 'const a = 2;' } }],
        ['mcp__somewhere__edit', { file_path: 'a.js', old_string: 'const a = 1;', new_string: 'const a = 2;' }],
    ];
    for (const [name, input] of calls) {
        const change = diff.fromToolInput(name, input);
        assert.ok(change, `${name} is an edit`);
        assert.strictEqual(change.path, 'a.js', `${name} names its file`);
        assert.strictEqual(change.added, 1, `${name} adds one line`);
        assert.strictEqual(change.removed, 1, `${name} removes one line`);
        assert.strictEqual(change.partial, true, 'a passage, so the file\'s line numbers are not claimed');
    }
});

check('several passages in one call are one change with a hunk each', () => {
    const change = diff.fromToolInput('MultiEdit', {
        file_path: 'a.js',
        edits: [
            { old_string: 'one', new_string: 'ONE' },
            { old_string: 'two', new_string: 'TWO' },
        ],
    });
    assert.strictEqual(change.hunks.length, 2);
    assert.strictEqual(change.added, 2);
    assert.strictEqual(change.removed, 2);
});

check('a whole-file write is every line added, and says so', () => {
    const change = diff.fromToolInput('write_file', { path: 'new.js', content: 'one\ntwo\nthree' });
    assert.strictEqual(change.added, 3);
    assert.strictEqual(change.removed, 0);
    assert.strictEqual(change.whole, true);
    assert.strictEqual(diff.fromToolInput('Write', { file_path: 'n.js', content: 'x' }).added, 1);
    assert.strictEqual(diff.fromToolInput('str_replace_editor', { command: 'create', path: 'n', file_text: 'a\nb' }).added, 2);
});

check('OpenCode\'s unified diff is read with its own line numbers', () => {
    const unified = [
        'Index: /srv/app.conf',
        '===================================================================',
        '--- /srv/app.conf',
        '+++ /srv/app.conf',
        '@@ -10,3 +10,3 @@',
        ' keep',
        '-listen 80',
        '+listen 8080',
        ' tail',
        '',
    ].join('\n');
    const change = diff.fromToolInput('edit', { filePath: '/srv/app.conf', diff: unified });
    assert.strictEqual(change.path, '/srv/app.conf');
    assert.strictEqual(change.added, 1);
    assert.strictEqual(change.removed, 1);
    assert.ok(!change.partial, 'a unified diff knows where it is');
    assert.deepStrictEqual(shape(change), ['s keep', 'r listen 80', 'a listen 8080', 's tail']);
    assert.strictEqual(change.hunks[0].lines[1].before, 11);
});

check('a patch envelope is read file by file, as passages', () => {
    const patch = [
        '*** Begin Patch',
        '*** Update File: src/a.js',
        '@@ function main() {',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 3;',
        '*** Add File: src/b.js',
        '+export default 1;',
        '*** Delete File: src/c.js',
        '*** End Patch',
    ].join('\n');
    const change = diff.fromToolInput('apply_patch', { input: patch });
    assert.strictEqual(change.path, 'src/a.js, src/b.js, src/c.js');
    assert.strictEqual(change.added, 2);
    assert.strictEqual(change.removed, 1);
    assert.strictEqual(change.partial, true);
    assert.deepStrictEqual(change.hunks.map(hunk => hunk.file), ['src/a.js', 'src/b.js']);
    assert.ok(diff.fromToolInput('patch', { patchText: patch }), 'OpenCode\'s patch tool carries the same');
});

check('anything that is not an edit has no diff', () => {
    assert.strictEqual(diff.fromToolInput('Read', { file_path: 'a.js' }), null);
    assert.strictEqual(diff.fromToolInput('run_command', { command: 'ls' }), null);
    assert.strictEqual(diff.fromToolInput('Edit', { file_path: 'a.js', old_string: 'x', new_string: 'x' }), null);
    assert.strictEqual(diff.fromToolInput('Edit', null), null);
    assert.strictEqual(diff.fromToolInput('Edit', { file_path: 'a.js' }), null, 'nothing to compare');
    assert.strictEqual(diff.fromToolInput('run_command', { input: '*** Begin Patch' }), null, 'only a patch tool\'s input');
});

check('the diff on an event is cut short and says how much was left off', () => {
    const change = diff.forEvent('write_file', { path: 'big.txt', content: lines(diff.MAX_EVENT_LINES + 50) });
    assert.strictEqual(change.added, diff.MAX_EVENT_LINES + 50, 'the count stays whole');
    assert.strictEqual(change.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0), diff.MAX_EVENT_LINES);
    assert.strictEqual(change.hidden, 50);
    assert.strictEqual(diff.forEvent('write_file', { path: 'small.txt', content: 'x' }).hidden, undefined);
    assert.strictEqual(diff.forEvent('Edit', { get file_path() { throw new Error('boom'); } }), null, 'never throws');
});

check('the files on either side of an edit tool are named for the checkpoints', () => {
    assert.strictEqual(diff.editTarget('Edit', { file_path: '/a', old_string: 'x', new_string: 'y' }), '/a');
    assert.strictEqual(diff.editTarget('Write', { file_path: '/b', content: 'x' }), '/b');
    assert.strictEqual(diff.editTarget('Read', { file_path: '/c' }), '');
    assert.deepStrictEqual(
        diff.passagesOf({ edits: [{ old_string: 'a', new_string: 'b', replace_all: true }] }),
        [{ old: 'a', new: 'b', all: true }],
    );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
