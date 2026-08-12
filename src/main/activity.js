const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
// Requires nothing itself, so there is no cycle back through the store.
const { describeSerial } = require('./protocol-config');

/**
 * The activity log: an append-only record of what was done in this app and to
 * which server.
 *
 * Two questions it exists to answer, the same two Termius's log answers: who
 * connected to what, and who changed what. "Who" is the OS account the app ran
 * under, plus the machine name; this client has no accounts of its own, so
 * that is the only honest answer available, and it is the useful one when a
 * backup travels between machines or two people share a workstation.
 *
 * Nothing secret is recorded. Call sites pass names, addresses, usernames and
 * paths; passwords, key material and passphrases never reach this module, and
 * an edit to one is written as the fact that it changed, never its value. The
 * file is plain JSON, readable by anyone who can read the userData directory,
 * so that rule is what keeps it safe to leave unencrypted.
 */

const SCHEMA_VERSION = 1;

/**
 * Entries kept before the oldest are dropped. A busy day of SFTP work writes a
 * few hundred, so this is months of history at roughly 1 MB on disk.
 */
const MAX_ENTRIES = 5000;

/** Writes are coalesced: a recursive delete records one entry per path. */
const FLUSH_DELAY = 500;

/** No single field is worth more than this; a deep path should not bloat the file. */
const MAX_FIELD = 400;

const CATEGORIES = new Set(['connection', 'data', 'files', 'security']);

/**
 * `warning` is not "it went wrong" but "look at this": accepting a host key
 * that changed succeeds in every technical sense and is still the line you
 * would want to find months later.
 */
const OUTCOMES = new Set(['success', 'failure', 'warning', 'info']);

const filePath = () => path.join(app.getPath('userData'), 'activity.json');

let entries = null;
let counter = 0;
let flushTimer = null;
let notify = () => {};

/** Who the OS says is running this. Resolved once; it cannot change mid-run. */
let actorCache = null;

function actor() {
    if (actorCache) return actorCache;
    let user = '';
    try {
        user = os.userInfo().username || '';
    } catch {
        // No passwd entry (a container, a locked-down service account).
        user = process.env.USERNAME || process.env.USER || '';
    }
    actorCache = { user: user || 'unknown', machine: os.hostname() || '' };
    return actorCache;
}

function setNotifier(fn) {
    notify = fn;
}

/* ------------------------------------------------------------------ *
 * Disk
 * ------------------------------------------------------------------ */

function load() {
    if (entries) return entries;
    try {
        if (fs.existsSync(filePath())) {
            const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
            entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
        } else {
            entries = [];
        }
    } catch (error) {
        // A truncated log is not worth failing a launch over, and there is
        // nothing here that can be recovered from a backup copy.
        console.error('Failed to load the activity log:', error.message);
        entries = [];
    }
    return entries;
}

/** Same temp-file + fsync + rename dance the sessions store uses. */
function writeNow() {
    flushTimer = null;
    if (!entries) return;

    const file = filePath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify({ version: SCHEMA_VERSION, entries }), 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    } catch (error) {
        console.error('Failed to persist the activity log:', error.message);
    }
}

function schedule() {
    if (flushTimer) return;
    flushTimer = setTimeout(writeNow, FLUSH_DELAY);
    // A pending write must never be the reason the process stays alive.
    flushTimer.unref?.();
}

function flush() {
    if (flushTimer) clearTimeout(flushTimer);
    writeNow();
}

// The debounce would otherwise lose the last few entries of a run, and the
// entries at the end of a run are the ones a person is most likely looking for.
// Guarded rather than assumed: the test harness stubs `app` down to the few
// members it needs, and a log that cannot be written is not worth a crash on
// the way to a window.
if (typeof app?.on === 'function') app.on('will-quit', flush);

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

const trim = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;
};

/**
 * Append one entry.
 *
 * Deliberately total: an audit trail that throws would take the operation it
 * was describing down with it, so a malformed call is dropped and logged to the
 * console instead.
 *
 *   category  connection | data | files | security
 *   action    dotted verb, e.g. 'host.update'; the renderer phrases it
 *   target    what it happened to: a host name, a remote path
 *   subject   where: user@address:port
 *   detail    one line of context, already phrased
 *   changes   [{ field, from, to, secret }] for edits
 *   outcome   success | failure | info
 */
function record(entry) {
    try {
        const category = CATEGORIES.has(entry?.category) ? entry.category : 'data';
        const list = load();

        const written = {
            id: `act-${Date.now().toString(36)}-${++counter}`,
            at: Date.now(),
            category,
            action: trim(entry.action),
            outcome: OUTCOMES.has(entry.outcome) ? entry.outcome : 'success',
            actor: actor(),
            target: trim(entry.target),
            subject: trim(entry.subject),
            detail: trim(entry.detail),
            message: trim(entry.message),
        };

        if (entry.hostId) written.hostId = trim(entry.hostId);
        if (entry.hostName) written.hostName = trim(entry.hostName);
        if (Array.isArray(entry.changes) && entry.changes.length > 0) {
            written.changes = entry.changes.slice(0, 24).map(change => ({
                field: trim(change.field),
                // A secret's values are never carried, only the fact it moved.
                from: change.secret ? '' : trim(change.from),
                to: change.secret ? '' : trim(change.to),
                secret: Boolean(change.secret),
            }));
        }

        list.push(written);
        if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);

        schedule();
        notify('activity-append', written);
        return written;
    } catch (error) {
        console.error('Could not record activity:', error.message);
        return null;
    }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const matchesSearch = (entry, needle) =>
    [entry.target, entry.subject, entry.detail, entry.message, entry.action, entry.actor?.user]
        .some(field => String(field || '').toLowerCase().includes(needle));

