const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { normalizeTunnels } = require('./tunnel-config');
const { normalizeSnippet, normalizeSnippets } = require('./snippet-config');
const { normalizeDesktop } = require('./desktop-config');
const { normalizeMonitor, monitorSupport, defaultCheckPort } = require('./monitor-config');
const { normalizeProxy, describeProxy, MAX_PROXY_HOPS } = require('./proxy-config');
const { normalizeTags, applyTagEdit, sameTags } = require('./host-tags');
const {
    normalizeProtocol,
    normalizeSerial,
    describeSerial,
    defaultPort,
} = require('./protocol-config');
const vault = require('./vault');
const activity = require('./activity');

const SCHEMA_VERSION = 2;

// Fields that must never be written in the clear. `vncPassword` and
// `rdpPassword` are flat rather than nested inside the `desktop` block so that
// every mechanism keyed off this list (encryption on save, the re-encrypt pass
// when the vault opens, redaction, backup export and restore) covers them
// without knowing anything about remote desktops.
//
// "Never leaves the main process" holds for all of these but `rdpPassword`,
// which is the documented exception: CredSSP runs in the WASM client, so rdp.js
// returns it once at open. It is still stored, logged and redacted like the
// rest, and never appears in a host record crossing IPC.
const SECRET_FIELDS = ['password', 'privateKey', 'passphrase', 'vncPassword', 'rdpPassword'];

/**
 * The only secret a proxy record has, named separately so a proxy is not written
 * out carrying four empty fields that belong to hosts and keys. Everything that
 * walks SECRET_FIELDS over a whole collection still covers it, because it skips
 * fields that hold nothing.
 */
const PROXY_SECRET_FIELDS = ['password'];

const ENC_PREFIX = 'enc.v1:';
const PLAIN_PREFIX = 'plain.v1:';

const storePath = () => path.join(app.getPath('userData'), 'sessions.json');
const backupPath = () => storePath() + '.bak';

let cache = null;
// Guards the re-entrancy between load(), the vault's unlock hook and this
// module's own upgrade pass.
let protecting = false;

function emptyStore() {
    return { version: SCHEMA_VERSION, hosts: [], folders: [], keys: [], snippets: [], proxies: [] };
}

/* ------------------------------------------------------------------ *
 * Secret handling
 * ------------------------------------------------------------------ */

/**
 * Secrets are written under the vault's data key, so an opening password (which
 * wraps that key) protects the file itself rather than only the window in front
 * of it. Throws when the vault is locked, because a save that quietly stored
 * nothing would look exactly like one that worked.
 */
function encryptSecret(value) {
    if (!value) return '';
    return vault.encryptSecret(value);
}

/** Pre-envelope formats: keystore-wrapped, obfuscated, or v1 plaintext. */
function decryptLegacy(stored) {
    // Peels one layer; an earlier bug could wrap a secret more than once, so
    // keep unwrapping until we reach something that is not our own ciphertext.
    let value = stored;
    for (let depth = 0; depth < 8; depth++) {
        try {
            if (value.startsWith(ENC_PREFIX)) {
                value = safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
            } else if (value.startsWith(PLAIN_PREFIX)) {
                value = Buffer.from(value.slice(PLAIN_PREFIX.length), 'base64').toString('utf8');
            } else {
                // Legacy v1 plaintext, or a fully unwrapped secret.
                return value;
            }
        } catch (error) {
            console.error('Failed to decrypt secret:', error.message);
            return '';
        }
    }
    console.error('Secret is nested deeper than expected; refusing to unwrap further');
    return '';
}

function decryptSecret(stored) {
    if (!stored) return '';

    // Nothing is handed out while locked, whatever format it is stored in. A
    // secret written before the envelope is still readable from the OS keystore
    // alone, and the whole point of the password is that reaching the keystore
    // is not enough. Those get re-encrypted the moment the vault opens.
    if (vault.isLocked()) return '';

    return vault.isVaultSecret(stored) ? vault.decryptSecret(stored) : decryptLegacy(stored);
}

/**
 * Whether stored credentials are protected by anything real. An opening
 * password counts on its own: it encrypts the data key without the OS keystore
 * being involved, which is the case on a Linux box with no keyring.
 */
function isEncryptionAvailable() {
    return vault.keystoreAvailable() || vault.isEnabled();
}

const isCiphertext = (value) =>
    typeof value === 'string'
    && (vault.isVaultSecret(value) || value.startsWith(ENC_PREFIX) || value.startsWith(PLAIN_PREFIX));

/**
 * Bring every secret under the vault key.
 *
 * Runs whenever the key becomes available. A record left in a pre-envelope
 * format would stay readable with the OS keystore alone, so a password that
 * covered everything else would not cover that one.
 */
function protectSecrets() {
    // `cache` rather than load(): asking the vault for a key runs this hook
    // again, and during the v1 migration the store is still being built.
    if (protecting || !cache) return 0;

    protecting = true;
    try {
        if (!vault.hasKey()) return 0;

        const store = cache;
        let upgraded = 0;

        for (const item of [...store.hosts, ...store.keys, ...store.proxies]) {
            for (const field of SECRET_FIELDS) {
                const value = item[field];
                if (!value || vault.isVaultSecret(value)) continue;

                const plain = decryptLegacy(value);
                item[field] = plain ? vault.encryptSecret(plain) : '';
                upgraded++;
            }
        }

        if (upgraded > 0) {
            console.log(`Re-encrypted ${upgraded} secret(s) under the vault key`);
            persist();
        }
        return upgraded;
    } catch (error) {
        console.error('Could not re-encrypt stored secrets:', error.message);
        return 0;
    } finally {
        protecting = false;
    }
}

// The key can arrive later than this module (a locked app unlocks mid-run), so
// the upgrade is driven by the vault rather than run once at startup.
vault.onUnlocked(protectSecrets);

/**
 * Apply incoming secret fields to a record.
 *   undefined / ''  -> keep whatever is already stored (edit without retyping)
 *   null            -> clear the secret
 *   non-empty       -> encrypt and replace
 *
 * `incoming` must be the caller's own object, never one already merged over
 * `existing`. Otherwise a save that omits a secret would hand us the stored
 * ciphertext and we would encrypt it a second time.
 */
function mergeSecrets(record, incoming, existing = {}, fields = SECRET_FIELDS) {
    const result = { ...record };
    for (const field of fields) {
        const value = incoming[field];
        if (value === null) {
            result[field] = '';
        } else if (value === undefined || value === '') {
            result[field] = existing[field] || '';
        } else if (isCiphertext(value)) {
            // Already encrypted (a record round-tripping through a caller);
            // storing it as-is keeps it from gaining another layer.
            result[field] = value;
        } else {
            result[field] = encryptSecret(value);
        }
    }
    return result;
}

/** Strip secrets before anything crosses the IPC boundary. */
function redactHost(host) {
    const { password, privateKey, passphrase, vncPassword, rdpPassword, ...rest } = host;
    return {
        ...rest,
        hasPassword: Boolean(password),
        hasPrivateKey: Boolean(privateKey),
        hasVncPassword: Boolean(vncPassword),
        hasRdpPassword: Boolean(rdpPassword),
    };
}

function redactKey(key) {
    const { privateKey, passphrase, ...rest } = key;
    return {
        ...rest,
        hasPrivateKey: Boolean(privateKey),
        hasPassphrase: Boolean(passphrase),
    };
}

/**
 * A proxy as the renderer may see it: normalised, and with the password replaced
 * by whether there is one. Normalised on the way out as well as in, so a record
 * written before a field existed still arrives complete at the editor.
 */
function redactProxy(proxy) {
    const { password, ...rest } = proxy;
    return { ...normalizeProxy(rest), hasPassword: Boolean(password) };
}

