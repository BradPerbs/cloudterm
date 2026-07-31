const sessionLog = require('./session-log');

/**
 * A short, in-memory tail of what each session printed.
 *
 * The assistant needs to see what the terminal saw. Three existing places hold
 * some of that and none of them will do on their own. The renderer's xterm
 * scrollback is capped and dies with a reload. The session log is off by
 * default and writes to disk, so asking it a question means reading a file the
 * user may have told us never to create. The MessagePort carries the bytes
 * past us but keeps nothing.
 *
 * So the bytes are tapped where they arrive, in the same place the session log
 * is fed, and the last stretch of them is kept in memory. Nothing is written to
 * disk and nothing outlives the session: this is a window onto a live terminal,
 * not a record of it. The session log remains the thing an audit reads.
 *
 * Escape sequences are stripped with the session log's own stripper, so a
 * screenful of colour codes does not eat the budget, and so what the assistant
 * reads is close to what a person sees.
 */

/** Roughly a few hundred lines of output, per session. */
const MAX_CHARS = 120000;

/** The most that is ever held back waiting for a sequence to complete. */
const MAX_PENDING = 512;

/**
 * A trailing escape sequence that has not finished arriving.
 *
 * The session log holds back everything from the last ESC onward, which costs
 * it nothing: it writes continuously and flushes the remainder when the
 * session closes, so the held text always lands a moment later.
 *
 * This buffer is read on demand, and the thing it is nearly always asked for
 * is the last line on screen. Holding back from the last ESC would hide
 * exactly that: a prompt ends with a colour reset, so `root@web-01:~#` would
 * sit in the pending buffer until the user typed something else. So only a
 * sequence that is genuinely still open is held:
 *
 *   ESC alone, or ESC followed by the start of a two or three byte escape
 *   CSI with no final byte yet          ESC [ 3
 *   OSC, DCS, PM or APC with no terminator yet
 *
 * Anything already terminated is passed through and stripped normally.
 */
const OPEN_SEQUENCE = /\x1B(?:\[[0-?]*[ -/]*|[\]P X^_][^\x07\x1B]*|[()#]?)$/;

function splitTail(text) {
    const match = text.match(OPEN_SEQUENCE);
    if (!match) return [text, ''];
    // A sequence this long is not going to be completed by anything worth
    // waiting for, and holding it would stall the tail of the buffer forever.
    if (match[0].length > MAX_PENDING) return [text, ''];
    return [text.slice(0, match.index), match[0]];
}

// paneId -> { chunks, length, written, pending, startedAt }
const buffers = new Map();

function open(paneId, { hostName = '', address = '', protocol = '', hostId = '' } = {}) {
    buffers.set(paneId, {
        chunks: [],
        length: 0,
        hostId,
        // Every character ever appended, so a caller can hold a cursor and ask
        // only for what has landed since. The count keeps rising after the
        // window at the front has been dropped, which is what makes a stale
        // cursor detectable rather than silently wrong.
        written: 0,
        pending: '',
        hostName,
        address,
        protocol,
        startedAt: Date.now(),
    });
}

function close(paneId) {
    buffers.delete(paneId);
}

/**
 * Record a chunk of server output.
 *
 * Split control sequences are held back exactly as the session log holds them,
 * because a sequence cut across two socket reads would otherwise have its tail
 * left in the buffer as literal text.
 */
function record(paneId, chunk) {
    const entry = buffers.get(paneId);
    if (!entry || !chunk) return;

    const [ready, held] = splitTail(entry.pending + chunk);
    entry.pending = held;
    if (!ready) return;

    const text = sessionLog.clean(ready).replace(/\r\n?/g, '\n');
    if (!text) return;

    entry.chunks.push(text);
    entry.length += text.length;
    entry.written += text.length;

    // Drop whole chunks from the front while there is more than one chunk of
    // slack, then trim the new front chunk to land exactly on the budget.
    while (entry.length > MAX_CHARS && entry.chunks.length > 1) {
        entry.length -= entry.chunks[0].length;
        entry.chunks.shift();
    }
    if (entry.length > MAX_CHARS) {
        const overflow = entry.length - MAX_CHARS;
        entry.chunks[0] = entry.chunks[0].slice(overflow);
        entry.length -= overflow;
    }
}

/**
 * Read the tail of a session.
 *
 * `since` is a cursor from an earlier read. It is how "run this and tell me
 * what happened" is built on an interactive shell: mark the position, send the
 * keystrokes, then read forward from the mark. A cursor older than the buffer
 * comes back with `truncated` set rather than quietly starting late, because
 * the difference matters to anything reasoning about the output.
 */
function read(paneId, { since = null, maxChars = MAX_CHARS, lines = 0 } = {}) {
    const entry = buffers.get(paneId);
    if (!entry) return { available: false, text: '', cursor: 0, truncated: false };

    const all = entry.chunks.join('');
    const bufferStart = entry.written - all.length;

    let text = all;
    let truncated = false;

    if (Number.isFinite(since) && since !== null) {
        if (since >= entry.written) {
            text = '';
        } else if (since < bufferStart) {
            truncated = true;
        } else {
            text = all.slice(since - bufferStart);
        }
    }

    if (lines > 0) {
        const split = text.split('\n');
        if (split.length > lines) {
            text = split.slice(-lines).join('\n');
            truncated = true;
        }
    }

    if (text.length > maxChars) {
        text = text.slice(-maxChars);
        truncated = true;
    }

    return {
        available: true,
        text,
        cursor: entry.written,
        truncated,
        hostName: entry.hostName,
        address: entry.address,
        protocol: entry.protocol,
    };
}

/** The current end position, for marking a spot before sending input. */
function cursor(paneId) {
    return buffers.get(paneId)?.written ?? 0;
}

/**
 * Every session with a live data path, whatever its transport.
 *
 * This doubles as the app's only main-side registry of what is open. The pane
 * tree in the renderer is the real model, but it cannot be asked from here,
 * and `ssh.sessions` knows nothing about telnet or serial. Every transport
 * opens a buffer here, so this list is the complete one.
 */
function list() {
    return [...buffers.entries()].map(([paneId, entry]) => ({
        sessionId: paneId,
        hostId: entry.hostId,
        hostName: entry.hostName,
        address: entry.address,
        protocol: entry.protocol,
        openedAt: entry.startedAt,
    }));
}

function info(paneId) {
    const entry = buffers.get(paneId);
    if (!entry) return null;
    return {
        sessionId: paneId,
        hostId: entry.hostId,
        hostName: entry.hostName,
        address: entry.address,
        protocol: entry.protocol,
        openedAt: entry.startedAt,
    };
}

function has(paneId) {
    return buffers.has(paneId);
}

module.exports = {
    open,
    close,
    record,
    read,
    cursor,
    has,
    list,
    info,
    MAX_CHARS,
};
