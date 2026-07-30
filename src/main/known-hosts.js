const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const activity = require('./activity');

const filePath = () => path.join(app.getPath('userData'), 'known_hosts.json');

let cache = null;

function load() {
    if (cache) return cache;
    try {
        if (fs.existsSync(filePath())) {
            cache = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        } else {
            cache = {};
        }
    } catch (error) {
        console.error('Failed to load known_hosts:', error.message);
        cache = {};
    }
    return cache;
}

function persist() {
    const file = filePath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify(cache, null, 2), 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);

        for (const hook of changeHooks) {
            try {
                hook();
            } catch (hookError) {
                // A listener must never be able to fail the write that fired it.
                console.error('Known-hosts change hook failed:', hookError.message);
            }
        }
    } catch (error) {
        console.error('Failed to persist known_hosts:', error.message);
    }
}

/** Notified after every successful write; see store.onChanged. */
const changeHooks = [];

function onChanged(hook) {
    changeHooks.push(hook);
}

const hostId = (host, port) => `${host}:${port || 22}`;

/**
 * Split a stored key back into host and port. Split on the *last* colon, so a
 * bare IPv6 literal like `::1:22` still yields `::1` rather than losing its
 * address to the first separator.
 */
function parseId(id) {
    const index = String(id).lastIndexOf(':');
    if (index <= 0) return { host: String(id), port: 22 };

    const port = Number(id.slice(index + 1));
    if (!Number.isInteger(port) || port <= 0) return { host: String(id), port: 22 };

    return { host: id.slice(0, index), port };
}

/** OpenSSH-style SHA256 fingerprint of a public key blob. */
function fingerprint(keyBuffer) {
    return 'SHA256:' + crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
}

/** SSH wire format: uint32 length, then the algorithm name. */
function keyType(keyBuffer) {
    if (!Buffer.isBuffer(keyBuffer) || keyBuffer.length < 4) return 'unknown';
    const length = keyBuffer.readUInt32BE(0);
    if (length > 64 || keyBuffer.length < 4 + length) return 'unknown';
    return keyBuffer.slice(4, 4 + length).toString('ascii');
}

/**
 * Compare a presented key against what we have on record.
 * Returns 'match' | 'unknown' | 'changed'.
 */
function check(host, port, keyBuffer) {
    const entries = load()[hostId(host, port)];
    if (!entries || entries.length === 0) return 'unknown';

    const presented = fingerprint(keyBuffer);
    const type = keyType(keyBuffer);

    if (entries.some(e => e.fingerprint === presented)) return 'match';
    // A key of a type we have never seen for this host is a first sighting,
    // not a mismatch (servers legitimately offer ed25519 and rsa).
    if (!entries.some(e => e.keyType === type)) return 'unknown';
    return 'changed';
}

function trust(host, port, keyBuffer, { replace = false } = {}) {
    const store = load();
    const id = hostId(host, port);
    const entry = {
        keyType: keyType(keyBuffer),
        fingerprint: fingerprint(keyBuffer),
        addedAt: new Date().toISOString(),
    };

    if (replace) {
        store[id] = (store[id] || []).filter(e => e.keyType !== entry.keyType);
    }
    store[id] = [...(store[id] || []), entry];
    persist();
    return entry;
}

function forget(host, port) {
    return forgetById(hostId(host, port));
}

/** Forget by stored key, so the caller never has to reassemble host and port. */
function forgetById(id) {
    const store = load();
    if (!(id in store)) return false;
    delete store[id];
    persist();
    return true;
}

/** Forget a single key for a host, leaving its other key types trusted. */
function forgetFingerprint(id, fingerprint) {
    const store = load();
    const entries = store[id];
    if (!entries) return false;

    const remaining = entries.filter(entry => entry.fingerprint !== fingerprint);
    if (remaining.length === entries.length) return false;

    if (remaining.length === 0) delete store[id];
    else store[id] = remaining;

    persist();
    return true;
}

