const fs = require('fs');
const path = require('path');
const diff = require('./diff');
const fileText = require('./file-text');

/**
 * What a turn did to files, and how to take it back.
 *
 * A turn that edits files ends with a card listing them, the way a diff
 * tool's summary does, and the card offers to undo the lot. Undo needs the
 * files as they were, so each one is read the moment before its first edit in
 * the turn and again after every edit, and the pair is kept here.
 *
 * Where the read happens depends on who does the writing:
 *
 *   our own tools    `edit_file` and `write_file` record the file themselves,
 *                    in the handler, on either side of the write, over the
 *                    same SFTP channel they write through. That is the only
 *                    road to a file on a server.
 *   a runtime's own  Claude Code's Edit, OpenCode's edit and the rest run in
 *                    their own process on this computer, so the file is read
 *                    when the call is announced and again when its result
 *                    comes back. Claude Code cannot run a call before its
 *                    permission hook has answered, and that answer comes after
 *                    the announcement, so the first read is of the file before
 *                    the edit. A runtime that announces late can have the read
 *                    land after the edit; the passage the call named is then
 *                    reversed instead, which is what `passages` is for. A
 *                    whole-file write read too late is not offered at all.
 *
 * Undo is refused file by file where a file has moved on since: restoring a
 * snapshot over somebody else's later change would be a second, worse edit.
 * A passage that can still be found is put back even then.
 *
 * Kept on disk beside the conversation history, one file per conversation, so
 * the card still works after a restart, and thrown away with its
 * conversation. Bounded three ways: a file too big to be worth a diff, or not
 * text, is not held at all; a turn holds so much and the files past that are
 * listed but not kept; and a conversation keeps its latest turns up to a size,
 * the older ones losing their undo but not their card. A snapshot holding a
 * key the user pasted into the chat is kept in memory only, since the history
 * on disk is promised to have those masked and a snapshot cannot be masked
 * without breaking the undo it exists for. See `storable`.
 */

/** Past this a file is not snapshotted: the card would not show it anyway. */
const MAX_BYTES = 1024 * 1024;
/** What one turn holds, before and after together. The files past it are listed, not kept. */
const MAX_TURN_BYTES = 4 * 1024 * 1024;
/** What one conversation keeps on disk. The oldest turns go first. */
const MAX_STORE_BYTES = 8 * 1024 * 1024;
/** Turns kept per conversation. Older ones lose their undo, not their card. */
const MAX_TURNS = 12;

/** conversationId -> the turn being recorded: `{ turnId, files, calls }`. */
const open = new Map();
/** conversationId -> the finished turns, read from or written to disk. */
const finished = new Map();

let directory = '';

function storeDir() {
    if (!directory) {
        // eslint-disable-next-line global-require
        const { app } = require('electron');
        directory = path.join(app.getPath('userData'), 'assistant-checkpoints');
    }
    return directory;
}

/** For the tests: somewhere that is not the user's profile. */
function setDirectory(value) {
    directory = value;
    finished.clear();
    open.clear();
}

const fileFor = conversationId => path.join(
    storeDir(),
    `${String(conversationId).replace(/[^\w.-]/g, '_')}.json`,
);

function loadTurns(conversationId) {
    if (finished.has(conversationId)) return finished.get(conversationId);
    let turns = [];
    try {
        const parsed = JSON.parse(fs.readFileSync(fileFor(conversationId), 'utf8'));
        if (Array.isArray(parsed?.turns)) turns = parsed.turns;
    } catch {
        // None yet, or unreadable: either way there is nothing to undo.
    }
    finished.set(conversationId, turns);
    return turns;
}

/** Whether a snapshot or a passage holds one of these values. */
function holdsAny(entry, values) {
    const holds = text => typeof text === 'string' && values.some(value => text.includes(value));
    return holds(entry.before?.content) || holds(entry.after?.content)
        || (entry.passages || []).some(change => holds(change.old) || holds(change.new));
}

/**
 * The turns as they may go to disk. A file whose snapshot holds a pasted key
 * goes without its contents and is marked `withheld`: its undo lasts as long
 * as this run of the app, and after a restart the card says it was not kept.
 */
function storable(turns, secrets) {
    const values = secrets ? [...secrets].filter(value => typeof value === 'string' && value) : [];
    if (values.length === 0) return turns;
    return turns.map(turn => ({
        ...turn,
        files: turn.files.map(entry => (holdsAny(entry, values) ? withoutContents(entry, 'withheld') : entry)),
    }));
}

/** An entry with nothing left to restore from, and why. */
const withoutContents = (entry, why) => ({ ...entry, before: null, after: null, passages: [], [why]: true });

