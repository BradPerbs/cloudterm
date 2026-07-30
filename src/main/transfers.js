const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const ssh = require('./ssh');
const sftp = require('./sftp');
const activity = require('./activity');
const { safeLocalSegment, isInsideLocal } = require('./local-path');

/** Transfers running at once, per tab. One SFTP channel carries them all. */
const MAX_ACTIVE = 2;

/** 64 KB is the ssh2 default; larger windows keep the pipe full on fast links. */
const CHUNK_SIZE = 256 * 1024;

/** Progress is coalesced to this cadence so a fast transfer can't storm IPC. */
const PROGRESS_INTERVAL = 250;

const MAX_DEPTH = 64;

// transferId -> transfer record (+ non-serialisable runtime state)
const transfers = new Map();
// requestId -> resolve, for conflicts awaiting a user decision
const pendingConflicts = new Map();

let counter = 0;
let notify = () => {};
let progressTimer = null;

function setNotifier(fn) {
    notify = fn;
}

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

/** The renderer-visible shape. Streams and callbacks stay on this side. */
function snapshot(transfer) {
    return {
        id: transfer.id,
        tabId: transfer.tabId,
        direction: transfer.direction,
        name: transfer.name,
        source: transfer.source,
        destination: transfer.destination,
        state: transfer.state,
        isDirectory: transfer.isDirectory,
        totalBytes: transfer.totalBytes,
        transferredBytes: transfer.transferredBytes,
        totalFiles: transfer.totalFiles,
        completedFiles: transfer.completedFiles,
        skippedFiles: transfer.skippedFiles,
        currentFile: transfer.currentFile,
        speed: transfer.speed,
        error: transfer.error,
        createdAt: transfer.createdAt,
        finishedAt: transfer.finishedAt,
    };
}

function listFor(tabId) {
    return [...transfers.values()]
        .filter(t => t.tabId === tabId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(snapshot);
}

/** Push the full list for a tab; the renderer replaces its state wholesale. */
function publish(tabId) {
    notify('sftp-transfers', { tabId, transfers: listFor(tabId) });
}

const ACTIVE_STATES = new Set(['queued', 'scanning', 'running']);

function scheduleProgress() {
    if (progressTimer) return;
    progressTimer = setInterval(() => {
        const tabs = new Set();
        for (const transfer of transfers.values()) {
            if (ACTIVE_STATES.has(transfer.state)) tabs.add(transfer.tabId);
        }
        if (tabs.size === 0) {
            clearInterval(progressTimer);
            progressTimer = null;
            return;
        }
        for (const tabId of tabs) publish(tabId);
    }, PROGRESS_INTERVAL);
}

/** Exponentially weighted speed, so the readout doesn't jitter per chunk. */
function sampleSpeed(transfer) {
    const now = Date.now();
    const elapsed = now - transfer.speedAt;
    if (elapsed < 400) return;

    const delta = transfer.transferredBytes - transfer.speedBytes;
    const instant = (delta * 1000) / elapsed;
    transfer.speed = transfer.speed ? transfer.speed * 0.6 + instant * 0.4 : instant;
    transfer.speedAt = now;
    transfer.speedBytes = transfer.transferredBytes;
}

/* ------------------------------------------------------------------ *
 * Tree scanning
 * ------------------------------------------------------------------ */

/**
 * Flatten a local tree into directories-first work items. Symlinks are
 * followed, but a realpath set stops a self-referencing link from looping.
 */
async function scanLocal(transfer, source, destination, items, depth, seen) {
    if (depth > MAX_DEPTH) throw new Error('Directory nesting is too deep');
    // Scanning a deep tree takes real time; a cancel has to land here too.
    if (transfer.canceled) throw new Error('Canceled');

    const stats = await fsp.stat(source);

    if (!stats.isDirectory()) {
        items.push({ type: 'file', source, destination, size: stats.size, mode: stats.mode & 0o7777 });
        return;
    }

    const real = await fsp.realpath(source);
    if (seen.has(real)) return;
    seen.add(real);

    items.push({ type: 'dir', source, destination, size: 0, mode: stats.mode & 0o7777 });

    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
        await scanLocal(
            transfer,
            path.join(source, entry.name),
            path.posix.join(destination, entry.name),
            items,
            depth + 1,
            seen
        );
    }
}

