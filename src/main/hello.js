const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { BaseAgent, utils: { parseKey } } = require('ssh2');

/**
 * Windows Hello.
 *
 * Two things come out of one mechanism. Hello holds an RSA-2048 key pair in the
 * TPM and will sign with it once you have shown a face, a finger or a PIN, and
 * the private half cannot be exported by anyone, including this app.
 *
 *   - As an unlock: sign a fixed challenge, and the signature is a key that
 *     wraps the vault's data key. Stable across calls, so it is a key and not
 *     just a prompt — see vault.js.
 *   - As an SSH key: the signature is RSASSA-PKCS1-v1_5 over SHA-256, which is
 *     precisely SSH's `rsa-sha2-256`. So the credential can be an SSH identity
 *     outright, with an `authorized_keys` line derived from its public half and
 *     a private half that never exists outside the TPM.
 *
 * Electron exposes none of this and there is no npm package that does without a
 * native build toolchain, so it goes through a small console helper compiled
 * from tools/HelloHelper.cs. Every call spawns it; the ones that sign put a
 * prompt on screen.
 */

/** Answers are `key=value` lines, one per line, on stdout. */
function parseFields(text) {
    const fields = {};
    for (const line of String(text || '').split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1);
    }
    return fields;
}

let helperPath = null;

/**
 * Where the helper is, in a build and in a checkout.
 *
 * Packaged it rides in `resources` beside the asar; in development it is
 * whatever `npm run build:hello` last wrote. Resolved once and remembered,
 * because it is asked for on every connection.
 */
function findHelper() {
    if (helperPath !== null) return helperPath;

    const candidates = [
        // Packaged. `extraResources` maps `resources/` to `resources/` inside
        // the app's own resources directory, so it nests; the flat path is
        // checked too, because that mapping is one line in package.json and a
        // wrong guess here only fails in a build, which is the worst place to
        // work it out.
        process.resourcesPath && path.join(process.resourcesPath, 'resources', 'hello-helper.exe'),
        process.resourcesPath && path.join(process.resourcesPath, 'hello-helper.exe'),
        // A checkout, running from source.
        path.join(app.getAppPath(), 'resources', 'hello-helper.exe'),
        path.join(__dirname, '..', '..', 'resources', 'hello-helper.exe'),
    ].filter(Boolean);

    helperPath = candidates.find(candidate => fs.existsSync(candidate)) || '';
    return helperPath;
}

/** Signing waits on a person, so it gets far longer than the quiet calls. */
const PROMPT_TIMEOUT = 130000;
const QUIET_TIMEOUT = 25000;

function run(args, { input, timeout = QUIET_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
        const helper = findHelper();
        if (!helper) {
            reject(new Error('The Windows Hello helper is missing from this build'));
            return;
        }

        const child = execFile(helper, args, {
            timeout,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        }, (error, stdout) => {
            const fields = parseFields(stdout);
            // A non-zero exit is expected for "the user cancelled" and "no such
            // credential", so the status matters more than the code. Only a
            // helper that said nothing at all is a hard failure.
            if (error && Object.keys(fields).length === 0) {
                reject(new Error(error.killed
                    ? 'Windows Hello did not answer in time'
                    : `Could not run the Windows Hello helper: ${error.message}`));
                return;
            }
            resolve(fields);
        });

        if (input !== undefined) {
            child.stdin.end(input);
        }
    });
}

const isWindows = () => process.platform === 'win32';

