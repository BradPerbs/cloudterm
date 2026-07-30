const { app, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const account = require('./account');
const vault = require('./vault');
const activity = require('./activity');
const { classifyTemplateName } = require('./os-detect');
const { DEFAULT_RDP_PORT } = require('./desktop-config');

/**
 * Keeping the host list in step with the servers on a CloudBlast account.
 *
 * The division of ownership is the whole design, and it is deliberate:
 *
 *   CloudBlast owns identity -- what a server is called and where it lives.
 *   Those are refreshed on every sync, because the panel is the authority and
 *   a renamed or re-addressed server should follow.
 *
 *   The user owns access -- how they connect. Auth method, port, username and
 *   any key they picked are written once when the host first appears and never
 *   touched again. Someone who switches a synced host to key auth should not
 *   find it back on password auth fifteen minutes later.
 *
 * Hosts are keyed by the server's uuid, so a sync is an upsert rather than an
 * import: running it twice produces one host, not two.
 */

const FOLDER_ID = 'cloudblast';
const FOLDER_NAME = 'CloudBlast';

/** Stable and derived from the server, which is what makes re-sync idempotent. */
const hostIdFor = (uuid) => `cloudblast-${uuid}`;

const INTERVAL_MS = 15 * 60 * 1000;

// Enough to keep a sync brief without opening a connection per server on an
// account with a lot of them.
const CREDENTIAL_CONCURRENCY = 4;

const statePath = () => path.join(app.getPath('userData'), 'server-sync.json');

let state = null;
let timer = null;
let running = false;
let notify = () => {};

/* ------------------------------------------------------------------ *
 * Preference
 * ------------------------------------------------------------------ */

function load() {
    if (state) return state;

    try {
        const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
        state = {
            enabled: Boolean(raw.enabled),
            lastSyncAt: raw.lastSyncAt || null,
            lastResult: raw.lastResult || null,
        };
    } catch {
        state = { enabled: false, lastSyncAt: null, lastResult: null };
    }

    return state;
}

function persist() {
    try {
        fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Failed to save the sync preference:', error.message);
    }
}

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

/**
 * The address to dial. IPv4 first because it is what an SSH client reaches on
 * every network; IPv6 only if that is all the server has.
 */
function addressFor(server, credentials) {
    const addresses = Array.isArray(server.ip_addresses) ? server.ip_addresses : [];

    const v4 = addresses.find(ip => ip?.type === 'ipv4')?.address || credentials?.ipv4 || '';
    if (v4) return v4;

    return addresses.find(ip => ip?.type === 'ipv6')?.address || credentials?.ipv6 || '';
}

/**
 * What the host is called. The panel's hostname is the name the user gave the
 * machine, so it is the one they will look for in the sidebar; `name` and the
 * short uuid are fallbacks for a server that has not got one.
 */
const labelFor = (server) =>
    server.hostname || server.name || server.uuid_short || server.uuid || 'CloudBlast server';

/**
 * The os/distro to write for a server, or null to leave the host's alone.
 *
 * The panel knows what template a server was built from, which is how a host
 * gets its icon the moment it appears rather than after the first successful
 * connection -- and it is the only way a powered-off server ever gets one.
 *
 * But a template name is a weaker claim than looking at the running machine.
 * Someone who installed something else over the image would see the icon
 * revert on the next sync, so once a session has reported an OS, the template
 * only overrides it when the panel's own answer has changed -- a rebuild onto
 * a different image, which is exactly when the icon should follow.
 */
function osFor(server, existing) {
    const reported = server.os || '';
    const classified = classifyTemplateName(reported, server.os_version);

    if (!classified.os) return null;

    if (!existing?.os) return classified;

    // Same template as last time: whatever the host has now is at least as
    // good, and probably came from the server itself.
    if ((existing.cloudblast?.os || '') === reported) return null;

    return classified;
}

/**
 * The remote desktop block for a synced server, or null to leave whatever is
 * already there alone.
 *
 * A Windows server is an RDP machine. The panel says which servers those are
 * before anything has ever connected to one, so there is no reason to make
 * someone discover it: the host arrives configured for the protocol it actually
 * speaks, reaching the machine directly, and not pretending to be an SSH
 * session it has no server for.
 *
 * Three cases, and the last one is the important one:
 *
 *   never set up   configure it, once. Recorded in `cloudblast.desktopSetup`
 *                  so that turning the desktop off afterwards stays off rather
 *                  than being switched back on by the next sync.
 *   RDP tunnelled  repaired whatever the flag says, because it cannot work:
 *                  a tunnelled desktop rides this host's SSH connection, and
 *                  that is the one thing a Windows box has not got.
 *   anything else  the user's arrangement, and left as it is.
 */
function remoteDesktopFor(detected, existing, creds) {
    // `detected` is null when the template said nothing new, which is the
    // normal case for a host that already knows what it is.
    const os = detected?.os || existing?.os;
    if (os !== 'windows') return null;

    const current = existing?.desktop;
    const username = current?.username || creds?.username || 'Administrator';

    const base = {
        enabled: true,
        protocol: 'rdp',
        transport: 'direct',
        // The point of the whole thing: no SSH session is opened, and the pane
        // goes straight to the desktop.
        only: true,
        port: DEFAULT_RDP_PORT,
        username,
    };

    if (!existing?.cloudblast?.desktopSetup && !current?.enabled) return base;

    if (current?.protocol === 'rdp' && current.transport === 'tunnel') {
        return {
            // Their scaling, quality and the rest are kept.
            ...current,
            ...base,
            port: current.port || DEFAULT_RDP_PORT,
            // Emphatically not kept: under a tunnel a blank address means the
            // server's own loopback, and it is stored as 127.0.0.1. Carried
            // into a direct dial that would point at this machine.
            host: '',
        };
    }

    return null;
}

/* ------------------------------------------------------------------ *
 * Syncing
 * ------------------------------------------------------------------ */

/** Runs `task` over `items`, at most `limit` at a time. */
async function pooled(items, limit, task) {
    const results = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await task(items[index]);
        }
    });

    await Promise.all(workers);

    return results;
}