async function scanRemote(transfer, handle, source, destination, items, depth, seen) {
    if (depth > MAX_DEPTH) throw new Error('Directory nesting is too deep');
    if (transfer.canceled) throw new Error('Canceled');

    const attrs = await sftp.call(handle, 'stat', source);

    if (!sftp.isDirMode(attrs.mode || 0)) {
        items.push({ type: 'file', source, destination, size: attrs.size || 0, mode: (attrs.mode || 0) & 0o7777 });
        return;
    }

    let real = source;
    try {
        real = await sftp.call(handle, 'realpath', source);
    } catch {
        // Keep the literal path if the server won't resolve it.
    }
    if (seen.has(real)) return;
    seen.add(real);

    items.push({ type: 'dir', source, destination, size: 0, mode: (attrs.mode || 0) & 0o7777 });

    const entries = await sftp.call(handle, 'readdir', source);
    for (const entry of entries) {
        // The remote side keeps the name verbatim, since it is a real path on the
        // server and has to stay byte-for-byte what the server called it. The
        // local side gets a sanitised segment, because a listing is the
        // server's to compose: on Windows a file it names `..\..\evil.exe`
        // would otherwise resolve two levels above the download folder.
        const localTarget = path.join(destination, safeLocalSegment(entry.filename));

        // Belt and braces. safeLocalSegment already makes this unreachable, so
        // reaching it means the sanitiser has a hole, so stop the transfer
        // rather than write to a path we cannot account for.
        if (!isInsideLocal(transfer.destination, localTarget)) {
            throw new Error(`"${entry.filename}" would be written outside the download folder`);
        }

        await scanRemote(
            transfer,
            handle,
            path.posix.join(source, entry.filename),
            localTarget,
            items,
            depth + 1,
            seen
        );
    }
}

/* ------------------------------------------------------------------ *
 * Conflicts
 * ------------------------------------------------------------------ */

/**
 * Ask the renderer what to do about an existing destination file. Resolves to
 * `cancel` if the window is gone, so a transfer can never silently overwrite
 * while nobody is watching.
 */
function askConflict(transfer, details) {
    return new Promise((resolve) => {
        const requestId = `cf-${++counter}`;
        pendingConflicts.set(requestId, { transferId: transfer.id, resolve });
        notify('sftp-conflict', {
            requestId,
            tabId: transfer.tabId,
            transferId: transfer.id,
            ...details,
        });
    });
}

function resolveConflict(requestId, decision) {
    const pending = pendingConflicts.get(requestId);
    if (!pending) return false;
    pendingConflicts.delete(requestId);
    pending.resolve(decision || { action: 'cancel' });
    return true;
}

/** Release prompts belonging to transfers that are going away. */
function releaseConflicts(matches) {
    for (const [requestId, pending] of pendingConflicts) {
        if (!matches(pending.transferId)) continue;
        pendingConflicts.delete(requestId);
        pending.resolve({ action: 'cancel' });
        notify('sftp-conflict-resolved', { requestId });
    }
}

/**
 * Append " (2)", " (3)" … before the extension until the name is free. `flavor`
 * is the path module for the *destination* side. A download lands on the
 * local filesystem, where posix parsing would mangle a Windows path.
 */
async function uniqueName(exists, target, flavor) {
    const dir = flavor.dirname(target);
    const base = flavor.basename(target);
    const ext = flavor.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;

    for (let index = 2; index < 1000; index++) {
        const candidate = flavor.join(dir, `${stem} (${index})${ext}`);
        if (!(await exists(candidate))) return candidate;
    }
    throw new Error('Could not find a free filename');
}

/**
 * Apply the conflict policy for one file. Returns the destination to write to,
 * a byte offset for resume, or null to skip.
 */
async function resolveDestination(transfer, item, probe) {
    const existing = await probe.stat(item.destination);
    if (!existing) return { destination: item.destination, offset: 0 };

    let policy = transfer.conflictPolicy;

    if (policy === 'ask') {
        const decision = await askConflict(transfer, {
            name: path.basename(item.destination),
            destination: item.destination,
            sourceSize: item.size,
            targetSize: existing.size,
            targetModifiedAt: existing.modifyTime,
        });

        if (decision.applyToAll) transfer.conflictPolicy = decision.action;
        policy = decision.action;
    }

    if (policy === 'cancel') {
        transfer.canceled = true;
        return null;
    }
    if (policy === 'skip') return null;
    if (policy === 'rename') {
        const free = await uniqueName(
            async (candidate) => Boolean(await probe.stat(candidate)),
            item.destination,
            probe.flavor
        );
        return { destination: free, offset: 0 };
    }
    if (policy === 'resume' && existing.size < item.size) {
        return { destination: item.destination, offset: existing.size };
    }
    if (policy === 'resume') {
        // Already complete (or larger than the source), so nothing to add.
        return null;
    }

    return { destination: item.destination, offset: 0 };
}

/* ------------------------------------------------------------------ *
 * Byte pumps
 * ------------------------------------------------------------------ */