/** `user@address:port`, the form the activity log names a server by. */
function describeAddress(host) {
    // A serial host has no address in this sense: no user, no port number, and
    // nothing a network could route. It is named by the cable instead, in the
    // same `COM3 · 115200 8N1` form the pane header uses, so a log line still
    // says which console was reached.
    if (normalizeProtocol(host?.protocol) === 'serial') {
        return describeSerial(host?.serial);
    }

    if (!host?.host) return '';
    const standard = defaultPort(host?.protocol);
    const port = host.port || standard;
    const where = port === standard ? host.host : `${host.host}:${port}`;
    // Telnet asks for a login over the connection itself, so there is no
    // username on the record to name it by even when the device has one.
    return host.username ? `${host.username}@${where}` : where;
}

/** Enough to name a host in a log line, with no secret and no full record. */
function describeHost(hostId) {
    const host = findHost(hostId);
    if (!host) return { id: hostId, name: '', address: '' };
    return {
        id: hostId,
        name: host.name || host.host || hostId,
        address: describeAddress(host),
    };
}

/* ------------------------------------------------------------------ *
 * Disk I/O
 * ------------------------------------------------------------------ */

/** Write via temp file + fsync + rename so a crash can never truncate the store. */
function writeAtomic(file, contents) {
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
        fs.writeFileSync(fd, contents, 'utf8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, backupPath());
    }
    fs.renameSync(tmp, file);
}

/** v1 was a flat array with records discriminated by `type` / `isFolder`. */
function migrateV1(entries) {
    const migrated = emptyStore();

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;

        if (entry.type === 'folder' || entry.isFolder) {
            const { isFolder, type, ...folder } = entry;
            migrated.folders.push(folder);
        } else if (entry.type === 'keychain') {
            // v1 overwrote each key's algorithm with the 'keychain' tag; it is
            // not recoverable, so fall back to blank rather than showing it.
            migrated.keys.push({
                ...entry,
                type: '',
                privateKey: encryptSecret(entry.privateKey),
                passphrase: encryptSecret(entry.passphrase),
            });
        } else {
            const { type, ...host } = entry;
            migrated.hosts.push({
                ...host,
                password: encryptSecret(entry.password),
                privateKey: encryptSecret(entry.privateKey),
            });
        }
    }

    return migrated;
}

/** Remove exactly one layer of our own wrapping, or null if there is none. */
function peelOnce(value) {
    if (value.startsWith(ENC_PREFIX)) {
        return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
    }
    if (value.startsWith(PLAIN_PREFIX)) {
        return Buffer.from(value.slice(PLAIN_PREFIX.length), 'base64').toString('utf8');
    }
    return null;
}

/**
 * Re-wrap any secret that an earlier save encrypted more than once, so the
 * stored form is single-layered again. Returns how many were repaired.
 */
function repairNestedSecrets(store) {
    let repaired = 0;

    for (const record of [...store.hosts, ...store.keys, ...store.proxies]) {
        for (const field of SECRET_FIELDS) {
            const value = record[field];
            if (!isCiphertext(value)) continue;
            try {
                if (!isCiphertext(peelOnce(value))) continue; // already single-layered
                const plain = decryptSecret(value);
                record[field] = plain ? encryptSecret(plain) : '';
                repaired++;
            } catch (error) {
                console.error(`Could not repair ${field}:`, error.message);
            }
        }
    }

    return repaired;
}

/**
 * Build the store from disk. Never call directly: `load` holds the vault's
 * unlock hook off while this runs, so the upgrade pass cannot reach a store
 * that is still half-built.
 */
function loadFromDisk() {
    const file = storePath();
    try {
        if (!fs.existsSync(file)) {
            cache = emptyStore();
            return cache;
        }

        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (Array.isArray(parsed)) {
            console.log('Migrating sessions store from v1 to v2 (encrypting secrets)');
            fs.copyFileSync(file, file + '.v1.bak');
            cache = migrateV1(parsed);
            persist();
            return cache;
        }

        cache = {
            version: SCHEMA_VERSION,
            hosts: parsed.hosts || [],
            folders: parsed.folders || [],
            keys: parsed.keys || [],
            // Added after v2 shipped. A store written before then simply has
            // none, which needs no migration: the collection starts empty.
            snippets: parsed.snippets || [],
            proxies: parsed.proxies || [],
        };

        const repaired = repairNestedSecrets(cache);
        if (repaired > 0) {
            console.log(`Repaired ${repaired} over-encrypted secret(s)`);
            persist();
        }

        return cache;
    } catch (error) {
        console.error('Failed to load store, falling back to backup:', error.message);
        try {
            if (fs.existsSync(backupPath())) {
                // Merged over an empty store rather than used as it stands: a
                // backup written by an older build is missing whichever
                // collections were added since, and half this file spreads them
                // without checking. One collection short is a crash on load,
                // which is the worst possible moment for one.
                cache = { ...emptyStore(), ...JSON.parse(fs.readFileSync(backupPath(), 'utf8')) };
                return cache;
            }
        } catch (backupError) {
            console.error('Backup is unreadable too:', backupError.message);
        }
        cache = emptyStore();
        return cache;
    }
}

function load() {
    if (cache) return cache;

    // Asking the vault for a key runs the unlock hook, which calls back in
    // here. Held off until the store exists, then run once, deliberately.
    protecting = true;
    try {
        loadFromDisk();
    } finally {
        protecting = false;
    }

    protectSecrets();
    return cache;
}

/**
 * Notified after every successful write. The cloud snapshot uses this to know
 * it has something to upload; hooking the single place that writes is what
 * keeps it from having to be remembered at each of the two dozen call sites
 * that change something.
 */
const changeHooks = [];

function onChanged(hook) {
    changeHooks.push(hook);
}

function persist() {
    try {
        writeAtomic(storePath(), JSON.stringify(cache, null, 2));

        for (const hook of changeHooks) {
            try {
                hook();
            } catch (error) {
                // A listener must never be able to fail the write that fired it.
                console.error('Store change hook failed:', error.message);
            }
        }

        return true;
    } catch (error) {
        console.error('Failed to persist store:', error.message);
        return false;
    }
}

/* ------------------------------------------------------------------ *
 * Hosts
 * ------------------------------------------------------------------ */

function getHosts() {
    return load().hosts.map(redactHost);
}