/**
 * Newest first, filtered and paged. `before` is the timestamp of the last row
 * already shown, so scrolling further back cannot skip or repeat a row when new
 * entries land while the page is open.
 */
function list({ category = '', outcome = '', hostId = '', search = '', limit = 200, before = 0 } = {}) {
    const needle = String(search || '').trim().toLowerCase();
    // One outcome or several: "show me only the problems" means both failures
    // and warnings, and asking twice would page them independently.
    const wanted = Array.isArray(outcome) ? new Set(outcome.filter(Boolean)) : null;
    const all = load();

    const matched = [];
    for (let index = all.length - 1; index >= 0; index--) {
        const entry = all[index];
        if (before && entry.at > before) continue;
        if (category && entry.category !== category) continue;
        if (wanted ? !wanted.has(entry.outcome) : (outcome && entry.outcome !== outcome)) continue;
        if (hostId && entry.hostId !== hostId) continue;
        if (needle && !matchesSearch(entry, needle)) continue;

        matched.push(entry);
        if (matched.length >= limit) break;
    }

    return {
        entries: matched,
        total: all.length,
        // Whether the very first (oldest) match was reached, so the page knows
        // there is nothing further back to ask for.
        exhausted: matched.length < limit,
    };
}

/** Counts per category over the whole log, for the filter chips. */
function summary() {
    const all = load();
    const counts = {
        all: all.length, connection: 0, data: 0, files: 0, security: 0,
        failures: 0, warnings: 0,
    };
    for (const entry of all) {
        if (counts[entry.category] !== undefined) counts[entry.category]++;
        if (entry.outcome === 'failure') counts.failures++;
        if (entry.outcome === 'warning') counts.warnings++;
    }
    return {
        ...counts,
        oldest: all[0]?.at || 0,
        newest: all[all.length - 1]?.at || 0,
        actor: actor(),
        capacity: MAX_ENTRIES,
    };
}

/** Everything, oldest first, for an export. */
function exportAll() {
    return [...load()];
}

function clear() {
    entries = [];
    flush();
    notify('activity-cleared', {});
    return true;
}

/* ------------------------------------------------------------------ *
 * Change detection
 * ------------------------------------------------------------------ */

const SECRET_FIELDS = new Set([
    'password', 'privateKey', 'passphrase', 'vncPassword', 'rdpPassword', 'bmcPassword',
]);

/**
 * Bookkeeping the app writes on its own. `lastConnectedAt` alone is written on
 * every dial and every reconnect, so without this the log would be mostly the
 * app talking about itself.
 */
const NOISE_FIELDS = new Set([
    'id', 'lastConnectedAt', 'os', 'distro',
    'hasPassword', 'hasPrivateKey', 'hasPassphrase', 'hasVncPassword',
    'hasRdpPassword', 'hasBmcPassword',
]);

/** How many of a list of words are worth naming before it becomes a paragraph. */
const LIST_PREVIEW = 5;

const describeValue = (value, field) => {
    if (value === null || value === undefined || value === '') return '';

    if (Array.isArray(value)) {
        // Tags are short words, and which ones changed is the whole content of
        // the change: "tags 2 entries → 3 entries" says a tag was added without
        // saying which, and that is the only thing anyone reads the row for.
        // Every other list here (port forwards, package steps) holds objects,
        // and naming them all would fill the row.
        if (field === 'tags') {
            return value.length > LIST_PREVIEW
                ? `${value.slice(0, LIST_PREVIEW).join(', ')} +${value.length - LIST_PREVIEW} more`
                : value.join(', ');
        }
        return value.length === 1 ? '1 entry' : `${value.length} entries`;
    }

    if (typeof value === 'object') {
        // The one nested block worth spelling out. A serial port fails silently
        // when its settings are wrong, so "serial changed" hides the only thing
        // anyone would read the row to find: `9600 8N1 → 115200 8N1` is the
        // whole explanation for a console that started printing garbage.
        if (field === 'serial') return describeSerial(value);
        // The monitor block is almost all one switch, and whether it is on is
        // the whole content of the change. "monitoring changed" would hide it.
        if (field === 'monitor') {
            const port = value.enabled && value.port ? ` (port ${value.port})` : '';
            return `${value.enabled ? 'on' : 'off'}${port}`;
        }
        return 'changed';
    }
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    return String(value);
};

/**
 * What actually differs between two records, as a list a person can read.
 *
 * Secrets are compared as stored, which works because the store only re-encrypts
 * a secret that was genuinely retyped; an untouched one keeps its existing
 * ciphertext byte for byte.
 */
function diff(before = {}, after = {}, { ignore = [] } = {}) {
    const skip = new Set([...NOISE_FIELDS, ...ignore]);
    const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const changes = [];

    for (const field of fields) {
        if (skip.has(field)) continue;

        const from = before?.[field];
        const to = after?.[field];
        if (JSON.stringify(from ?? '') === JSON.stringify(to ?? '')) continue;

        if (SECRET_FIELDS.has(field)) {
            changes.push({ field, secret: true, from: '', to: '' });
        } else {
            changes.push({ field, from: describeValue(from, field), to: describeValue(to, field) });
        }
    }

    return changes;
}

module.exports = {
    setNotifier,
    record,
    list,
    summary,
    exportAll,
    clear,
    diff,
    flush,
    actor,
};
