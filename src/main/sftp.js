const path = require('path');
const ssh = require('./ssh');

/** Guard against symlink loops when walking or deleting a remote tree. */
const MAX_DEPTH = 64;

/** Resolving every symlink in a huge directory would stall the listing. */
const MAX_SYMLINK_RESOLVES = 250;

/* ------------------------------------------------------------------ *
 * Session handle
 * ------------------------------------------------------------------ */

/**
 * Open the SFTP subsystem for a tab, reusing the existing channel. The handle
 * is cleared when the channel dies so the next call transparently reopens it
 * rather than handing out a dead one.
 */
function init(tabId) {
    return new Promise((resolve) => {
        const session = ssh.sessions.get(tabId);
        if (!session?.client) {
            resolve({ success: false, message: 'No SSH connection found' });
            return;
        }
        if (session.sftp) {
            resolve({ success: true });
            return;
        }
        if (session.sftpOpening) {
            // A second view asked while the first request was still in flight.
            session.sftpOpening.then(resolve);
            return;
        }

        session.sftpOpening = new Promise((settle) => {
            session.client.sftp((err, sftp) => {
                session.sftpOpening = null;

                if (err) {
                    settle({ success: false, message: err.message });
                    return;
                }

                const forget = () => {
                    if (session.sftp === sftp) session.sftp = null;
                };
                sftp.on('close', forget);
                sftp.on('end', forget);
                sftp.on('error', forget);

                // Attached to the session so teardown closes it with the connection.
                session.sftp = sftp;
                settle({ success: true });
            });
        });

        session.sftpOpening.then(resolve);
    });
}

function close(tabId) {
    const session = ssh.sessions.get(tabId);
    if (session?.sftp) {
        const handle = session.sftp;
        session.sftp = null;
        try {
            handle.end();
        } catch {
            // Already torn down with the connection.
        }
    }
    return { success: true };
}

function handleFor(tabId) {
    return ssh.sessions.get(tabId)?.sftp || null;
}

/**
 * Run an sftp call, reopening the subsystem if the channel went away since the
 * view last touched it. Every operation funnels through here so a dropped
 * channel surfaces as one retry rather than an error in the UI.
 */
async function withSftp(tabId, fn) {
    let sftp = handleFor(tabId);

    if (!sftp) {
        const opened = await init(tabId);
        if (!opened.success) return opened;
        sftp = handleFor(tabId);
        if (!sftp) return { success: false, message: 'SFTP is not available' };
    }

    return new Promise((resolve) => {
        try {
            fn(sftp, resolve);
        } catch (error) {
            resolve({ success: false, message: error.message });
        }
    });
}