/**
 * Pipe one file, attributing progress to the transfer. The streams are parked
 * on the record so a cancel can tear them down mid-flight.
 */
function pump(transfer, readStream, writeStream) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (error) => {
            if (settled) return;
            settled = true;
            transfer.streams = null;
            if (error) reject(error);
            else resolve();
        };

        transfer.streams = { readStream, writeStream };

        readStream.on('data', (chunk) => {
            transfer.transferredBytes += chunk.length;
            sampleSpeed(transfer);
        });

        readStream.on('error', (error) => {
            writeStream.destroy();
            settle(error);
        });
        writeStream.on('error', (error) => {
            readStream.destroy();
            settle(error);
        });
        writeStream.on('close', () => {
            if (transfer.canceled) settle(new Error('Canceled'));
            else settle(null);
        });

        readStream.pipe(writeStream);
    });
}

async function copyFileUp(transfer, handle, item, destination, offset) {
    const readStream = fs.createReadStream(item.source, {
        highWaterMark: CHUNK_SIZE,
        start: offset || 0,
    });
    const writeStream = handle.createWriteStream(destination, {
        highWaterMark: CHUNK_SIZE,
        mode: item.mode || 0o644,
        flags: offset ? 'a' : 'w',
    });
    await pump(transfer, readStream, writeStream);
}

async function copyFileDown(transfer, handle, item, destination, offset) {
    const readStream = handle.createReadStream(item.source, {
        highWaterMark: CHUNK_SIZE,
        start: offset || 0,
    });
    const writeStream = fs.createWriteStream(destination, {
        highWaterMark: CHUNK_SIZE,
        flags: offset ? 'a' : 'w',
    });
    await pump(transfer, readStream, writeStream);
}

/* ------------------------------------------------------------------ *
 * Execution
 * ------------------------------------------------------------------ */

/**
 * Existence probes, directory creation and path parsing for the destination
 * side of a transfer. `flavor` matters: uploads land on POSIX, downloads on
 * whatever this machine runs.
 */
function probeFor(direction, handle) {
    if (direction === 'upload') {
        return {
            flavor: path.posix,
            stat: async (remotePath) => {
                try {
                    const attrs = await sftp.call(handle, 'stat', remotePath);
                    return { size: attrs.size || 0, modifyTime: (attrs.mtime || 0) * 1000 };
                } catch {
                    return null;
                }
            },
            mkdir: (remotePath) => sftp.mkdirRecursive(handle, remotePath),
        };
    }

    return {
        flavor: path,
        stat: async (localPath) => {
            try {
                const stats = await fsp.stat(localPath);
                return { size: stats.size, modifyTime: stats.mtimeMs };
            } catch {
                return null;
            }
        },
        mkdir: (localPath) => fsp.mkdir(localPath, { recursive: true }),
    };
}

async function run(transfer) {
    const opened = await sftp.init(transfer.tabId);
    if (!opened.success) throw new Error(opened.message || 'SFTP is not available');

    const handle = ssh.sessions.get(transfer.tabId)?.sftp;
    if (!handle) throw new Error('SFTP is not available');

    // ---- Scan -------------------------------------------------------
    transfer.state = 'scanning';
    publish(transfer.tabId);

    const items = [];
    if (transfer.direction === 'upload') {
        await scanLocal(transfer, transfer.source, transfer.destination, items, 0, new Set());
    } else {
        await scanRemote(transfer, handle, transfer.source, transfer.destination, items, 0, new Set());
    }

    if (transfer.canceled) throw new Error('Canceled');

    const files = items.filter(item => item.type === 'file');
    transfer.isDirectory = items[0]?.type === 'dir';
    transfer.totalFiles = files.length;
    transfer.totalBytes = files.reduce((sum, item) => sum + item.size, 0);

    // ---- Copy -------------------------------------------------------
    transfer.state = 'running';
    transfer.startedAt = Date.now();
    transfer.speedAt = Date.now();
    transfer.speedBytes = 0;
    publish(transfer.tabId);
    scheduleProgress();

    const probe = probeFor(transfer.direction, handle);
    const failures = [];

    // Only directories found while walking the source get created below, so the
    // destination's own parent has to be made here, since it may never have existed
    // (a typed path) or may have been removed since the picker ran.
    try {
        await probe.mkdir(probe.flavor.dirname(transfer.destination));
    } catch (error) {
        throw new Error(`Cannot create ${probe.flavor.dirname(transfer.destination)}: ${error.message}`);
    }

    for (const item of items) {
        if (transfer.canceled) throw new Error('Canceled');

        if (item.type === 'dir') {
            try {
                await probe.mkdir(item.destination);
            } catch (error) {
                failures.push(`${path.basename(item.destination)}: ${error.message}`);
            }
            continue;
        }

        transfer.currentFile = path.basename(item.source);

        let target;
        try {
            target = await resolveDestination(transfer, item, probe);
        } catch (error) {
            failures.push(`${path.basename(item.source)}: ${error.message}`);
            continue;
        }

        if (transfer.canceled) throw new Error('Canceled');

        if (!target) {
            transfer.skippedFiles++;
            // A skipped file still counts toward the total, or the bar stalls.
            transfer.transferredBytes += item.size;
            continue;
        }

        // Bytes already on the far side count as done, or a resumed transfer
        // would report a percentage far below what is actually there.
        if (target.offset) transfer.transferredBytes += target.offset;

        try {
            if (transfer.direction === 'upload') {
                await copyFileUp(transfer, handle, item, target.destination, target.offset);
            } else {
                await copyFileDown(transfer, handle, item, target.destination, target.offset);
            }
            transfer.completedFiles++;
        } catch (error) {
            if (transfer.canceled) throw new Error('Canceled');
            failures.push(`${path.basename(item.source)}: ${error.message}`);
        }
    }

    transfer.currentFile = '';

    if (failures.length) {
        const shown = failures.slice(0, 3).join('; ');
        throw new Error(failures.length > 3 ? `${shown} (+${failures.length - 3} more)` : shown);
    }
}