function ensureRootFolder() {
    const existing = store.getFolders().find(folder => folder.id === FOLDER_ID);
    if (existing) return;

    store.saveFolder({ id: FOLDER_ID, name: FOLDER_NAME, parentId: '' });
}

/**
 * The project a server belongs to, as `{ id, name }`, or null for one sitting
 * loose at the top of the account.
 *
 * CloudBlast calls these projects and keeps them flat, so they become one level
 * of folders inside the CloudBlast folder rather than an arbitrary tree. The
 * array form is tolerated because folders_servers is a many-to-many table even
 * though the panel only ever writes one row per server.
 */
function projectFor(server) {
    const folder = server.folder
        || (Array.isArray(server.folders) ? server.folders[0] : null);

    if (!folder || folder.id === undefined || folder.id === null) return null;

    return {
        id: String(folder.id),
        name: String(folder.name || '').trim() || `Project ${folder.id}`,
    };
}

/** Namespaced so pruning can recognise its own folders and nothing else. */
const folderIdFor = (projectId) => `cloudblast-folder-${projectId}`;

/**
 * Mirror the account's projects as folders under the CloudBlast folder, and
 * return them keyed by project id.
 */
function syncFolders(servers) {
    const projects = new Map();

    for (const server of servers) {
        const project = projectFor(server);
        if (project) projects.set(project.id, project);
    }

    for (const project of projects.values()) {
        store.saveFolder({
            id: folderIdFor(project.id),
            name: project.name,
            parentId: FOLDER_ID,
        });
    }

    return projects;
}

