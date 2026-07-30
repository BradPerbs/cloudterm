const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Key management for stored credentials, and the opening password that guards
 * them.
 *
 * Envelope encryption. Secrets are encrypted with a random 32-byte data key
 * (the DEK), and only the DEK is ever wrapped by anything the user controls:
 *
 *   no password    DEK wrapped by the OS keystore
 *   password set   DEK wrapped by scrypt(password), then by the OS keystore
 *
 * The indirection is what makes the password practical. Setting, changing or
 * removing it re-wraps 32 bytes; not one stored secret is rewritten, so none of
 * those operations can half-finish and leave the store unreadable.
 *
 * With a password set, the file on disk is useless to someone who copies it,
 * even with the OS account it came from. That is the difference from a lock
 * that only guards the window.
 *
 * There is no recovery. The DEK exists only inside the wrapped blob, so a
 * forgotten password means the stored credentials are gone. That is the cost of
 * the guarantee, and the UI says so before the password is set.
 */

const SCHEMA_VERSION = 1;

const vaultPath = () => path.join(app.getPath('userData'), 'vault.json');

/** The pre-envelope lock, which held a verifier and encrypted nothing. */
const legacyLockPath = () => path.join(app.getPath('userData'), 'lock.json');

// ~33 MB and ~100ms per attempt. Stored per-vault so these can be raised later
// without stranding a vault written under the old cost.
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const MIN_LENGTH = 8;

/** Failed unlocks are slowed down, so the wrap cannot be hammered. */
const ATTEMPT_DELAYS = [0, 0, 250, 500, 1000, 2000, 4000];

let record = null;
let loaded = false;

// The DEK, held only in memory and only while unlocked.
let dek = null;
let failedAttempts = 0;

// Run when the DEK first becomes available, so the store can bring any
// pre-envelope secret up to the current format.
const unlockHooks = [];

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

const keystoreAvailable = () => {
    try {
        return safeStorage.isEncryptionAvailable();
    } catch {
        return false;
    }
};

function gcmEncrypt(plaintext, key) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Throws if the key is wrong or the blob was tampered with; GCM authenticates. */
function gcmDecrypt(blob, key) {
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = blob.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
}

function deriveKek(password, kdf) {
    const { salt, N, r, p } = kdf;
    return crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), KEY_BYTES, {
        N, r, p, maxmem: KDF.maxmem,
    });
}

/* ------------------------------------------------------------------ *
 * Vault file
 * ------------------------------------------------------------------ */

function readVault() {
    if (loaded) return record;
    loaded = true;

    try {
        if (fs.existsSync(vaultPath())) {
            const parsed = JSON.parse(fs.readFileSync(vaultPath(), 'utf8'));
            record = parsed?.wrapped ? parsed : null;
        } else {
            record = null;
        }
    } catch (error) {
        console.error('Failed to read the vault:', error.message);
        record = null;
    }

    return record;
}

function writeVault(next) {
    const file = vaultPath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify(next, null, 2), 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
        record = next;
        loaded = true;
        return true;
    } catch (error) {
        console.error('Failed to write the vault:', error.message);
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            // The previous vault file is untouched either way.
        }
        return false;
    }
}

/**
 * Wrap the DEK for storage. `password` null means keystore-only.
 *
 * The keystore layer is applied on top of the password layer rather than
 * instead of it, so a password vault needs both this OS account and the
 * password. Without a keystore the password layer still stands on its own.
 */
function buildRecord(key, password) {
    const kdf = password
        ? { salt: crypto.randomBytes(32).toString('hex'), N: KDF.N, r: KDF.r, p: KDF.p }
        : null;

    const inner = password ? gcmEncrypt(key, deriveKek(password, kdf)) : key;
    const usedKeystore = keystoreAvailable();
    const wrapped = usedKeystore
        ? safeStorage.encryptString(inner.toString('base64'))
        : inner;

    return {
        version: SCHEMA_VERSION,
        protection: password ? 'password' : 'keystore',
        keystore: usedKeystore,
        kdf,
        wrapped: wrapped.toString('base64'),
    };
}

