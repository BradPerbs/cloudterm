/**
 * How fast a turn generated its answer, for the number under it.
 *
 * No runtime reports tokens per second itself, so it is worked out here: the
 * result's output tokens over the turn's active time. Active time is the wall
 * time from the user's message, minus the time spent waiting on the user at
 * an approval card, minus the time spent waiting on tool runs. What is left is
 * the model's own time: queueing, time to first token, streaming and stalls
 * on the provider's side stay in, a command running on a server and a person
 * reading a card come out.
 *
 * Timing the reply's streaming bursts instead gives the transport's pace
 * rather than the model's: a runtime that buffers and flushes the reply in a
 * few large chunks reads as thousands of tokens a second. Wall minus waits
 * divides every turn by the same ruler.
 *
 * A turn whose runtime reports no usage (Codex, Kimi and OpenCode, today)
 * gets nothing, and so does a turn under half a second of active time
 * (millisecond stamps say nothing reliable there) or past a thousand tokens a
 * second (a clock artifact, not a model). The panel shows no number rather
 * than a wrong one.
 */

/** Output tokens, however the runtime spelled its usage. */
function outputTokens(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    for (const name of ['output_tokens', 'completion_tokens', 'outputTokens', 'output']) {
        const n = Number(usage[name]);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

/**
 * What a turn spent waiting on the user, from its approval cards.
 *
 * Request and settlement carry the same id and are both stamped, so each
 * answered card contributes its own pause. A card never answered (a turn cut
 * off mid-question) contributes nothing: the wait never ended.
 */
function waitingMs(events, start) {
    const asked = new Map();
    let waiting = 0;
    for (const event of events) {
        if (!event || event.at < start) continue;
        if (event.type === 'approval-request' && event.requestId) {
            asked.set(event.requestId, event.at);
        } else if (event.type === 'approval-settled' && asked.has(event.requestId)) {
            waiting += Math.max(0, event.at - asked.get(event.requestId));
            asked.delete(event.requestId);
        }
    }
    return waiting;
}

/**
 * What a turn spent waiting on tool runs, as the union of its call-to-result
 * intervals.
 *
 * Calls and results share an id. Overlapping calls (parallel tools) count
 * once: it is wall time the turn lost, not the sum of each tool's clock. A
 * call never answered counts through to the end of the turn. Results with no
 * call, and calls outside this turn, contribute nothing.
 */
function toolBusyMs(events, start, end) {
    const pending = new Map();
    const spans = [];
    for (const event of events) {
        if (!event || !Number.isFinite(event.at)) continue;
        if (event.at < start || event.at > end) continue;
        const known = event.id !== undefined && event.id !== null;
        if (event.type === 'tool-call' && known) {
            if (!pending.has(event.id) || event.at < pending.get(event.id)) pending.set(event.id, event.at);
        } else if (event.type === 'tool-result' && known && pending.has(event.id)) {
            const from = Math.max(pending.get(event.id), start);
            const to = Math.min(Math.max(event.at, pending.get(event.id)), end);
            pending.delete(event.id);
            if (to > from) spans.push([from, to]);
        }
    }
    for (const callAt of pending.values()) {
        const from = Math.max(callAt, start);
        if (end > from) spans.push([from, end]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let open = null;
    for (const span of spans) {
        if (!open) {
            open = span;
        } else if (span[0] <= open[1]) {
            if (span[1] > open[1]) open[1] = span[1];
        } else {
            total += open[1] - open[0];
            open = span;
        }
    }
    if (open) total += open[1] - open[0];
    return total;
}

/** Active time under this long is stamp noise, not a measurement. */
const MIN_ACTIVE_MS = 500;

/** Past this the clock slipped, not the model sprinted: say nothing. */
const MAX_TPS = 1000;

/**
 * Stamp a result event with its answer rate, in place.
 *
 * `events` is the conversation's log so far, the result itself not yet in it;
 * `stamped` is the result, already carrying its `at`. Adds `outputTokens`,
 * `durationMs` (the active time) and `tokensPerSec`, plus `wallMs` when the
 * turn took meaningfully longer than its active time, so the panel can say
 * both. Leaves the event alone when there is nothing honest to say.
 */
function stampTurnRate(events, stamped) {
    try {
        if (!stamped || stamped.type !== 'result') return stamped;
        const tokens = Number(stamped.outputTokens) || outputTokens(stamped.usage);
        if (!(tokens > 0)) return stamped;

        const log = Array.isArray(events) ? events : [];
        let start = null;
        for (let index = log.length - 1; index >= 0; index -= 1) {
            if (log[index]?.type === 'user-message') {
                start = log[index].at;
                break;
            }
        }
        if (start === null || !(stamped.at > start)) return stamped;

        const wall = Math.max(0, stamped.at - start - waitingMs(log, start));
        if (!(wall > 0)) return stamped;
        const tools = Math.min(Math.max(0, toolBusyMs(log, start, stamped.at)), wall);
        const active = wall - tools;
        if (!(active >= MIN_ACTIVE_MS)) return stamped;

        const tps = Math.round((tokens / (active / 1000)) * 10) / 10;
        if (!(tps > 0) || tps > MAX_TPS) return stamped;

        stamped.outputTokens = tokens;
        stamped.durationMs = active;
        if (wall > active) stamped.wallMs = wall;
        stamped.tokensPerSec = tps;
    } catch {
        // A missing number is never worth breaking a turn over.
    }
    return stamped;
}

module.exports = { stampTurnRate, outputTokens, toolBusyMs, waitingMs };