/**
 * Drop folders for projects that no longer exist.
 *
 * Runs after the hosts have been placed, so anything still inside is a host
 * this sync did not claim; deleteFolder reparents those up to the CloudBlast
 * folder rather than deleting them, which is the right outcome for a host the
 * user moved in here by hand.
 */
function pruneFolders(projects) {
    const live = new Set([...projects.keys()].map(folderIdFor));
    let removed = 0;

    for (const folder of store.getFolders()) {
        if (!folder.id.startsWith('cloudblast-folder-') || live.has(folder.id)) continue;
        store.deleteFolder(folder.id);
        removed += 1;
    }

    return removed;
}

/**
 * Pull the account's servers and reconcile them against the host list.
 *
 * Returns a report rather than throwing for the ordinary "cannot right now"
 * cases -- signed out, locked, offline. A background timer that threw every
 * fifteen minutes because the laptop is on a train would be noise, not news.
 */
async function sync({ manual = false } = {}) {
    if (running) return { skipped: 'A sync is already running' };

    const connection = account.status();

    if (!connection.connected) return { skipped: 'Not signed in to CloudBlast' };

    // Credentials are written under the vault key, so a locked vault cannot
    // take a sync. Skipping is correct: the alternative is writing hosts with
    // their passwords silently dropped.
    if (vault.isLocked()) return { skipped: 'The app is locked' };

    running = true;

    try {
        const servers = await account.servers();

        const wanted = servers.filter(server => server?.uuid);

        // Fetched per server, so one server whose credentials are unavailable
        // does not cost the whole sync.
        const credentials = await pooled(wanted, CREDENTIAL_CONCURRENCY, async (server) => {
            try {
                return await account.credentials(server.uuid);
            } catch {
                return null;
            }
        });

        let projects = new Map();

        if (wanted.length > 0) {
            ensureRootFolder();
            projects = syncFolders(wanted);
        }

        const existingById = new Map(store.getHosts().map(host => [host.id, host]));

        let added = 0;
        let updated = 0;

        wanted.forEach((server, index) => {
            const id = hostIdFor(server.uuid);
            const existing = existingById.get(id);
            const creds = credentials[index];
            const address = addressFor(server, creds);

            // Nothing to dial. Leaving the previous address in place beats
            // replacing it with an empty string on a transient API hiccup.
            if (!address && !existing) return;

            const detected = osFor(server, existing);
            const project = projectFor(server);
            const desktop = remoteDesktopFor(detected, existing, creds);

            const record = {
                id,
                name: labelFor(server),
                ...(address ? { host: address } : {}),
                ...(detected ? { os: detected.os, distro: detected.distro } : {}),

                // Where a server lives is the panel's to decide, on every sync
                // rather than only at creation: moving a server between projects
                // there is exactly the change that should show up here.
                folderId: project ? folderIdFor(project.id) : FOLDER_ID,

                cloudblast: {
                    uuid: server.uuid,
                    serverId: server.id ?? null,
                    status: server.status || '',
                    // Kept so the next sync can tell a rebuild onto a new image
                    // apart from the same image reported again.
                    os: server.os || '',
                    // Sticky: once a desktop has been set up for this server,
                    // later syncs stop having an opinion about whether it is on.
                    desktopSetup: Boolean(existing?.cloudblast?.desktopSetup || desktop),
                    syncedAt: new Date().toISOString(),
                },
            };

            if (desktop) {
                record.desktop = desktop;

                // The panel's password is the machine's, so it is the one RDP
                // needs. Stored under its own field: `password` is the SSH
                // credential and a desktop-only host never spends it.
                if (creds?.password && creds.passwordStatus === 'ready') {
                    record.rdpPassword = creds.password;
                }
            }

            // Only meaningful when the password actually exists. A server still
            // installing reports 'generating' and has none yet; sending '' here
            // would be read by mergeSecrets as "keep what you have", which is
            // what we want, but being explicit keeps that from being accidental.
            if (creds?.password && creds.passwordStatus === 'ready') {
                record.password = creds.password;
            }

            if (!existing) {
                // How to connect is set once, at creation, and is the user's
                // from then on.
                record.port = 22;
                record.username = creds?.username || 'root';
                record.authMethod = 'password';
                added += 1;
            } else {
                updated += 1;
            }

            store.saveHost(record);
        });

        // Anything this module created for a server that is no longer on the
        // account. Scoped to the id prefix so a host the user made by hand is
        // never in scope, however it is named or wherever it sits.
        const live = new Set(wanted.map(server => hostIdFor(server.uuid)));
        let removed = 0;

        for (const host of existingById.values()) {
            if (!host.id.startsWith('cloudblast-') || live.has(host.id)) continue;
            store.deleteHost(host.id);
            removed += 1;
        }

        // After the hosts have been placed, so a folder is only judged empty
        // once this sync has finished moving things into it.
        const foldersRemoved = wanted.length > 0 ? pruneFolders(projects) : 0;

        const report = {
            added,
            updated,
            removed,
            total: wanted.length,
            projects: projects.size,
            foldersRemoved,
        };

        state = { ...load(), lastSyncAt: new Date().toISOString(), lastResult: report };
        persist();

        if (added > 0 || removed > 0 || manual) {
            activity.record({
                category: 'data',
                action: 'cloudblast.sync',
                outcome: 'success',
                target: 'CloudBlast servers',
                detail: `${added} added, ${updated} updated, ${removed} removed`,
            });
        }

        notify('server-sync-state', { ...status(), report });

        return report;
    } catch (error) {
        const report = { error: error.message };

        state = { ...load(), lastSyncAt: new Date().toISOString(), lastResult: report };
        persist();

        activity.record({
            category: 'data',
            action: 'cloudblast.sync',
            outcome: 'failure',
            target: 'CloudBlast servers',
            message: error.message,
        });

        notify('server-sync-state', { ...status(), report });

        return report;
    } finally {
        running = false;
    }
}

