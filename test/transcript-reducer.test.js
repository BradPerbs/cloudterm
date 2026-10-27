/**
 * The transcript fold, held to the promises the panel's speed rests on.
 *
 * A long conversation stays quick because the fold leaves alone whatever an
 * event does not touch: a streamed word keeps the same list, a tool result
 * replaces one item and keeps the rest. Replaying a log and folding a batch
 * are shortcuts that change the list in place, so each is checked against
 * the plain one-event-at-a-time fold it stands in for.
 *
 * Then the things a turn can leave behind: a finished block arriving twice,
 * words or thinking with no finished block to carry them, and calls still
 * marked running after the turn that made them is over.
 *
 * The module under test is ESM for the bundler, so it is imported
 * dynamically; everything else follows the repo's test style.
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

/** Frozen all the way down, so a fold that writes to its input throws. */
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

/** Two turns with everything in them the transcript knows how to draw. */
function conversation() {
    let at = 1000;
    const next = event => ({ ...event, at: at++ });
    return [
        next({ type: 'user-message', text: 'Restart nginx on both' }),
        next({ type: 'thinking-delta', text: 'Check status first.' }),
        next({ type: 'text-delta', text: 'Checking ' }),
        next({ type: 'text-delta', text: 'first.' }),
        next({ type: 'tool-call', id: 't1', name: 'run_command', input: { command: 'systemctl status nginx', session: 's1' } }),
        next({ type: 'tool-call', id: 't2', name: 'run_command', input: { command: 'systemctl status nginx', session: 's2' } }),
        next({ type: 'approval-request', requestId: 'r1', name: 'run_command', input: { command: 'systemctl status nginx', session: 's2' }, sessionId: 's2' }),
        next({ type: 'tool-result', id: 't1', text: 'active (running)' }),
        next({ type: 'approval-settled', requestId: 'r1', status: 'approved' }),
        next({ type: 'tool-result', id: 't2', text: 'inactive', isError: true }),
        next({ type: 'model-changed', text: 'Switched to a faster model' }),
        next({ type: 'assistant-text', text: 'Restarted web-02.' }),
        next({ type: 'result', costUsd: 0.01 }),
        next({ type: 'user-message', text: 'And the logs?' }),
        next({ type: 'thinking-delta', text: 'Look at journalctl' }),
        next({ type: 'tool-failed', name: 'read_file', message: 'no such file' }),
        next({ type: 'warning', message: 'Slow to answer' }),
        next({ type: 'error', message: 'The run ended' }),
        next({ type: 'notice', text: 'Picked up after a restart.' }),
        next({ type: 'interrupted' }),
    ];
}