/**
 * Written out, oldest turns dropped until it fits. A conversation with no
 * turns left has its file removed rather than kept empty.
 */
function saveTurns(conversationId, secrets) {
    const turns = finished.get(conversationId) || [];
    try {
        if (turns.length === 0) {
            fs.rmSync(fileFor(conversationId), { force: true });
            return;
        }
        let body = JSON.stringify({ turns: storable(turns, secrets) });
        while (body.length > MAX_STORE_BYTES && turns.length > 1) {
            turns.shift();
            body = JSON.stringify({ turns: storable(turns, secrets) });
        }
        fs.mkdirSync(storeDir(), { recursive: true });
        fs.writeFileSync(fileFor(conversationId), body, 'utf8');
    } catch (error) {
        console.error('Could not save the edit checkpoints:', error.message);
    }
}

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

/**
 * A file's key within a turn. Case folded on Windows, where `C:\a` and `c:\A`
 * are the same file and a runtime will happily spell it both ways.
 */
function keyOf(file) {
    if (file.where === 'remote') return `remote:${file.sessionId || ''}:${file.path}`;
    const name = path.resolve(file.path);
    return `local:${process.platform === 'win32' ? name.toLowerCase() : name}`;
}

/**
 * A file's bytes as `{ existed, content }`, or null when they cannot be held:
 * too large, or not UTF-8 text. Undo writes the text back as UTF-8, so a file
 * that would not survive that trip is not one it can promise to restore.
 */
function stateOf(buffer) {
    if (!buffer || buffer.length > MAX_BYTES || fileText.looksBinary(buffer)) return null;
    const content = buffer.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(buffer)) return null;
    return { existed: true, content };
}

/** The same for text already decoded, such as what a write is about to put there. */
function stateOfText(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) return null;
    return { existed: true, content: text };
}

/**
 * A local file as `{ existed, content }`, or null when it cannot be held.
 * Absent is an answer, not a failure, because a file the turn created is
 * undone by removing it.
 */
function readLocal(target) {
    try {
        const stat = fs.statSync(target);
        if (!stat.isFile() || stat.size > MAX_BYTES) return null;
        return stateOf(fs.readFileSync(target));
    } catch (error) {
        if (error.code === 'ENOENT') return { existed: false, content: '' };
        return null;
    }
}

const sameState = (left, right) => Boolean(left && right)
    && left.existed === right.existed
    && (!left.existed || left.content === right.content);

/** What an entry costs to keep, in characters. */
const sizeOf = entry => (entry.before?.content?.length || 0) + (entry.after?.content?.length || 0)
    + entry.passages.reduce((total, change) => total + change.old.length + change.new.length, 0);

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

function begin(conversationId, turnId) {
    open.set(conversationId, { turnId, files: new Map(), calls: new Map() });
}

function entryFor(conversationId, file) {
    const turn = open.get(conversationId);
    if (!turn || !file?.path) return null;
    const key = keyOf(file);
    if (!turn.files.has(key)) {
        const remote = file.where === 'remote';
        turn.files.set(key, {
            key,
            path: remote ? file.path : path.resolve(file.path),
            where: remote ? 'remote' : 'local',
            sessionId: file.sessionId || '',
            // The saved host behind the session, so undo can go over another
            // session to the same machine once this one is closed.
            hostId: file.hostId || '',
            host: file.host || '',
            before: undefined,
            after: undefined,
            passages: [],
        });
    }
    return turn.files.get(key);
}

/** The file before the turn touched it. Only the first reading counts. */
function before(conversationId, file, state) {
    const entry = entryFor(conversationId, file);
    if (entry && entry.before === undefined) entry.before = state || null;
}

/** The file as the turn left it. Every reading replaces the last. */
function after(conversationId, file, state) {
    const entry = entryFor(conversationId, file);
    if (entry) entry.after = state || null;
}

/** A passage the turn replaced, for when the snapshot cannot be trusted. */
function passage(conversationId, file, change) {
    const entry = entryFor(conversationId, file);
    if (entry && typeof change?.new === 'string' && typeof change?.old === 'string') {
        entry.passages.push({ old: change.old, new: change.new, all: Boolean(change.all) });
    }
}

/**
 * What our own edit tools are handed to record with, for one conversation.
 * A server's file is marked with the host behind its session, which is what
 * names it on the card and finds another way to it once that tab is closed.
 */