/** Whether this machine can do any of it. Cheap, and never prompts. */
async function isSupported() {
    if (!isWindows() || !findHelper()) return false;
    try {
        const fields = await run(['supported']);
        return fields.supported === 'True';
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------ *
 * Public keys
 * ------------------------------------------------------------------ */

const sshString = (value) => {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(body.length, 0);
    return Buffer.concat([length, body]);
};

/** An SSH `mpint` is signed, so a leading zero goes on when the top bit is set. */
function mpint(buffer) {
    let start = 0;
    while (start < buffer.length - 1 && buffer[start] === 0) start++;

    let body = buffer.subarray(start);
    if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
    return sshString(body);
}

/**
 * The X.509 public key Hello hands out, as the `ssh-rsa` line a server wants.
 *
 * Same key, two encodings: SSH names the algorithm and then lists the exponent
 * and modulus, where X.509 wraps them in an AlgorithmIdentifier. Going through
 * a JWK is the shortest honest route between the two.
 */
function toSshPublicKey(spkiBase64, comment = 'windows-hello') {
    const key = crypto.createPublicKey({
        key: Buffer.from(spkiBase64, 'base64'),
        format: 'der',
        type: 'spki',
    });

    if (key.asymmetricKeyType !== 'rsa') {
        throw new Error(`Windows Hello returned an unexpected key type: ${key.asymmetricKeyType}`);
    }

    const jwk = key.export({ format: 'jwk' });
    const blob = Buffer.concat([
        sshString('ssh-rsa'),
        mpint(Buffer.from(jwk.e, 'base64url')),
        mpint(Buffer.from(jwk.n, 'base64url')),
    ]);

    return {
        publicKey: `ssh-rsa ${blob.toString('base64')}${comment ? ` ${comment}` : ''}`,
        fingerprint: 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, ''),
    };
}

/* ------------------------------------------------------------------ *
 * Credentials
 * ------------------------------------------------------------------ */

/**
 * Make a credential, or replace the one under this name.
 *
 * Prompts. Comes back with the public half in both forms: the SSH line to put
 * in `authorized_keys`, and the raw X.509 the vault records so it can tell
 * whether the credential was reset behind its back.
 */
async function create(name, comment) {
    const fields = await run(['create', name], { timeout: PROMPT_TIMEOUT });
    if (fields.status !== 'Success') {
        throw new Error(describeStatus(fields, 'Windows Hello did not create a credential'));
    }
    return { spki: fields.publicKey, ...toSshPublicKey(fields.publicKey, comment) };
}

/** The public half of an existing credential. Never prompts. */
async function publicKey(name, comment) {
    const fields = await run(['publickey', name]);
    if (fields.status !== 'Success') return null;
    return { spki: fields.publicKey, ...toSshPublicKey(fields.publicKey, comment) };
}

/** Sign with the credential. Prompts, every time, by design. */
async function sign(name, data) {
    const fields = await run(['sign', name], {
        input: Buffer.from(data).toString('base64'),
        timeout: PROMPT_TIMEOUT,
    });

    if (fields.status !== 'Success') {
        throw new Error(describeStatus(fields, 'That Windows Hello credential is gone'));
    }
    if (fields.signStatus !== 'Success') {
        throw new Error(describeStatus({ status: fields.signStatus, message: fields.message },
            'Windows Hello did not sign'));
    }
    return Buffer.from(fields.signature, 'base64');
}

async function remove(name) {
    try {
        await run(['delete', name]);
        return true;
    } catch {
        // A credential that cannot be deleted is not worth failing over: it is
        // useless without the record that names it.
        return false;
    }
}

/** The helper's status words, in language worth showing someone. */
function describeStatus(fields, fallback) {
    switch (fields.status) {
        case 'UserCanceled': return 'Windows Hello was cancelled';
        case 'UserPrefersPassword': return 'Windows Hello was declined in favour of a password';
        case 'NotFound': return 'That Windows Hello credential no longer exists on this machine';
        case 'SecurityDeviceLocked': return 'Windows Hello is locked after too many attempts';
        case 'CredentialAlreadyExists': return 'A Windows Hello credential of that name already exists';
        default: return fields.message || fallback;
    }
}

/* ------------------------------------------------------------------ *
 * Signing into servers
 * ------------------------------------------------------------------ */

/**
 * A one-identity agent that logs in as a Hello credential.
 *
 * ssh2 has no way to be handed a key it cannot hold the private half of, but an
 * agent is exactly that by definition — it offers identities and signs for
 * them, and where the signing happens is its own business. Here it happens in
 * the TPM.
 *
 * The hash is not negotiable: Hello always signs PKCS#1 v1.5 over SHA-256, so
 * this only works where the server accepts `rsa-sha2-256`. ssh2 asks for that
 * first when a server offers it, which every OpenSSH since 7.2 does, and the
 * check below turns anything else into a message rather than a signature the
 * server will silently refuse.
 */
function agentFor(name, publicKeyLine) {
    const identity = parseKey(publicKeyLine);
    if (identity instanceof Error) {
        throw new Error(`Could not read the Windows Hello public key: ${identity.message}`);
    }

    return new class HelloAgent extends BaseAgent {
        getIdentities(callback) {
            callback(null, [identity]);
        }

        sign(pubKey, data, options, callback) {
            if (typeof options === 'function') callback = options;

            const hash = options && options.hash;
            if (hash && hash !== 'sha256') {
                callback(new Error(
                    `This server asked for a ${hash} signature. A Windows Hello key can only sign `
                    + 'SHA-256 (rsa-sha2-256), so it cannot be used here.'));
                return;
            }

            sign(name, data).then(
                signature => callback(null, signature),
                error => callback(error),
            );
        }
    }();
}

module.exports = {
    isSupported,
    create,
    publicKey,
    sign,
    remove,
    agentFor,
    toSshPublicKey,
};
