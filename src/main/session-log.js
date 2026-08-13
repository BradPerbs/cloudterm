const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const activity = require('./activity');

/**
 * Session transcripts: what the terminal actually showed, written to a file.
 *
 * This is the other half of the activity log. That one records *that* a session
 * happened and what records were edited; this one records what was on screen
 * while it was open, which is the thing an audit is usually asking for.
 *
 * It lives in the main process, at the point the bytes arrive from the server,
 * for three reasons. The renderer can be reloaded and its scrollback is capped,
 * so a log kept there would have holes in it. The bytes are already here, so
 * nothing extra crosses the bridge. And a transcript that stops when the window
 * is busy would be worse than none at all: a gap in a log reads as "nothing
 * happened".
 *
 * Only what the *server* sent is written. Keystrokes are not: a transcript that
 * echoes input would carry every password typed at a `sudo` prompt, where the
 * server deliberately echoes nothing. What the shell chooses to print back is
 * already on the screen the user is looking at.
 */

const CONFIG_VERSION = 1;

/** `plain` strips the escape sequences; `raw` is byte-for-byte what arrived. */
const FORMATS = new Set(['plain', 'raw']);

const DEFAULTS = {
    enabled: false,
    // Empty means the default directory, resolved at use time: `app` is not
    // ready when this module is first required.
    directory: '',
    format: 'plain',
    // Prefix each line with the local time it was written. `plain` only:
    // stamping a raw stream would corrupt the escape sequences it exists to keep.
    timestamps: false,
    // Which kinds of session "record every session" records. A session forced
    // from its own header is recorded regardless: that gesture names one
    // specific session, so a filter meant for the blanket setting has no say.
    protocols: { ssh: true, telnet: true, serial: true },
    // How many days a transcript is kept before the sweep deletes it.
    // 0 means forever.
    retentionDays: 0,
    // The most the log folder is allowed to hold, in megabytes; the sweep
    // deletes oldest-first once it is past this. 0 means no cap.
    maxTotalMB: 0,
};

const RETENTION_MAX_DAYS = 3650;
const SIZE_CAP_MAX_MB = 1024 * 100;

/**
 * A control sequence, matched so it can be dropped.
 *
 *   CSI  ESC [ ... final byte        colours, cursor moves, erases
 *   OSC  ESC ] ... BEL or ESC \      window titles, hyperlinks, clipboard
 *   DCS/SOS/PM/APC ESC P/X/^/_ ... ST
 *   two- and three-byte escapes      ESC ( B, ESC =, ESC 7
 *
 * Written as one alternation so a sequence is never half-removed, and applied
 * to a buffer that is only flushed on a boundary the sequences cannot straddle
 * (see `pending` below).
 */
const CONTROL_SEQUENCE = new RegExp([
    '\\x1B\\[[0-?]*[ -/]*[@-~]',
    '\\x1B\\][\\s\\S]*?(?:\\x07|\\x1B\\\\)',
    '\\x1B[P X^_][\\s\\S]*?(?:\\x07|\\x1B\\\\)',
    '\\x1B[()#][0-9A-Za-z]',
    '\\x1B[0-9A-Za-z=><]',
].join('|'), 'g');

/* eslint-disable no-control-regex */
/** Everything left that is not printable, once the sequences above are gone. */
const BARE_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
/* eslint-enable no-control-regex */

// tabId -> { stream, filePath, host, lines, bytes, startedAt, pending, column }
const open = new Map();

let config = null;

const configPath = () => path.join(app.getPath('userData'), 'session-log.json');

/** Where transcripts go when the user has not chosen somewhere else. */
function defaultDirectory() {
    try {
        return path.join(app.getPath('documents'), 'CloudBlast', 'Session logs');
    } catch {
        // No Documents folder (a stripped container); userData always exists.
        return path.join(app.getPath('userData'), 'session-logs');
    }
}

/** A non-negative whole number, or the fallback when it is anything else. */
function clampCount(value, fallback, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.min(Math.floor(number), max);
}

