const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');
const knownHosts = require('./known-hosts');
const sshConfig = require('./ssh-config');
const keygen = require('./keygen');

/**
 * Bring an existing OpenSSH setup into the app: `~/.ssh/config` becomes hosts
 * (with their port forwards), and `~/.ssh/known_hosts` becomes trusted keys.
 *
 * Scanning and applying both read from disk. The renderer only ever sends back
 * *which* entries to take, never the entries themselves, so no host key blob
 * or private key round-trips through it, and a compromised renderer cannot
 * talk the main process into trusting a key that is not in the file.
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
 * Private key inspection
 * ------------------------------------------------------------------ */

/** Read one SSH wire string (uint32 length, then bytes). */
function readSshString(buffer, offset) {
    if (offset + 4 > buffer.length) return null;
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length || offset + 4 + length > buffer.length) return null;
    return { value: buffer.subarray(offset + 4, offset + 4 + length), next: offset + 4 + length };
}

const OPENSSH_MAGIC = 'openssh-key-v1\0';

/**
 * Pull the cipher and public half out of a modern OpenSSH private key.
 *
 *   magic | ciphername | kdfname | kdfoptions | uint32 keycount | publickey
 *
 * The public key is a plain blob even when the private half is encrypted,
 * which is what lets an encrypted key still be identified and fingerprinted.
 */
function inspectOpenSshKey(text) {
    const body = text.match(
        /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/
    );
    if (!body) return null;

    const blob = Buffer.from(body[1].replace(/\s+/g, ''), 'base64');
    if (blob.subarray(0, OPENSSH_MAGIC.length).toString('binary') !== OPENSSH_MAGIC) return null;

    const cipher = readSshString(blob, OPENSSH_MAGIC.length);
    if (!cipher) return null;
    const kdf = readSshString(blob, cipher.next);
    if (!kdf) return null;
    const kdfOptions = readSshString(blob, kdf.next);
    if (!kdfOptions) return null;

    // uint32 key count, then the first public key blob.
    const publicKey = readSshString(blob, kdfOptions.next + 4);
    if (!publicKey) return null;

    const algorithm = readSshString(publicKey.value, 0);

    return {
        encrypted: cipher.value.toString('ascii') !== 'none',
        algorithm: algorithm ? algorithm.value.toString('ascii') : '',
        publicBlob: publicKey.value,
    };
}

const ALGORITHM_LABELS = [
    [/ed25519/i, 'ED25519'],
    [/ecdsa/i, 'ECDSA'],
    [/rsa|dss/i, 'RSA'],
];

function labelForAlgorithm(name) {
    for (const [pattern, label] of ALGORITHM_LABELS) {
        if (pattern.test(name || '')) return label;
    }
    return 'ED25519';
}

/**
 * Work out whether an IdentityFile can be imported, and what it is.
 *   ready       usable as-is
 *   encrypted   valid, but needs a passphrase we cannot ask for here
 *   unreadable  missing, a directory, or not a private key at all
 */
function inspectIdentityFile(filePath) {
    let text;
    try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return { state: 'unreadable', reason: 'Not a file' };
        text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return { state: 'unreadable', reason: error.code === 'ENOENT' ? 'File not found' : error.message };
    }

    if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) {
        // Pointing IdentityFile at the public half is a common slip.
        return {
            state: 'unreadable',
            reason: /ssh-(rsa|ed25519)|ecdsa-/.test(text)
                ? 'This is a public key, not a private one'
                : 'Not a private key',
        };
    }

    const openssh = inspectOpenSshKey(text);
    if (openssh) {
        return {
            state: openssh.encrypted ? 'encrypted' : 'ready',
            text,
            type: labelForAlgorithm(openssh.algorithm),
            fingerprint: openssh.publicBlob.length ? knownHosts.fingerprint(openssh.publicBlob) : '',
        };
    }

    // Classic PEM. `Proc-Type: 4,ENCRYPTED` is the only marker it carries.
    const encrypted = /Proc-Type:\s*4,\s*ENCRYPTED/i.test(text);
    const type = /BEGIN RSA/.test(text) ? 'RSA' : /BEGIN EC/.test(text) ? 'ECDSA' : 'ED25519';

    return { state: encrypted ? 'encrypted' : 'ready', text, type, fingerprint: '' };
}

/** Prefer the fingerprint from the `.pub` file, which is what `ssh-keygen -l` shows. */
function readPublicKey(privateKeyPath) {
    try {
        const text = fs.readFileSync(`${privateKeyPath}.pub`, 'utf8').trim();
        if (!text) return null;
        return { text, fingerprint: keygen.fingerprintFromPublicKey(text) };
    } catch {
        return null;
    }
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
            const inspected = inspectIdentityFile(file);
            if (!identity || (identity.state !== 'ready' && inspected.state === 'ready')) {
                identity = { ...inspected, path: file };
            }
        }

        if (identity?.state === 'encrypted') {
            warnings.push('Its key is passphrase-protected. Add the passphrase in Keychain after importing');
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

function scan({ configPath, knownHostsPath } = {}) {
    const paths = defaultPaths();
    return {
        paths,
        config: scanConfig(configPath || paths.configPath),
        knownHosts: scanKnownHosts(knownHostsPath || paths.knownHostsPath),
    };
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

/**
 * Put an identity file in the keychain, reusing an entry with the same name
 * rather than stacking a duplicate every time a shared key is imported.
 *
 * `created` is true only for the call that actually wrote the key. Several
 * hosts commonly share one IdentityFile, and each of them reaching the same
 * entry is a reuse, not another import.
 */
function importIdentity(identityPath, cache) {
    if (cache.has(identityPath)) {
        const cached = cache.get(identityPath);
        return cached ? { id: cached.id, created: false } : null;
    }

    const inspected = inspectIdentityFile(identityPath);
    if (inspected.state !== 'ready' && inspected.state !== 'encrypted') {
        cache.set(identityPath, null);
        return null;
    }

    const name = path.basename(identityPath);
    const existing = store.getKeys().find(key => key.name === name);
    if (existing) {
        cache.set(identityPath, { id: existing.id });
        return { id: existing.id, created: false };
    }

    const publicKey = readPublicKey(identityPath);
    const saved = store.saveKey({
        name,
        type: inspected.type,
        comment: `Imported from ${identityPath}`,
        privateKey: inspected.text,
        publicKey: publicKey?.text || '',
        fingerprint: publicKey?.fingerprint || inspected.fingerprint || '',
    });

    cache.set(identityPath, { id: saved.id });
    return { id: saved.id, created: true };
}

/**
 * Import the selected hosts and host keys.
 *
 * Both files are re-read here rather than trusting anything the renderer sends
 * back; `aliases` and `fingerprints` are only used to filter what was found.
 */
function apply({
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
                const key = importIdentity(candidate.identityPath, cache);
                if (key) {
                    authMethod = 'keychain';
                    keychainKeyId = key.id;
                    if (key.created) report.keys.imported += 1;
                    else report.keys.reused += 1;
                }
            }

            try {
                const saved = store.saveHost({
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

module.exports = {
    defaultPaths,
    scan,
    apply,
    // Exported so the pieces can be exercised without touching the store.
    parseKnownHosts,
    inspectIdentityFile,
};
