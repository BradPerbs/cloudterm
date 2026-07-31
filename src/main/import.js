const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');
const knownHosts = require('./known-hosts');
const sshConfig = require('./ssh-config');
const common = require('./import-common');
const puttyImport = require('./putty-import');
const mobaxtermImport = require('./mobaxterm-import');

/**
 * Bring an existing setup into the app.
 *
 * This file owns the OpenSSH side (`~/.ssh/config` becomes hosts with their
 * port forwards, `~/.ssh/known_hosts` becomes trusted keys) and dispatches
 * the other sources: PuTTY and KiTTY (putty-import.js) and MobaXterm
 * (mobaxterm-import.js). One `source` field on scan and apply picks which.
 *
 * Scanning and applying both read from disk (or the registry). The renderer
 * only ever sends back *which* entries to take, never the entries themselves,
 * so no host key blob or private key round-trips through it, and a
 * compromised renderer cannot talk the main process into trusting a key that
 * is not in the file.
 */

const sshDir = () => path.join(os.homedir(), '.ssh');

function defaultPaths() {
    const directory = sshDir();
    const configPath = path.join(directory, 'config');
    const knownHostsPath = path.join(directory, 'known_hosts');

    return {
        sshDir: directory,
        configPath,
        knownHostsPath,
        hasConfig: fs.existsSync(configPath),
        hasKnownHosts: fs.existsSync(knownHostsPath),
    };
}

/* ------------------------------------------------------------------ *
 * known_hosts
 * ------------------------------------------------------------------ */

/** `[host]:port` for anything off port 22, a bare name otherwise. */
function splitHostSpec(spec) {
    const bracketed = spec.match(/^\[(.+)\]:(\d+)$/);
    if (bracketed) return { host: bracketed[1], port: Number(bracketed[2]) };
    return { host: spec, port: 22 };
}

/**
 * Parse an OpenSSH known_hosts file into entries this app can store.
 *
 * The base64 field is exactly the key blob the SSH handshake presents, so the
 * fingerprints computed here are identical to the ones recorded on a live
 * connection: an imported key matches without re-prompting.
 */
function parseKnownHosts(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return {
            path: filePath,
            entries: [],
            stats: { hashed: 0, patterns: 0, markers: 0, malformed: 0 },
            error: error.code === 'ENOENT' ? 'No known_hosts file' : error.message,
        };
    }

    const entries = [];
    const stats = { hashed: 0, patterns: 0, markers: 0, malformed: 0 };

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const fields = trimmed.split(/\s+/);

        // @cert-authority and @revoked mean something this app has no way to
        // honour; importing them as ordinary trust would be wrong.
        if (fields[0].startsWith('@')) {
            stats.markers += 1;
            continue;
        }
        if (fields.length < 3) {
            stats.malformed += 1;
            continue;
        }

        const [hostField, , encoded] = fields;

        // `|1|salt|hash`. Hashed names cannot be reversed, so there is no host
        // to attach the key to.
        if (hostField.startsWith('|')) {
            stats.hashed += 1;
            continue;
        }

        const blob = Buffer.from(encoded, 'base64');
        const keyType = blob.length ? knownHosts.keyType(blob) : 'unknown';
        if (keyType === 'unknown') {
            stats.malformed += 1;
            continue;
        }

        const fingerprint = knownHosts.fingerprint(blob);
        const comment = fields.slice(3).join(' ');

        for (const spec of hostField.split(',')) {
            if (/[*?!]/.test(spec)) {
                stats.patterns += 1;
                continue;
            }

            const { host, port } = splitHostSpec(spec);
            entries.push({ host, port, keyType, fingerprint, comment, blob });
        }
    }

    return { path: filePath, entries, stats, error: '' };
}

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

const sameHost = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** An imported host is a duplicate when it would dial the same place as the same user. */
function findExistingHost(existing, candidate) {
    return existing.find(host =>
        sameHost(host.host, candidate.hostName)
        && (host.port || 22) === candidate.port
        && sameHost(host.username, candidate.user));
}

