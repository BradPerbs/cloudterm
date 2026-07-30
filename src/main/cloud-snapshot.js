const { app, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const knownHosts = require('./known-hosts');
const account = require('./account');
const backup = require('./backup');
const vault = require('./vault');
const activity = require('./activity');

/**
 * The setup snapshot: this machine's saved hosts, folders, keys, snippets,
 * proxies, known hosts and terminal settings, encrypted and kept on the account
 * so signing in elsewhere reproduces it.
 *
 * What is deliberately left out: anything the CloudBlast sync already owns.
 * Those hosts and folders are rebuilt from the servers API on every device, so
 * carrying them here would be a second copy that can disagree with the first --
 * and a stale one would resurrect hosts for servers that have been deleted.
 * Everything the *user* made is in scope; everything the panel made is not.
 *
 * The blob is encrypted on this machine with AES-256-GCM, under a per-account
 * key the console issues and holds in an APP_KEY-encrypted column, so a stolen
 * database alone cannot open it.
 *
 * The key is server-issued rather than derived from a user secret, because this
 * client authenticates by OAuth and so never sees a password to derive one
 * from. Worth knowing before building on this: the threat model it covers is a
 * database breach, not a compromise of the application server.
 */

const SCHEMA_VERSION = 1;

const statePath = () => path.join(app.getPath('userData'), 'cloud-snapshot.json');

// Long enough that a burst of edits is one upload, short enough that closing
// the app right after a change usually still catches it.
const PUSH_DEBOUNCE_MS = 8000;

// Backstop for the pull side. Changes made on another device arrive within this
// even if nothing local happens to trigger a check.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

let state = null;
let pushTimer = null;
let pollTimer = null;
let busy = false;
let notify = () => {};

// Terminal settings live in the renderer's localStorage, so main cannot read
// them. The renderer hands them over whenever they change and they are cached
// here for the next push.
let rendererSettings = null;

/* ------------------------------------------------------------------ *
 * Local bookkeeping
 * ------------------------------------------------------------------ */

function load() {
    if (state) return state;

    try {
        const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
        state = {
            enabled: raw.enabled !== false,
            revision: Number(raw.revision) || 0,
            lastPushAt: raw.lastPushAt || null,
            lastPullAt: raw.lastPullAt || null,
            lastError: raw.lastError || null,
            key: raw.key ? vault.decryptSecret(raw.key) : '',
        };
    } catch {
        state = {
            enabled: true, revision: 0, lastPushAt: null, lastPullAt: null, lastError: null, key: '',
        };
    }

    return state;
}

function persist() {
    try {
        const current = load();
        fs.writeFileSync(statePath(), JSON.stringify({
            enabled: current.enabled,
            revision: current.revision,
            lastPushAt: current.lastPushAt,
            lastPullAt: current.lastPullAt,
            lastError: current.lastError,
            // The account key opens every snapshot this user has, so it is held
            // under the vault like any other credential rather than in the clear.
            key: current.key ? vault.encryptSecret(current.key) : '',
        }, null, 2), { mode: 0o600 });
    } catch (error) {
        console.error('Failed to save snapshot state:', error.message);
    }
}

vault.onUnlocked(() => { state = null; });

/* ------------------------------------------------------------------ *
 * What goes in
 * ------------------------------------------------------------------ */

/** Records the CloudBlast server sync owns, which this must not duplicate. */
const isManaged = (record) => typeof record?.id === 'string' && record.id.startsWith('cloudblast-');

/**
 * Counts, sent in the clear alongside the ciphertext.
 *
 * This is what lets an operator confirm the feature is working -- that a device
 * is saving, and roughly how much -- without anyone decrypting a snapshot to
 * find out. Deliberately only numbers: no host name, address, username or
 * anything else that would describe a customer's infrastructure.
 */
function describe(payload) {
    return {
        hosts: payload.hosts.length,
        folders: payload.folders.length,
        keys: payload.keys.length,
        snippets: payload.snippets.length,
        proxies: payload.proxies.length,
        known_hosts: Object.keys(payload.knownHosts || {}).length,
        has_settings: Boolean(payload.settings),
        app_version: app.getVersion(),
        platform: process.platform,
    };
}

function collect() {
    const everything = store.exportAll();

    return {
        version: SCHEMA_VERSION,
        capturedAt: new Date().toISOString(),
        hosts: everything.hosts.filter(host => !isManaged(host)),
        folders: everything.folders.filter(folder => !isManaged(folder) && folder.id !== 'cloudblast'),
        keys: everything.keys,
        snippets: everything.snippets,
        // Not filtered by `isManaged`: proxies are this machine's own, so there
        // is no server-owned counterpart for one to collide with.
        proxies: everything.proxies,
        knownHosts: knownHosts.exportAll(),
        settings: rendererSettings || null,
    };
}

/**
 * Fold a downloaded snapshot into this machine.
 *
 * Additive: `overwrite` is false, so a record this machine already has wins.
 * That makes a pull safe to run on launch without a prompt -- the worst it can
 * do is add something, never quietly rewrite a host that works. Two devices
 * editing the same host is the case this does not resolve, and the revision
 * guard on push is what stops that going unnoticed.
 */
function apply(payload) {
    const summary = store.importAll({
        hosts: Array.isArray(payload?.hosts) ? payload.hosts.filter(h => !isManaged(h)) : [],
        folders: Array.isArray(payload?.folders) ? payload.folders.filter(f => !isManaged(f)) : [],
        keys: payload?.keys,
        snippets: payload?.snippets,
        proxies: payload?.proxies,
    }, { overwrite: false });

    if (payload?.knownHosts) knownHosts.importAll(payload.knownHosts, { overwrite: false });

    // Handed to the renderer rather than applied here; localStorage is its own.
    if (payload?.settings) notify('cloud-snapshot-settings', payload.settings);

    return summary;
}

/* ------------------------------------------------------------------ *
 * Key
 * ------------------------------------------------------------------ */

async function ensureKey() {
    const current = load();

    if (current.key) return current.key;

    const key = await account.snapshotKey();

    if (!key) throw new Error('The console did not return an account key');

    state = { ...current, key };
    persist();

    return key;
}

/* ------------------------------------------------------------------ *
 * Push and pull
 * ------------------------------------------------------------------ */

/** Why a sync cannot run right now, or '' when it can. */
function blocked() {
    if (!load().enabled) return 'Saving your setup is turned off';
    if (!account.status().connected) return 'Not signed in to CloudBlast';
    // exportAll and importAll both refuse while locked, and a snapshot written
    // with the secrets missing would be worse than no snapshot at all.
    if (vault.isLocked()) return 'The app is locked';
    return '';
}

async function pull({ force = false } = {}) {
    const stop = blocked();
    if (stop) return { skipped: stop };
    if (busy) return { skipped: 'A sync is already running' };

    busy = true;

    try {
        return await pullLocked({ force });
    } finally {
        busy = false;
    }
}

/** The pull itself. Assumes the caller already holds `busy`. */
async function pullLocked({ force = false } = {}) {
    try {
        const meta = await account.snapshotMeta();
        const current = load();

        if (!meta.exists) return { pulled: false, reason: 'Nothing saved yet' };

        if (!force && meta.revision <= current.revision) {
            return { pulled: false, reason: 'Already up to date', revision: current.revision };
        }

        const remote = await account.snapshotGet();

        if (!remote?.payload) return { pulled: false, reason: 'Nothing saved yet' };

        const key = remote.key || await ensureKey();

        // The console stores the envelope as the opaque string it was handed,
        // so it comes back as one and has to be parsed before it is an envelope
        // again. Push serialises here, pull deserialises here; the two have to
        // stay a pair.
        let envelope;

        try {
            envelope = JSON.parse(remote.payload);
        } catch {
            throw new Error('Your saved setup could not be read and was left alone');
        }

        const payload = backup.unsealWithKey(envelope, key);

        // A null here means the key does not open the blob. Not fatal and not
        // silently ignorable either: it usually means the account key was
        // replaced, and pushing over it would destroy whatever is up there.
        if (!payload) {
            throw new Error('Your saved setup could not be decrypted with this account key');
        }

        const summary = apply(payload);

        state = {
            ...load(),
            revision: remote.revision,
            lastPullAt: new Date().toISOString(),
            lastError: null,
            key,
        };
        persist();

        const added = (summary?.hosts?.added || 0) + (summary?.keys?.added || 0)
            + (summary?.snippets?.added || 0) + (summary?.folders?.added || 0)
            + (summary?.proxies?.added || 0);

        if (added > 0) {
            activity.record({
                category: 'data',
                action: 'cloud.restore',
                outcome: 'success',
                target: 'CloudBlast setup',
                detail: `${summary.hosts?.added || 0} host(s), ${summary.keys?.added || 0} key(s) restored`,
            });
        }

        notify('cloud-snapshot-state', { ...status(), pulled: true, added });

        return { pulled: true, revision: remote.revision, added, summary };
    } catch (error) {
        state = { ...load(), lastError: error.message };
        persist();
        notify('cloud-snapshot-state', { ...status(), error: error.message });
        return { error: error.message };
    }
}

async function push() {
    const stop = blocked();
    if (stop) return { skipped: stop };
    if (busy) return { skipped: 'A sync is already running' };

    busy = true;

    try {
        return await pushLocked({ retry: true });
    } catch (error) {
        state = { ...load(), lastError: error.message };
        persist();
        notify('cloud-snapshot-state', { ...status(), error: error.message });
        return { error: error.message };
    } finally {
        busy = false;
    }
}

/**
 * The push itself. Assumes the caller already holds `busy`.
 *
 * On a conflict it merges what the other device wrote and tries once more. Only
 * once: a second conflict means something is pushing continuously, and retrying
 * again would keep losing the same race while holding the lock.
 */
async function pushLocked({ retry }) {
    const key = await ensureKey();
    const payload = collect();

    const result = await account.snapshotPut({
        payload: JSON.stringify(backup.sealWithKey(payload, key)),
        baseRevision: load().revision,
        deviceName: account.deviceName(),
        stats: describe(payload),
    });

    if (result.conflict) {
        if (!retry) return { conflict: true };

        await pullLocked({ force: true });

        return pushLocked({ retry: false });
    }

    state = {
        ...load(),
        revision: result.revision ?? load().revision + 1,
        lastPushAt: new Date().toISOString(),
        lastError: null,
    };
    persist();

    notify('cloud-snapshot-state', status());

    return { pushed: true, revision: state.revision };
}

/* ------------------------------------------------------------------ *
 * Triggers
 * ------------------------------------------------------------------ */

/**
 * Something local changed. Debounced, because editing a host fires several of
 * these and each one would otherwise be an upload of the whole setup.
 */
function schedulePush() {
    if (blocked()) return;

    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; push(); }, PUSH_DEBOUNCE_MS);
    pushTimer.unref?.();
}

