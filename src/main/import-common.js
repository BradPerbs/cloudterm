const fs = require('fs');
const path = require('path');
const store = require('./store');
const knownHosts = require('./known-hosts');
const keygen = require('./keygen');

/**
 * The pieces every session importer needs, whichever app the sessions come
 * from: identity-file inspection, putting a key in the keychain, spotting a
 * host that is already saved, and minting record ids.
 *
 * Kept out of import.js so the per-app importers (putty-import.js,
 * mobaxterm-import.js) and the OpenSSH importer can share them without
 * requiring each other.
 */

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
 *   ppk         a PuTTY .ppk; valid, but PuTTYgen has to convert it first
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

    // PuTTY's own format. The header names the algorithm, and the Encryption
    // line says whether a passphrase guards it, so both are worth reporting
    // even though the key cannot be taken as it stands.
    const ppk = text.match(/^PuTTY-User-Key-File-\d+:\s*(\S+)/m);
    if (ppk) {
        return {
            state: 'ppk',
            encrypted: /^Encryption:\s*(?!none\b)/m.test(text),
            type: labelForAlgorithm(ppk[1]),
            fingerprint: '',
        };
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

/**
 * Put an identity file in the keychain, reusing an entry with the same name
 * rather than stacking a duplicate every time a shared key is imported.
 *
 * `created` is true only for the call that actually wrote the key. Several
 * hosts commonly share one identity file, and each of them reaching the same
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

/* ------------------------------------------------------------------ *
 * Duplicate detection
 * ------------------------------------------------------------------ */

const sameText = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * The record already saved that an imported candidate would duplicate, or
 * undefined. What counts as "the same place" depends on how the candidate
 * connects:
 *
 *   serial      the same COM port, whatever it is set to
 *   rdp / vnc   a desktop host pointing the same protocol at the same address
 *   ssh/telnet  the same address and port as the same user
 */
function matchExistingHost(existing, candidate) {
    if (candidate.protocol === 'serial') {
        return existing.find(host => (host.protocol || 'ssh') === 'serial'
            && sameText(host.serial?.path, candidate.serial?.path));
    }

    if (candidate.protocol === 'rdp' || candidate.protocol === 'vnc') {
        return existing.find(host => host.desktop?.enabled
            && host.desktop.protocol === candidate.protocol
            && sameText(host.desktop.host, candidate.host)
            && (host.desktop.port || 0) === candidate.port);
    }

    const standard = candidate.protocol === 'telnet' ? 23 : 22;
    return existing.find(host => (host.protocol || 'ssh') === candidate.protocol
        && sameText(host.host, candidate.host)
        && (host.port || standard) === candidate.port
        && sameText(host.username, candidate.username));
}

/* ------------------------------------------------------------------ *
 * Record ids
 * ------------------------------------------------------------------ */

let counter = 0;

/**
 * An id the store will not collide on. The store's own fallback is
 * `host-${Date.now()}`, which is fine for a person clicking Save but not for
 * an import writing several records in the same millisecond: the second would
 * silently become an update of the first.
 */
function freshId(prefix) {
    counter += 1;
    return `${prefix}-${Date.now()}-${counter}`;
}

module.exports = {
    inspectIdentityFile,
    readPublicKey,
    importIdentity,
    matchExistingHost,
    freshId,
    sameText,
    labelForAlgorithm,
};