function scanConfig(configPath) {
    if (!fs.existsSync(configPath)) {
        return { path: configPath, hosts: [], warnings: [], stats: null, error: 'No config file' };
    }

    const parsed = sshConfig.parse(configPath);
    const existing = store.getHosts();

    const hosts = parsed.hosts.map((host) => {
        const warnings = [...host.warnings];

        // The first identity file that is actually usable decides; the rest are
        // reported so a stale IdentityFile is visible rather than silent.
        let identity = null;
        for (const file of host.identityFiles) {
            const inspected = common.inspectIdentityFile(file);
            if (!identity || (identity.state !== 'ready' && inspected.state === 'ready')) {
                identity = { ...inspected, path: file };
            }
        }

        if (identity?.state === 'encrypted') {
            warnings.push('Its key is passphrase-protected. Add the passphrase in Keychain after importing');
        } else if (identity?.state === 'ppk') {
            warnings.push(
                `${path.basename(identity.path)} is a PuTTY key. Export it as an OpenSSH key `
                + 'with PuTTYgen, then attach it in Keychain'
            );
        } else if (identity?.state === 'unreadable') {
            warnings.push(`IdentityFile ${path.basename(identity.path)}: ${identity.reason}`);
        }

        const match = findExistingHost(existing, host);

        // The hop this host is relayed through, as a name. Resolved to a record
        // id after the import, because the config can name a host further down
        // the file than the one referring to it.
        //
        // A chain of several is linked at its last hop only: that is the one
        // this host is reached through, and the links between the others would
        // need records this app has no way to invent.
        const jumpAliases = sshConfig.proxyJumpAliases(host.proxyJump);
        const jumpAlias = jumpAliases[jumpAliases.length - 1] || '';

        if (jumpAliases.length > 1) {
            warnings.push(
                `Relayed through ${jumpAliases.join(' then ')}; only the last hop, `
                + `${jumpAlias}, is linked here. Set the rest on their own records`
            );
        }

        // Said now rather than after the import, where it would arrive as a
        // host that quietly connects directly to something it cannot reach.
        const jumpImportable = jumpAlias
            && (parsed.hosts.some(entry => entry.alias === jumpAlias)
                || existing.some(entry => entry.name === jumpAlias));

        if (jumpAlias && !jumpImportable) {
            warnings.push(`Its jump host ${jumpAlias} is not in this config, so it cannot be linked`);
        }

        return {
            key: host.alias,
            name: host.alias,
            host: host.hostName,
            port: host.port,
            username: host.user,
            jumpAlias: jumpImportable ? jumpAlias : '',
            identityPath: identity?.path || '',
            identityName: identity ? path.basename(identity.path) : '',
            identityState: identity?.state || 'none',
            // With a usable key we can wire up keychain auth; otherwise the
            // agent is the only thing that could plausibly work unattended.
            proposedAuth: identity?.state === 'ready' ? 'keychain' : 'agent',
            tunnels: host.tunnels,
            status: match ? 'present' : 'new',
            existingName: match?.name || '',
            warnings,
        };
    });

    return {
        path: parsed.path,
        files: parsed.files,
        hosts,
        warnings: parsed.warnings,
        stats: parsed.stats,
        error: '',
    };
}

function scanKnownHosts(knownHostsPath) {
    const parsed = parseKnownHosts(knownHostsPath);
    if (parsed.error) return { ...parsed, entries: [] };

    const entries = parsed.entries.map((entry) => {
        const status = knownHosts.check(entry.host, entry.port, entry.blob);
        return {
            key: `${entry.host}:${entry.port}|${entry.fingerprint}`,
            host: entry.host,
            port: entry.port,
            keyType: entry.keyType,
            fingerprint: entry.fingerprint,
            comment: entry.comment,
            // 'changed' means we already trust a different key of this type for
            // this host, worth flagging rather than quietly replacing.
            status: status === 'match' ? 'present' : status === 'changed' ? 'conflict' : 'new',
        };
    });

    return { path: parsed.path, entries, stats: parsed.stats, error: '' };
}

function scanOpenSsh({ configPath, knownHostsPath } = {}) {
    const paths = defaultPaths();
    return {
        paths,
        config: scanConfig(configPath || paths.configPath),
        knownHosts: scanKnownHosts(knownHostsPath || paths.knownHostsPath),
    };
}

/* ------------------------------------------------------------------ *
 * Source dispatch
 * ------------------------------------------------------------------ */

/** Which sources have anything to offer, for the Backup page to show. */
function detect() {
    return {
        openssh: defaultPaths(),
        putty: puttyImport.detect('putty'),
        kitty: puttyImport.detect('kitty'),
        mobaxterm: mobaxtermImport.detect(),
    };
}

