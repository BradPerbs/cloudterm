/**
 * A turn's answer rate, for the number under its reply.
 *
 * The result's output tokens over the turn's active time: wall time from the
 * user's message minus approval waits minus tool runs. Turns whose runtime
 * reports no usage get nothing, as do turns too fast to measure or past any
 * plausible model pace; the panel shows no number rather than a wrong one.
 */
const path = require('path');
const assert = require('assert');

const { stampTurnRate, toolBusyMs, outputTokens } = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'turn-rate'));

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

/** A result stamped `ms` after `start`, on a log holding one message. */
function stamped(start, ms, extra = {}) {
    const events = [{ type: 'user-message', text: 'go', at: start }];
    const result = { type: 'result', subtype: 'success', at: start + ms, ...extra };
    stampTurnRate(events, result);
    return result;
}

console.log('\nturn rate');

check('output tokens over the turn\'s time is the rate', () => {
    const result = stamped(1000, 4000, { usage: { output_tokens: 80 } });
    assert.strictEqual(result.outputTokens, 80);
    assert.strictEqual(result.durationMs, 4000);
    assert.strictEqual(result.tokensPerSec, 20);
    assert.strictEqual(result.wallMs, undefined, 'no second figure when nothing was waited on');
});

check('every usage spelling the runtimes use is read', () => {
    assert.strictEqual(stamped(0, 2000, { usage: { completion_tokens: 40 } }).tokensPerSec, 20);
    assert.strictEqual(stamped(0, 2000, { usage: { outputTokens: 40 } }).tokensPerSec, 20);
    assert.strictEqual(stamped(0, 2000, { usage: { output: 40 } }).tokensPerSec, 20);
    assert.strictEqual(outputTokens(null), 0);
});

check('approval waits come out of the time', () => {
    const events = [
        { type: 'user-message', text: 'go', at: 1000 },
        { type: 'approval-request', requestId: 'r1', at: 1500 },
        { type: 'approval-settled', requestId: 'r1', status: 'approved', at: 3500 },
    ];
    const result = { type: 'result', subtype: 'success', usage: { output_tokens: 40 }, at: 5000 };
    stampTurnRate(events, result);
    // Four wall seconds, two of them waiting on the user.
    assert.strictEqual(result.durationMs, 2000);
    assert.strictEqual(result.tokensPerSec, 20);
});

check('tool runs come out of the time, and the wall stays alongside', () => {
    const events = [
        { type: 'user-message', text: 'go', at: 0 },
        { type: 'tool-call', id: 'c1', at: 1000 },
        { type: 'tool-result', id: 'c1', at: 6000 },
    ];
    const result = { type: 'result', subtype: 'success', usage: { output_tokens: 100 }, at: 10000 };
    stampTurnRate(events, result);
    // Ten wall seconds, five of them a command on a server.
    assert.strictEqual(result.durationMs, 5000);
    assert.strictEqual(result.tokensPerSec, 20);
    assert.strictEqual(result.wallMs, 10000);
});

check('overlapping tools count once', () => {
    const events = [
        { type: 'user-message', text: 'go', at: 0 },
        { type: 'tool-call', id: 'c1', at: 1000 },
        { type: 'tool-call', id: 'c2', at: 2000 },
        { type: 'tool-result', id: 'c1', at: 4000 },
        { type: 'tool-result', id: 'c2', at: 5000 },
    ];
    assert.strictEqual(toolBusyMs(events, 0, 10000), 4000);
    const result = { type: 'result', subtype: 'success', usage: { output_tokens: 120 }, at: 10000 };
    stampTurnRate(events, result);
    assert.strictEqual(result.durationMs, 6000);
    assert.strictEqual(result.tokensPerSec, 20);
});

check('a tool call never answered counts to the end of the turn', () => {
    const events = [
        { type: 'user-message', text: 'go', at: 0 },
        { type: 'tool-call', id: 'c1', at: 8000 },
    ];
    assert.strictEqual(toolBusyMs(events, 0, 10000), 2000);
});

check('only the latest turn is measured, and an earlier one\'s tools stay out of it', () => {
    const events = [
        { type: 'user-message', text: 'first', at: 0 },
        { type: 'tool-call', id: 'c1', at: 1000 },
        { type: 'tool-result', id: 'c1', at: 9000 },
        { type: 'user-message', text: 'second', at: 20000 },
    ];
    const result = { type: 'result', subtype: 'success', usage: { output_tokens: 40 }, at: 22000 };
    stampTurnRate(events, result);
    assert.strictEqual(result.durationMs, 2000);
    assert.strictEqual(result.tokensPerSec, 20);
});

check('a turn with no usage gets no number', () => {
    const result = stamped(1000, 4000, { usage: null });
    assert.strictEqual(result.tokensPerSec, undefined);
    assert.strictEqual(result.durationMs, undefined);
});

check('a turn with no message to measure from is left alone', () => {
    const result = { type: 'result', subtype: 'success', usage: { output_tokens: 40 }, at: 5000 };
    stampTurnRate([], result);
    assert.strictEqual(result.tokensPerSec, undefined);
});

check('a turn too fast to measure gets no number', () => {
    const result = stamped(0, 300, { usage: { output_tokens: 100 } });
    assert.strictEqual(result.tokensPerSec, undefined);
    assert.strictEqual(result.durationMs, undefined);
});

check('an absurd pace is a clock artifact, not a measurement', () => {
    const result = stamped(0, 1000, { usage: { output_tokens: 5000 } });
    assert.strictEqual(result.tokensPerSec, undefined);
    assert.strictEqual(result.durationMs, undefined);
});

check('anything that is not a result is left as it is', () => {
    const event = { type: 'assistant-text', text: 'hi', at: 2000, usage: { output_tokens: 10 } };
    stampTurnRate([{ type: 'user-message', at: 0 }], event);
    assert.strictEqual(event.tokensPerSec, undefined);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