function saveHost(host) {
    // An address dialled from a picker is not a saved record and must never
    // become one by the back door. The renderer already knows not to save it
    // back, but the call that would is the ordinary "remember when this was
    // last reached" after a successful dial, and that one is easy to reach by
    // accident. See openQuickConnect.
    if (isQuickConnectId(host?.id)) {
        const record = quickConnects.get(host.id);
        return record ? redactHost(record) : null;
    }

    const store = load();
    const id = host.id || `host-${Date.now()}`;
    const index = store.hosts.findIndex(h => h.id === id);
    const existing = index >= 0 ? store.hosts[index] : {};

    // Never trust redaction flags coming back from the renderer.
    const { hasPassword, hasPrivateKey, hasVncPassword, hasRdpPassword, ...incoming } = host;
    const record = mergeSecrets({ ...existing, ...incoming, id }, incoming, existing);

    // Tunnels carry no secrets, but they do come from the renderer and drive
    // real listening sockets. Normalise so a malformed record can never reach
    // the forwarding runtime.
    if (record.tunnels !== undefined) record.tunnels = normalizeTunnels(record.tunnels);

    // Same reasoning: the desktop block decides what address the VNC bridge
    // dials, so it is normalised before it is ever stored rather than trusted
    // at the point it is used.
    if (record.desktop !== undefined) record.desktop = normalizeDesktop(record.desktop);

    // And again for the monitor block, which decides what address a background
    // timer opens a connection to every minute. A port arriving as a string, or
    // as 0, would be a socket dialled at nothing on a schedule.
    if (record.monitor !== undefined) record.monitor = normalizeMonitor(record.monitor);

    // Tags drive nothing but the user's own filing, so this is not a guard on
    // the runtime the way the two above are. It is a guard on the tag list
    // itself: it arrives as free text from a chip field, and every page that
    // shows tags assumes "prod" is one tag rather than three spellings of it.
    if (record.tags !== undefined) record.tags = normalizeTags(record.tags);

    // Which transport this host connects over, and the settings that one needs.
    // Normalised on the way in for the same reason as the two above: the serial
    // block is handed more or less straight to a driver, so a malformed record
    // must not be able to reach it.
    //
    // A record saved before this existed has no `protocol` and normalises to
    // `ssh`, which is what it was.
    record.protocol = normalizeProtocol(record.protocol);
    if (record.serial !== undefined || record.protocol === 'serial') {
        record.serial = normalizeSerial(record.serial);
    }

    // The bastion this host is reached through, held as a reference to another
    // saved host rather than an address, so the hop is dialled with its own
    // credentials and its own host-key trust. See resolveChain.
    //
    // A host cannot be its own bastion. Longer cycles are caught at connect
    // time, where the whole chain is visible; this one is refused here because
    // it is the one the editor is capable of offering.
    if (record.jumpHostId !== undefined) {
        record.jumpHostId = String(record.jumpHostId ?? '').trim();
        if (record.jumpHostId === id) record.jumpHostId = '';
    }

    // The proxy this host is dialled through, held as a reference to a saved
    // proxy for the same reason a jump host is: the credential belongs to the
    // proxy, not to every host that happens to be reached through it.
    //
    // A serial host cannot use one. There is no socket to proxy, and leaving a
    // stale reference on the record would show a route in the editor that
    // nothing would ever take.
    if (record.proxyId !== undefined) {
        record.proxyId = String(record.proxyId ?? '').trim();
    }
    if (record.protocol === 'serial') record.proxyId = '';

    // Same tidy-up for the monitor, and it has to happen after the two fields
    // above are settled because it is decided by them. A serial console has no
    // socket to check, and a host reached through a bastion has no route from
    // this machine at all, so a check from here would report a perfectly
    // healthy host offline every minute. Cleared rather than left set: a switch
    // that reads as on while nothing ever acts on it is worse than one that
    // went off when its reason did.
    if (record.monitor?.enabled && (record.protocol === 'serial' || record.jumpHostId)) {
        record.monitor = { ...record.monitor, enabled: false };
    }

    // Written into the shell on every connect, so it is stored in the exact
    // form it will be sent: CRLF normalised, trailing blank lines dropped. The
    // newline that actually runs it is added at send time rather than stored,
    // so a record that lost its last line cannot silently stop working.
    if (record.initCommand !== undefined) {
        record.initCommand = String(record.initCommand ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\s+$/, '');
    }

    if (index >= 0) store.hosts[index] = record;
    else store.hosts.push(record);

    persist();

    // Logged from here rather than the IPC layer because this is the only place
    // that holds both sides of the edit. A save whose only difference is
    // bookkeeping (the connect timestamp, a detected OS) records nothing:
    // those are written on every dial and would bury the real edits.
    const changes = activity.diff(existing, record);
    if (index < 0 || changes.length > 0) {
        activity.record({
            category: 'data',
            action: index < 0 ? 'host.create' : 'host.update',
            target: record.name || record.host || id,
            subject: describeAddress(record),
            hostId: id,
            hostName: record.name || '',
            // A new record has no "before", so every field would read as a
            // change. Only an edit gets a diff.
            changes: index < 0 ? [] : changes,
        });
    }

    return redactHost(record);
}

function deleteHost(hostId) {
    const store = load();
    const removed = store.hosts.find(h => h.id === hostId);
    store.hosts = store.hosts.filter(h => h.id !== hostId);

    // Anything relayed through the host that just went has to stop pointing at
    // it. Left dangling it would still look connectable in the list and fail on
    // the dial, naming a bastion that no longer exists to be looked at.
    const orphaned = store.hosts.filter(h => h.jumpHostId === hostId);
    for (const host of orphaned) host.jumpHostId = '';

    persist();

    if (removed) {
        activity.record({
            category: 'data',
            action: 'host.delete',
            target: removed.name || removed.host || hostId,
            subject: describeAddress(removed),
            hostId,
            hostName: removed.name || '',
            // Worth a line: those hosts now connect directly, which is a change
            // to how they reach the network that nobody asked for explicitly.
            detail: orphaned.length
                ? `${orphaned.length} host(s) are no longer relayed through it`
                : '',
        });
    }

    return true;
}

/**
 * Copy a host, credentials and all.
 *
 * Done here rather than by saving a copy from the renderer, because the
 * renderer has never seen the secrets: a round trip through it would produce a
 * host that looks right and cannot log in. The stored ciphertext is copied
 * as-is, so nothing has to be decrypted to make the copy and a locked vault is
 * no obstacle.
 *
 * The copy deliberately does not inherit "last connected": it has not been.
 */
function duplicateHost(hostId) {
    const store = load();
    const source = store.hosts.find(h => h.id === hostId);
    if (!source) return null;

    const { lastConnectedAt, ...rest } = source;
    const record = {
        ...rest,
        id: `host-${Date.now()}`,
        name: `${source.name || 'Host'} copy`,
    };

    // Lands immediately after its original in a manual arrangement, rather than
    // at the end of a list the user has just finished ordering. The next drop
    // in that folder renumbers everything to whole positions again.
    if (Number.isFinite(source.order)) record.order = source.order + 0.5;

    store.hosts.push(record);
    persist();

    activity.record({
        category: 'data',
        action: 'host.create',
        target: record.name,
        subject: describeAddress(record),
        hostId: record.id,
        hostName: record.name,
        detail: `Duplicated from ${source.name || source.host || hostId}`,
    });

    return redactHost(record);
}

/**
 * Add and remove tags across a set of hosts in one write.
 *
 * Its own path rather than a `saveHost` per record, for the same reason
 * arranging has one: tagging is something you do to a selection, and a dozen
 * saves would be a dozen writes, a dozen log lines, and a dozen chances to
 * leave the set half-tagged if one of them threw.
 *
 * Only `tags` is read from the payload. Nothing else on the incoming ids can
 * reach a record, so this cannot carry a rename or a credential the way a full
 * save could. It is the same rule `arrangeItems` follows, and for the same
 * reason: it accepts a list straight from the renderer.
 *
 * A host whose tags the edit would not change is left untouched, so re-applying
 * a tag that is already there is not an edit and does not say it was one.
 */
function tagHosts({ hostIds = [], add = [], remove = [] } = {}) {
    const adding = normalizeTags(add);
    const removing = normalizeTags(remove);
    if (adding.length === 0 && removing.length === 0) return { changed: 0, hostIds: [] };

    const store = load();
    const wanted = new Set(Array.isArray(hostIds) ? hostIds : []);
    const touched = [];

    for (const host of store.hosts) {
        if (!wanted.has(host.id)) continue;

        const before = normalizeTags(host.tags);
        const after = applyTagEdit(before, { add: adding, remove: removing });
        if (sameTags(before, after)) continue;

        host.tags = after;
        touched.push(host);
    }

    if (touched.length === 0) return { changed: 0, hostIds: [] };

    persist();

    // One line for the whole edit rather than one per host. The detail names
    // the tags rather than counting them, because "Added prod" is the thing
    // worth reading back and there is never enough of it to fill a row.
    const detail = [
        adding.length > 0 && `Added ${adding.join(', ')}`,
        removing.length > 0 && `Removed ${removing.join(', ')}`,
    ].filter(Boolean).join(' · ');

    const single = touched.length === 1 ? touched[0] : null;

    activity.record({
        category: 'data',
        action: 'host.tag',
        target: single
            ? (single.name || single.host || single.id)
            : `${touched.length} hosts`,
        detail,
        // Only when there is one host to point at: a log row that links to a
        // host has to mean that host, not the first of twelve.
        ...(single ? { hostId: single.id, hostName: single.name || '', subject: describeAddress(single) } : {}),
    });

    return { changed: touched.length, hostIds: touched.map(host => host.id) };
}