function hooksFor(conversationId) {
    const withHost = (file) => {
        if (file?.where !== 'remote' || file.hostId) return file;
        // eslint-disable-next-line global-require
        const info = require('../transcript').info(file.sessionId);
        return { ...file, host: info?.hostName || info?.address || '', hostId: info?.hostId || '' };
    };
    return {
        before: (file, state) => before(conversationId, withHost(file), state),
        after: (file, state) => after(conversationId, withHost(file), state),
        passage: (file, change) => passage(conversationId, withHost(file), change),
    };
}

/**
 * A file on a server, read over an SFTP handle the tool already has open, for
 * the turn's undo: `done` is handed the file as it is, absent, or null when
 * it cannot be held. Never fails the write that follows it.
 */
function readRemote(handle, target, done) {
    handle.stat(target, (statError, attrs) => {
        if (statError) {
            // SSH_FX_NO_SUCH_FILE: the write is about to create it.
            done(statError.code === 2 ? { existed: false, content: '' } : null);
            return;
        }
        if (attrs.size > MAX_BYTES) {
            done(null);
            return;
        }
        handle.readFile(target, (readError, data) => done(readError ? null : stateOf(data)));
    });
}

/**
 * A runtime's own edit tool, announced. Read now, before it runs, and held
 * against the call id so the result can read it again. Only an absolute path:
 * a relative one is relative to wherever the runtime is standing, which is
 * not something this process can know for certain.
 */
function callStarted(conversationId, event) {
    const turn = open.get(conversationId);
    if (!turn || !event?.id) return;
    const target = diff.editTarget(event.rawName || event.name, event.input);
    if (!target || !path.isAbsolute(target)) return;
    const file = { where: 'local', path: target };
    before(conversationId, file, readLocal(target));
    turn.calls.set(event.id, { file, passages: diff.passagesOf(event.input) });
}

function callFinished(conversationId, event) {
    const turn = open.get(conversationId);
    const call = turn?.calls.get(event?.id);
    if (!call) return;
    turn.calls.delete(event.id);
    after(conversationId, call.file, readLocal(call.file.path));
    // A refused or failed edit changed nothing, so it has nothing to reverse.
    if (!event.isError) for (const change of call.passages) passage(conversationId, call.file, change);
}

/** The change a file went through, from whichever record is sound. */
function changeOf(entry) {
    if (entry.before && entry.after) {
        return diff.between(
            entry.before.existed ? entry.before.content : '',
            entry.after.existed ? entry.after.content : '',
        );
    }
    // The passages alone: the lines around them were never held.
    const change = diff.combine((entry.passages || []).map(item => diff.between(item.old, item.new)));
    return change ? { ...change, partial: true } : null;
}

/** A file as the card draws it: no contents, which stay here. */
function summaryOf(entry) {
    return {
        id: entry.key,
        path: entry.path,
        where: entry.where,
        host: entry.host,
        added: entry.added,
        removed: entry.removed,
        created: entry.created,
        deleted: entry.deleted,
        // Listed, but not something undo can put back. See `finish`.
        kept: !entry.dropped,
    };
}

/**
 * Close the turn. Answers what it changed, in the card's shape, or null when
 * it changed nothing; what is needed to undo it is kept here.
 */
function finish(conversationId, { secrets } = {}) {
    const turn = open.get(conversationId);
    open.delete(conversationId);
    if (!turn) return null;

    const files = [];
    let room = MAX_TURN_BYTES;
    for (const entry of turn.files.values()) {
        // Unknown on either side, and no passage to fall back on: the file
        // was never held, so it is neither shown nor offered for undo.
        if (entry.before === undefined) entry.before = null;
        if (entry.after === undefined) entry.after = null;

        // Read after the edit had already landed: the two readings agree, but
        // the call said it replaced something. The passage is the truth then.
        if (entry.before && entry.after && sameState(entry.before, entry.after)) {
            if (entry.passages.length === 0) continue;
            entry.before = null;
        }
        if (!(entry.before && entry.after) && entry.passages.length === 0) continue;

        const change = changeOf(entry);
        const counted = {
            ...entry,
            added: change?.added || 0,
            removed: change?.removed || 0,
            created: Boolean(entry.before && !entry.before.existed && entry.after?.existed),
            deleted: Boolean(entry.before?.existed && entry.after && !entry.after.existed),
        };
        // Counted while the contents are still here, and kept only while the
        // turn has room: a run that rewrites a hundred files is listed in
        // full, and undoes as many of them as fit.
        const size = sizeOf(counted);
        if (size <= room) {
            room -= size;
            files.push(counted);
        } else {
            files.push(withoutContents(counted, 'dropped'));
        }
    }
    if (files.length === 0) return null;

    const turns = loadTurns(conversationId);
    turns.push({ turnId: turn.turnId, at: Date.now(), reverted: false, files });
    if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
    saveTurns(conversationId, secrets);

    return { turnId: turn.turnId, files: files.map(summaryOf) };
}

