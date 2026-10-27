/**
 * What the transcript fold makes of the events that go under a reply: the
 * change an edit carries, which its row and its approval card draw as a diff,
 * and each turn's answer rate, for the footer under its reply.
 *
 * The module under test is ESM for the bundler, so it is imported
 * dynamically, as in the reducer's own test.
 */
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

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

async function main() {
    const { replay } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'transcript-reducer.js')).href);

    console.log('\ntranscript extras');

    const change = { path: '/etc/app.conf', added: 1, removed: 1, partial: true, hunks: [] };

    check('an edit\'s row and its approval card both carry its change', () => {
        const state = replay([
            { type: 'user-message', text: 'Move it to 8080', at: 1 },
            { type: 'tool-call', id: 't1', name: 'edit_file', input: { path: '/etc/app.conf' }, diff: change, at: 2 },
            { type: 'approval-request', requestId: 'r1', name: 'edit_file', input: { path: '/etc/app.conf' }, diff: change, at: 3 },
        ]);
        const row = state.items.find(item => item.kind === 'tool');
        assert.deepStrictEqual(row.diff, change);
        assert.deepStrictEqual(row.approval.diff, change);
    });

    check('a call that is not an edit has no change on it', () => {
        const state = replay([
            { type: 'user-message', text: 'List it', at: 1 },
            { type: 'tool-call', id: 't1', name: 'run_command', input: { command: 'ls' }, at: 2 },
        ]);
        assert.strictEqual(state.items.find(item => item.kind === 'tool').diff, null);
    });

    check('a turn\'s answer rate is filed under the message that began it', () => {
        const state = replay([
            { type: 'user-message', text: 'First', at: 10 },
            { type: 'assistant-text', text: 'One.', at: 11 },
            { type: 'result', outputTokens: 80, durationMs: 4000, tokensPerSec: 20, wallMs: 9000, at: 12 },
            { type: 'user-message', text: 'Second', at: 20 },
            { type: 'assistant-text', text: 'Two.', at: 21 },
            { type: 'result', usage: { output_tokens: 10 }, at: 22 },
        ]);
        assert.deepStrictEqual(state.turnRates[10], { tps: 20, tokens: 80, seconds: 4, wall: 9 });
        assert.strictEqual(state.turnRates[20], undefined, 'a result main stamped nothing on has no number');
    });

    console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