/* ------------------------------------------------------------------ *
 * Quick connect
 * ------------------------------------------------------------------ */

/**
 * An address typed into a picker, held as a host record for as long as the app
 * is running and no longer.
 *
 * Everything downstream of the launcher works by host id: the dispatcher reads
 * the protocol by id, the connection layer resolves a chain by id, the pane
 * asks for a session by id. So an ad-hoc address becomes a record like any
 * other, and none of that has to learn a second way of being told where to go.
 * What makes it ad-hoc is only where it lives: in this map, never in `hosts`,
 * so it is not saved, not listed, not exported and not backed up.
 *
 * The login goes on the record once the user has typed it, which is what makes
 * a dropped session reconnect without stopping to ask again. It is in memory
 * and in the clear, because there is nothing on disk for it to be encrypted
 * against; it goes when the app locks, and when the app closes.
 */
const QUICK_PREFIX = 'quick-';

const quickConnects = new Map();
let quickCounter = 0;

function isQuickConnectId(hostId) {
    return String(hostId || '').startsWith(QUICK_PREFIX);
}

/**
 * The record behind an id, wherever it lives.
 *
 * Only the lookups the connection path actually goes through use this. A quick
 * connect has no folder, no tunnels and no desktop settings, so the readers for
 * those find nothing and answer with their empty case, which is the right
 * answer rather than a gap.
 */
function findHost(hostId) {
    return quickConnects.get(hostId) || load().hosts.find(h => h.id === hostId) || null;
}

/**
 * Turn a parsed address into something dialable. See src/main/address.js.
 *
 * The same address asked for twice is the same record, so a second tab to a
 * machine already reached does not ask for the login again, and both panes go
 * on sharing it the way two panes on a saved host do.
 */
function openQuickConnect(address) {
    const host = String(address?.host || '').trim();
    if (!host) return null;

    const username = String(address?.username || '').trim();
    const port = Number(address?.port) || defaultPort('ssh');
    const asked = `${username} ${host} ${port}`;

    for (const record of quickConnects.values()) {
        if (record.asked === asked) return redactHost(record);
    }

    quickCounter += 1;
    const record = {
        id: `${QUICK_PREFIX}${quickCounter}`,
        // Exactly what was typed, and what a later dial is matched against.
        // Held apart from the fields below because those fill in as the login
        // is answered, and what was asked for does not change with them.
        asked,
        // What tells the renderer not to save this back. See App.jsx.
        ephemeral: true,
        protocol: 'ssh',
        host,
        port,
        username,
        // Nothing is configured, which is exactly what an address on its own
        // means. The connection layer asks on the pane that is dialling.
        authMethod: 'password',
        password: '',
    };
    record.name = describeAddress(record);

    quickConnects.set(record.id, record);
    return redactHost(record);
}

/**
 * Keep what the user typed at the prompt, for as long as the record lives.
 *
 * Called by the connection layer once an answer has been given, so the next
 * dial on the same address has it: a link that drops and comes back should not
 * put a password box in front of someone six times on the way.
 */
function rememberQuickConnect(hostId, { username, password } = {}) {
    const record = quickConnects.get(hostId);
    if (!record) return;

    if (typeof username === 'string' && username) {
        record.username = username;
        record.name = describeAddress(record);
    }
    if (typeof password === 'string') record.password = password;
}

/**
 * Drop every ad-hoc record and the logins typed into them.
 *
 * Locking the app is meant to put the stored secrets out of reach, and a
 * password sitting on one of these would be the one it did not.
 */
function forgetQuickConnects() {
    for (const record of quickConnects.values()) record.password = '';
    quickConnects.clear();
}

/**
 * Resolve the credentials for a host at connect time. Main process only:
 * the return value must never be sent over IPC.
 */
function resolveCredentials(hostId) {
    const store = load();
    const host = findHost(hostId);
    if (!host) return null;

    const protocol = normalizeProtocol(host.protocol);

    const credentials = {
        protocol,
        host: host.host,
        port: host.port || defaultPort(protocol),
        username: host.username,
        // Not a credential either, and read only by serial.js. It is resolved
        // here rather than fetched separately so that every transport gets its
        // connect-time configuration from the same call, by host id.
        serial: normalizeSerial(host.serial),
        authMethod: host.authMethod || 'password',
        legacyAlgorithms: Boolean(host.legacyAlgorithms),
        // Blank means "auto-detect"; the connection layer resolves it.
        agentPath: host.agentPath || '',
        agentForward: Boolean(host.agentForward),
        // Not a credential, but it is connect-time host config resolved by id
        // in exactly the same way, and the shell layer already reads this object.
        initCommand: host.initCommand || '',
        // Where the socket is opened, as opposed to what is spoken over it. In
        // dial order, and every entry carries its own decrypted password.
        proxyId: '',
        proxyChain: [],
        password: '',
        privateKey: '',
        passphrase: '',
    };

    /*
     * The proxy this connection is dialled through.
     *
     * Resolved here for the same reasons the credentials are: by id, in the main
     * process, and never taken from the renderer. It is resolved before the
     * protocol check below because it applies to every transport that opens a
     * socket, not only SSH; a serial line has none to open, so it is not asked.
     *
     * A dangling reference is a failure rather than a quiet direct connection.
     * A proxy is usually the only route to the host, and where it is not, it was
     * chosen to keep the connection off the local network: falling back to
     * dialling straight out would be the one thing the setting exists to stop.
     */
    if (protocol !== 'serial' && host.proxyId) {
        const { chain, error } = resolveProxyChain(host.proxyId);
        if (error) return { ...credentials, error };
        credentials.proxyId = host.proxyId;
        credentials.proxyChain = chain;
    }

    // Only SSH authenticates from here. Telnet and serial have no client-side
    // authentication at all (a device asks for a login over the connection
    // itself, if it asks), so their records carry whatever auth settings they
    // had before the protocol was switched, and none of it is read.
    //
    // This is a guard, not a tidy-up. Without it a host switched to telnet
    // while it was set to keychain auth fails to dial with "Selected SSH key
    // not found in keychain", over a key the connection was never going to use.
    if (protocol !== 'ssh') return credentials;

    // An address typed into a picker arrives with no login on it, so the
    // connection layer does the asking: the user name before it dials, since
    // there is no handshake without one, and the password only once the server
    // has asked for it and its host key has been accepted. Cleared as soon as
    // there is a password to reuse, which is what makes the reconnect after a
    // dropped link silent. See openQuickConnect and ssh.js.
    if (host.ephemeral) credentials.promptCredentials = !host.password;

    if (credentials.authMethod === 'keychain') {
        const key = store.keys.find(k => k.id === host.keychainKeyId);
        if (!key) return { ...credentials, error: 'Selected SSH key not found in keychain' };

        // A Windows Hello key has no private half to hand over: the TPM signs,
        // and only after the person in front of the machine has proved who they
        // are. So the connection is given the credential's name and the public
        // key, and does the asking when it gets there.
        if (key.hello) {
            credentials.authMethod = 'key';
            credentials.hello = { credential: key.helloCredential, publicKey: key.publicKey };
            return credentials;
        }

        credentials.privateKey = decryptSecret(key.privateKey);
        credentials.passphrase = decryptSecret(key.passphrase);
        // A certificate is public and is carried in the clear. It rides along
        // with the key rather than being chosen per host, the same way `ssh`
        // picks up `<key>-cert.pub` on its own: a certificate belongs to the
        // key it was issued for, not to the server it is shown to.
        credentials.certificate = key.certificate || '';
        credentials.authMethod = 'key';
    } else if (credentials.authMethod === 'key') {
        credentials.privateKey = decryptSecret(host.privateKey);
        credentials.passphrase = decryptSecret(host.passphrase);
    } else if (credentials.authMethod === 'agent') {
        // The agent holds the key material; there is nothing to decrypt.
    } else if (host.ephemeral) {
        // Held in memory and in the clear: an ad-hoc record is never written,
        // so there is no stored secret here to unwrap. See openQuickConnect.
        credentials.password = String(host.password || '');
    } else {
        credentials.password = decryptSecret(host.password);
    }

    return credentials;
}

