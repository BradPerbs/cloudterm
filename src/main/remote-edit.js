const { app, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ssh = require('./ssh');
const sftp = require('./sftp');
const activity = require('./activity');
const { safeLocalSegment } = require('./local-path');

/** Editing pulls the whole file down, so keep it to something sane. */
const MAX_EDIT_SIZE = 64 * 1024 * 1024;

/** Polling beats fs.watch here: editors that save by atomic replace break inotify. */
const POLL_INTERVAL = 900;

// `${tabId}::${remotePath}` -> watch record
const watched = new Map();

let notify = () => {};

function setNotifier(fn) {
    notify = fn;
}

const keyFor = (tabId, remotePath) => `${tabId}::${remotePath}`;

function report(record, state, message = '') {
    notify('sftp-edit-status', {
        tabId: record.tabId,
        remotePath: record.remotePath,
        name: path.basename(record.remotePath),
        state,
        message,
    });
}

/** A stable scratch path per remote file, so reopening reuses the same buffer. */
function localPathFor(tabId, remotePath) {
    const digest = crypto.createHash('sha1').update(`${tabId}:${remotePath}`).digest('hex').slice(0, 12);

    // Parsed as POSIX because that is what a remote path is. `path.basename`
    // would cut a legitimate Linux filename like `report\final` at the
    // backslash. That makes sanitising the result mandatory rather than
    // merely tidy: the name is about to become part of a local path, where a
    // backslash is a separator again.
    const name = safeLocalSegment(path.posix.basename(remotePath), 'file');

    return path.join(app.getPath('temp'), 'cloudblast-ssh-edit', digest, name);
}

function streamDown(handle, remotePath, localPath) {
    return new Promise((resolve, reject) => {
        const readStream = handle.createReadStream(remotePath);
        const writeStream = fs.createWriteStream(localPath);
        readStream.on('error', (error) => { writeStream.destroy(); reject(error); });
        writeStream.on('error', (error) => { readStream.destroy(); reject(error); });
        writeStream.on('close', resolve);
        readStream.pipe(writeStream);
    });
}

function streamUp(handle, localPath, remotePath, mode) {
    return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(localPath);
        const writeStream = handle.createWriteStream(remotePath, { mode: mode || 0o644 });
        readStream.on('error', (error) => { writeStream.destroy(); reject(error); });
        writeStream.on('error', (error) => { readStream.destroy(); reject(error); });
        writeStream.on('close', resolve);
        readStream.pipe(writeStream);
    });
}

/**
 * Push the scratch file back. Saves that land mid-upload set `pending` so the
 * newest content still gets written, without two uploads racing on one path.
 */
async function upload(record) {
    if (record.uploading) {
        record.pending = true;
        return;
    }

    record.uploading = true;
    report(record, 'uploading');

    try {
        // The channel may have been closed since the file was opened; a save
        // half an hour later should still land.
        const opened = await sftp.init(record.tabId);
        if (!opened.success) throw new Error(opened.message || 'Connection is no longer open');

        const handle = ssh.sessions.get(record.tabId)?.sftp;
        if (!handle) throw new Error('Connection is no longer open');

        await streamUp(handle, record.localPath, record.remotePath, record.mode);

        const stats = await fsp.stat(record.localPath);
        record.mtimeMs = stats.mtimeMs;
        record.size = stats.size;

        report(record, 'saved');
        activity.record({
            category: 'files',
            action: 'file.edit',
            target: record.remotePath,
            detail: 'Saved from the local editor',
            ...ssh.describe(record.tabId),
        });
    } catch (error) {
        report(record, 'error', error.message);
        activity.record({
            category: 'files',
            action: 'file.edit',
            outcome: 'failure',
            target: record.remotePath,
            message: error.message,
            ...ssh.describe(record.tabId),
        });
    } finally {
        record.uploading = false;
        if (record.pending) {
            record.pending = false;
            upload(record);
        }
    }
}