/** Numeric-aware so `server2` sorts before `server10`, as people expect. */
const compareHosts = (a, b) =>
    a.host.localeCompare(b.host, undefined, { numeric: true, sensitivity: 'base' })
    || a.port - b.port;

function list() {
    const store = load();
    return Object.entries(store)
        .map(([id, entries]) => ({ id, ...parseId(id), entries: entries || [] }))
        .sort(compareHosts);
}

/**
 * Build an ssh2 `hostVerifier`. Unknown or changed keys are escalated to the
 * user through `requestTrust`; nothing is sent to the server until it resolves.
 */
function createHostVerifier({ host, port, requestTrust }) {
    return (keyBuffer, callback) => {
        let status;
        try {
            status = check(host, port, keyBuffer);
        } catch (error) {
            console.error('Host key check failed:', error.message);
            return callback(false);
        }

        if (status === 'match') return callback(true);

        const details = {
            host,
            port: port || 22,
            status,
            keyType: keyType(keyBuffer),
            fingerprint: fingerprint(keyBuffer),
        };

        Promise.resolve(requestTrust(details))
            .then((accepted) => {
                // A key decision is the security event worth having a record of:
                // accepting a *changed* key is the one that matters, and a
                // refusal is worth as much as an acceptance.
                activity.record({
                    category: 'security',
                    action: accepted
                        ? (status === 'changed' ? 'hostkey.replace' : 'hostkey.trust')
                        : 'hostkey.reject',
                    outcome: accepted && status === 'changed' ? 'warning' : 'info',
                    target: `${host}:${port || 22}`,
                    subject: details.fingerprint,
                    detail: status === 'changed'
                        ? `${details.keyType} key had changed since it was last trusted`
                        : `${details.keyType} key seen for the first time`,
                });

                if (!accepted) return callback(false);
                trust(host, port, keyBuffer, { replace: status === 'changed' });
                callback(true);
            })
            .catch((error) => {
                console.error('Host key prompt failed:', error.message);
                callback(false);
            });
    };
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

/** The trusted-key map, copied so a caller cannot mutate the live cache. */
function exportAll() {
    const store = load();
    return Object.fromEntries(
        Object.entries(store).map(([id, entries]) => [id, (entries || []).map(e => ({ ...e }))])
    );
}

/**
 * Merge trusted keys from a backup.
 *
 * Additive and deduplicated by fingerprint: restoring never drops a key this
 * machine already trusts, so a server whose key legitimately rotated since the
 * backup keeps working. A key in the backup that this machine does not have is
 * added, which is the point: it is why a restored setup connects without
 * re-prompting for every host.
 *
 * Note this can leave two fingerprints trusted for one host+type, which is the
 * same state a server mid key-rotation produces. The count of those is reported
 * so the restore summary can say so rather than leaving it invisible.
 */
function importAll(incoming, { overwrite = false } = {}) {
    const store = load();
    const result = { hosts: 0, keys: 0, duplicateTypes: 0 };

    for (const [id, entries] of Object.entries(incoming || {})) {
        if (!Array.isArray(entries) || entries.length === 0) continue;

        const valid = entries.filter(entry => entry?.fingerprint && entry?.keyType);
        if (valid.length === 0) continue;

        if (overwrite || !store[id]) {
            if (!store[id]) result.hosts++;
            store[id] = valid.map(entry => ({ ...entry }));
            result.keys += valid.length;
            continue;
        }

        const known = new Set(store[id].map(entry => entry.fingerprint));
        for (const entry of valid) {
            if (known.has(entry.fingerprint)) continue;
            if (store[id].some(existing => existing.keyType === entry.keyType)) {
                result.duplicateTypes++;
            }
            store[id].push({ ...entry });
            known.add(entry.fingerprint);
            result.keys++;
        }
    }

    persist();
    return result;
}

module.exports = {
    check,
    trust,
    onChanged,
    exportAll,
    importAll,
    forget,
    forgetById,
    forgetFingerprint,
    list,
    fingerprint,
    keyType,
    createHostVerifier,
};
