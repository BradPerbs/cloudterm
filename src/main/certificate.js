const crypto = require('crypto');
const { BaseAgent, utils: { parseKey } } = require('ssh2');

/**
 * OpenSSH certificates.
 *
 * A certificate is a public key signed by a CA, carrying the principals it may
 * log in as and the window it is valid for. The server trusts the CA rather
 * than the key, which is how a fleet stops keeping an `authorized_keys` per
 * machine. Nothing here signs certificates; the app only presents one it was
 * given.
 *
 * ssh2 has no API for this. `config.privateKey` takes a string or a Buffer and
 * nothing else, so a certificate and its key cannot be handed to it together.
 * `config.agent` does take an object, and an agent's whole job is to offer
 * identities and sign for them — which is exactly the shape of the problem. So
 * a certificate login here is a one-identity agent that lives in this process:
 * it offers the certificate, and signs with the key the certificate is for.
 */

/* ------------------------------------------------------------------ *
 * Reading a certificate
 * ------------------------------------------------------------------ */

/**
 * Fields between the nonce and the serial, which differ per algorithm. They are
 * skipped rather than read: the public key inside the certificate is checked
 * against the private key through ssh2 further down, which does not need them
 * picked apart by hand.
 */
const KEY_FIELDS = {
    'ssh-rsa-cert-v01@openssh.com': 2,                        // e, n
    'rsa-sha2-256-cert-v01@openssh.com': 2,
    'rsa-sha2-512-cert-v01@openssh.com': 2,
    'ssh-dss-cert-v01@openssh.com': 4,                        // p, q, g, y
    'ssh-ed25519-cert-v01@openssh.com': 1,                    // pk
    'ecdsa-sha2-nistp256-cert-v01@openssh.com': 2,            // curve, pk
    'ecdsa-sha2-nistp384-cert-v01@openssh.com': 2,
    'ecdsa-sha2-nistp521-cert-v01@openssh.com': 2,
};

/** A certificate never expires when its window runs to the end of a uint64. */
const FOREVER = 0xffffffffffffffffn;

function reader(buffer) {
    let cursor = 0;

    const need = (bytes) => {
        if (cursor + bytes > buffer.length) throw new Error('Certificate is truncated');
    };

    return {
        string() {
            need(4);
            const length = buffer.readUInt32BE(cursor);
            need(4 + length);
            const value = buffer.subarray(cursor + 4, cursor + 4 + length);
            cursor += 4 + length;
            return value;
        },
        uint32() {
            need(4);
            const value = buffer.readUInt32BE(cursor);
            cursor += 4;
            return value;
        },
        uint64() {
            need(8);
            const value = buffer.readBigUInt64BE(cursor);
            cursor += 8;
            return value;
        },
        at: () => cursor,
    };
}

/** One SSH wire `string`: a big-endian length followed by the bytes. */
function sshString(value) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(body.length, 0);
    return Buffer.concat([length, body]);
}

/** The plain algorithm a certificate is built over. */
const plainType = (type) => type.replace(/-cert-v01@openssh\.com$/, '');

/** The principals field is one string holding a sequence of strings. */
function readStrings(buffer) {
    const read = reader(buffer);
    const values = [];
    let cursor = 0;
    while (cursor < buffer.length) {
        const value = read.string();
        values.push(value.toString('utf8'));
        cursor += 4 + value.length;
    }
    return values;
}

const fingerprintOf = (blob) =>
    'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');

/**
 * What a certificate says about itself.
 *
 * Throws on anything it cannot read, because a certificate that will not parse
 * here is one that would fail at connect time with nothing to explain it. The
 * caller reports the message; the alternative is storing a broken certificate
 * and finding out on a server.
 */
function parse(text) {
    const line = String(text || '').trim();
    if (!line) return null;

    const [advertised, blob] = line.split(/\s+/);
    if (!blob) throw new Error('That does not look like a certificate');

    const buffer = Buffer.from(blob, 'base64');
    const read = reader(buffer);

    const type = read.string().toString('utf8');
    if (type !== advertised) throw new Error('Certificate type does not match its body');
    if (!(type in KEY_FIELDS)) throw new Error(`Unsupported certificate type: ${type}`);

    read.string(); // nonce

    /**
     * The key fields, kept as raw wire bytes.
     *
     * A certificate holds exactly the fields a plain public key of the same
     * algorithm holds, in the same order and the same encoding — so putting the
     * plain algorithm name in front of them rebuilds the public key the
     * certificate is for, without this having to understand what an RSA modulus
     * or a curve point is. That blob is what says whether a certificate belongs
     * to a given private key.
     */
    const fieldsFrom = read.at();
    for (let field = 0; field < KEY_FIELDS[type]; field++) read.string();
    const publicKey = Buffer.concat([
        sshString(plainType(type)),
        buffer.subarray(fieldsFrom, read.at()),
    ]);

    const serial = read.uint64();
    const kind = read.uint32();
    const keyId = read.string().toString('utf8');
    const principals = readStrings(read.string());
    const validAfter = read.uint64();
    const validBefore = read.uint64();
    read.string(); // critical options
    read.string(); // extensions
    read.string(); // reserved
    const signatureKey = read.string();

    return {
        type,
        publicKey,
        serial: String(serial),
        // A host certificate in a user's keychain is a mistake worth naming: it
        // will never authenticate a login.
        kind: kind === 1 ? 'user' : kind === 2 ? 'host' : 'unknown',
        keyId,
        principals,
        validAfter: Number(validAfter) * 1000,
        validBefore: validBefore >= FOREVER ? null : Number(validBefore) * 1000,
        caFingerprint: fingerprintOf(signatureKey),
    };
}