/** What closes a turn's record of edits: it lands just before any of these. */
const CLOSES = new Set(['result', 'error', 'interrupted', 'closed']);

/**
 * Follow one of a conversation's events on its way into the log, and answer
 * the card to record ahead of it when it ends a turn that changed files: a
 * `turn-changes` event, or null. A message starts a turn (and closes one
 * still open), the end of a turn closes it, and a runtime's own edit tool is
 * read on either side of its call. Never throws: a turn is never worth
 * breaking over its card.
 */
function track(conversationId, event, { secrets } = {}) {
    try {
        let summary = null;
        if (event.type === 'user-message') {
            summary = finish(conversationId, { secrets });
            begin(conversationId, event.at);
        } else if (CLOSES.has(event.type)) {
            summary = finish(conversationId, { secrets });
        } else if (event.type === 'tool-call' && event.local) {
            // Ours record themselves, in the handler, which is the only place
            // a server's file can be read.
            callStarted(conversationId, event);
        } else if (event.type === 'tool-result') {
            callFinished(conversationId, event);
        }
        return summary ? { type: 'turn-changes', ...summary } : null;
    } catch (error) {
        console.error('Could not record an edit:', error.message);
        return null;
    }
}

/* ------------------------------------------------------------------ *
 * Reading back and undoing
 * ------------------------------------------------------------------ */

const findTurn = (conversationId, turnId) => loadTurns(conversationId)
    .find(turn => String(turn.turnId) === String(turnId)) || null;

/** Each file's change as lines, for the card's review. */
function changes(conversationId, turnId) {
    const turn = findTurn(conversationId, turnId);
    if (!turn) return { found: false, files: [] };
    return {
        found: true,
        reverted: Boolean(turn.reverted),
        files: turn.files.map(entry => ({ ...summaryOf(entry), diff: changeOf(entry) })),
    };
}

/** A reason a file was left as it is, as a code the card words for itself. */
const problem = (code, message = '') => ({ code, message });

/** Raised by the I/O when there is no way to reach the file at all. */
class Unreachable extends Error {
    constructor(code, message = '') {
        super(message || code);
        this.code = code;
    }
}

