/**
 * The questions the assistant is currently stopped on.
 *
 * Everything here exists because a question that is asked badly gets answered
 * badly, on a live server.
 *
 * A pending approval lives on the tool row it belongs to, or, rarely, as a card
 * of its own when the transcript never saw the call start. The panel should not
 * have to know that, so it asks here.
 *
 * The rest of the file is about folding identical questions together. "Run
 * `apt update` on these three boxes" is one decision, and the model asks it as
 * three tool calls: as three cards it was the same command three times, told
 * apart only by a hostname. Answering it three times is not more consent than
 * answering it once, it is the same consent collected in a way that teaches
 * people to click without reading.
 *
 * Two things are folded, because the three calls do not necessarily arrive
 * together:
 *
 *   `items`   the calls asking right now. Several are pending at once when the
 *             agent runs its tool calls in parallel.
 *
 *   `queued`  calls the model has already emitted, on named sessions, that have
 *             not asked yet and will ask this same question when they do. The
 *             agent that runs its calls one at a time produces exactly this: one
 *             open question and two rows waiting behind it.
 *
 * Both are drawn on the card, so the answer is given with every server it will
 * reach named on it. See `useAssistant`, which holds that answer for the queued
 * ones and applies it as they arrive.
 *
 * Nothing else is merged. The key covers the tool, whether it runs locally, and
 * every argument except the session, so two commands differing by a flag, a
 * path or a timeout stay two questions no matter how alike they look.
 */

import { describeSession } from './assistant-scope';

/** Every open question, in the order the transcript asked them. */
export function pendingApprovals(items) {
    const open = [];
    for (const item of items) {
        if (item.kind === 'tool' && item.approval?.status === 'pending') open.push(item.approval);
        else if (item.kind === 'approval' && item.status === 'pending') open.push(item);
    }
    return open;
}

/**
 * What makes two calls the same question.
 *
 * Serialised rather than compared field by field because the inputs are
 * whatever a tool declares, including ones this app has never heard of, and the
 * honest answer for an unknown shape is "identical or not". Keys are sorted so
 * that two objects built in a different order still agree.
 *
 * Takes anything carrying a name, an input and the local flag: a pending
 * approval, a tool row, or the raw event either of them was built from.
 */
export function questionKey(call) {
    const input = call.input || {};
    const rest = Object.keys(input)
        .filter(key => key !== 'session')
        .sort()
        .map(key => `${key}=${JSON.stringify(input[key])}`)
        .join(' ');
    return `${call.local ? 'local' : 'remote'} ${call.name} ${rest}`;
}

/**
 * The open questions, folded, in the order they were asked.
 *
 * A group of one with nothing queued behind it is the ordinary single-server
 * case with nothing done to it.
 */
export function groupApprovals(items) {
    const groups = [];
    const byKey = new Map();

    for (const approval of pendingApprovals(items)) {
        const key = questionKey(approval);
        const found = byKey.get(key);
        if (found) {
            found.items.push(approval);
            continue;
        }
        const group = { key, items: [approval], queued: [] };
        byKey.set(key, group);
        groups.push(group);
    }

    if (groups.length === 0) return groups;

    // Only this turn. A run that was interrupted, or one whose app went away
    // mid-command, leaves rows that say running and never will again, and a
    // question asked an hour later must not fold those in and claim consent
    // covers a server nothing is about to touch. The last thing the user said
    // is where the current turn starts.
    let start = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index].kind === 'user') {
            start = index;
            break;
        }
    }

    for (const item of items.slice(start)) {
        // Still to ask: emitted, not finished, and no question of its own yet.
        // A row that already carries an approval is one of the cards above or
        // was answered already, and a row with a result is over.
        if (item.kind !== 'tool' || item.approval || item.status !== 'running') continue;

        // Only a call that names its session can be folded in. Without one the
        // panel cannot say which server it would reach, and a target that
        // cannot be drawn on the card is a target nobody consented to.
        const session = item.input?.session;
        if (!session || typeof session !== 'string') continue;

        const group = byKey.get(questionKey(item));
        if (!group) continue;
        if (group.items.some(approval => approval.sessionId === session)) continue;
        if (group.queued.some(entry => entry.sessionId === session)) continue;

        group.queued.push({ id: item.id, sessionId: session });
    }

    return groups;
}

/** Everything one card is answering for, asked and about to be asked alike. */
export function groupTargets(group) {
    return [...group.items, ...group.queued];
}

/**
 * The servers a group is about, in the shape `TargetStack` draws.
 *
 * Resolved against the open sessions, so a card names a machine the way the tab
 * strip and the panel header name it: its OS, the name it goes by, and the
 * address behind that on hover. A call whose session is gone, or one replayed
 * from a transcript written before the id was recorded, falls back to whatever
 * name the request carried and is dimmed, exactly as an unconnected host is in
 * the scope menu.
 *
 * Local tool calls have no server at all and come back empty, which is what the
 * card wants: there is nothing to name, and it says so in its own words.
 */
export function approvalMarks(targets, sessions = []) {
    const marks = [];

    for (const target of targets) {
        // A pending call is keyed by its request, one still queued by the tool
        // row it is waiting on. Neither exists twice.
        const key = target.requestId || target.id;
        const session = sessions.find(entry => entry.sessionId === target.sessionId);

        if (session) {
            marks.push({
                key,
                os: session.os,
                distro: session.distro,
                name: describeSession(session),
                address: session.address,
                dim: false,
            });
        } else if (target.host) {
            marks.push({ key, os: '', distro: '', name: target.host, address: '', dim: true });
        }
    }

    return marks;
}