/** Pick up queued work while the tab is under its concurrency limit. */
function drain(tabId) {
    const forTab = [...transfers.values()].filter(t => t.tabId === tabId);
    const active = forTab.filter(t => t.state === 'scanning' || t.state === 'running').length;
    if (active >= MAX_ACTIVE) return;

    const next = forTab
        .filter(t => t.state === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return;

    start(next);
}

function start(transfer) {
    // Claim the slot synchronously. `run` is async, so leaving the state at
    // 'queued' until its first await would let the next drain() pick the same
    // transfer up a second time.
    transfer.state = 'scanning';

    run(transfer)
        .then(() => {
            transfer.state = transfer.canceled ? 'canceled' : 'done';
            if (!transfer.canceled) transfer.transferredBytes = Math.max(transfer.transferredBytes, transfer.totalBytes);
        })
        .catch((error) => {
            if (transfer.canceled || error.message === 'Canceled') {
                transfer.state = 'canceled';
            } else {
                transfer.state = 'error';
                transfer.error = error.message;
            }
        })
        .finally(() => {
            transfer.finishedAt = Date.now();
            transfer.speed = 0;
            transfer.streams = null;
            publish(transfer.tabId);

            // An upload is an edit to the far side, so it belongs in the log
            // whichever way it went. Recorded once the outcome is known rather
            // than on enqueue, so a cancelled queue leaves nothing behind.
            activity.record({
                category: 'files',
                action: transfer.direction === 'upload' ? 'file.upload' : 'file.download',
                outcome: transfer.state === 'done' ? 'success'
                    : transfer.state === 'error' ? 'failure' : 'info',
                target: transfer.direction === 'upload' ? transfer.destination : transfer.source,
                detail: transfer.state === 'canceled'
                    ? 'Cancelled'
                    : `${transfer.isDirectory ? 'folder' : 'file'}, ${transfer.totalFiles || 1} item(s)`,
                message: transfer.error || '',
                ...(transfer.host || {}),
            });


            if (transfer.state === 'done' || transfer.direction === 'upload') {
                notify('sftp-changed', { tabId: transfer.tabId, direction: transfer.direction });
            }
            drain(transfer.tabId);
        });

    publish(transfer.tabId);
    scheduleProgress();
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Queue one transfer per top-level item, so dropping three folders produces
 * three rows rather than a thousand.
 *
 *   direction        'upload' | 'download'
 *   sources          absolute paths on the source side
 *   destinationDir   directory on the target side
 *   destinationPath  exact target for a single item (Save As)
 *   conflictPolicy   'ask' | 'overwrite' | 'skip' | 'resume' | 'rename'
 */
function enqueue(tabId, { direction, sources, destinationDir, destinationPath, conflictPolicy = 'ask' }) {
    const list = (sources || []).filter(Boolean);
    if (list.length === 0) return { success: false, message: 'Nothing to transfer' };
    if (!destinationDir && !destinationPath) {
        return { success: false, message: 'No destination given' };
    }

    const joinTarget = direction === 'upload' ? path.posix.join : path.join;
    const sourceBase = direction === 'upload' ? path.basename : path.posix.basename;

    const created = list.map((source) => {
        // `name` is what the row is labelled with, so it stays as the server
        // spelled it. What gets joined onto a local directory does not: a
        // remote file called `..\..\evil.exe` has a posix basename of exactly
        // that, and `path.join` on Windows would walk it out of the folder the
        // user picked. Uploads are unaffected, since a local filename cannot
        // contain a separator, and `path.posix.join` gives `\` no meaning.
        const name = sourceBase(source);
        const targetName = direction === 'upload' ? name : safeLocalSegment(name);

        // A "Save as" path is the user's own choice, so it is taken as given.
        const destination = destinationPath && list.length === 1
            ? destinationPath
            : joinTarget(destinationDir, targetName);

        const transfer = {
            id: `tx-${Date.now()}-${++counter}`,
            tabId,
            direction,
            name,
            source,
            destination,
            state: 'queued',
            isDirectory: false,
            totalBytes: 0,
            transferredBytes: 0,
            totalFiles: 0,
            completedFiles: 0,
            skippedFiles: 0,
            currentFile: '',
            speed: 0,
            speedAt: 0,
            speedBytes: 0,
            error: '',
            conflictPolicy,
            canceled: false,
            streams: null,
            createdAt: Date.now(),
            finishedAt: 0,
            // Captured now, not when the transfer finishes: a dropped link
            // cancels what is queued, and by then the session it belonged to is
            // already gone from the registry.
            host: ssh.describe(tabId),
        };

        transfers.set(transfer.id, transfer);
        return transfer;
    });

    publish(tabId);
    for (let i = 0; i < MAX_ACTIVE; i++) drain(tabId);

    return { success: true, ids: created.map(t => t.id) };
}

function cancel(id) {
    const transfer = transfers.get(id);
    if (!transfer) return { success: false, message: 'Transfer not found' };

    transfer.canceled = true;

    if (transfer.state === 'queued') {
        transfer.state = 'canceled';
        transfer.finishedAt = Date.now();
    } else if (transfer.streams) {
        transfer.streams.readStream.destroy();
        transfer.streams.writeStream.destroy();
    }

    // A conflict prompt this transfer is blocked on must let go, or it would
    // sit there waiting on an answer that no longer means anything.
    releaseConflicts(id => id === transfer.id);

    publish(transfer.tabId);
    drain(transfer.tabId);
    return { success: true };
}

function retry(id) {
    const transfer = transfers.get(id);
    if (!transfer) return { success: false, message: 'Transfer not found' };
    if (transfer.state === 'queued' || transfer.state === 'running' || transfer.state === 'scanning') {
        return { success: false, message: 'Transfer is already running' };
    }

    Object.assign(transfer, {
        state: 'queued',
        canceled: false,
        error: '',
        transferredBytes: 0,
        completedFiles: 0,
        skippedFiles: 0,
        totalBytes: 0,
        totalFiles: 0,
        speed: 0,
        currentFile: '',
        finishedAt: 0,
        createdAt: Date.now(),
        // A retry over a partial file should continue it, not start over.
        conflictPolicy: transfer.conflictPolicy === 'ask' ? 'resume' : transfer.conflictPolicy,
    });

    publish(transfer.tabId);
    drain(transfer.tabId);
    return { success: true };
}

const isFinished = (transfer) =>
    transfer.state === 'done' || transfer.state === 'error' || transfer.state === 'canceled';

function clearFinished(tabId) {
    for (const [id, transfer] of transfers) {
        if (transfer.tabId === tabId && isFinished(transfer)) transfers.delete(id);
    }
    publish(tabId);
    return { success: true };
}

function cancelAll(tabId) {
    for (const transfer of transfers.values()) {
        if (transfer.tabId === tabId && !isFinished(transfer)) cancel(transfer.id);
    }
    return { success: true };
}

/** Drop everything for a tab whose session has gone away. */
function cleanup(tabId) {
    const dropped = new Set();

    for (const [id, transfer] of transfers) {
        if (transfer.tabId !== tabId) continue;
        if (!isFinished(transfer)) {
            transfer.canceled = true;
            if (transfer.streams) {
                transfer.streams.readStream.destroy();
                transfer.streams.writeStream.destroy();
            }
        }
        dropped.add(id);
        transfers.delete(id);
    }

    releaseConflicts(id => dropped.has(id));

    // Reconnecting tears the session down and builds a new one; without this
    // the pane would keep showing transfers that no longer exist.
    if (dropped.size > 0) publish(tabId);
}

module.exports = {
    setNotifier,
    enqueue,
    cancel,
    cancelAll,
    retry,
    clearFinished,
    list: listFor,
    resolveConflict,
    cleanup,
};