async function main() {
    const reducer = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'transcript-reducer.js')).href);
    const { INITIAL, applyEvent, applyBatch, replay } = reducer;
    const events = conversation();
    const oneByOne = events.reduce((state, event) => applyEvent(state, event), INITIAL);

    console.log('transcript reducer');

    check('replaying a log gives what folding it one event at a time gives', () => {
        assert.deepStrictEqual(replay(events), oneByOne);
    });

    check('replaying does not touch the shared starting state', () => {
        replay(events);
        assert.deepStrictEqual(INITIAL.items, []);
    });

    check('a batch gives what its events one at a time give, however it is cut', () => {
        for (const size of [1, 2, 3, 5, 8, events.length]) {
            let state = INITIAL;
            for (let from = 0; from < events.length; from += size) {
                state = applyBatch(state, events.slice(from, from + size));
            }
            assert.deepStrictEqual(state, oneByOne, `batches of ${size}`);
        }
    });

    check('neither a single event nor a batch writes to the state it was given', () => {
        const frozen = deepFreeze(replay(events.slice(0, 8)));
        const rest = events.slice(8);
        assert.doesNotThrow(() => rest.reduce((state, event) => applyEvent(state, event), frozen));
        assert.doesNotThrow(() => applyBatch(frozen, rest));
    });

    check('a streamed word leaves the list, and every item in it, as it was', () => {
        const state = replay(events.slice(0, 5));
        const after = applyEvent(state, { type: 'text-delta', text: 'more', at: 1 });
        assert.strictEqual(after.items, state.items);
        assert.strictEqual(after.draft.text, 'more');
    });

    check('a result replaces its own item and keeps every other one', () => {
        const state = replay(events.slice(0, 7));
        const after = applyEvent(state, { type: 'tool-result', id: 't1', text: 'ok', at: 1 });
        assert.notStrictEqual(after.items, state.items);
        const changed = after.items.filter((item, index) => item !== state.items[index]);
        assert.strictEqual(changed.length, 1);
        assert.strictEqual(changed[0].id, 't1');
        assert.strictEqual(changed[0].status, 'done');
    });

    check('a result lands on the call it answers, not the newest one', () => {
        const state = replay(events.slice(0, 6));
        const after = applyEvent(state, { type: 'tool-result', id: 't1', text: 'ok', at: 1 });
        assert.strictEqual(after.items.find(item => item.id === 't1').status, 'done');
        assert.strictEqual(after.items.find(item => item.id === 't2').status, 'running');
    });

    check('a question rides on its call, which waits and then runs once answered', () => {
        const asked = replay(events.slice(0, 7));
        const row = asked.items.find(item => item.id === 't2');
        assert.strictEqual(row.status, 'waiting');
        assert.strictEqual(row.approval.status, 'pending');
        const answered = replay(events.slice(0, 9));
        const after = answered.items.find(item => item.id === 't2');
        assert.strictEqual(after.status, 'running');
        assert.strictEqual(after.approval.status, 'approved');
    });

    check('the words and thinking before a call land above it', () => {
        const state = replay(events.slice(0, 5));
        const [user, said, call] = state.items;
        assert.strictEqual(user.kind, 'user');
        assert.strictEqual(said.kind, 'assistant');
        assert.strictEqual(said.text, 'Checking first.');
        assert.strictEqual(said.thinking, 'Check status first.');
        assert.strictEqual(call.id, 't1');
        assert.deepStrictEqual(state.draft, { text: '', thinking: '' });
    });

    check('thinking with no words before a call is kept as a thought', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'thinking-delta', text: 'Read the config first', at: 2 },
            { type: 'tool-call', id: 'x', name: 'read_file', input: { path: '/etc/hosts' }, at: 3 },
        ]);
        assert.strictEqual(state.items[1].kind, 'assistant');
        assert.strictEqual(state.items[1].text, '');
        assert.strictEqual(state.items[1].thinking, 'Read the config first');
    });

    check('fragments merged into one are drawn exactly as the fragments were', () => {
        // The main process keeps a streaming block as one growing fragment
        // in the log; replaying that must match having watched it stream.
        const apart = replay([
            { type: 'user-message', text: 'hi', at: 1 },
            { type: 'text-delta', text: 'Hel', at: 2 },
            { type: 'text-delta', text: 'lo', at: 3 },
            { type: 'tool-call', id: 'x', name: 'list_hosts', input: {}, at: 4 },
        ]);
        const merged = replay([
            { type: 'user-message', text: 'hi', at: 1 },
            { type: 'text-delta', text: 'Hello', at: 2 },
            { type: 'tool-call', id: 'x', name: 'list_hosts', input: {}, at: 4 },
        ]);
        assert.deepStrictEqual(merged, apart);
        assert.strictEqual(merged.items[1].text, 'Hello');
    });

    check('a late finished block does not duplicate the draft a stop kept', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'text-delta', text: 'Partial', at: 2 },
            { type: 'interrupted', at: 3 },
            { type: 'assistant-text', text: 'Partial', at: 4 },
        ]);
        const replies = state.items.filter(item => item.kind === 'assistant');
        assert.strictEqual(replies.length, 1);
        assert.strictEqual(replies[0].text, 'Partial');
        assert.ok(state.items.some(item => item.kind === 'notice' && item.text === 'Stopped.'));
    });

    check('the same words said again after a call are a new reply', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'assistant-text', text: 'Checking.', at: 2 },
            { type: 'tool-call', id: 'x', name: 'run_command', input: { command: 'uptime' }, at: 3 },
            { type: 'tool-result', id: 'x', text: 'up 3 days', at: 4 },
            { type: 'assistant-text', text: 'Checking.', at: 5 },
        ]);
        assert.strictEqual(state.items.filter(item => item.kind === 'assistant').length, 2);
    });

    check('words left in the draft when a turn ends are kept as a reply', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'text-delta', text: 'All done', at: 2 },
            { type: 'result', costUsd: 0, at: 3 },
        ]);
        assert.strictEqual(state.items.at(-1).kind, 'assistant');
        assert.strictEqual(state.items.at(-1).text, 'All done');
        assert.deepStrictEqual(state.draft, { text: '', thinking: '' });
        assert.strictEqual(state.busy, false);
    });

    check('an error keeps what had arrived of the reply above it', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'text-delta', text: 'Looking at the', at: 2 },
            { type: 'error', message: 'Connection lost', at: 3 },
        ]);
        const [, said, notice] = state.items;
        assert.strictEqual(said.text, 'Looking at the');
        assert.strictEqual(notice.tone, 'error');
    });

    check('calls still running when the turn ends are stopped, not left running', () => {
        for (const end of ['interrupted', 'error', 'closed', 'notice', 'result']) {
            const state = replay([
                { type: 'user-message', text: 'go', at: 1 },
                { type: 'tool-call', id: 'x', name: 'run_command', input: { command: 'sleep 99' }, at: 2 },
                { type: 'tool-call', id: 'y', name: 'read_file', input: { path: '/a' }, at: 3 },
                { type: 'tool-result', id: 'y', text: 'a', at: 4 },
                { type: end, message: 'gone', text: 'gone', at: 5 },
            ]);
            assert.strictEqual(state.items.find(item => item.id === 'x').status, 'stopped', end);
            assert.strictEqual(state.items.find(item => item.id === 'y').status, 'done', end);
        }
    });

    check('a result that arrives after its turn ended still lands', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'tool-call', id: 'x', name: 'run_command', input: { command: 'uptime' }, at: 2 },
            { type: 'interrupted', at: 3 },
            { type: 'tool-result', id: 'x', text: 'up', at: 4 },
        ]);
        assert.strictEqual(state.items.find(item => item.id === 'x').status, 'done');
    });

    check('an answer arriving for a stopped call does not set it running again', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'tool-call', id: 'x', name: 'run_command', input: { command: 'reboot' }, at: 2 },
            { type: 'approval-request', requestId: 'r', name: 'run_command', input: { command: 'reboot' }, at: 3 },
            { type: 'error', message: 'Lost the runtime', at: 4 },
            { type: 'approval-settled', requestId: 'r', status: 'approved', at: 5 },
        ]);
        const row = state.items.find(item => item.id === 'x');
        assert.strictEqual(row.status, 'stopped');
        assert.strictEqual(row.approval.status, 'approved');
    });

    check('a turn that ends with nothing in flight keeps the list it had', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'assistant-text', text: 'Done.', at: 2 },
        ]);
        const after = applyEvent(state, { type: 'closed', at: 3 });
        assert.strictEqual(after.items, state.items);
        assert.strictEqual(after.busy, false);
    });

    check('a model change is a divider, and the turn goes on', () => {
        const state = replay([
            { type: 'user-message', text: 'go', at: 1 },
            { type: 'model-changed', text: 'Switched to Claude Sonnet · high effort', at: 2 },
        ]);
        const divider = state.items.at(-1);
        assert.strictEqual(divider.kind, 'divider');
        assert.strictEqual(divider.text, 'Switched to Claude Sonnet · high effort');
        assert.strictEqual(state.busy, true);
    });

    check('a warning is shown and the turn keeps running', () => {
        const state = replay([{ type: 'user-message', text: 'hi', at: 1 }]);
        const after = applyEvent(state, { type: 'warning', message: 'Slow to answer', at: 2 });
        assert.strictEqual(after.busy, true);
        const notice = after.items.at(-1);
        assert.strictEqual(notice.kind, 'notice');
        assert.strictEqual(notice.tone, 'warn');
    });

    console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