/* ------------------------------------------------------------------ *
 * Schedule
 * ------------------------------------------------------------------ */

function startTimer() {
    stopTimer();
    timer = setInterval(() => { sync(); }, INTERVAL_MS);
    // Nothing here should hold the process open on its own.
    timer.unref?.();
}

function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
}

function status() {
    const current = load();

    return {
        enabled: current.enabled,
        lastSyncAt: current.lastSyncAt,
        lastResult: current.lastResult,
        running,
        intervalMinutes: INTERVAL_MS / 60000,
    };
}

function setEnabled(enabled) {
    state = { ...load(), enabled: Boolean(enabled) };
    persist();

    if (state.enabled) {
        startTimer();
        // Turning it on should do something visible, not wait a quarter hour.
        sync();
    } else {
        stopTimer();
    }

    return status();
}

/**
 * Called once the app is ready. A sync on launch is the point of the setting:
 * servers created in the panel since the app was last open are there when it
 * opens, without anyone asking for them.
 */
function start(notifier) {
    if (typeof notifier === 'function') notify = notifier;

    // A sleeping laptop misses every interval it was due. Resuming is the one
    // moment the host list is most likely to be stale.
    powerMonitor.on('resume', () => {
        if (load().enabled) sync();
    });

    // The vault gates writing credentials, so a sync that was skipped for a
    // locked app is worth retrying the moment it is unlocked.
    vault.onUnlocked(() => {
        if (load().enabled) sync();
    });

    if (!load().enabled) return;

    startTimer();
    sync();
}

function stop() {
    stopTimer();
}

module.exports = {
    status,
    setEnabled,
    sync,
    start,
    stop,
    FOLDER_ID,
    hostIdFor,
    // Exported for the tests: the rules for what a Windows server is set up as
    // are worth pinning down without standing up a whole sync.
    remoteDesktopFor,
};