/**
 * How many servers one connection may be relayed through.
 *
 * A bound rather than a limit anybody will reach: two hops is already unusual
 * and ten is a mistake. It exists so a chain that cycle detection somehow let
 * through still ends, rather than dialling until something else gives out.
 */
const MAX_JUMP_HOPS = 10;

/**
 * Resolve every hop a host is reached through, in the order they are dialled.
 *
 * The last entry is the host itself; anything before it is a jump host, the
 * outermost first. A host with no `jumpHostId` resolves to a chain of one,
 * which is why the connection layer needs no separate path for the ordinary
 * case: it dials a list either way.
 *
 * A jump host is stored as a reference to another saved host rather than as an
 * address, and this is what that buys: each hop is resolved through the same
 * `resolveCredentials` as any other connection, so a bastion is reached with
 * its own key, its own agent, its own certificate and its own host-key trust,
 * none of which would exist if it were a `user@host:port` string on this
 * record.
 *
 * Main process only, under the same rule as resolveCredentials, and more so:
 * this holds decrypted secrets for every hop and must never cross IPC.
 */
function resolveChain(hostId) {
    const store = load();
    const fail = (error) => ({ chain: [], error });

    // Walked target-first, because that is the direction the links point, and
    // reversed at the end: a chain is dialled from the outside in.
    const ids = [];
    const seen = new Set();
    let currentId = String(hostId || '').trim();

    while (currentId) {
        if (seen.has(currentId)) {
            return fail(`${describeHost(currentId).name || 'That host'} is reached through itself`);
        }
        if (ids.length >= MAX_JUMP_HOPS) {
            return fail(`This connection is relayed through more than ${MAX_JUMP_HOPS} servers`);
        }

        const host = findHost(currentId);
        if (!host) {
            // The target's own absence is the caller's ordinary "no such host";
            // a missing hop is a dangling reference, which reads differently.
            return fail(ids.length === 0
                ? 'Host not found'
                : 'A jump host this connection is relayed through no longer exists');
        }

        seen.add(currentId);
        ids.push(currentId);
        currentId = String(host.jumpHostId || '').trim();
    }

    // A blank host id never entered the loop, so it collected nothing. Reported
    // as the missing host it is rather than returned as an empty chain, which
    // the connection layer would walk into believing it had a target.
    if (ids.length === 0) return fail('Host not found');

    ids.reverse();

    const chain = [];
    for (const [index, id] of ids.entries()) {
        const isTarget = index === ids.length - 1;
        const label = describeHost(id);

        // A relay is a channel on an SSH connection, so a hop that is not
        // itself an SSH host has nothing to open one on. Only checked for the
        // hops: what the target speaks is the dispatcher's business.
        if (!isTarget && getHostProtocol(id) !== 'ssh') {
            return fail(`${label.name} is not an SSH host, so nothing can be relayed through it`);
        }

        const credentials = resolveCredentials(id);
        if (!credentials) {
            return fail('A jump host this connection is relayed through no longer exists');
        }
        if (credentials.error) {
            // Named, because "Selected SSH key not found in keychain" about a
            // bastion the user was not thinking about is otherwise a message
            // that appears to be about the host they asked for.
            return fail(isTarget ? credentials.error : `${label.name}: ${credentials.error}`);
        }

        chain.push({ ...credentials, hostId: id, label, isTarget });
    }

    return { chain, error: '' };
}

/**
 * Which transport a host connects over.
 *
 * Separate from resolveCredentials because the dispatcher needs it before it
 * has chosen a backend, and resolving credentials to answer a question with no
 * secret in it would decrypt a private key just to read one string.
 */
function getHostProtocol(hostId) {
    const host = findHost(hostId);
    return normalizeProtocol(host?.protocol);
}

/** Port forwards configured for a host, in the shape the runtime expects. */
function getHostTunnels(hostId) {
    const host = load().hosts.find(h => h.id === hostId);
    return normalizeTunnels(host?.tunnels);
}

/**
 * Resolve a host's remote desktop settings, password included.
 *
 * Main process only, under the same rule as resolveCredentials: this return
 * value must never be sent over IPC as it stands. The VNC bridge performs the
 * RFB handshake itself precisely so that its password never has to reach the
 * renderer; the RDP bridge cannot, and forwards `password` alone. See the note
 * at the top of rdp.js.
 *
 * `password` is whichever secret belongs to the configured protocol, so callers
 * do not have to know which field it was stored in.
 */
function resolveDesktop(hostId) {
    const host = load().hosts.find(h => h.id === hostId);
    if (!host) return null;

    const desktop = desktopFor(host);

    /*
     * A desktop dialled `direct` opens its own socket, so it goes through the
     * host's proxy exactly as a shell session would. Under `tunnel` it is a
     * channel on an SSH connection that has already been made, and that
     * connection is where the proxy was applied, so the chain is left empty
     * rather than proxying something that is already inside a tunnel.
     *
     * A broken reference is reported the way resolveCredentials reports one: as
     * an error, not as a desktop that quietly reaches out on its own.
     */
    let proxyChain = [];
    let proxyError = '';
    if (desktop.transport === 'direct' && host.proxyId) {
        const resolved = resolveProxyChain(host.proxyId);
        proxyChain = resolved.chain;
        proxyError = resolved.error;
    }

    return {
        ...desktop,
        proxyChain,
        proxyError,
        password: decryptSecret(desktop.protocol === 'rdp' ? host.rdpPassword : host.vncPassword),
    };
}

/**
 * A host's desktop block, with the address filled in.
 *
 * A direct desktop that names no address means the host itself. Requiring it to
 * be typed twice would be asking for the same answer to the same question, and
 * for an RDP-only host, where the desktop *is* the connection, it would be
 * asking for it in the one place the user has no reason to look.
 *
 * Only for `direct`: under a tunnel, a blank address means the server's own
 * loopback, which is a different (and deliberate) default.
 */
function desktopFor(host) {
    const desktop = normalizeDesktop(host?.desktop);
    if (desktop.transport === 'direct' && !desktop.host && host?.host) {
        return { ...desktop, host: host.host };
    }
    return desktop;
}

/** Whether a host has a desktop configured, for the parts of the UI that only ask that. */
function getHostDesktop(hostId) {
    const host = load().hosts.find(h => h.id === hostId);
    return desktopFor(host);
}

/* ------------------------------------------------------------------ *
 * Monitoring
 * ------------------------------------------------------------------ */

/**
 * What one watched host resolves to: where to knock, and what stops it being
 * knocked on at all.
 *
 * Everything except the proxy route, which is the only expensive part and the
 * only part that carries a secret. Both readers below are built on this so that
 * the list a settings page shows and the list the poller dials cannot disagree
 * about which port a host is checked on.
 */
