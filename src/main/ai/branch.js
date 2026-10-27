const archive = require('./archive');

/**
 * A new chat that carries on from part of an old one: "new chat from here",
 * under a finished reply.
 *
 * Branching copies a conversation's log up to the end of one turn into a new
 * conversation, which the panel then opens in a tab of its own like any other.
 * The log is enough for the panel to draw it, but not for the agent to know
 * it: the runtime behind the new conversation has never seen any of it, and
 * the old one's session id cannot be shared without the two writing over each
 * other's memory. So what was said goes with the new chat's first message
 * instead, as a block the agent is told is the earlier conversation.
 *
 * The cards listing the files a turn changed come along to be read, not
 * undone: the files are shared, and undoing belongs to the conversation that
 * made the change. Each is marked with the conversation it came `from`, which
 * is also where its review is read from.
 */

/** How much of the earlier conversation a branch carries into its first message. */
const MAX_CARRY_OVER = 60000;

/**
 * Where the turn a message started ends: the index of the next message, or
 * the end of the log. -1 when that message is no longer in it.
 */
function turnEnd(events, turnId) {
    const start = events.findIndex(event => event.type === 'user-message' && String(event.at) === String(turnId));
    if (start < 0) return -1;
    const next = events.findIndex((event, index) => index > start && event.type === 'user-message');
    return next < 0 ? events.length : next;
}

/**
 * The events before `end`, ready to stand as a conversation of their own.
 *
 * The stream previews go, as they do on disk. So does anything left waiting:
 * a call with no result, or a question with no answer, would spin or ask for
 * ever in a copy that has no runtime behind it to finish them.
 */
function copyEvents(events, end, sourceId) {
    const kept = events.slice(0, end).filter(event => !archive.isTransient(event.type));
    const answered = new Set(kept.filter(event => event.type === 'tool-result').map(event => event.id));
    const settled = new Set(kept.filter(event => event.type === 'approval-settled').map(event => event.requestId));
    return kept
        .filter((event) => {
            if (event.type === 'tool-call') return answered.has(event.id);
            if (event.type === 'approval-request') return settled.has(event.requestId);
            return true;
        })
        .map(event => (event.type === 'turn-changes' || event.type === 'turn-reverted'
            ? { ...event, from: event.from || sourceId }
            : event));
}

/**
 * What was said, as text, for a runtime that has none of it: the user's
 * messages and the agent's replies, newest kept when it runs long. Tool calls
 * are left out; the agent can look again, and their output is most of the
 * size. Keys the user pasted are already masked in the log, and stay so here.
 */
function carryOver(events) {
    const lines = [];
    for (const event of events) {
        if (event.type === 'user-message' && event.text) lines.push('## User', '', event.text, '');
        else if (event.type === 'assistant-text' && event.text) lines.push('## Assistant', '', event.text, '');
    }
    const said = lines.join('\n').trim();
    return said.length > MAX_CARRY_OVER ? said.slice(-MAX_CARRY_OVER) : said;
}

/** The block that goes in front of a branch's first message. */
function carryOverBlock(said) {
    return '<earlier-conversation>\nThis chat was branched from an earlier one, which you have no memory of. '
        + 'This is what was said there, up to the point it was branched. Carry on from it.\n\n'
        + `${said}\n</earlier-conversation>`;
}

/**
 * Fill `copy`, a conversation just made, with `source` up to the end of the
 * turn that `turnId` began. False when that turn is no longer in the log.
 */
function fill(source, copy, turnId) {
    const end = turnEnd(source.events, turnId);
    if (end < 0) return false;
    copy.events = copyEvents(source.events, end, source.id);
    copy.title = source.title;
    copy.carryOver = carryOver(copy.events);
    copy.updatedAt = Date.now();
    return true;
}

module.exports = { turnEnd, copyEvents, carryOver, carryOverBlock, fill, MAX_CARRY_OVER };