/** Reading and writing a local file, for undo. */
const localIo = {
    read: async entry => readLocal(entry.path),
    write: async (entry, content) => {
        fs.mkdirSync(path.dirname(entry.path), { recursive: true });
        fs.writeFileSync(entry.path, content, 'utf8');
    },
    remove: async (entry) => {
        try {
            fs.unlinkSync(entry.path);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    },
};

/**
 * The same over SFTP, through the session the edit went over or, once that
 * one is closed, any other session open to the same saved host. Sessions are
 * tabs here, and closing a tab and opening another to the same machine is
 * the ordinary way back to it.
 */
function remoteIo() {
    // eslint-disable-next-line global-require
    const sftp = require('../sftp');
    // eslint-disable-next-line global-require
    const transcript = require('../transcript');

    const sessionFor = (entry) => {
        if (entry.sessionId && transcript.info(entry.sessionId)) return entry.sessionId;
        if (entry.hostId) {
            const other = transcript.list().find(session => session.hostId === entry.hostId);
            if (other) return other.sessionId;
        }
        throw new Unreachable('closed');
    };

    const over = (entry, fn) => sftp.withSftp(sessionFor(entry), fn).then((result) => {
        if (result && result.success === false) throw new Error(result.message || 'SFTP is not available on that session.');
        return result?.value;
    });

    return {
        read: entry => over(entry, (handle, resolve) => {
            handle.readFile(entry.path, (error, data) => {
                if (error) {
                    // SSH_FX_NO_SUCH_FILE: gone, which is an answer.
                    resolve(error.code === 2
                        ? { value: { existed: false, content: '' } }
                        : { success: false, message: error.message });
                    return;
                }
                resolve({ value: stateOf(data) });
            });
        }),
        write: (entry, content) => over(entry, (handle, resolve) => {
            handle.writeFile(entry.path, content, { encoding: 'utf8' }, (error) => {
                resolve(error ? { success: false, message: error.message } : { value: true });
            });
        }),
        remove: entry => over(entry, (handle, resolve) => {
            handle.unlink(entry.path, (error) => {
                resolve(error && error.code !== 2 ? { success: false, message: error.message } : { value: true });
            });
        }),
    };
}

/**
 * The file with its passages put back, newest first, or null when one of
 * them is no longer there to find.
 */
function reversePassages(content, passages) {
    let text = content;
    for (const change of [...passages].reverse()) {
        // An edit that deleted its passage left nothing to find it by.
        if (!change.new) return null;
        const applied = fileText.applyEdit(text, change.new, change.old, { all: change.all });
        if (applied.error) return null;
        text = applied.content;
    }
    return text;
}

/** Put one file back. Null when it is back (or already was), a problem when not. */
async function revertFile(entry, io) {
    if (entry.withheld || entry.dropped) return problem('notKept');

    const current = await io.read(entry);
    if (!current) return problem('unreadable');

    if (entry.before && entry.after) {
        if (sameState(current, entry.before)) return null;
        if (sameState(current, entry.after)) {
            if (entry.before.existed) await io.write(entry, entry.before.content);
            else await io.remove(entry);
            return null;
        }
    }
    if (entry.passages.length > 0 && current.existed) {
        const restored = reversePassages(current.content, entry.passages);
        if (restored !== null) {
            await io.write(entry, restored);
            return null;
        }
    }
    return problem(current.existed ? 'changed' : 'gone');
}

/**
 * Put every file the turn changed back the way it was. File by file, so one
 * that has moved on since does not stop the others; the answer says which
 * were put back and which were not, and why.
 *
 * Answers `{ success, reverted: [path], failed: [{ id, path, where, host,
 * reason, message }] }`, or `{ success: true, already: true }` for a turn
 * already undone in full.
 */
async function revert(conversationId, turnId, { remote = remoteIo, secrets } = {}) {
    const turn = findTurn(conversationId, turnId);
    if (!turn) return { success: false, message: 'There is nothing kept to undo for that turn.' };
    if (turn.reverted) return { success: true, reverted: [], failed: [], already: true };

    const reverted = [];
    const failed = [];
    let remoteChannel = null;
    // The last file touched first, so a turn that edited one file twice by
    // two roads is unwound in the order it was wound.
    for (const entry of [...turn.files].reverse()) {
        if (entry.restored) continue;
        let outcome;
        try {
            const io = entry.where === 'remote'
                ? (remoteChannel || (remoteChannel = remote()))
                : localIo;
            outcome = await revertFile(entry, io);
        } catch (error) {
            outcome = error instanceof Unreachable
                ? problem(error.code)
                : problem('failed', error.message);
        }
        const { id, path: where, host } = summaryOf(entry);
        if (outcome) {
            failed.push({ id, path: where, where: entry.where, host, reason: outcome.code, message: outcome.message });
        } else {
            // Marked, so a second try after a partial undo leaves it alone.
            entry.restored = true;
            reverted.push(where);
        }
    }

    turn.reverted = failed.length === 0;
    turn.revertedAt = Date.now();
    saveTurns(conversationId, secrets);
    return { success: true, reverted, failed };
}

/**
 * What the agent is told on its next message after an undo, or it would carry
 * on from files that are no longer what it wrote.
 */
function revertNote(paths) {
    return 'The user undid the file changes from one of your earlier turns. These files are back as they '
        + `were before it, so read them again before relying on what you wrote:\n${paths.map(file => `- ${file}`).join('\n')}`;
}

/** A conversation thrown away takes its snapshots with it. */
function forget(conversationId) {
    open.delete(conversationId);
    finished.delete(conversationId);
    try {
        fs.unlinkSync(fileFor(conversationId));
    } catch {
        // Never had any.
    }
}

/**
 * Drop the snapshots of every conversation not in `keep`: ones that fell off
 * the end of the history while the app was not looking. Run once, when the
 * history is read back.
 */
function prune(keep) {
    const wanted = new Set([...keep].map(id => path.basename(fileFor(id))));
    let names = [];
    try {
        names = fs.readdirSync(storeDir());
    } catch {
        return;
    }
    for (const name of names) {
        if (!name.endsWith('.json') || wanted.has(name)) continue;
        try {
            fs.unlinkSync(path.join(storeDir(), name));
        } catch {
            // Gone already, or held open: the next prune will have it.
        }
    }
}

module.exports = {
    begin,
    before,
    after,
    passage,
    callStarted,
    callFinished,
    finish,
    track,
    hooksFor,
    readRemote,
    changes,
    revert,
    revertNote,
    forget,
    prune,
    readLocal,
    stateOf,
    stateOfText,
    setDirectory,
    MAX_BYTES,
    MAX_TURN_BYTES,
    MAX_STORE_BYTES,
};