function monitorEntry(host) {
    const monitor = normalizeMonitor(host.monitor);
    const label = { hostId: host.id, name: host.name || host.host || host.id };

    const support = monitorSupport(host);
    if (!support.ok) {
        // Configured on, and no longer checkable: the host was switched to
        // serial, or given a jump host, after monitoring was turned on.
        return { ...label, host: '', port: 0, error: support.reason };
    }

    // A desktop-only host is named by its desktop address when it has one of
    // its own; for everything else there is one address on the record.
    const desktopOnly = Boolean(host.desktop?.enabled && host.desktop.only);
    const address = (desktopOnly ? host.desktop.host || host.host : host.host) || '';
    const port = monitor.port || defaultCheckPort(host, defaultPort(host.protocol));

    if (!port) {
        return { ...label, host: address, port: 0, error: 'There is no port to check this host on' };
    }

    return { ...label, host: address, port, error: '' };
}

/** Every host with the switch on, in the order they are stored. */
const monitoredHosts = () =>
    load().hosts.filter(host => normalizeMonitor(host.monitor).enabled);

/**
 * Every host the poller should be checking, with the address, port and proxy
 * route resolved.
 *
 * Main process only, under the same rule as resolveCredentials: a proxy chain
 * carries decrypted passwords, so this return value must never cross IPC as it
 * stands. monitor.js keeps them and sends the renderer nothing but names.
 *
 * A host whose settings cannot be resolved (a proxy that has been deleted out
 * from under it) is returned with `error` set rather than dropped. Silently not
 * checking a host that is switched on reads, from the outside, exactly like a
 * host that is up.
 */
function getMonitorTargets() {
    return monitoredHosts().map((host) => {
        const entry = { ...monitorEntry(host), proxyChain: [] };
        if (entry.error || !host.proxyId) return entry;

        // The same route the session would take. A host only reachable through
        // a proxy has to be checked through it too, or the check is answering a
        // question about a network this machine is not on.
        const { chain, error } = resolveProxyChain(host.proxyId);
        if (error) entry.error = error;
        else entry.proxyChain = chain;

        return entry;
    });
}

/**
 * The same list, named for a person rather than for a socket, and safe to send
 * over IPC: no proxy chain, so no password, so nothing to redact.
 *
 * This is what answers "which hosts am I watching", which has to be answerable
 * before any check has ever run and while monitoring is switched off entirely.
 * Deriving it from the results of the last sweep, which is the obvious thing to
 * do, means a settings page that can only tell you what it is watching after it
 * has watched something.
 *
 * Monitoring facts only: an id, a name and where the check goes. Anything about
 * how a host is *drawn* (its OS, its distro icon) is deliberately not here. The
 * renderer already holds every host record, and joining on the id there means
 * one source for what a host looks like rather than a second copy travelling
 * alongside every status update.
 */
function listMonitoredHosts() {
    return monitoredHosts().map((host) => {
        const entry = monitorEntry(host);
        return {
            hostId: entry.hostId,
            name: entry.name,
            address: entry.host ? `${entry.host}:${entry.port}` : '',
            error: entry.error,
        };
    });
}

/* ------------------------------------------------------------------ *
 * Proxies
 *
 * A collection of its own rather than an address on each host, for the same
 * reason the keychain is not a private key per host: one proxy is usually the
 * route for everything, its credential belongs to it, and changing the port it
 * listens on should not be twenty edits.
 *
 * A host points at one by id. Nothing here reads a host, and the runtime never
 * reads this collection: it is handed a resolved chain by resolveCredentials.
 * ------------------------------------------------------------------ */

function getProxies() {
    return load().proxies.map(redactProxy);
}

function saveProxy(proxy) {
    const store = load();
    const id = proxy.id || `proxy-${Date.now()}`;
    const index = store.proxies.findIndex(entry => entry.id === id);
    const existing = index >= 0 ? store.proxies[index] : {};

    // Never trust the redaction flag coming back from the renderer.
    const { hasPassword, ...incoming } = proxy;

    // Normalised before the secret is merged, so the record written is the same
    // shape the client will be handed whatever the editor sent.
    const record = mergeSecrets(
        normalizeProxy({ ...existing, ...incoming, id }),
        incoming,
        existing,
        PROXY_SECRET_FIELDS,
    );

    // A proxy cannot be reached through itself. Longer cycles are caught when
    // the chain is resolved, where the whole of it is visible; this one is
    // refused here because it is the one the editor can offer.
    if (record.viaProxyId === id) record.viaProxyId = '';

    if (index >= 0) store.proxies[index] = record;
    else store.proxies.push(record);

    persist();

    const changes = activity.diff(existing, record);
    if (index < 0 || changes.length > 0) {
        activity.record({
            category: 'data',
            action: index < 0 ? 'proxy.create' : 'proxy.update',
            target: record.name || describeProxy(record),
            subject: describeProxy(record),
            changes: index < 0 ? [] : changes,
        });
    }

    return redactProxy(record);
}

/**
 * Remove a proxy, and stop anything pointing at what is no longer there.
 *
 * Hosts left holding a dangling reference would refuse to connect rather than
 * connect directly (see resolveCredentials), which is the safe failure but a
 * confusing one. So the references are cleared here and the change is named in
 * the log: those hosts now dial straight out, which is a change to how they
 * reach the network that nobody asked for explicitly.
 */
function deleteProxy(proxyId) {
    const store = load();
    const removed = store.proxies.find(entry => entry.id === proxyId);
    if (!removed) return false;

    store.proxies = store.proxies.filter(entry => entry.id !== proxyId);

    const chained = store.proxies.filter(entry => entry.viaProxyId === proxyId);
    for (const entry of chained) entry.viaProxyId = '';

    const orphaned = store.hosts.filter(host => host.proxyId === proxyId);
    for (const host of orphaned) host.proxyId = '';

    persist();

    activity.record({
        category: 'data',
        action: 'proxy.delete',
        target: removed.name || describeProxy(removed),
        subject: describeProxy(removed),
        detail: [
            orphaned.length ? `${orphaned.length} host(s) now connect directly` : '',
            chained.length ? `${chained.length} proxy(s) are no longer chained through it` : '',
        ].filter(Boolean).join(' · '),
    });

    return true;
}

/**
 * Copy a proxy, password and all.
 *
 * Done here rather than by saving a copy from the renderer for the reason
 * duplicateHost is: the renderer has never seen the password, so a round trip
 * through it would produce a proxy that looks right and cannot authenticate.
 */
function duplicateProxy(proxyId) {
    const store = load();
    const source = store.proxies.find(entry => entry.id === proxyId);
    if (!source) return null;

    const record = {
        ...source,
        id: `proxy-${Date.now()}`,
        name: `${source.name || 'Proxy'} copy`,
    };

    store.proxies.push(record);
    persist();

    activity.record({
        category: 'data',
        action: 'proxy.create',
        target: record.name,
        subject: describeProxy(record),
        detail: `Duplicated from ${source.name || describeProxy(source)}`,
    });

    return redactProxy(record);
}

/**
 * Resolve every proxy a connection is relayed through, in the order they are
 * dialled: the first entry is reached from this machine, the last is the one
 * asked to reach the host.
 *
 * The links point the other way on the records, because `viaProxyId` says which
 * proxy *this* one is reached through, so the walk collects them innermost first
 * and reverses at the end. Same shape as resolveChain, for the same reason.
 *
 * Main process only, under the same rule as resolveCredentials: every entry
 * carries a decrypted password and must never cross IPC.
 */
function resolveProxyChain(proxyId) {
    const store = load();
    const fail = (error) => ({ chain: [], error });

    const chain = [];
    const seen = new Set();
    let currentId = String(proxyId || '').trim();

    while (currentId) {
        if (seen.has(currentId)) {
            return fail('A proxy in this route is reached through itself');
        }
        if (chain.length >= MAX_PROXY_HOPS) {
            return fail(`This connection is relayed through more than ${MAX_PROXY_HOPS} proxies`);
        }

        const record = store.proxies.find(entry => entry.id === currentId);
        if (!record) {
            return fail('A proxy this connection goes through no longer exists');
        }

        seen.add(currentId);

        const proxy = normalizeProxy(record);
        chain.push({ ...proxy, password: decryptSecret(record.password) });
        currentId = proxy.viaProxyId;
    }

    if (chain.length === 0) return fail('No proxy chosen');

    chain.reverse();
    return { chain, error: '' };
}

