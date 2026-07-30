const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { createAgent } = require('ssh2');

/** Windows OpenSSH exposes its agent as a named pipe rather than a socket. */
const WINDOWS_OPENSSH_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

/** An unreachable agent must not stall a connection attempt. */
const PROBE_TIMEOUT = 5000;

/**
 * Agents worth trying, most likely first.
 *
 * `SSH_AUTH_SOCK` wins everywhere. If the user exported it, that is the agent
 * they mean, including under Git Bash or WSL interop. Windows then gets the
 * OpenSSH pipe and Pageant, which ssh2 recognises by that literal string. The
 * pipe is tried even when `existsSync` says no: the pipe namespace does not
 * always answer a stat, and a dead candidate costs one fast failure.
 */
function candidatePaths(configured) {
    const explicit = (configured || '').trim();
    if (explicit) return [explicit];

    const candidates = [];
    if (process.env.SSH_AUTH_SOCK) candidates.push(process.env.SSH_AUTH_SOCK);

    if (process.platform === 'win32') {
        let pipeExists = false;
        try {
            pipeExists = fs.existsSync(WINDOWS_OPENSSH_PIPE);
        } catch {
            // Probing the pipe namespace failed; try it anyway below.
        }
        if (pipeExists) candidates.unshift(WINDOWS_OPENSSH_PIPE);
        else candidates.push(WINDOWS_OPENSSH_PIPE);
        candidates.push('pageant');
    }

    return candidates;
}

/** The agent shown as the default before anything has been probed. */
const defaultAgentPath = (configured) => candidatePaths(configured)[0] || '';

/** Which agent a stored (possibly blank, meaning "auto") setting resolves to. */
const resolvePath = (configured) => (configured || '').trim() || defaultAgentPath();

const fingerprint = (blob) =>
    'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');

function describe(key) {
    let print = '';
    try {
        print = fingerprint(key.getPublicSSH());
    } catch {
        // A key type ssh2 could not re-serialise; the type alone still helps.
    }
    return { type: key.type || 'unknown', comment: key.comment || '', fingerprint: print };
}

const describeLocation = (path) => {
    if (path === 'pageant') return 'Pageant';
    if (path === WINDOWS_OPENSSH_PIPE) return 'Windows OpenSSH agent';
    return path;
};

/* ------------------------------------------------------------------ *
 * Asking the agent directly
 * ------------------------------------------------------------------ */

/**
 * The keys an agent is holding, read off the wire ourselves.
 *
 * ssh2 parses every identity an agent returns and quietly drops the ones it
 * cannot read — its own comment says as much, and the list it hands back is
 * short by however many those were. That silence is the problem: a security key
 * is exactly the kind ssh2 does not understand, so someone with a YubiKey in
 * their agent sees a shorter list here than `ssh-add -l` gives them, with
 * nothing to say why, and the key is never offered at connect time either.
 *
 * The agent protocol is small enough to ask directly, so this reads the
 * identity list without parsing the keys, and the caller compares the two.
 * Nothing here needs to understand a key to count it and name its algorithm.
 */
const AGENTC_REQUEST_IDENTITIES = 11;
const AGENT_IDENTITIES_ANSWER = 12;

/** Enough for any plausible identity list; a runaway reply is not read forever. */
const MAX_REPLY = 256 * 1024;

function rawIdentities(path) {
    return new Promise((resolve) => {
        // Pageant is not a socket — ssh2 reaches it through a different IPC
        // entirely — so there is nothing to connect to here. Answering "unknown"
        // is honest; guessing at zero would invent a discrepancy.
        if (!path || path === 'pageant') {
            resolve(null);
            return;
        }

        let socket;
        try {
            socket = net.connect(path);
        } catch {
            resolve(null);
            return;
        }

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                socket.destroy();
            } catch {
                // Already gone; the answer is what matters.
            }
            resolve(value);
        };

        const timer = setTimeout(() => finish(null), PROBE_TIMEOUT);

        socket.on('error', () => finish(null));
        socket.on('close', () => finish(null));

        socket.on('connect', () => {
            const request = Buffer.allocUnsafe(5);
            request.writeUInt32BE(1, 0);
            request[4] = AGENTC_REQUEST_IDENTITIES;
            socket.write(request);
        });

        let buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_REPLY) {
                finish(null);
                return;
            }
            if (buffer.length < 4) return;

            const length = buffer.readUInt32BE(0);
            if (length > MAX_REPLY) {
                finish(null);
                return;
            }
            if (buffer.length < 4 + length) return;

            finish(readIdentityList(buffer.subarray(4, 4 + length)));
        });
    });
}