/** Whether the window has closed, which is the failure nobody diagnoses quickly. */
function isExpired(details, now = Date.now()) {
    if (!details) return false;
    if (details.validBefore !== null && now > details.validBefore) return true;
    return now < details.validAfter;
}

/* ------------------------------------------------------------------ *
 * Signing with one
 * ------------------------------------------------------------------ */

/** The hash each curve signs with, which is fixed by the curve. */
const ECDSA_HASH = {
    'ecdsa-sha2-nistp256-cert-v01@openssh.com': 'sha256',
    'ecdsa-sha2-nistp384-cert-v01@openssh.com': 'sha384',
    'ecdsa-sha2-nistp521-cert-v01@openssh.com': 'sha512',
};

/** RSA certificates are advertised under a SHA-2 name; SHA-1 is refused by
 *  every current OpenSSH, and ssh2 would otherwise sign one with SHA-1. */
const RSA_TYPES = new Set([
    'ssh-rsa-cert-v01@openssh.com',
    'rsa-sha2-256-cert-v01@openssh.com',
    'rsa-sha2-512-cert-v01@openssh.com',
]);
const RSA_ADVERTISED = 'rsa-sha2-512-cert-v01@openssh.com';

/** One SSH `mpint`: minimal big-endian, with a leading zero if the top bit is set. */
function mpint(value) {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start++;

    let body = value.subarray(start);
    if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);

    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(body.length, 0);
    return Buffer.concat([length, body]);
}

/**
 * An ECDSA signature in the form SSH wants, which is not the form OpenSSL gives.
 *
 * ssh2 converts between the two, but only for keys whose type it recognises,
 * and it matches on the plain algorithm names — a certificate's type is not one
 * of them, so its signature would go out in DER and be rejected. Signing here
 * with `ieee-p1363` gives r and s back to back, which is two mpints away from
 * what the wire wants.
 */
function signEcdsa(pem, data, hash) {
    const raw = crypto.sign(hash, data, { key: pem, dsaEncoding: 'ieee-p1363' });
    const half = raw.length / 2;
    return Buffer.concat([mpint(raw.subarray(0, half)), mpint(raw.subarray(half))]);
}

/**
 * Check that a certificate is for this key.
 *
 * The most common mistake by far is pasting the wrong one — a certificate for
 * a key that lives on another machine looks completely normal and fails as
 * "permission denied". Both sides are asked for the public key they represent;
 * a certificate is a public key with paperwork, so they must agree.
 */
function matchesKey(certificate, privateKey, passphrase) {
    const details = parse(certificate);
    if (!details) return false;

    const key = parseKey(privateKey, passphrase || undefined);
    if (key instanceof Error) throw new Error(`Could not read the private key: ${key.message}`);

    return details.publicKey.equals(key.getPublicSSH());
}

/**
 * The same check against a stored public key, which needs no secret and works
 * while editing a key whose private half was left alone. `null` means there was
 * nothing to compare against, which is not the same answer as "no".
 */
function matchesPublicKey(certificate, publicKey) {
    const details = parse(certificate);
    if (!details) return null;

    const blob = String(publicKey || '').trim().split(/\s+/)[1];
    if (!blob) return null;

    return details.publicKey.equals(Buffer.from(blob, 'base64'));
}

/**
 * A one-identity agent that logs in with `certificate`, signing with `privateKey`.
 *
 * Handed to ssh2 as `config.agent`. Nothing leaves this process: it is the
 * in-memory shape of an agent, not a socket, and it exists only for the life of
 * one connection attempt.
 */
function agentFor({ privateKey, passphrase, certificate }) {
    const key = parseKey(privateKey, passphrase || undefined);
    if (key instanceof Error) throw new Error(`Could not read the private key: ${key.message}`);
    if (key.getPrivatePEM() === null) throw new Error('That key has no private half to sign with');

    const cert = parseKey(certificate);
    if (cert instanceof Error) throw new Error(`Could not read the certificate: ${cert.message}`);

    const rsa = RSA_TYPES.has(cert.type);
    const ecdsaHash = ECDSA_HASH[cert.type];

    /**
     * The identity offered to the server: the certificate, under the algorithm
     * name it should be advertised as. Built by inheriting from the parsed
     * certificate rather than by hand, so ssh2 still recognises it as one of
     * its own keys and reads the blob straight off it.
     */
    const identity = Object.create(cert);
    if (rsa) identity.type = RSA_ADVERTISED;

    const pem = key.getPrivatePEM();

    return new class CertificateAgent extends BaseAgent {
        getIdentities(callback) {
            callback(null, [identity]);
        }

        sign(pubKey, data, options, callback) {
            if (typeof options === 'function') callback = options;

            try {
                if (ecdsaHash) {
                    callback(null, signEcdsa(pem, data, ecdsaHash));
                    return;
                }

                // ssh2 frames the result itself, so this is the bare signature.
                // RSA is pinned to SHA-512 to match the name it is advertised
                // under; ed25519 takes no hash at all.
                const signature = key.sign(data, rsa ? 'sha512' : undefined);
                if (signature instanceof Error) throw signature;
                callback(null, signature);
            } catch (error) {
                callback(error);
            }
        }
    }();
}

module.exports = { parse, isExpired, matchesKey, matchesPublicKey, agentFor };