/**
 * The chain the Proxies page's check button should exercise.
 *
 * Two shapes, because the check has to work on a proxy that has not been saved:
 * an editor that can only test what is already stored is one that cannot help
 * you get the settings right in the first place.
 *
 *   { proxyId }   a saved record, resolved with everything it chains through
 *   { proxy }     a draft from the editor, appended to whatever its `viaProxyId`
 *                 resolves to. A blank password means "the one already stored",
 *                 which is the same rule a save follows, so testing an edit
 *                 without retyping the password works.
 */
function resolveTestChain({ proxyId, proxy } = {}) {
    if (proxyId) return resolveProxyChain(proxyId);
    if (!proxy) return { chain: [], error: 'Nothing to check' };

    const draft = normalizeProxy(proxy);

    let chain = [];
    if (draft.viaProxyId) {
        const resolved = resolveProxyChain(draft.viaProxyId);
        if (resolved.error) return resolved;
        chain = resolved.chain;
    }

    const stored = load().proxies.find(entry => entry.id === draft.id);
    const password = proxy.password || (stored ? decryptSecret(stored.password) : '');

    return { chain: [...chain, { ...draft, password }], error: '' };
}

/* ------------------------------------------------------------------ *
 * Folders
 * ------------------------------------------------------------------ */

function getFolders() {
    return load().folders;
}

function saveFolder(folder) {
    const store = load();
    const id = folder.id || `folder-${Date.now()}`;
    const index = store.folders.findIndex(f => f.id === id);
    const existing = index >= 0 ? store.folders[index] : {};
    const record = { ...existing, ...folder, id };

    if (index >= 0) store.folders[index] = record;
    else store.folders.push(record);

    persist();

    const changes = activity.diff(existing, record);
    if (index < 0 || changes.length > 0) {
        activity.record({
            category: 'data',
            action: index < 0 ? 'folder.create' : 'folder.update',
            target: record.name || id,
            changes: index < 0 ? [] : changes,
        });
    }

    return record;
}

/** Deleting a folder reparents its contents rather than destroying them. */
function deleteFolder(folderId) {
    const store = load();
    const folder = store.folders.find(f => f.id === folderId);
    if (!folder) return false;

    const parentId = folder.parentId || '';

    store.folders = store.folders
        .filter(f => f.id !== folderId)
        .map(f => (f.parentId === folderId ? { ...f, parentId } : f));

    store.hosts = store.hosts.map(h => (h.folderId === folderId ? { ...h, folderId: parentId } : h));

    persist();

    activity.record({
        category: 'data',
        action: 'folder.delete',
        target: folder.name || folderId,
        detail: 'Its contents moved up a level',
    });

    return true;
}

/* ------------------------------------------------------------------ *
 * Arranging
 *
 * Where records sit, as opposed to what they are. Dragging a card is the one
 * edit that can touch a hundred records at once (reordering a folder renumbers
 * every card in it), so it gets a path of its own rather than a hundred saves.
 * ------------------------------------------------------------------ */

/** Would filing `folderId` under `parentId` put it inside itself? */
function wouldCycle(folders, folderId, parentId) {
    const seen = new Set();
    let current = parentId || '';

    while (current) {
        if (current === folderId) return true;
        // A loop already in the file would otherwise spin here forever.
        if (seen.has(current)) return true;
        seen.add(current);
        current = folders.find(f => f.id === current)?.parentId || '';
    }

    return false;
}

/**
 * Apply a drag-and-drop rearrangement.
 *
 * Only placement is read from the payload: which folder a record belongs to,
 * and its position within it. Nothing else on the incoming objects is looked
 * at, so a rename or a credential cannot be smuggled through this path even
 * though it accepts a list of records straight from the renderer.
 */
function arrangeItems({ hosts = [], folders = [] } = {}) {
    const store = load();
    const foldersById = new Map(store.folders.map(folder => [folder.id, folder]));
    const hostsById = new Map(store.hosts.map(host => [host.id, host]));
    const moves = [];
    let changed = false;

    // Folders first: the cycle guard walks the parent chain, so it has to see
    // the tree as it will be, not as it was.
    for (const change of Array.isArray(folders) ? folders : []) {
        const record = foldersById.get(change?.id);
        if (!record) continue;

        if (change.parentId !== undefined) {
            const parentId = String(change.parentId || '');
            if (parentId && !foldersById.has(parentId)) continue;

            if (wouldCycle(store.folders, record.id, parentId)) {
                console.error(`Refusing to file folder ${record.id} inside itself`);
                continue;
            }

            if ((record.parentId || '') !== parentId) {
                moves.push({
                    action: 'folder.move',
                    target: record.name || record.id,
                    detail: parentId
                        ? `Moved into ${foldersById.get(parentId)?.name || parentId}`
                        : 'Moved to the top level',
                });
            }
            record.parentId = parentId;
        }

        if (Number.isFinite(change.order)) record.order = change.order;
        changed = true;
    }

    for (const change of Array.isArray(hosts) ? hosts : []) {
        const record = hostsById.get(change?.id);
        if (!record) continue;

        if (change.folderId !== undefined) {
            const folderId = String(change.folderId || '');
            if (folderId && !foldersById.has(folderId)) continue;

            if ((record.folderId || '') !== folderId) {
                moves.push({
                    action: 'host.move',
                    target: record.name || record.host || record.id,
                    subject: describeAddress(record),
                    hostId: record.id,
                    hostName: record.name || '',
                    detail: folderId
                        ? `Moved into ${foldersById.get(folderId)?.name || folderId}`
                        : 'Moved to the top level',
                });
            }
            record.folderId = folderId;
        }

        if (Number.isFinite(change.order)) record.order = change.order;
        changed = true;
    }

    if (!changed) return true;
    persist();

    // Only the moves are logged. A reorder is a preference about a screen, and
    // recording one line per card would bury the edits worth reading.
    for (const move of moves) activity.record({ category: 'data', ...move });

    return true;
}

/* ------------------------------------------------------------------ *
 * Keychain
 * ------------------------------------------------------------------ */

function getKeys() {
    return load().keys.map(redactKey);
}

function saveKey(key) {
    const store = load();
    const id = key.id || `key-${Date.now()}`;
    const index = store.keys.findIndex(k => k.id === id);
    const existing = index >= 0 ? store.keys[index] : {};

    // `type` stays the key algorithm (ED25519/RSA/...); records are separated
    // by collection now, so nothing needs a discriminator tag.
    const { hasPrivateKey, hasPassphrase, ...incoming } = key;
    const record = mergeSecrets({ ...existing, ...incoming, id }, incoming, existing);

    if (index >= 0) store.keys[index] = record;
    else store.keys.push(record);

    persist();

    const changes = activity.diff(existing, record);
    if (index < 0 || changes.length > 0) {
        activity.record({
            category: 'security',
            action: index < 0 ? 'key.create' : 'key.update',
            target: record.name || id,
            detail: record.type || '',
            changes: index < 0 ? [] : changes,
        });
    }

    return redactKey(record);
}

function deleteKey(keyId) {
    const store = load();
    const removed = store.keys.find(k => k.id === keyId);
    store.keys = store.keys.filter(k => k.id !== keyId);
    persist();

    if (removed) {
        activity.record({
            category: 'security',
            action: 'key.delete',
            target: removed.name || keyId,
            detail: removed.type || '',
        });
    }

    return true;
}