function watch(record) {
    const listener = (current) => {
        // Zeroed mtime means the file went away; stop rather than upload nothing.
        if (current.nlink === 0 || !current.isFile()) return;
        if (current.mtimeMs === record.mtimeMs && current.size === record.size) return;

        record.mtimeMs = current.mtimeMs;
        record.size = current.size;

        // Editors write in bursts; settle before shipping it.
        clearTimeout(record.settleTimer);
        record.settleTimer = setTimeout(() => upload(record), 350);
    };

    fs.watchFile(record.localPath, { interval: POLL_INTERVAL }, listener);
    record.listener = listener;
}

/**
 * Download a remote file to a scratch copy, hand it to the OS default editor,
 * and mirror every save back to the server until the watch is stopped.
 */
async function open(tabId, remotePath) {
    const key = keyFor(tabId, remotePath);
    const existing = watched.get(key);
    if (existing) {
        // Already being edited, so just bring the editor forward again.
        await shell.openPath(existing.localPath);
        return { success: true, localPath: existing.localPath, reused: true };
    }

    const opened = await sftp.init(tabId);
    if (!opened.success) return { success: false, message: opened.message };

    const handle = ssh.sessions.get(tabId)?.sftp;
    if (!handle) return { success: false, message: 'SFTP is not available' };

    let attrs;
    try {
        attrs = await sftp.call(handle, 'stat', remotePath);
    } catch (error) {
        return { success: false, message: error.message };
    }

    if (sftp.isDirMode(attrs.mode || 0)) {
        return { success: false, message: 'Directories cannot be edited' };
    }
    if ((attrs.size || 0) > MAX_EDIT_SIZE) {
        return {
            success: false,
            message: `File is larger than ${Math.round(MAX_EDIT_SIZE / 1024 / 1024)} MB. Download it instead`,
        };
    }

    const localPath = localPathFor(tabId, remotePath);

    const record = {
        tabId,
        remotePath,
        localPath,
        mode: (attrs.mode || 0) & 0o7777,
        mtimeMs: 0,
        size: 0,
        uploading: false,
        pending: false,
        listener: null,
        settleTimer: null,
    };

    report(record, 'downloading');

    try {
        await fsp.mkdir(path.dirname(localPath), { recursive: true });
        await streamDown(handle, remotePath, localPath);

        const stats = await fsp.stat(localPath);
        record.mtimeMs = stats.mtimeMs;
        record.size = stats.size;
    } catch (error) {
        report(record, 'error', error.message);
        return { success: false, message: error.message };
    }

    watched.set(key, record);
    watch(record);
    report(record, 'ready');

    const failure = await shell.openPath(localPath);
    if (failure) {
        // No handler for this file type; the watch still works if the user
        // opens the scratch copy themselves, so surface the path.
        report(record, 'error', failure);
        return { success: false, message: failure, localPath };
    }

    return { success: true, localPath };
}

function stopRecord(record) {
    clearTimeout(record.settleTimer);
    if (record.listener) fs.unwatchFile(record.localPath, record.listener);
    fs.rm(record.localPath, { force: true }, () => {});
    report(record, 'stopped');
}

function stop(tabId, remotePath) {
    const key = keyFor(tabId, remotePath);
    const record = watched.get(key);
    if (!record) return { success: false, message: 'Not being edited' };
    watched.delete(key);
    stopRecord(record);
    return { success: true };
}

function list(tabId) {
    return [...watched.values()]
        .filter(record => record.tabId === tabId)
        .map(record => ({
            remotePath: record.remotePath,
            name: path.basename(record.remotePath),
            localPath: record.localPath,
        }));
}

/** Drop every watch for a tab whose session has gone away. */
function cleanup(tabId) {
    for (const [key, record] of watched) {
        if (record.tabId !== tabId) continue;
        watched.delete(key);
        stopRecord(record);
    }
}

module.exports = { setNotifier, open, stop, list, cleanup };