function scan(options = {}) {
    const source = options.source || 'openssh';
    if (source === 'putty' || source === 'kitty') return puttyImport.scan(source);
    if (source === 'mobaxterm') return mobaxtermImport.scan(options);
    return scanOpenSsh(options);
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

/**
 * Import the selected hosts and host keys.
 *
 * Both files are re-read here rather than trusting anything the renderer sends
 * back; `aliases` and `fingerprints` are only used to filter what was found.
 */
function applyOpenSsh({
    configPath,
    knownHostsPath,
    aliases = [],
    fingerprints = [],
    importIdentityFiles = true,
} = {}) {
    const report = {
        hosts: { imported: 0, skipped: 0, failed: 0, relayed: 0 },
        keys: { imported: 0, reused: 0 },
        knownHosts: { imported: 0, skipped: 0 },
        notes: [],
    };

    /* ---- hosts ---- */

    if (aliases.length > 0) {
        const wanted = new Set(aliases);
        const scanned = scanConfig(configPath || defaultPaths().configPath);
        const cache = new Map();

        // alias -> id for the records written by this run, and the ProxyJump
        // links still to be resolved. Both are collected rather than acted on,
        // because a config can name a jump host in a block further down than
        // the one referring to it.
        const created = new Map();
        const jumpLinks = [];

        for (const candidate of scanned.hosts) {
            if (!wanted.has(candidate.key)) continue;

            if (candidate.status === 'present') {
                report.hosts.skipped += 1;
                continue;
            }

            let authMethod = 'agent';
            let keychainKeyId = '';

            if (importIdentityFiles && candidate.identityPath) {
                const key = common.importIdentity(candidate.identityPath, cache);
                if (key) {
                    authMethod = 'keychain';
                    keychainKeyId = key.id;
                    if (key.created) report.keys.imported += 1;
                    else report.keys.reused += 1;
                }
            }

            try {
                const saved = store.saveHost({
                    // Not left to the store's `host-${Date.now()}` fallback: a
                    // batch import can write two records in one millisecond,
                    // and the second would silently update the first.
                    id: common.freshId('host'),
                    name: candidate.name,
                    host: candidate.host,
                    port: candidate.port,
                    username: candidate.username,
                    authMethod,
                    keychainKeyId,
                    folderId: '',
                    tunnels: candidate.tunnels,
                });
                created.set(candidate.key, saved.id);
                if (candidate.jumpAlias) {
                    jumpLinks.push({ id: saved.id, alias: candidate.jumpAlias });
                }
                report.hosts.imported += 1;
            } catch (error) {
                report.hosts.failed += 1;
                report.notes.push(`${candidate.name}: ${error.message}`);
            }
        }

        /* ---- jump hosts ---- */

        // Linked once every record this run writes exists. Resolved against
        // those first and against the store second, so re-importing a config
        // links to the records the previous run left rather than needing the
        // bastion imported again alongside.
        //
        // The write is a partial save: id and the one field. Everything else on
        // the record, credentials included, is left exactly as it was.
        if (jumpLinks.length > 0) {
            const byName = new Map(store.getHosts().map(host => [host.name, host.id]));

            for (const { id, alias } of jumpLinks) {
                const jumpHostId = created.get(alias) || byName.get(alias) || '';
                // A host that turned out to name itself is dropped rather than
                // reported: the store would refuse it anyway, and there is
                // nothing the person importing could do about their own config
                // that this app should be asking them to go and do.
                if (!jumpHostId || jumpHostId === id) continue;

                try {
                    store.saveHost({ id, jumpHostId });
                    report.hosts.relayed += 1;
                } catch (error) {
                    report.notes.push(`Could not link ${alias} as a jump host: ${error.message}`);
                }
            }
        }
    }

    /* ---- known hosts ---- */

    if (fingerprints.length > 0) {
        const wanted = new Set(fingerprints);
        const parsed = parseKnownHosts(knownHostsPath || defaultPaths().knownHostsPath);

        for (const entry of parsed.entries) {
            const key = `${entry.host}:${entry.port}|${entry.fingerprint}`;
            if (!wanted.has(key)) continue;

            const status = knownHosts.check(entry.host, entry.port, entry.blob);
            if (status === 'match') {
                report.knownHosts.skipped += 1;
                continue;
            }

            // A key of a type we already trust for this host replaces it; the
            // user chose this entry knowing it was flagged as a conflict.
            knownHosts.trust(entry.host, entry.port, entry.blob, { replace: status === 'changed' });
            report.knownHosts.imported += 1;
        }
    }

    return { success: true, ...report };
}

function apply(options = {}) {
    const source = options.source || 'openssh';
    if (source === 'putty' || source === 'kitty') return puttyImport.apply(source, options);
    if (source === 'mobaxterm') return mobaxtermImport.apply(options);
    return applyOpenSsh(options);
}

module.exports = {
    defaultPaths,
    detect,
    scan,
    apply,
    // Exported so the pieces can be exercised without touching the store.
    parseKnownHosts,
    inspectIdentityFile: common.inspectIdentityFile,
};