/** Returns the DEK, or null when the password is wrong. Throws on a corrupt vault. */
function unwrap(current, password) {
    const raw = Buffer.from(current.wrapped, 'base64');

    let inner;
    if (current.keystore) {
        if (!keystoreAvailable()) {
            throw new Error('This vault was written with the OS keystore, which is not available');
        }
        inner = Buffer.from(safeStorage.decryptString(raw), 'base64');
    } else {
        inner = raw;
    }

    if (current.protection !== 'password') return inner;

    try {
        return gcmDecrypt(inner, deriveKek(password, current.kdf));
    } catch {
        // A GCM tag mismatch is the wrong password, not a broken vault.
        return null;
    }
}

function runUnlockHooks() {
    for (const hook of unlockHooks) {
        try {
            hook();
        } catch (error) {
            console.error('Vault unlock hook failed:', error.message);
        }
    }
}

/**
 * Make sure a DEK exists. A fresh install, or one predating the envelope, gets
 * one wrapped under the keystore alone, which is the same protection those
 * secrets already had.
 */
function ensureKey() {
    if (dek) return dek;

    const current = readVault();
    if (current) {
        if (current.protection === 'password') return null; // needs unlocking
        const key = unwrap(current, null);
        if (!key) return null;
        dek = key;
        runUnlockHooks();
        return dek;
    }

    // A legacy lock guarded the window but encrypted nothing, so it cannot be
    // carried across without the password. It is honoured until then.
    if (fs.existsSync(legacyLockPath())) return null;

    const key = crypto.randomBytes(KEY_BYTES);
    if (!writeVault(buildRecord(key, null))) return null;
    dek = key;
    runUnlockHooks();
    return dek;
}

/* ------------------------------------------------------------------ *
 * Legacy lock, superseded by the envelope
 * ------------------------------------------------------------------ */

function readLegacyLock() {
    try {
        if (!fs.existsSync(legacyLockPath())) return null;
        const parsed = JSON.parse(fs.readFileSync(legacyLockPath(), 'utf8'));
        return parsed?.salt && parsed?.hash ? parsed : null;
    } catch {
        return null;
    }
}

