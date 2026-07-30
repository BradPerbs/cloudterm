const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');

/**
 * Portable, passphrase-encrypted backups of everything the app stores.
 *
 * Why the secrets travel in the clear *inside* the envelope: the vault's data
 * key is wrapped by this machine's OS keystore, so a file carrying `v2:`
 * ciphertext would be undecryptable anywhere else, the exact situation a
 * backup exists to survive. So the store decrypts under the local key and this
 * module re-encrypts under a passphrase the user chose, which is what makes the
 * file restorable on a new machine.
 *
 * That also means the file is exactly as sensitive as the vault it came from.
 * It is AES-256-GCM under scrypt, at the same cost as the vault's own wrap, and
 * the plaintext is never written to disk at any point: it is built in memory,
 * encrypted, and only the envelope is written.
 *
 * GCM authenticates, so a wrong passphrase and a corrupted file are both a tag
 * mismatch. They are told apart by nothing at all, deliberately: the caller
 * reports "wrong passphrase or damaged file" rather than confirming which,
 * since distinguishing them is an oracle.
 */

const FORMAT = 'cloudblast-backup';
const VERSION = 1;

// Matched to the vault's own KDF cost: ~33 MB and ~100ms per attempt. Stored in
// the file so these can be raised later without stranding older backups.
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 32;

const MIN_PASSPHRASE = 8;

/** A backup is worth nothing if it cannot be opened, and there is no reset. */
function validatePassphrase(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
        return `Use at least ${MIN_PASSPHRASE} characters`;
    }
    return '';
}

/**
 * The header fields bound into the ciphertext as additional data.
 *
 * Rebuilt field by field in a fixed order rather than re-serialising whatever
 * the file happened to contain, so both sides always produce identical bytes.
 * Binding it means the KDF cost cannot be edited down to something cheap to
 * attack and still decrypt: tampering with the header breaks the tag.
 */
const additionalData = (header) => Buffer.from(JSON.stringify({
    format: header.format,
    version: header.version,
    createdAt: header.createdAt,
    cipher: header.cipher,
    kdf: {
        algo: header.kdf.algo,
        salt: header.kdf.salt,
        N: header.kdf.N,
        r: header.kdf.r,
        p: header.kdf.p,
    },
}), 'utf8');

const deriveKey = (passphrase, kdf) =>
    crypto.scryptSync(String(passphrase), Buffer.from(kdf.salt, 'hex'), KEY_BYTES, {
        N: kdf.N, r: kdf.r, p: kdf.p, maxmem: KDF.maxmem,
    });

/** Build the envelope. `payload` is a plain object; it is never written unencrypted. */
function seal(payload, passphrase) {
    const header = {
        format: FORMAT,
        version: VERSION,
        createdAt: new Date().toISOString(),
        app: app.getVersion(),
        cipher: 'aes-256-gcm',
        kdf: {
            algo: 'scrypt',
            salt: crypto.randomBytes(SALT_BYTES).toString('hex'),
            N: KDF.N,
            r: KDF.r,
            p: KDF.p,
        },
    };

    const key = deriveKey(passphrase, header.kdf);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(additionalData(header));

    const body = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
        cipher.final(),
    ]);

    return {
        ...header,
        payload: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'),
    };
}

/**
 * Open an envelope. Returns the payload object, or null when the passphrase is
 * wrong or the file has been altered. Throws only when the file is not a
 * backup at all, which is a different problem and worth a different message.
 */
function unseal(envelope, passphrase) {
    if (envelope?.format !== FORMAT) {
        throw new Error('This is not a CloudBlast backup file');
    }
    if (envelope.version > VERSION) {
        throw new Error(
            `This backup was written by a newer version of the app (format ${envelope.version})`
        );
    }
    if (envelope.cipher !== 'aes-256-gcm' || envelope.kdf?.algo !== 'scrypt') {
        throw new Error('This backup uses an encryption scheme this version cannot read');
    }

    const raw = Buffer.from(String(envelope.payload || ''), 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) {
        throw new Error('This backup file is truncated');
    }

    const key = deriveKey(passphrase, envelope.kdf);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    decipher.setAAD(additionalData(envelope));

    try {
        const plaintext = Buffer.concat([
            decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
            decipher.final(),
        ]);
        return JSON.parse(plaintext.toString('utf8'));
    } catch {
        // Tag mismatch (wrong passphrase or tampering) and unparseable plaintext
        // are both "you cannot open this", and the caller must not learn which.
        return null;
    }
}

/** Temp file then rename, so a failed write cannot leave a half-written backup. */
function writeFile(filePath, envelope) {
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify(envelope, null, 2), 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, filePath);
    } catch (error) {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            // Nothing was renamed into place, so the target is untouched.
        }
        throw error;
    }
}

function readFile(filePath) {
    const contents = fs.readFileSync(filePath, 'utf8');
    try {
        return JSON.parse(contents);
    } catch {
        throw new Error('This file is not readable as a backup');
    }
}

/* ------------------------------------------------------------------ *
 * Key-based envelopes
 *
 * Same cipher and the same authenticated header, but keyed directly by 32
 * random bytes instead of a passphrase. Used for the cloud snapshot, where the
 * key comes from the account rather than from something a person typed.
 *
 * No KDF, because there is nothing to stretch: a passphrase needs scrypt
 * because it is low entropy and guessable, while a 256-bit random key is
 * neither. Running scrypt over it would cost 100ms per sync and buy nothing.
 * ------------------------------------------------------------------ */

const KEYED_FORMAT = 'cloudblast-snapshot';

function keyBuffer(key) {
    const buffer = Buffer.from(String(key || ''), 'base64');
    if (buffer.length !== KEY_BYTES) throw new Error('The snapshot key is not a 256-bit key');
    return buffer;
}

function sealWithKey(payload, key) {
    const header = {
        format: KEYED_FORMAT,
        version: VERSION,
        createdAt: new Date().toISOString(),
        app: app.getVersion(),
        cipher: 'aes-256-gcm',
        kdf: { algo: 'none' },
    };

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(key), iv);
    cipher.setAAD(additionalData(header));

    const body = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
        cipher.final(),
    ]);

    return {
        ...header,
        payload: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'),
    };
}

/** Returns the payload, or null when the key is wrong or the blob was altered. */
function unsealWithKey(envelope, key) {
    if (envelope?.format !== KEYED_FORMAT) {
        throw new Error('This is not a CloudBlast snapshot');
    }
    if (envelope.version > VERSION) {
        throw new Error('This snapshot was written by a newer version of the app');
    }
    if (envelope.cipher !== 'aes-256-gcm') {
        throw new Error('This snapshot uses an encryption scheme this version cannot read');
    }

    const raw = Buffer.from(String(envelope.payload || ''), 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error('This snapshot is truncated');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(key), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    decipher.setAAD(additionalData(envelope));

    try {
        return JSON.parse(Buffer.concat([
            decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
            decipher.final(),
        ]).toString('utf8'));
    } catch {
        return null;
    }
}

module.exports = {
    FORMAT,
    KEYED_FORMAT,
    VERSION,
    MIN_PASSPHRASE,
    validatePassphrase,
    seal,
    unseal,
    sealWithKey,
    unsealWithKey,
    writeFile,
    readFile,
};