/** Terminal settings, handed over by the renderer when they change. */
function setSettings(settings) {
    const next = JSON.stringify(settings ?? null);
    if (next === JSON.stringify(rendererSettings ?? null)) return;

    rendererSettings = settings ?? null;
    schedulePush();
}

function status() {
    const current = load();

    return {
        enabled: current.enabled,
        revision: current.revision,
        lastPushAt: current.lastPushAt,
        lastPullAt: current.lastPullAt,
        lastError: current.lastError,
        pending: Boolean(pushTimer),
        blocked: blocked(),
    };
}

/**
 * Forget everything tied to the account that was signed in.
 *
 * The revision and the key belong to one account, not to this machine. Left
 * behind at sign-out they would make the next account's snapshot look older
 * than what this device has already seen, and the pull that should restore it
 * would decide there was nothing to do.
 *
 * The preference itself survives: whether the user wants cloud backup is about
 * them, not about which account they were last in.
 */
function reset() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;

    state = {
        enabled: load().enabled,
        revision: 0,
        lastPushAt: null,
        lastPullAt: null,
        lastError: null,
        key: '',
    };
    persist();

    return status();
}

function setEnabled(enabled) {
    state = { ...load(), enabled: Boolean(enabled) };
    persist();

    if (state.enabled) {
        startPolling();
        pull().then(() => push());
    } else {
        stopPolling();
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = null;
    }

    return status();
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { pull(); }, POLL_INTERVAL_MS);
    pollTimer.unref?.();
}

function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
}

function start(notifier) {
    if (typeof notifier === 'function') notify = notifier;

    store.onChanged?.(schedulePush);
    knownHosts.onChanged?.(schedulePush);

    powerMonitor.on('resume', () => { if (!blocked()) pull(); });
    vault.onUnlocked(() => { if (!blocked()) pull(); });

    if (load().enabled) {
        startPolling();
        pull();
    }
}

/**
 * Flush a pending upload before the app exits, so quitting right after an edit
 * does not lose it. Best effort: the process is going away regardless.
 */
function flush() {
    if (!pushTimer) return null;

    clearTimeout(pushTimer);
    pushTimer = null;

    return push();
}

module.exports = {
    status,
    setEnabled,
    reset,
    push,
    pull,
    schedulePush,
    setSettings,
    start,
    flush,
    collect,
};