function legacyMatches(lock, password) {
    try {
        const expected = Buffer.from(lock.hash, 'hex');
        const params = lock.params || {};
        const actual = crypto.scryptSync(String(password), Buffer.from(lock.salt, 'hex'),
            params.keylen || 64,
            { N: params.N || KDF.N, r: params.r || KDF.r, p: params.p || KDF.p, maxmem: KDF.maxmem });
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

/**
 * Turn a verified legacy password into a real vault. The secrets it never
 * protected are brought under the DEK by the unlock hooks.
 */
function upgradeLegacy(password) {
    const key = crypto.randomBytes(KEY_BYTES);
    if (!writeVault(buildRecord(key, password))) return false;

    dek = key;
    try {
        fs.rmSync(legacyLockPath(), { force: true });
    } catch (error) {
        console.error('Could not remove the legacy lock file:', error.message);
    }
    runUnlockHooks();
    return true;
}

/* ------------------------------------------------------------------ *
 * Lock state
 * ------------------------------------------------------------------ */

function isEnabled() {
    const current = readVault();
    if (current) return current.protection === 'password';
    return Boolean(readLegacyLock());
}

function isLocked() {
    if (!isEnabled()) {
        // Materialises the key on first use, so a passwordless app is usable
        // without anyone having to unlock anything.
        ensureKey();
        return false;
    }
    return !dek;
}

function hasKey() {
    return Boolean(dek || ensureKey());
}

function status() {
    const current = readVault();
    return {
        enabled: isEnabled(),
        locked: isLocked(),
        minLength: MIN_LENGTH,
        // 'password' means the stored secrets need the password, not just this
        // OS account. The UI says which of the two the user is getting.
        protection: current?.protection || (readLegacyLock() ? 'legacy' : 'keystore'),
        keystoreAvailable: keystoreAvailable(),
    };
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function unlock(password) {
    if (!isEnabled()) return { success: true };

    const delay = ATTEMPT_DELAYS[Math.min(failedAttempts, ATTEMPT_DELAYS.length - 1)];
    if (delay) await wait(delay);

    const legacy = readVault() ? null : readLegacyLock();
    if (legacy) {
        if (!legacyMatches(legacy, password)) {
            failedAttempts++;
            return { success: false, message: 'Incorrect password' };
        }
        if (!upgradeLegacy(password)) {
            return { success: false, message: 'Could not upgrade the stored password' };
        }
        failedAttempts = 0;
        return { success: true };
    }

    let key;
    try {
        key = unwrap(readVault(), password);
    } catch (error) {
        return { success: false, message: error.message };
    }

    if (!key) {
        failedAttempts++;
        return { success: false, message: 'Incorrect password' };
    }

    failedAttempts = 0;
    dek = key;
    runUnlockHooks();
    return { success: true };
}

function validate(password) {
    if (typeof password !== 'string' || password.length < MIN_LENGTH) {
        return `Use at least ${MIN_LENGTH} characters`;
    }
    return '';
}

function set(password) {
    if (isEnabled()) return { success: false, message: 'A password is already set' };

    const problem = validate(password);
    if (problem) return { success: false, message: problem };

    const key = ensureKey();
    if (!key) return { success: false, message: 'The credential store is not ready' };

    // Every secret must already be under the DEK, or re-wrapping it would leave
    // the stragglers readable without the password.
    runUnlockHooks();

    if (!writeVault(buildRecord(key, password))) {
        return { success: false, message: 'Could not save the password' };
    }
    return { success: true };
}

function change(currentPassword, nextPassword) {
    if (!isEnabled()) return { success: false, message: 'No password is set' };

    const problem = validate(nextPassword);
    if (problem) return { success: false, message: problem };

    let key;
    try {
        key = unwrap(readVault(), currentPassword);
    } catch (error) {
        return { success: false, message: error.message };
    }
    if (!key) return { success: false, message: 'Current password is incorrect' };

    if (!writeVault(buildRecord(key, nextPassword))) {
        return { success: false, message: 'Could not save the password' };
    }
    dek = key;
    return { success: true };
}

/**
 * Drop back to keystore-only. The secrets stay encrypted, under a DEK that no
 * longer needs a password, so this is a downgrade in protection rather than a
 * decryption of anything.
 */
function disable(currentPassword) {
    if (!isEnabled()) return { success: true };

    let key;
    try {
        key = unwrap(readVault(), currentPassword);
    } catch (error) {
        return { success: false, message: error.message };
    }
    if (!key) return { success: false, message: 'Password is incorrect' };

    if (!writeVault(buildRecord(key, null))) {
        return { success: false, message: 'Could not remove the password' };
    }
    dek = key;
    return { success: true };
}

/** Forget the DEK. Nothing can be decrypted again until the password is re-entered. */
function lock() {
    if (!isEnabled()) return { success: false, message: 'No password is set' };
    if (dek) dek.fill(0);
    dek = null;
    return { success: true };
}

/* ------------------------------------------------------------------ *
 * Secret encryption, used by the store
 * ------------------------------------------------------------------ */

const SECRET_PREFIX = 'v2:';

const isVaultSecret = (value) => typeof value === 'string' && value.startsWith(SECRET_PREFIX);

/** Throws rather than returning empty: a dropped credential must not look like a save. */
function encryptSecret(plaintext) {
    const key = dek || ensureKey();
    if (!key) throw new Error('The credential store is locked');
    return SECRET_PREFIX + gcmEncrypt(Buffer.from(String(plaintext), 'utf8'), key).toString('base64');
}

function decryptSecret(stored) {
    const key = dek || ensureKey();
    if (!key) return '';
    try {
        return gcmDecrypt(Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64'), key).toString('utf8');
    } catch (error) {
        console.error('Failed to decrypt a secret:', error.message);
        return '';
    }
}

function onUnlocked(hook) {
    unlockHooks.push(hook);
}

module.exports = {
    // Lock
    isEnabled,
    isLocked,
    status,
    unlock,
    set,
    change,
    disable,
    lock,
    // Keys and secrets
    hasKey,
    onUnlocked,
    isVaultSecret,
    encryptSecret,
    decryptSecret,
    keystoreAvailable,
};