function sanitize(raw) {
    const next = { ...DEFAULTS, protocols: { ...DEFAULTS.protocols } };
    if (raw && typeof raw === 'object') {
        next.enabled = Boolean(raw.enabled);
        next.directory = typeof raw.directory === 'string' ? raw.directory.trim() : '';
        next.format = FORMATS.has(raw.format) ? raw.format : DEFAULTS.format;
        next.timestamps = Boolean(raw.timestamps);
        // Only the protocols this module knows about, and only the ones the
        // patch mentions: a config written before a protocol existed keeps
        // recording it, which is the safe direction for an audit trail.
        if (raw.protocols && typeof raw.protocols === 'object') {
            for (const key of Object.keys(next.protocols)) {
                if (key in raw.protocols) next.protocols[key] = Boolean(raw.protocols[key]);
            }
        }
        next.retentionDays = clampCount(raw.retentionDays, DEFAULTS.retentionDays, RETENTION_MAX_DAYS);
        next.maxTotalMB = clampCount(raw.maxTotalMB, DEFAULTS.maxTotalMB, SIZE_CAP_MAX_MB);
    }
    // Only ever true where it means something, so the renderer never has to
    // reason about a combination that does nothing.
    if (next.format === 'raw') next.timestamps = false;
    return next;
}

function loadConfig() {
    if (config) return config;
    try {
        if (fs.existsSync(configPath())) {
            config = sanitize(JSON.parse(fs.readFileSync(configPath(), 'utf8'))?.config);
        } else {
            config = sanitize(null);
        }
    } catch (error) {
        console.error('Failed to read the session log settings:', error.message);
        config = sanitize(null);
    }
    return config;
}

function persistConfig() {
    try {
        fs.writeFileSync(
            configPath(),
            JSON.stringify({ version: CONFIG_VERSION, config }),
            'utf8'
        );
    } catch (error) {
        console.error('Failed to save the session log settings:', error.message);
    }
}

/** The settings as the renderer reads them, with the directory resolved. */
function getConfig() {
    const current = loadConfig();
    return {
        ...current,
        directory: current.directory || defaultDirectory(),
        // Told apart so the settings page can show the default as a default
        // rather than as a choice the user made.
        usingDefaultDirectory: !current.directory,
    };
}

/**
 * Change the settings.
 *
 * Sessions already being logged are left alone: a file whose format changed
 * halfway through is not a transcript of anything. Turning logging off does
 * close them, because that is the one change where continuing would be the
 * surprise.
 */
