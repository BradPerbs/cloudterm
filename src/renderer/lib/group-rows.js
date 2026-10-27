/**
 * The transcript's rows as drawn, folded from its items.
 *
 *   tool calls     two or more back to back fold into one `tools` group:
 *                  "8 reads · 3 commands", opening into the calls.
 *   thoughts       never folded. The narration and the thinking between calls
 *                  stand in the transcript on their own and end the group
 *                  above them, so the next calls start a new one. A burst
 *                  reads thought, calls, thought, calls, reply.
 *
 * An assistant message with nothing in it draws as nothing, so it does not
 * split a run in two; it is left out while a run is open.
 *
 * Done here rather than in the reducer, so every answer, result and update
 * still finds its call where it always did. A group is the same object for
 * as long as its members are (`previous` is the last pass's groups by id),
 * which is what lets the transcript segment it sits in tell nothing changed.
 *
 * `enabled` is the "Group tool calls" setting. Off, every call is its own row.
 */

const hasText = item => Boolean(String(item.text || '').trim());
const hasThinking = item => Boolean(String(item.thinking || '').trim());

/** An assistant message with neither words nor thinking in it. */
const isEmptyAssistant = item => item.kind === 'assistant' && !hasText(item) && !hasThinking(item);

/** A call that has been answered: one still waiting is the card above the composer. */
const isAnswered = item => item.kind === 'tool' && item.approval?.status !== 'pending';

export function groupRows(items, { enabled = true, previous = new Map() } = {}) {
    const kept = new Map();
    if (!enabled) return { rows: items, kept };

    const rows = [];
    let run = [];

    const close = () => {
        if (run.length > 1) {
            const id = `tools-${run[0].id}`;
            const old = previous.get(id);
            const same = old && old.items.length === run.length && old.items.every((item, index) => item === run[index]);
            const group = same ? old : { kind: 'tools', id, items: run };
            kept.set(id, group);
            rows.push(group);
        } else {
            rows.push(...run);
        }
        run = [];
    };

    for (const item of items) {
        if (isEmptyAssistant(item) && run.length > 0) continue;
        if (isAnswered(item)) {
            run.push(item);
            continue;
        }
        // A thought, a reply, a notice, a call still waiting: the group
        // above ends here, and the calls after it start a new one.
        close();
        rows.push(item);
    }
    close();
    return { rows, kept };
}
