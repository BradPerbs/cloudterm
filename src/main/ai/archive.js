const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Conversations, kept across runs of the app.
 *
 * A conversation lived in a Map in the main process and nowhere else, which is
 * why the history menu was empty every morning: quitting the app was the same
 * thing as deleting every chat in it. The event log is already the whole of
 * what a panel needs to rebuild itself (see the note at the top of `index.js`),
 * so keeping one is a matter of writing that log out and reading it back.
 *
 * Kept in its own file next to the assistant's settings rather than in the
 * sessions store, for the same reason those are: none of this is a host, a key
 * or a snippet, and the store's shape is the thing that syncs between machines.
 * A chat about a server belongs to the machine it was had on.
 *
 * Nothing here is a secret, but it is not nothing either: it holds command
 * output from real servers. It is written to the userData directory with the
 * same reach as the activity log, and for the same reason: it is what the app
 * shows the person sitting in front of it, and encrypting it would mean the
 * history menu could not be read until the vault was open.
 */

const SCHEMA_VERSION = 1;

/** How many are written out. The cap the map holds in memory, matched. */
const MAX_CONVERSATIONS = 20;

/**
 * How much of one conversation is kept.
 *
 * Both bounds are needed and they catch different things: a long chat runs into
 * the event count, and a short one that read a 100k-line log runs into the
 * character budget on a single tool result. Counted from the newest backwards,
 * so what is dropped is always the start of the conversation rather than the
 * part anyone is still reading.
 */
const MAX_EVENTS = 600;
const MAX_CHARS = 250000;

/** Roughly what an event costs beyond its text, so the budget is not fiction. */
const EVENT_OVERHEAD = 150;

/**
 * The stream, as opposed to what it produced.
 *
 * Deltas are a preview of a block that arrives whole a moment later as
 * `assistant-text`, and thinking is not rendered at all. Writing thousands of
 * them out would be most of the file, and replaying them adds nothing the
 * finished block does not already say.
 */
const TRANSIENT = new Set(['text-delta', 'thinking-delta', 'thinking-start']);

/** Writes are coalesced: one turn emits a couple of dozen events. */
const FLUSH_DELAY = 2000;

const filePath = () => path.join(app.getPath('userData'), 'assistant-history.json');

let source = null;
let flushTimer = null;
let suspended = false;

/** Where the conversations to write are read from, set once by `index.js`. */
function setSource(fn) {
    source = fn;
}

const isTransient = (type) => TRANSIENT.has(type);

/* ------------------------------------------------------------------ *
 * Shape on disk
 * ------------------------------------------------------------------ */

/**
 * One live conversation, as it is written out.
 *
 * `busy` is recorded rather than smoothed over here, because the repair belongs
 * on the way back in: a conversation saved mid-turn is honestly mid-turn, and
 * it is only when it comes back to a panel that the turn is definitively over.
 */
function pack(conversation) {
    const events = [];
    let chars = 0;

    for (let index = conversation.events.length - 1; index >= 0; index -= 1) {
        if (events.length >= MAX_EVENTS) break;

        const event = conversation.events[index];
        if (TRANSIENT.has(event.type)) continue;

        chars += (typeof event.text === 'string' ? event.text.length : 0) + EVENT_OVERHEAD;
        // Never zero events: one oversized tool result should cost the rest of
        // the conversation, not the whole of it.
        if (chars > MAX_CHARS && events.length > 0) break;

        events.push(event);
    }

    events.reverse();

    return {
        id: conversation.id,
        scope: conversation.scope,
        sessionId: conversation.boundSessionId,
        // The set a pinned conversation is fenced to. Session ids do not
        // survive the app closing, and `unpack` drops them; host ids do, which
        // is what lets "these two boxes" still mean something tomorrow.
        sessionIds: conversation.sessionIds || [],
        hostIds: conversation.hostIds || [],
        // The agent's own id for this chat, and which agent it belongs to. Both
        // or neither: see `unpack`.
        providerSessionId: conversation.providerSessionId || '',
        provider: conversation.provider || '',
        title: conversation.title || '',
        costUsd: conversation.costUsd || 0,
        busy: Boolean(conversation.busy),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        events,
    };
}

/** Anything that is still recognisably one of our events. */
function readEvents(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(event => event && typeof event === 'object' && typeof event.type === 'string')
        .slice(-MAX_EVENTS);
}

/**
 * A stored conversation, back in the shape the rest of the module works with.
 *
 * Two things are repaired on the way in, both of them consequences of the app
 * having been closed rather than of anything the user did:
 *
 *   A question that was never answered. The request is in the log, so a panel
 *   replaying it would draw a live approval card whose id died with the last
 *   process, and clicking it would do nothing at all. It is settled as expired,
 *   which is the same thing that happens to one nobody answers in time.
 *
 *   A turn that was still running. Without a `result` to close it the panel
 *   would come back showing "Working" forever, on a query that stopped existing
 *   when the app did. It is closed out with a line saying so.
 *
 * `null` for anything unreadable, so one bad record cannot cost the rest.
 */