function setConfig(patch) {
    const before = loadConfig();
    config = sanitize({ ...before, ...patch });
    persistConfig();

    const changes = [];
    if (before.enabled !== config.enabled) {
        changes.push({ field: 'enabled', from: before.enabled ? 'on' : 'off', to: config.enabled ? 'on' : 'off' });
    }
    if (before.format !== config.format) {
        changes.push({ field: 'format', from: before.format, to: config.format });
    }
    if (before.directory !== config.directory) {
        changes.push({ field: 'directory', from: before.directory || '(default)', to: config.directory || '(default)' });
    }
    if (before.timestamps !== config.timestamps) {
        changes.push({ field: 'timestamps', from: before.timestamps ? 'on' : 'off', to: config.timestamps ? 'on' : 'off' });
    }
    for (const key of Object.keys(config.protocols)) {
        if (before.protocols[key] !== config.protocols[key]) {
            changes.push({ field: `record ${key}`, from: before.protocols[key] ? 'on' : 'off', to: config.protocols[key] ? 'on' : 'off' });
        }
    }
    const describeDays = (days) => days > 0 ? `${days} days` : 'forever';
    const describeCap = (mb) => mb > 0 ? `${mb} MB` : 'no cap';
    if (before.retentionDays !== config.retentionDays) {
        changes.push({ field: 'retention', from: describeDays(before.retentionDays), to: describeDays(config.retentionDays) });
    }
    if (before.maxTotalMB !== config.maxTotalMB) {
        changes.push({ field: 'size cap', from: describeCap(before.maxTotalMB), to: describeCap(config.maxTotalMB) });
    }

    if (changes.length > 0) {
        activity.record({
            category: 'security',
            action: 'sessionlog.configure',
            outcome: 'info',
            target: 'Session logging',
            detail: config.enabled ? 'Recording terminal output to disk' : 'Not recording terminal output',
            changes,
        });
    }

    if (!config.enabled) {
        for (const tabId of [...open.keys()]) close(tabId, { reason: 'disabled' });
    }

    // A tightened retention setting means "there is now too much on disk", and
    // the natural moment to honour that is right away, not at the next session.
    if (before.retentionDays !== config.retentionDays
        || before.maxTotalMB !== config.maxTotalMB
        || before.directory !== config.directory) {
        sweep();
    }

    return getConfig();
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** A host name reduced to something a filesystem will take. */
function slug(name) {
    const cleaned = String(name || '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return cleaned || 'session';
}

/** `2026-07-26_142530`, sortable and legal on every filesystem we target. */
function stamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('-') + '_' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
}

/**
 * Start recording a session, if recording is on. Safe to call for every
 * session opened: it decides for itself whether there is anything to do.
 *
 * `force` is the session's own control asking for a transcript of this one
 * session while the global setting is off: the common case of "record what I
 * am about to do here", which should not mean turning recording on for
 * everything else too.
 *
 * A failure here never propagates. Logging is a side effect of connecting, and
 * a full disk or a directory that has been deleted must not be the reason a
 * connection fails.
 */
function start(tabId, { hostName = '', address = '', hostId = '', protocol = '', force = false } = {}) {
    const current = loadConfig();
    if (!current.enabled && !force) return null;
    // The per-protocol filter only speaks for the blanket setting. A protocol
    // this module has no opinion on is recorded: for an audit trail, the safe
    // failure is a transcript nobody asked for, not a gap.
    if (!force && protocol && current.protocols[protocol] === false) return null;
    if (open.has(tabId)) return open.get(tabId).filePath;

    // The cheap moment to apply retention: the folder is about to be touched
    // anyway, and sessions open at nothing like the rate that would make the
    // directory scan matter.
    sweep({ throttled: true });

    const directory = current.directory || defaultDirectory();
    const startedAt = new Date();
    const baseName = `${slug(hostName || address)}_${stamp(startedAt)}`;

    try {
        fs.mkdirSync(directory, { recursive: true });

        // Open synchronously so a returned path already exists on disk. The
        // stream open is otherwise async, and callers (and the retention
        // tests) treat the path as ready the moment start() returns.
        // Exclusive create (`wx`) plus a random suffix: two tabs that stamp
        // the same second must not share or truncate one transcript.
        let filePath;
        let fd;
        for (let attempt = 0; attempt < 8; attempt++) {
            const suffix = crypto.randomBytes(attempt === 0 ? 3 : 4).toString('hex');
            filePath = path.join(directory, `${baseName}_${suffix}.log`);
            try {
                fd = fs.openSync(filePath, 'wx');
                break;
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
                fd = undefined;
            }
        }
        if (fd === undefined) {
            throw new Error('Could not create a unique session log path');
        }
        const stream = fs.createWriteStream(null, { fd, encoding: 'utf8' });
        stream.on('error', (error) => {
            console.error(`Session log write failed for ${tabId}:`, error.message);
            // Drop the entry rather than keep handing bytes to a dead stream.
            open.delete(tabId);
        });

        const header = [
            `# CloudTerm session log`,
            `# host: ${hostName || '(unnamed)'}${address ? ` (${address})` : ''}`,
            ...(protocol ? [`# protocol: ${protocol}`] : []),
            `# started: ${startedAt.toISOString()}`,
            `# format: ${current.format}${current.timestamps ? ' with timestamps' : ''}`,
            '',
        ].join('\n');
        stream.write(header);

        open.set(tabId, {
            stream,
            filePath,
            hostName,
            address,
            hostId,
            startedAt: startedAt.getTime(),
            bytes: 0,
            format: current.format,
            timestamps: current.timestamps,
            // A control sequence can be split across two reads from the socket.
            // Anything that looks like the start of one is held back until the
            // next chunk completes it, so the stripper never sees half a
            // sequence and leaves its tail in the file as text.
            pending: '',
            // Whether the last thing written ended a line, so a timestamp is
            // only ever emitted at the start of one.
            atLineStart: true,
        });

        activity.record({
            category: 'security',
            action: 'sessionlog.start',
            outcome: 'info',
            target: hostName || address,
            subject: address,
            detail: `Recording to ${path.basename(filePath)}`,
            hostId,
            hostName,
        });

        return filePath;
    } catch (error) {
        console.error(`Could not start a session log for ${tabId}:`, error.message);
        activity.record({
            category: 'security',
            action: 'sessionlog.start',
            outcome: 'failure',
            target: hostName || address,
            subject: address,
            message: error.message,
            hostId,
            hostName,
        });
        return null;
    }
}

/**
 * The longest suffix of `text` that could be the beginning of a control
 * sequence, and so must wait for the next chunk before it can be judged.
 *
 * Bounded: a lone ESC at the end of a stream, or an OSC whose terminator never
 * arrives, would otherwise hold the tail of the file back forever.
 */
const MAX_PENDING = 512;

function splitPending(text) {
    const escape = text.lastIndexOf('\x1B');
    if (escape === -1) return [text, ''];

    const tail = text.slice(escape);
    // A complete sequence needs no holding back, and one this long is not going
    // to be completed by anything we would want to keep waiting for.
    if (tail.length > MAX_PENDING) return [text, ''];
    // Already terminated, so it is whole and the stripper can see it.
    if (/[@-~]$/.test(tail) && /^\x1B\[[0-?]*[ -/]*[@-~]$/.test(tail)) return [text, ''];
    if (/(?:\x07|\x1B\\)$/.test(tail)) return [text, ''];

    return [text.slice(0, escape), tail];
}

function clean(text) {
    return text.replace(CONTROL_SEQUENCE, '').replace(BARE_CONTROL, '');
}

/**
 * Record a chunk of server output.
 *
 * `plain` normalises line endings and drops the escape sequences, which is what
 * makes the file greppable, the point of a transcript. `raw` keeps every byte,
 * for replaying it back through a terminal later.
 */
function write(tabId, chunk) {
    const entry = open.get(tabId);
    if (!entry || !chunk) return;

    try {
        if (entry.format === 'raw') {
            entry.stream.write(chunk);
            entry.bytes += Buffer.byteLength(chunk);
            return;
        }

        const [ready, held] = splitPending(entry.pending + chunk);
        entry.pending = held;
        if (!ready) return;

        // A bare CR is the shell redrawing the line it is already on: a
        // progress bar, a spinner. Kept as a line break so the file reads as
        // the sequence of states the screen went through.
        let text = clean(ready).replace(/\r\n?/g, '\n');
        if (!text) return;

        if (entry.timestamps) {
            const prefix = () => `[${new Date().toISOString()}] `;
            let out = '';
            for (const character of text) {
                if (entry.atLineStart && character !== '\n') {
                    out += prefix();
                    entry.atLineStart = false;
                }
                out += character;
                if (character === '\n') entry.atLineStart = true;
            }
            text = out;
        }

        entry.stream.write(text);
        entry.bytes += Buffer.byteLength(text);
    } catch (error) {
        console.error(`Session log write failed for ${tabId}:`, error.message);
        open.delete(tabId);
    }
}

const CLOSE_REASONS = {
    session: 'Session ended',
    disabled: 'Recording turned off',
    stopped: 'Stopped from the session',
};

function close(tabId, { reason = 'session' } = {}) {
    const entry = open.get(tabId);
    if (!entry) return null;
    open.delete(tabId);

    try {
        // Whatever was being held back for a sequence that never completed. It
        // is real output, so it belongs in the file rather than being dropped.
        if (entry.pending && entry.format !== 'raw') {
            const tail = clean(entry.pending).replace(/\r\n?/g, '\n');
            if (tail) entry.stream.write(tail);
        }
        entry.stream.end(
            `\n# ended: ${new Date().toISOString()} (${CLOSE_REASONS[reason] || CLOSE_REASONS.session})\n`
        );
    } catch (error) {
        console.error(`Could not close the session log for ${tabId}:`, error.message);
    }

    activity.record({
        category: 'security',
        action: 'sessionlog.stop',
        outcome: 'info',
        target: entry.hostName || entry.address,
        subject: entry.address,
        detail: `${path.basename(entry.filePath)} · ${CLOSE_REASONS[reason] || CLOSE_REASONS.session}`,
        hostId: entry.hostId,
        hostName: entry.hostName,
    });

    return entry.filePath;
}

/** Whether this session is being recorded, and where, for the pane header. */
function status(tabId) {
    const entry = open.get(tabId);
    const current = loadConfig();
    return {
        // Whether every new session is being recorded, which is what tells the
        // header's control apart from the global setting behind it.
        always: current.enabled,
        recording: Boolean(entry),
        filePath: entry?.filePath || '',
        fileName: entry ? path.basename(entry.filePath) : '',
        bytes: entry?.bytes || 0,
        startedAt: entry?.startedAt || 0,
    };
}

/** Every transcript on disk, newest first, for the settings page. */
function list({ limit = 200 } = {}) {
    const directory = loadConfig().directory || defaultDirectory();
    try {
        if (!fs.existsSync(directory)) return { directory, files: [] };

        const files = fs.readdirSync(directory)
            .filter(name => name.toLowerCase().endsWith('.log'))
            .map((name) => {
                const full = path.join(directory, name);
                try {
                    const stats = fs.statSync(full);
                    return { name, path: full, bytes: stats.size, modifiedAt: stats.mtimeMs };
                } catch {
                    // Deleted between the readdir and the stat.
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.modifiedAt - a.modifiedAt)
            .slice(0, limit);

        return { directory, files };
    } catch (error) {
        console.error('Could not list session logs:', error.message);
        return { directory, files: [] };
    }
}

/* ------------------------------------------------------------------ *
 * Retention
 * ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let lastSweepAt = 0;

/**
 * Delete transcripts the retention settings say have expired: first anything
 * older than `retentionDays`, then oldest-first until the folder is back under
 * `maxTotalMB`. A transcript still being written is never deleted, whatever
 * its age; it still counts against the cap, because its bytes are still on
 * the disk.
 *
 * `throttled` is for the call made on every session start, so a burst of tabs
 * does not rescan the folder once per tab. Settings changes and app startup
 * sweep unconditionally.
 *
 * Deliberately quiet on failure: retention is housekeeping, and a locked file
 * or a vanished folder must never take a connection down with it.
 */
function sweep({ throttled = false } = {}) {
    const current = loadConfig();
    if (current.retentionDays <= 0 && current.maxTotalMB <= 0) return;
    if (throttled && Date.now() - lastSweepAt < SWEEP_INTERVAL_MS) return;
    lastSweepAt = Date.now();

    const directory = current.directory || defaultDirectory();
    let files;
    try {
        if (!fs.existsSync(directory)) return;
        files = fs.readdirSync(directory)
            .filter(name => name.toLowerCase().endsWith('.log'))
            .map((name) => {
                const full = path.join(directory, name);
                try {
                    const stats = fs.statSync(full);
                    return { path: full, bytes: stats.size, modifiedAt: stats.mtimeMs };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch (error) {
        console.error('Could not scan the session log folder:', error.message);
        return;
    }

    const active = new Set([...open.values()].map(entry => entry.filePath));

    // path -> why it goes, so age and the cap are decided in one pass and a
    // file is only ever deleted once.
    const doomed = new Map();

    if (current.retentionDays > 0) {
        const cutoff = Date.now() - current.retentionDays * DAY_MS;
        for (const file of files) {
            if (file.modifiedAt < cutoff && !active.has(file.path)) {
                doomed.set(file.path, 'age');
            }
        }
    }

    if (current.maxTotalMB > 0) {
        const cap = current.maxTotalMB * 1024 * 1024;
        // Newest first, keeping a running total: everything after the cap is
        // crossed goes, which is exactly "delete the oldest until it fits".
        const kept = files
            .filter(file => !doomed.has(file.path))
            .sort((a, b) => b.modifiedAt - a.modifiedAt);
        let total = 0;
        for (const file of kept) {
            total += file.bytes;
            if (total > cap && !active.has(file.path)) doomed.set(file.path, 'size');
        }
    }

    if (doomed.size === 0) return;

    let byAge = 0;
    let bySize = 0;
    let freed = 0;
    const byBytes = new Map(files.map(file => [file.path, file.bytes]));
    for (const [filePath, reason] of doomed) {
        try {
            fs.unlinkSync(filePath);
            if (reason === 'age') byAge += 1; else bySize += 1;
            freed += byBytes.get(filePath) || 0;
        } catch (error) {
            console.error('Could not delete an expired session log:', error.message);
        }
    }

    const deleted = byAge + bySize;
    if (deleted > 0) {
        const parts = [];
        if (byAge > 0) parts.push(`${byAge} older than ${current.retentionDays} days`);
        if (bySize > 0) parts.push(`${bySize} over the ${current.maxTotalMB} MB cap`);
        activity.record({
            category: 'security',
            action: 'sessionlog.retention',
            outcome: 'info',
            target: 'Session logging',
            detail: `Deleted ${deleted} transcript${deleted === 1 ? '' : 's'} `
                + `(${parts.join(', ')}), freeing ${Math.round(freed / 1024)} KB`,
        });
    }
}

function closeAll() {
    for (const tabId of [...open.keys()]) close(tabId, { reason: 'session' });
}

if (typeof app?.on === 'function') app.on('will-quit', closeAll);
// Expired transcripts go at launch too, so retention holds even for someone
// who records rarely and would otherwise wait for the next session to sweep.
if (typeof app?.whenReady === 'function') app.whenReady().then(() => sweep());

module.exports = {
    getConfig,
    setConfig,
    defaultDirectory,
    start,
    write,
    close,
    closeAll,
    status,
    list,
    sweep,
    // Exported for the tests: the stripper and the split-chunk rule are the
    // parts that have to be exactly right.
    clean,
    splitPending,
    sanitize,
};