/** `byte 12; uint32 nkeys; { string blob, string comment } * nkeys`. */
function readIdentityList(body) {
    if (body.length < 5 || body[0] !== AGENT_IDENTITIES_ANSWER) return null;

    const identities = [];
    let cursor = 1;

    const readString = () => {
        if (cursor + 4 > body.length) return null;
        const length = body.readUInt32BE(cursor);
        if (cursor + 4 + length > body.length) return null;
        const value = body.subarray(cursor + 4, cursor + 4 + length);
        cursor += 4 + length;
        return value;
    };

    const count = body.readUInt32BE(cursor);
    cursor += 4;

    for (let index = 0; index < count; index++) {
        const blob = readString();
        if (!blob) return null;
        const comment = readString();
        if (!comment) return null;

        // The algorithm is the first field of the blob, which is all this needs
        // to read — the key itself stays an opaque run of bytes.
        const nameLength = blob.length >= 4 ? blob.readUInt32BE(0) : 0;
        const type = nameLength > 0 && nameLength <= blob.length - 4
            ? blob.subarray(4, 4 + nameLength).toString('latin1')
            : '';

        identities.push({ type, comment: comment.toString('utf8'), fingerprint: fingerprint(blob) });
    }

    return identities;
}

/** Ask one specific agent what it is holding. */
function probeOne(path) {
    return new Promise((resolve) => {
        let agent;
        try {
            agent = createAgent(path);
        } catch (error) {
            resolve({ available: false, path, location: describeLocation(path), message: error.message });
            return;
        }

        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ path, location: describeLocation(path), ...value });
        };

        const timer = setTimeout(
            () => settle({ available: false, message: 'The agent did not respond' }),
            PROBE_TIMEOUT
        );

        try {
            agent.getIdentities(async (error, keys) => {
                if (error) {
                    settle({ available: false, message: error.message });
                    return;
                }

                const usable = (keys || []).map(describe);

                // Which of the agent's keys ssh2 threw away on the way here.
                // Asked only once there is an answer to compare against, so a
                // dead agent still costs one failure rather than two.
                const all = await rawIdentities(path);
                const known = new Set(usable.map(identity => identity.fingerprint).filter(Boolean));
                const unusable = all === null
                    ? []
                    : all.filter(identity => !known.has(identity.fingerprint));

                settle({ available: true, identities: usable, unusable });
            });
        } catch (error) {
            // Pageant throws synchronously when it is not running.
            settle({ available: false, message: error.message });
        }
    });
}

/**
 * Find a live agent. With no configured path this walks the candidates and
 * returns the first that answers, so "Agent" works against whichever agent the
 * machine actually runs. The last failure is returned when none do, which is
 * what the host editor shows instead of letting the user discover it as an
 * opaque authentication failure at connect time.
 */
async function probe(configuredPath) {
    const candidates = candidatePaths(configuredPath);

    if (candidates.length === 0) {
        return {
            available: false,
            path: '',
            message: 'No agent found. Set SSH_AUTH_SOCK, or start an agent and check again.',
        };
    }

    let last = null;
    for (const path of candidates) {
        const result = await probeOne(path);
        if (result.available) return result;
        last = result;
    }
    return last;
}

module.exports = {
    candidatePaths,
    defaultAgentPath,
    resolvePath,
    describeLocation,
    probe,
    rawIdentities,
};