/** Promise form of a node-style sftp method, rejecting on error. */
function call(sftp, method, ...args) {
    return new Promise((resolve, reject) => {
        sftp[method](...args, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

/* ------------------------------------------------------------------ *
 * Attribute helpers
 * ------------------------------------------------------------------ */

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

const isDirMode = (mode) => (mode & S_IFMT) === S_IFDIR;
const isLinkMode = (mode) => (mode & S_IFMT) === S_IFLNK;

/**
 * Serialise ssh2 attrs for IPC. `isDirectory()` and friends are methods, so the
 * flags have to be flattened here, since they would not survive structured cloning.
 */
function toEntry(name, attrs) {
    const mode = attrs.mode || 0;
    return {
        name,
        size: attrs.size || 0,
        mode,
        permissions: mode & 0o7777,
        isDirectory: isDirMode(mode),
        isSymlink: isLinkMode(mode),
        modifyTime: (attrs.mtime || 0) * 1000,
        accessTime: (attrs.atime || 0) * 1000,
        uid: attrs.uid ?? null,
        gid: attrs.gid ?? null,
    };
}

/* ------------------------------------------------------------------ *
 * Listing
 * ------------------------------------------------------------------ */

/**
 * Directory listing. `readdir` reports symlinks themselves, not their targets,
 * so a link to a directory would otherwise be undecidable. Each one is
 * followed here to fill in `linkTarget` and `targetIsDirectory`, which is what
 * lets the UI navigate into it.
 */
function list(tabId, remotePath) {
    return withSftp(tabId, async (sftp, resolve) => {
        let entries;
        try {
            entries = await call(sftp, 'readdir', remotePath);
        } catch (error) {
            resolve({ success: false, message: error.message });
            return;
        }

        const files = entries.map(item => toEntry(item.filename, item.attrs));

        const links = files.filter(f => f.isSymlink).slice(0, MAX_SYMLINK_RESOLVES);
        await Promise.all(links.map(async (link) => {
            const full = path.posix.join(remotePath, link.name);
            try {
                link.linkTarget = await call(sftp, 'readlink', full);
            } catch {
                // Unreadable link, so leave the target blank.
            }
            try {
                const target = await call(sftp, 'stat', full);
                link.targetIsDirectory = isDirMode(target.mode || 0);
                link.size = target.size || 0;
            } catch {
                // Broken link: it stays a symlink with no resolved target.
                link.broken = true;
            }
        }));

        resolve({ success: true, files, path: remotePath });
    });
}

function home(tabId) {
    return withSftp(tabId, (sftp, resolve) => {
        sftp.realpath('.', (err, absolutePath) => {
            if (err) resolve({ success: false, path: '/', message: err.message });
            else resolve({ success: true, path: absolutePath });
        });
    });
}

/** Resolve `~`, `..` and relative input from the path bar into a real path. */
function realpath(tabId, remotePath) {
    return withSftp(tabId, (sftp, resolve) => {
        sftp.realpath(remotePath, (err, absolutePath) => {
            if (err) resolve({ success: false, message: err.message });
            else resolve({ success: true, path: absolutePath });
        });
    });
}

function stat(tabId, remotePath, { follow = true } = {}) {
    return withSftp(tabId, (sftp, resolve) => {
        sftp[follow ? 'stat' : 'lstat'](remotePath, (err, attrs) => {
            if (err) {
                resolve({ success: false, message: err.message });
                return;
            }
            resolve({ success: true, stats: toEntry(path.posix.basename(remotePath), attrs) });
        });
    });
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

/** `mkdir -p`: walks down from the first missing ancestor. */
async function mkdirRecursive(sftp, remotePath) {
    const segments = remotePath.split('/').filter(Boolean);
    const absolute = remotePath.startsWith('/');
    let current = absolute ? '' : '.';

    for (const segment of segments) {
        current = current === '' ? `/${segment}` : `${current}/${segment}`;
        try {
            const attrs = await call(sftp, 'stat', current);
            if (!isDirMode(attrs.mode || 0)) {
                throw new Error(`${current} exists and is not a directory`);
            }
        } catch (error) {
            if (error.message.includes('is not a directory')) throw error;
            await call(sftp, 'mkdir', current);
        }
    }
}

function mkdir(tabId, remotePath) {
    return withSftp(tabId, async (sftp, resolve) => {
        try {
            await mkdirRecursive(sftp, remotePath);
            resolve({ success: true });
        } catch (error) {
            resolve({ success: false, message: error.message });
        }
    });
}

function createFile(tabId, remotePath) {
    return withSftp(tabId, async (sftp, resolve) => {
        try {
            // 'wx' fails if it already exists, so this can never blank a file.
            const handle = await call(sftp, 'open', remotePath, 'wx');
            await call(sftp, 'close', handle);
            resolve({ success: true });
        } catch (error) {
            resolve({ success: false, message: error.message });
        }
    });
}

function rename(tabId, oldPath, newPath) {
    return withSftp(tabId, async (sftp, resolve) => {
        try {
            await call(sftp, 'rename', oldPath, newPath);
            resolve({ success: true });
        } catch (error) {
            resolve({ success: false, message: error.message });
        }
    });
}

function chmod(tabId, remotePath, mode, { recursive = false } = {}) {
    return withSftp(tabId, async (sftp, resolve) => {
        try {
            if (recursive) {
                await chmodTree(sftp, remotePath, mode, 0);
            } else {
                await call(sftp, 'chmod', remotePath, mode);
            }
            resolve({ success: true });
        } catch (error) {
            resolve({ success: false, message: error.message });
        }
    });
}

async function chmodTree(sftp, remotePath, mode, depth) {
    if (depth > MAX_DEPTH) throw new Error('Directory nesting is too deep');

    const attrs = await call(sftp, 'lstat', remotePath);
    if (isLinkMode(attrs.mode || 0)) return; // Never follow links when recursing.

    await call(sftp, 'chmod', remotePath, mode);

    if (!isDirMode(attrs.mode || 0)) return;

    const entries = await call(sftp, 'readdir', remotePath);
    for (const entry of entries) {
        await chmodTree(sftp, path.posix.join(remotePath, entry.filename), mode, depth + 1);
    }
}

/**
 * Delete a path. Directories are emptied depth-first, because plain `rmdir` fails on
 * anything non-empty, which is what made the old delete silently useless.
 * Symlinks are unlinked, never followed.
 */
async function removeTree(sftp, remotePath, depth) {
    if (depth > MAX_DEPTH) throw new Error('Directory nesting is too deep');

    const attrs = await call(sftp, 'lstat', remotePath);

    if (isLinkMode(attrs.mode || 0) || !isDirMode(attrs.mode || 0)) {
        await call(sftp, 'unlink', remotePath);
        return;
    }

    const entries = await call(sftp, 'readdir', remotePath);
    for (const entry of entries) {
        await removeTree(sftp, path.posix.join(remotePath, entry.filename), depth + 1);
    }
    await call(sftp, 'rmdir', remotePath);
}

/** Delete many paths, reporting each failure instead of stopping at the first. */
function remove(tabId, remotePaths) {
    return withSftp(tabId, async (sftp, resolve) => {
        const targets = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
        const errors = [];

        for (const target of targets) {
            try {
                await removeTree(sftp, target, 0);
            } catch (error) {
                errors.push(`${path.posix.basename(target)}: ${error.message}`);
            }
        }

        resolve(errors.length
            ? { success: false, message: errors.join('; '), deleted: targets.length - errors.length }
            : { success: true, deleted: targets.length });
    });
}

/* ------------------------------------------------------------------ *
 * Remote-to-remote copy / move
 * ------------------------------------------------------------------ */

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * Copy one path server-side with `cp`, so the bytes never travel to this
 * machine. Resolves null when there is no usable exec channel, which sends the
 * caller to the streaming fallback; a string is the error `cp` reported.
 */
function execCopy(tabId, source, destination) {
    return new Promise((resolve) => {
        const client = ssh.sessions.get(tabId)?.client;
        if (!client) {
            resolve(null);
            return;
        }

        const command = `cp -a -- ${shellQuote(source)} ${shellQuote(destination)}`;

        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        // A wedged exec must not hang the copy forever.
        const timer = setTimeout(() => settle(null), 30000);

        client.exec(command, (err, stream) => {
            if (err) {
                clearTimeout(timer);
                settle(null);
                return;
            }

            let stderr = '';
            stream.stderr.on('data', (data) => { stderr += data.toString(); });
            stream.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    settle(true);
                    return;
                }
                // 127 is "command not found": the server has no `cp`, so the
                // streaming fallback is the right answer, not an error.
                settle(code === 127 ? null : (stderr.trim() || `cp exited with ${code}`));
            });
        });
    });
}

/** Free name in `dir` for `name`, appending " (2)", " (3)" … as needed. */
async function uniqueRemoteName(sftp, dir, name) {
    const extension = path.posix.extname(name);
    const stem = extension ? name.slice(0, -extension.length) : name;

    let candidate = path.posix.join(dir, name);
    for (let index = 2; index < 1000; index++) {
        try {
            await call(sftp, 'lstat', candidate);
        } catch {
            return candidate; // Nothing there, so the name is free.
        }
        candidate = path.posix.join(dir, `${stem} (${index})${extension}`);
    }
    throw new Error('Could not find a free filename');
}

/** Last resort when the server has no usable shell: pull each file through us. */
async function streamCopy(sftp, source, destination, depth) {
    if (depth > MAX_DEPTH) throw new Error('Directory nesting is too deep');

    const attrs = await call(sftp, 'lstat', source);

    if (isLinkMode(attrs.mode || 0)) {
        const target = await call(sftp, 'readlink', source);
        await call(sftp, 'symlink', target, destination);
        return;
    }

    if (isDirMode(attrs.mode || 0)) {
        await mkdirRecursive(sftp, destination);
        const entries = await call(sftp, 'readdir', source);
        for (const entry of entries) {
            await streamCopy(
                sftp,
                path.posix.join(source, entry.filename),
                path.posix.join(destination, entry.filename),
                depth + 1
            );
        }
        await call(sftp, 'chmod', destination, (attrs.mode || 0) & 0o7777).catch(() => {});
        return;
    }

    await new Promise((resolve, reject) => {
        const read = sftp.createReadStream(source);
        const write = sftp.createWriteStream(destination, { mode: (attrs.mode || 0) & 0o7777 });
        read.on('error', (error) => { write.destroy(); reject(error); });
        write.on('error', (error) => { read.destroy(); reject(error); });
        write.on('close', resolve);
        read.pipe(write);
    });
}

/**
 * Copy or move entries into a directory on the same host.
 *
 * Names that would collide are given a " (2)" suffix rather than overwriting:
 * a paste is not worth losing a file over, and it is what makes "Duplicate"
 * work when the source already sits in the destination.
 *
 * Copies go through the server's own `cp` where possible, so the bytes never
 * make the round trip to this machine; the SFTP-only fallback does.
 */
function transferRemote(tabId, sources, destinationDir, { move = false } = {}) {
    return withSftp(tabId, async (sftp, resolve) => {
        const errors = [];
        const copiedForMove = [];

        for (const source of sources) {
            const name = path.posix.basename(source);

            if (move && path.posix.dirname(source) === destinationDir) {
                continue; // Already where it is being dropped.
            }

            let destination;
            try {
                destination = await uniqueRemoteName(sftp, destinationDir, name);
            } catch (error) {
                errors.push(`${name}: ${error.message}`);
                continue;
            }

            if (move) {
                try {
                    await call(sftp, 'rename', source, destination);
                    continue;
                } catch {
                    // Cross-device, or a server without atomic rename, so fall
                    // through and copy it, then delete the original.
                }
            }

            const result = await execCopy(tabId, source, destination);

            if (result === true) {
                copiedForMove.push(source);
                continue;
            }
            if (typeof result === 'string') {
                errors.push(`${name}: ${result}`);
                continue;
            }

            try {
                await streamCopy(sftp, source, destination, 0);
                copiedForMove.push(source);
            } catch (error) {
                errors.push(`${name}: ${error.message}`);
            }
        }

        // Only originals that actually made it across are removed.
        if (move) {
            for (const source of copiedForMove) {
                try {
                    await removeTree(sftp, source, 0);
                } catch (error) {
                    errors.push(`${path.posix.basename(source)}: copied but not removed (${error.message})`);
                }
            }
        }

        resolve(errors.length ? { success: false, message: errors.join('; ') } : { success: true });
    });
}

/* ------------------------------------------------------------------ *
 * Disk usage
 * ------------------------------------------------------------------ */

/** statvfs is an OpenSSH extension; ssh2 throws outright when it is absent. */
function diskUsage(tabId, remotePath) {
    return withSftp(tabId, (sftp, resolve) => {
        try {
            sftp.ext_openssh_statvfs(remotePath, (err, fsInfo) => {
                if (err || !fsInfo) {
                    resolve({ success: false });
                    return;
                }
                const blockSize = Number(fsInfo.f_frsize || fsInfo.f_bsize || 0);
                resolve({
                    success: true,
                    total: Number(fsInfo.f_blocks || 0) * blockSize,
                    free: Number(fsInfo.f_bavail || 0) * blockSize,
                });
            });
        } catch {
            // Server does not advertise the extension.
            resolve({ success: false });
        }
    });
}

module.exports = {
    init,
    close,
    withSftp,
    call,
    list,
    home,
    realpath,
    stat,
    mkdir,
    mkdirRecursive,
    createFile,
    rename,
    chmod,
    remove,
    transferRemote,
    diskUsage,
    isDirMode,
    isLinkMode,
    toEntry,
};