/* ------------------------------------------------------------------ *
 * Snippets
 *
 * Global rather than hung off a host: a snippet is a command you know, and it
 * is worth having on every box that has the tool. `hostIds` narrows one down
 * when it really is specific to a few.
 *
 * Deleting a host deliberately leaves snippets alone. An id that matches no
 * host simply never matches, so the snippet stops offering itself rather than
 * quietly widening to every host, and it is still listed in the library where
 * its scope can be seen and fixed.
 * ------------------------------------------------------------------ */

function getSnippets() {
    return normalizeSnippets(load().snippets);
}

function saveSnippet(snippet) {
    const store = load();
    const record = normalizeSnippet(snippet);
    const index = store.snippets.findIndex(entry => entry.id === record.id);
    const existing = index >= 0 ? store.snippets[index] : {};

    if (index >= 0) store.snippets[index] = record;
    else store.snippets.push(record);

    persist();

    const changes = activity.diff(existing, record);
    if (index < 0 || changes.length > 0) {
        activity.record({
            category: 'data',
            action: index < 0 ? 'snippet.create' : 'snippet.update',
            target: record.name || record.id,
            changes: index < 0 ? [] : changes,
        });
    }

    return record;
}

function deleteSnippet(snippetId) {
    const store = load();
    const removed = store.snippets.find(entry => entry.id === snippetId);
    store.snippets = store.snippets.filter(entry => entry.id !== snippetId);
    persist();

    if (removed) {
        activity.record({
            category: 'data',
            action: 'snippet.delete',
            target: removed.name || snippetId,
        });
    }

    return true;
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

/**
 * Everything worth backing up, with secrets in the clear.
 *
 * Main process only, under the same rule as resolveCredentials: the return
 * value must never cross IPC. It exists so backup.js can re-encrypt under a
 * passphrase the user chose, which is what makes the file portable: the vault
 * key is wrapped by this machine's keystore and means nothing anywhere else.
 *
 * Throws when locked rather than exporting blanks: a backup full of empty
 * passwords would look like a backup and restore as a broken setup.
 */
function exportAll() {
    if (vault.isLocked()) throw new Error('Unlock the app before exporting a backup');

    const store = load();
    const withSecrets = (record) => {
        const copy = { ...record };
        for (const field of SECRET_FIELDS) {
            copy[field] = record[field] ? decryptSecret(record[field]) : '';
        }
        return copy;
    };

    return {
        hosts: store.hosts.map(withSecrets),
        folders: store.folders.map(folder => ({ ...folder })),
        keys: store.keys.map(withSecrets),
        snippets: normalizeSnippets(store.snippets),
        // A host that connects through a proxy is not restorable without the
        // proxy, so the collection travels with the rest of the setup. Written
        // out field by field rather than through `withSecrets`, because
        // normalising drops the stored ciphertext that call would read.
        proxies: store.proxies.map(record => ({
            ...normalizeProxy(record),
            password: record.password ? decryptSecret(record.password) : '',
        })),
    };
}

/**
 * Upsert by id. Records already present are skipped unless `overwrite`, so
 * restoring onto a machine that already has hosts is additive by default and
 * cannot quietly undo local edits.
 */
function mergeCollection(existing, incoming, { overwrite, prepare }) {
    const result = { added: 0, replaced: 0, skipped: 0 };

    for (const raw of Array.isArray(incoming) ? incoming : []) {
        let record;
        try {
            record = prepare(raw);
        } catch (error) {
            console.error('Skipping an unreadable backup record:', error.message);
            result.skipped++;
            continue;
        }
        if (!record?.id) {
            result.skipped++;
            continue;
        }

        const index = existing.findIndex(entry => entry.id === record.id);
        if (index < 0) {
            existing.push(record);
            result.added++;
        } else if (overwrite) {
            existing[index] = record;
            result.replaced++;
        } else {
            result.skipped++;
        }
    }

    return result;
}

/**
 * Bring a decrypted backup payload into the store, encrypting its secrets under
 * the local vault key on the way in.
 *
 * Secrets are encrypted explicitly here rather than through mergeSecrets, whose
 * "does this already look like ciphertext" heuristic is right for a record
 * round-tripping through the renderer and wrong for a restore: a password that
 * genuinely began with `v2:` would be stored unencrypted.
 */
function importAll(payload, { overwrite = false } = {}) {
    if (vault.isLocked()) throw new Error('Unlock the app before restoring a backup');

    const store = load();

    const prepareSecrets = (raw, fields = SECRET_FIELDS) => {
        const { hasPassword, hasPrivateKey, hasPassphrase, hasVncPassword, ...rest } = raw || {};
        const record = { ...rest };
        for (const field of fields) {
            record[field] = raw?.[field] ? encryptSecret(raw[field]) : '';
        }
        return record;
    };

    const summary = {
        hosts: mergeCollection(store.hosts, payload?.hosts, {
            overwrite,
            prepare: (raw) => {
                const record = prepareSecrets(raw);
                // Same normalisation a saved host gets: these drive real
                // listening sockets and must not reach the runtime malformed.
                if (record.tunnels !== undefined) record.tunnels = normalizeTunnels(record.tunnels);
                if (record.desktop !== undefined) record.desktop = normalizeDesktop(record.desktop);
                if (record.monitor !== undefined) record.monitor = normalizeMonitor(record.monitor);
                // A backup is a file a person can edit, so the tag list arrives
                // as untrusted as one from the editor does.
                if (record.tags !== undefined) record.tags = normalizeTags(record.tags);
                return record;
            },
        }),
        folders: mergeCollection(store.folders, payload?.folders, {
            overwrite,
            prepare: (raw) => ({ ...raw }),
        }),
        keys: mergeCollection(store.keys, payload?.keys, {
            overwrite,
            prepare: prepareSecrets,
        }),
        snippets: mergeCollection(store.snippets, payload?.snippets, {
            overwrite,
            prepare: normalizeSnippet,
        }),
        // Normalised on the way in like the tunnel and desktop blocks are, and
        // for the same reason: a backup is a file a person can edit, and these
        // records decide where a socket is opened.
        proxies: mergeCollection(store.proxies, payload?.proxies, {
            overwrite,
            prepare: (raw) => {
                const record = prepareSecrets(raw, PROXY_SECRET_FIELDS);
                return { ...normalizeProxy(record), password: record.password };
            },
        }),
    };

    persist();
    return summary;
}

/** How a payload would land, without changing anything. */
function previewImport(payload) {
    const store = load();
    const count = (incoming, existing) => {
        const ids = new Set(existing.map(entry => entry.id));
        let fresh = 0;
        let conflicting = 0;
        for (const record of Array.isArray(incoming) ? incoming : []) {
            if (record?.id && ids.has(record.id)) conflicting++;
            else fresh++;
        }
        return { total: fresh + conflicting, new: fresh, existing: conflicting };
    };

    return {
        hosts: count(payload?.hosts, store.hosts),
        folders: count(payload?.folders, store.folders),
        keys: count(payload?.keys, store.keys),
        snippets: count(payload?.snippets, store.snippets),
        proxies: count(payload?.proxies, store.proxies),
    };
}

module.exports = {
    load,
    isEncryptionAvailable,
    onChanged,
    exportAll,
    importAll,
    previewImport,
    getHosts,
    saveHost,
    deleteHost,
    duplicateHost,
    tagHosts,
    describeHost,
    openQuickConnect,
    rememberQuickConnect,
    forgetQuickConnects,
    resolveCredentials,
    resolveChain,
    MAX_JUMP_HOPS,
    getHostProtocol,
    getHostTunnels,
    resolveDesktop,
    getHostDesktop,
    getMonitorTargets,
    listMonitoredHosts,
    getProxies,
    saveProxy,
    deleteProxy,
    duplicateProxy,
    resolveProxyChain,
    resolveTestChain,
    getFolders,
    saveFolder,
    deleteFolder,
    arrangeItems,
    getKeys,
    saveKey,
    deleteKey,
    getSnippets,
    saveSnippet,
    deleteSnippet,
};