function unpack(record, currentProvider) {
    if (!record || typeof record !== 'object') return null;
    if (typeof record.id !== 'string' || !record.id) return null;

    const events = readEvents(record.events);

    const answered = new Set(
        events.filter(event => event.type === 'approval-settled').map(event => event.requestId)
    );
    const at = Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now();

    for (const event of events.slice()) {
        if (event.type !== 'approval-request') continue;
        if (answered.has(event.requestId)) continue;
        answered.add(event.requestId);
        events.push({ type: 'approval-settled', requestId: event.requestId, status: 'expired', at });
    }

    if (record.busy) {
        events.push({
            type: 'notice',
            tone: 'info',
            text: 'This turn was cut short when the app closed.',
            at,
        });
    }

    // The agent's session id means nothing to a different agent: resuming a
    // Claude Code chat inside Codex either fails or, worse, continues something
    // else. Dropped when they disagree, which costs the model its memory of the
    // conversation and keeps the transcript, rather than the other way round.
    const provider = typeof record.provider === 'string' ? record.provider : '';
    const resumable = provider && provider === currentProvider;

    // The hosts of a pinned set outlive the app; its sessions do not. Every
    // session id in a stored record belongs to a terminal that closed when the
    // window did, so they are dropped and the hosts carry the fence. A set that
    // was nothing but sessions falls back to following the session in front,
    // which is what an empty set means everywhere else.
    const hostIds = Array.isArray(record.hostIds) ? record.hostIds.filter(Boolean) : [];
    const stillPinned = record.scope === 'targets' && hostIds.length > 0;

    let scope = 'session';
    if (record.scope === 'global') scope = 'global';
    else if (stillPinned) scope = 'targets';

    return {
        id: record.id,
        scope,
        boundSessionId: scope === 'session' && typeof record.sessionId === 'string'
            ? record.sessionId
            : '',
        sessionIds: [],
        hostIds: stillPinned ? hostIds : [],
        session: null,
        starting: null,
        events,
        busy: false,
        // Where the user is now is not where they were, so the situational
        // block goes again with the first message of this run.
        lastContext: '',
        providerSessionId: resumable ? String(record.providerSessionId || '') : '',
        provider,
        needsRestart: false,
        costUsd: Number.isFinite(record.costUsd) ? record.costUsd : 0,
        title: typeof record.title === 'string' ? record.title : '',
        createdAt: Number.isFinite(record.createdAt) ? record.createdAt : at,
        updatedAt: at,
    };
}

/* ------------------------------------------------------------------ *
 * Disk
 * ------------------------------------------------------------------ */

/** Every stored conversation, oldest first. Empty on anything unreadable. */
function read() {
    try {
        if (!fs.existsSync(filePath())) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        if (!Array.isArray(parsed?.conversations)) return [];
        return parsed.conversations.slice(-MAX_CONVERSATIONS);
    } catch (error) {
        // A truncated file is not worth failing a launch over, and a chat log
        // is not something anyone can recover from a backup copy.
        console.error('Could not read the assistant history:', error.message);
        return [];
    }
}

/** The same temp-file + fsync + rename dance the sessions store uses. */
function writeNow() {
    flushTimer = null;
    if (!source) return;

    let conversations;
    try {
        conversations = source();
    } catch (error) {
        console.error('Could not collect the assistant history:', error.message);
        return;
    }

    const file = filePath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify({ version: SCHEMA_VERSION, conversations }), 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    } catch (error) {
        console.error('Could not save the assistant history:', error.message);
    }
}

/** Something changed. Write it out shortly. */
function save() {
    if (suspended || flushTimer) return;
    flushTimer = setTimeout(writeNow, FLUSH_DELAY);
    // A pending write must never be the reason the process stays alive.
    flushTimer.unref?.();
}

function flush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (!suspended) writeNow();
}

/**
 * Stop writing.
 *
 * Held over a shutdown, which empties the map this reads from: a debounced
 * write landing after that would faithfully record that there is nothing left.
 */
function suspend() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    suspended = true;
}

function resume() {
    suspended = false;
}

// The debounce would otherwise lose the last exchange of a run, which is the
// one anybody is most likely to come back for. Guarded rather than assumed: the
// test harness stubs `app` down to the few members it needs.
if (typeof app?.on === 'function') app.on('will-quit', flush);

module.exports = {
    setSource,
    isTransient,
    pack,
    unpack,
    read,
    save,
    flush,
    suspend,
    resume,
    MAX_CONVERSATIONS,
};
