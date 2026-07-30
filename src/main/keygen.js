const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const KEY_TYPES = {
    ED25519: 'ed25519',
    ECDSA: 'ecdsa',
    RSA: 'rsa',
};

/** OpenSSH-style fingerprint: SHA256 over the decoded key blob, not the base64. */
function fingerprintFromPublicKey(publicKey) {
    const blob = publicKey.trim().split(/\s+/)[1];
    if (!blob) return '';
    const digest = crypto.createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64');
    return 'SHA256:' + digest.replace(/=+$/, '');
}

/* ------------------------------------------------------------------ *
 * Naming a key that came from outside
 * ------------------------------------------------------------------ */

/**
 * Wire names, as they appear at the front of a public key line and inside an
 * OpenSSH private key, mapped to the labels the keychain shows.
 *
 * Longest first, because `ecdsa-sha2-nistp256` and the security-key form that
 * wraps it both start the same way.
 */
const WIRE_NAMES = [
    ['sk-ssh-ed25519@openssh.com', 'ED25519-SK'],
    ['sk-ecdsa-sha2-nistp', 'ECDSA-SK'],
    ['ssh-ed25519', 'ED25519'],
    ['ecdsa-sha2-nistp', 'ECDSA'],
    ['rsa-sha2-', 'RSA'],
    ['ssh-rsa', 'RSA'],
    ['ssh-dss', 'DSA'],
];

const labelFor = (wireName) =>
    (WIRE_NAMES.find(([prefix]) => String(wireName || '').startsWith(prefix)) || [])[1] || '';

/** One SSH-wire `string`: a big-endian length followed by that many bytes. */
function readString(buffer, offset) {
    if (offset + 4 > buffer.length) return null;
    const length = buffer.readUInt32BE(offset);
    const end = offset + 4 + length;
    if (end > buffer.length) return null;
    return { value: buffer.subarray(offset + 4, end), next: end };
}

/**
 * The algorithm named inside an `OPENSSH PRIVATE KEY` body.
 *
 * The container holds the public half in the clear even when the private half
 * is encrypted, so this answers without a passphrase. Walking the header is
 * only four fields, and it beats scanning the bytes for something that looks
 * like an algorithm name.
 */
function opensshKeyType(base64Body) {
    let buffer;
    try {
        buffer = Buffer.from(base64Body, 'base64');
    } catch {
        return '';
    }

    const MAGIC = 'openssh-key-v1\0';
    if (buffer.subarray(0, MAGIC.length).toString('latin1') !== MAGIC) return '';

    // ciphername, kdfname, kdfoptions
    let cursor = MAGIC.length;
    for (let field = 0; field < 3; field++) {
        const read = readString(buffer, cursor);
        if (!read) return '';
        cursor = read.next;
    }

    cursor += 4; // number of keys, which is 1 for everything ssh-keygen writes
    const blob = readString(buffer, cursor);
    if (!blob) return '';

    const name = readString(blob.value, 0);
    return name ? name.value.toString('latin1') : '';
}

/** What a pasted private key says about itself, without its passphrase. */
function typeFromPrivateKey(privateKey) {
    const text = String(privateKey || '');

    // The pre-OpenSSH PEM headers name the algorithm outright.
    if (/BEGIN RSA PRIVATE KEY/.test(text)) return 'RSA';
    if (/BEGIN EC PRIVATE KEY/.test(text)) return 'ECDSA';
    if (/BEGIN DSA PRIVATE KEY/.test(text)) return 'DSA';

    const openssh = text.match(/BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END/);
    if (openssh) return labelFor(opensshKeyType(openssh[1].replace(/\s+/g, '')));

    // PKCS#8 says nothing in its header, but node can read one. An encrypted
    // one throws for want of a passphrase, which is the same as not knowing.
    if (/BEGIN PRIVATE KEY/.test(text)) {
        try {
            return {
                rsa: 'RSA', ec: 'ECDSA', ed25519: 'ED25519', dsa: 'DSA',
            }[crypto.createPrivateKey(text).asymmetricKeyType] || '';
        } catch {
            return '';
        }
    }

    return '';
}

/**
 * The algorithm and fingerprint of a key the app did not generate.
 *
 * A generated key is described by ssh-keygen on the way out. An imported one is
 * whatever was pasted, and the form has no business asking "which kind is
 * this?" when the key already says so — answered by hand it is a field to get
 * wrong, and a key labelled ED25519 because that is what the picker defaults to
 * is worse than one labelled nothing.
 *
 * Only fields that could actually be worked out come back, so a key this cannot
 * read leaves whatever is stored alone rather than overwriting it with a guess.
 */
function identify({ publicKey, privateKey } = {}) {
    const found = {};

    const line = String(publicKey || '').trim();
    if (line) {
        const type = labelFor(line.split(/\s+/)[0]);
        if (type) found.type = type;

        const fingerprint = fingerprintFromPublicKey(line);
        if (fingerprint) found.fingerprint = fingerprint;
    }

    // No public half was pasted, which is allowed: the private key carries the
    // same answer, it just cannot be fingerprinted from here.
    if (!found.type) {
        const type = typeFromPrivateKey(privateKey);
        if (type) found.type = type;
    }

    return found;
}

function generate({ type, keySize, comment, passphrase }) {
    return new Promise((resolve, reject) => {
        const keyType = KEY_TYPES[type] || 'ed25519';
        const tempDir = path.join(app.getPath('temp'), `ssh-keygen-${crypto.randomBytes(8).toString('hex')}`);

        fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

        const privateKeyPath = path.join(tempDir, 'id_key');
        const publicKeyPath = `${privateKeyPath}.pub`;
        const cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });

        const args = ['-t', keyType, '-f', privateKeyPath, '-C', comment || 'generated-key', '-N', passphrase || ''];
        if (keySize && (type === 'ECDSA' || type === 'RSA')) {
            args.push('-b', String(keySize));
        }

        const keygen = spawn('ssh-keygen', args);
        let stderr = '';
        keygen.stderr.on('data', (data) => { stderr += data.toString(); });

        keygen.on('error', (err) => {
            cleanup();
            reject(new Error(
                err.code === 'ENOENT'
                    ? 'ssh-keygen not found. Install OpenSSH client to generate keys.'
                    : err.message
            ));
        });

        keygen.on('close', (code) => {
            if (code !== 0) {
                cleanup();
                reject(new Error(stderr.trim() || 'Key generation failed'));
                return;
            }

            try {
                const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
                const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
                cleanup();
                resolve({
                    privateKey,
                    publicKey,
                    fingerprint: fingerprintFromPublicKey(publicKey),
                });
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    });
}

module.exports = { generate, fingerprintFromPublicKey, identify };
