const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const store = require('./store');
const vncAuth = require('./vnc-auth');
const { dial } = require('./desktop-dial');
const { validateDesktop, describeDesktop } = require('./desktop-config');
const { proxyHops } = require('./proxy-config');

/**
 * Remote desktop (RFB/VNC) for a pane.
 *
 * Two problems have to be solved to put a desktop in an Electron window, and
 * this module is both of them.
 *
 * 1. The renderer cannot open a TCP socket. noVNC therefore speaks RFB over a
 *    WebSocket, so a listener on loopback bridges the two: WebSocket on the
 *    near side, and on the far side either a `direct-tcpip` channel over the
 *    tab's own SSH connection (the interesting case, since the VNC port never
 *    has to leave the server) or a plain socket.
 *
 *    The listener is bound to 127.0.0.1 on an ephemeral port, its path is a
 *    128-bit single-use token, and it stops listening the moment the renderer
 *    has attached. Nothing else on the machine gets a second chance at it.
 *
 * 2. Authentication has to happen *here*, not in the renderer. The store's rule
 *    is that a stored secret never travels main -> renderer, and a VNC password
 *    is a stored secret; handing it to a window that also renders untrusted
 *    remote output to get it back out again would be the one hole in that rule.
 *
 *    So this is not a dumb pipe. It completes the RFB handshake with the server
 *    itself (§7.1: version, security type, challenge-response), and then plays
 *    the *server* side of a fresh 3.8 "no authentication" handshake to noVNC.
 *    From ClientInit onwards every byte is passed through untouched. The
 *    renderer draws a desktop it never had a credential for.
 *
 * Runtime state is keyed by pane, so a desktop dies with the session carrying it.
 */

/** Counters are coalesced to this cadence: a live desktop must not storm IPC. */
const UPDATE_INTERVAL = 250;

/** How long a prepared session waits for the renderer to attach before giving up. */
const ARM_TIMEOUT = 20000;

/** Give up on a server that accepts a socket and then says nothing. */
const HANDSHAKE_TIMEOUT = 20000;

/**
 * Bounds on how far ahead of the WebSocket the far end is allowed to get.
 * Framebuffer updates arrive faster than a busy renderer drains them, and
 * without this the buffered frames would be unbounded memory.
 */
const SEND_HIGH_WATER = 4 * 1024 * 1024;
const SEND_LOW_WATER = 1 * 1024 * 1024;

/** A clipboard paste is the only large client -> server message; 4MB is ample. */
const MAX_WS_PAYLOAD = 4 * 1024 * 1024;

/** RFB security types, by the numbers in the registry. */
const SECURITY = {
    INVALID: 0,
    NONE: 1,
    VNC_AUTH: 2,
};

/** Only for telling the user what a server offered that we could not use. */
const SECURITY_NAMES = {
    5: 'RA2',
    6: 'RA2ne',
    16: 'Tight',
    17: 'Ultra',
    18: 'TLS',
    19: 'VeNCrypt',
    20: 'SASL',
    21: 'MD5 hash',
    30: 'Apple Remote Desktop',
    113: 'RSA-AES',
    114: 'RSA-AES-Unencrypted',
};

// paneId -> session
const byPane = new Map();

let notify = () => {};
let updateTimer = null;
const dirtyPanes = new Set();

function setNotifier(fn) {
    notify = fn;
}

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

/** The renderer-visible shape. Sockets, tokens and passwords stay on this side. */
function snapshot(session) {
    return {
        paneId: session.paneId,
        hostId: session.hostId,
        state: session.state,
        message: session.message,
        lastError: session.lastError,
        transport: session.config.transport,
        address: describeDesktop(session.config),
        desktopName: session.desktopName,
        // What this desktop is reached through, for the pane header's route mark.
        // Names and addresses only; the credentials stay on this side.
        route: session.route,
        bytesUp: session.bytesUp,
        bytesDown: session.bytesDown,
        openedAt: session.openedAt,
    };
}

function get(paneId) {
    const session = byPane.get(paneId);
    return session ? snapshot(session) : null;
}

function markDirty(paneId) {
    dirtyPanes.add(paneId);
    if (updateTimer) return;

    updateTimer = setInterval(() => {
        if (dirtyPanes.size === 0) {
            clearInterval(updateTimer);
            updateTimer = null;
            return;
        }
        for (const id of [...dirtyPanes]) {
            dirtyPanes.delete(id);
            notify('vnc-update', { paneId: id, session: get(id) });
        }
    }, UPDATE_INTERVAL);
}

/** Push immediately, for state changes where a quarter-second lag is visible. */
function flush(paneId) {
    dirtyPanes.delete(paneId);
    notify('vnc-update', { paneId, session: get(paneId) });
}

function setState(session, state, message = '') {
    session.state = state;
    session.message = message;
    if (state === 'error') session.lastError = message;
    flush(session.paneId);
}

/* ------------------------------------------------------------------ *
 * Reading an exact number of bytes
 * ------------------------------------------------------------------ */

/**
 * A promise-shaped reader over a paused stream.
 *
 * The handshake is a sequence of fixed-size reads, which is painful to express
 * against `'data'` events and easy to get subtly wrong (a short read that
 * happens to work on loopback and fails over a real link). Everything arrives
 * here first; `read(n)` resolves once n bytes are in hand.
 */
class Reader {
    constructor(stream) {
        this.stream = stream;
        this.buffer = Buffer.alloc(0);
        this.want = 0;
        this.resolve = null;
        this.reject = null;
        this.failure = null;

        this.onData = (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.settle();
        };
        this.onEnd = () => this.fail(new Error('The server closed the connection'));
        this.onError = (error) => this.fail(error);

        stream.on('data', this.onData);
        stream.on('end', this.onEnd);
        stream.on('close', this.onEnd);
        stream.on('error', this.onError);
    }

    settle() {
        if (!this.resolve || this.buffer.length < this.want) return;
        const taken = this.buffer.subarray(0, this.want);
        this.buffer = this.buffer.subarray(this.want);
        const resolve = this.resolve;
        this.resolve = null;
        this.reject = null;
        this.want = 0;
        resolve(taken);
    }

    fail(error) {
        // The first failure is the real one; a socket error is usually followed
        // by a close that would otherwise overwrite the useful message.
        this.failure = this.failure || error;
        const reject = this.reject;
        this.resolve = null;
        this.reject = null;
        if (reject) reject(this.failure);
    }

    read(count) {
        if (this.failure) return Promise.reject(this.failure);
        return new Promise((resolve, reject) => {
            this.want = count;
            this.resolve = resolve;
            this.reject = reject;
            this.settle();
        });
    }

    /**
     * Stop reading and hand back whatever arrived beyond the handshake. Nothing
     * should have, since the server waits for ClientInit, but a byte dropped
     * here would desynchronise the whole stream.
     */
    detach() {
        this.stream.removeListener('data', this.onData);
        this.stream.removeListener('end', this.onEnd);
        this.stream.removeListener('close', this.onEnd);
        this.stream.removeListener('error', this.onError);
        const rest = this.buffer;
        this.buffer = Buffer.alloc(0);
        return rest;
    }
}

/** Reject if a handshake stalls, so a silent server cannot hold a pane forever. */
function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); }
        );
    });
}

/* ------------------------------------------------------------------ *
 * The RFB handshake, server side (we are the client)
 * ------------------------------------------------------------------ */

/** `RFB 003.008\n` -> 3.8, clamped to what we implement. */
function parseVersion(banner) {
    const text = banner.toString('latin1');
    const match = text.match(/^RFB (\d{3})\.(\d{3})\n$/);
    if (!match) {
        throw new Error('This does not look like a VNC server (bad RFB greeting)');
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major !== 3) throw new Error(`Unsupported RFB major version ${major}`);
    // 3.4 and 3.6 exist in the wild as mislabelled 3.3.
    if (minor >= 8) return 8;
    if (minor >= 7) return 7;
    return 3;
}

/** A failure reason string: 4-byte length then UTF-8. */
async function readReason(reader) {
    try {
        const length = (await reader.read(4)).readUInt32BE(0);
        if (length === 0 || length > 4096) return '';
        return (await reader.read(length)).toString('utf8').trim();
    } catch {
        return ''; // The server hung up instead of explaining.
    }
}

/** Pick a security type we can actually complete, or explain why we cannot. */
function chooseSecurity(types, hasPassword) {
    if (hasPassword && types.includes(SECURITY.VNC_AUTH)) return SECURITY.VNC_AUTH;
    if (types.includes(SECURITY.NONE)) return SECURITY.NONE;

    if (types.includes(SECURITY.VNC_AUTH)) {
        const error = new Error('This VNC server requires a password. Add one in the host\'s remote desktop settings.');
        error.needsPassword = true;
        throw error;
    }

    const offered = types
        .map(type => SECURITY_NAMES[type] || `type ${type}`)
        .join(', ');
    throw new Error(
        `No supported authentication. The server offered ${offered || 'nothing usable'}; `
        + 'this client supports None and VNC password authentication.'
    );
}

/**
 * Take the connection from the greeting to an authenticated session, leaving
 * the server waiting for ClientInit.
 */
async function negotiateWithServer(reader, stream, password) {
    const version = parseVersion(await reader.read(12));
    stream.write(Buffer.from(`RFB 003.00${version}\n`, 'latin1'));

    let chosen;

    if (version >= 7) {
        const count = (await reader.read(1))[0];
        if (count === 0) {
            const reason = await readReason(reader);
            throw new Error(reason || 'The server refused the connection');
        }
        const types = [...(await reader.read(count))];
        chosen = chooseSecurity(types, Boolean(password));
        stream.write(Buffer.from([chosen]));
    } else {
        // 3.3: the server dictates one type as a 32-bit value, and we do not
        // get to answer with a choice.
        const type = (await reader.read(4)).readUInt32BE(0);
        if (type === SECURITY.INVALID) {
            const reason = await readReason(reader);
            throw new Error(reason || 'The server refused the connection');
        }
        chosen = chooseSecurity([type], Boolean(password));
    }

    if (chosen === SECURITY.VNC_AUTH) {
        const challenge = await reader.read(16);
        stream.write(vncAuth.respond(password, challenge));
    }

    // Before 3.8 a passwordless session gets no SecurityResult at all, and
    // waiting for one would hang against exactly the oldest servers.
    if (chosen === SECURITY.NONE && version < 8) return { version, chosen };

    const result = (await reader.read(4)).readUInt32BE(0);
    if (result !== 0) {
        const reason = version >= 8 ? await readReason(reader) : '';
        if (chosen === SECURITY.VNC_AUTH) {
            const error = new Error(reason || 'The VNC password was rejected');
            error.authFailed = true;
            throw error;
        }
        throw new Error(reason || 'The server rejected the connection');
    }

    return { version, chosen };
}

/* ------------------------------------------------------------------ *
 * The RFB handshake, client side (we are the server, to noVNC)
 * ------------------------------------------------------------------ */

/**
 * Present a plain 3.8 "no authentication" handshake to the renderer.
 *
 * Always 3.8 and always None, whatever was negotiated upstream: noVNC has no
 * credential and needs none, and pinning the version means the byte stream the
 * renderer sees is the same shape against every server.
 */
function negotiateWithClient(ws) {
    return new Promise((resolve, reject) => {
        let stage = 'version';
        let buffer = Buffer.alloc(0);

        const cleanup = () => {
            ws.off('message', onMessage);
            ws.off('close', onClose);
            ws.off('error', onClose);
        };

        const onClose = () => {
            cleanup();
            reject(new Error('The viewer closed before the handshake finished'));
        };

        const onMessage = (data) => {
            buffer = Buffer.concat([buffer, Buffer.from(data)]);

            if (stage === 'version') {
                if (buffer.length < 12) return;
                // Not checked: there is exactly one version on offer, and the
                // only client is our own view.
                buffer = buffer.subarray(12);
                stage = 'security';
                ws.send(Buffer.from([1, SECURITY.NONE]));
            }

            if (stage === 'security') {
                if (buffer.length < 1) return;
                const chosen = buffer[0];
                buffer = buffer.subarray(1);
                if (chosen !== SECURITY.NONE) {
                    cleanup();
                    reject(new Error(`The viewer asked for security type ${chosen}`));
                    return;
                }
                stage = 'done';
                ws.send(Buffer.alloc(4)); // SecurityResult: OK
                cleanup();
                // Anything already pipelined behind the choice is ClientInit,
                // and belongs to the far end rather than to this handshake.
                resolve(buffer);
            }
        };

        ws.on('message', onMessage);
        ws.on('close', onClose);
        ws.on('error', onClose);
        ws.send(Buffer.from('RFB 003.008\n', 'latin1'));
    });
}

/* ------------------------------------------------------------------ *
 * Passthrough
 * ------------------------------------------------------------------ */

/**
 * Join the WebSocket to the far end for the rest of the session.
 *
 * Both directions are flow-controlled. Framebuffer updates outrun a busy
 * renderer, and a paste can outrun a slow link, so neither side is allowed to
 * queue without bound in the other's direction.
 */
function passthrough(session, leftovers) {
    const { ws, stream } = session;

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        try {
            ws.close();
        } catch {
            // Already going.
        }
        stream.destroy?.();
        // A desktop that has lost its stream is over; the pane offers a retry.
        if (session.state === 'active') setState(session, 'closed', 'The desktop session ended');
    };

    // Server -> viewer.
    stream.on('data', (chunk) => {
        session.bytesDown += chunk.length;
        markDirty(session.paneId);

        if (ws.readyState !== ws.OPEN) return;
        ws.send(chunk, () => {
            if (stream.isPaused() && ws.bufferedAmount < SEND_LOW_WATER) stream.resume();
        });
        if (ws.bufferedAmount > SEND_HIGH_WATER) stream.pause();
    });

    // Viewer -> server.
    ws.on('message', (data) => {
        const chunk = Buffer.from(data);
        session.bytesUp += chunk.length;
        markDirty(session.paneId);

        if (!stream.write(chunk)) {
            ws.pause();
            stream.once('drain', () => ws.resume());
        }
    });

    stream.on('end', close);
    stream.on('close', close);
    stream.on('error', close);
    ws.on('close', close);
    ws.on('error', close);

    // ClientInit, if noVNC sent it in the same frame as its security choice.
    if (leftovers?.length) stream.write(leftovers);
}

/* ------------------------------------------------------------------ *
 * The loopback WebSocket listener
 * ------------------------------------------------------------------ */

/**
 * Listen on 127.0.0.1 for exactly one viewer.
 *
 * The token in the path is the whole authorisation: `Origin` is not checked
 * because a `file://` renderer does not send a usable one, and a 128-bit
 * single-use secret on a loopback-only ephemeral port is the stronger claim
 * anyway. `ws` answers a mismatched path with 400 before upgrading.
 */
function listen(session) {
    return new Promise((resolve, reject) => {
        const server = new WebSocketServer({
            host: '127.0.0.1',
            port: 0,
            path: `/${session.token}`,
            maxPayload: MAX_WS_PAYLOAD,
            // RFB is already compressed by Tight or ZRLE. Deflating it again
            // costs CPU on every frame and saves nothing.
            perMessageDeflate: false,
            clientTracking: false,
        });

        server.once('error', (error) => reject(error));

        server.once('listening', () => {
            session.wss = server;
            resolve(server.address().port);
        });

        server.on('connection', (ws, request) => {
            // Defence in depth behind the `path` option, which has already
            // matched: one connection, and nothing after it.
            const expected = `/${session.token}`;
            const actual = (request.url || '').split('?')[0];
            if (actual.length !== expected.length
                || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
                ws.close(1008, 'Unauthorised');
                return;
            }

            if (session.ws) {
                ws.close(1008, 'Already attached');
                return;
            }

            // Stops accepting; the connection just made stays open.
            try {
                server.close();
            } catch {
                // Already closed.
            }
            session.wss = null;
            session.ws = ws;

            clearTimeout(session.armTimer);
            session.armTimer = null;

            attach(session, ws);
        });
    });
}

/** Finish the handshake with the viewer and start passing bytes. */
async function attach(session, ws) {
    ws.binaryType = 'nodebuffer';

    try {
        // The far end is idle here: it is waiting for ClientInit, which only
        // arrives once the viewer is through its own handshake.
        const clientRest = await negotiateWithClient(ws);

        // Paused across the handover so nothing can arrive between the reader
        // letting go of `'data'` and the passthrough taking it over.
        session.stream.pause();
        const serverRest = session.reader.detach();
        session.reader = null;

        passthrough(session, clientRest);

        // Anything the server said before we were watching still belongs to the
        // viewer, and would desynchronise the stream if it were dropped.
        if (serverRest.length) {
            session.bytesDown += serverRest.length;
            ws.send(serverRest);
        }

        session.stream.resume();
        session.openedAt = Date.now();
        setState(session, 'active');
    } catch (error) {
        // The viewer went away or spoke nonsense. The far end is useless now.
        session.stream?.destroy?.();
        setState(session, 'error', error.message);
    }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

/**
 * Prepare a desktop for a pane and return the address its viewer should attach
 * to.
 *
 * Everything that can fail with a message worth reading (no SSH session, a
 * refused port, a rejected password) fails inside this call, so the view gets
 * a real error instead of an opaque socket close a moment later.
 */
async function open(paneId, hostId) {
    // Re-opening is how the view retries, so a stale session is replaced rather
    // than refused.
    close(paneId, { silent: true });

    const config = store.resolveDesktop(hostId);
    if (!config) return { success: false, message: 'Host not found' };

    const invalid = validateDesktop(config);
    if (invalid) return { success: false, message: invalid };

    // A proxy the host names and that is no longer there. Reported rather than
    // dialled around: see the note in store.resolveCredentials.
    if (config.proxyError) return { success: false, message: config.proxyError };

    const session = {
        paneId,
        hostId,
        // The password is deliberately not kept on the session: it is used
        // during the handshake below and then has no further purpose here. Nor
        // is the proxy chain, for the same reason: the dial happens inside this
        // call, so nothing after it has any use for the credential.
        config: {
            transport: config.transport,
            host: config.host,
            port: config.port,
            shared: config.shared,
            viewOnly: config.viewOnly,
            scaling: config.scaling,
            quality: config.quality,
            compression: config.compression,
        },
        state: 'connecting',
        message: '',
        lastError: '',
        desktopName: '',
        /*
         * The path to this desktop. Only a directly dialled one has a path of its
         * own: under `tunnel` it is a channel on the pane's SSH session, whose own
         * path the header is already showing.
         */
        route: config.transport === 'direct'
            ? [
                ...proxyHops(config.proxyChain),
                {
                    kind: 'host',
                    label: store.describeHost(hostId).name,
                    detail: `${config.host}:${config.port}`,
                },
            ]
            : [],
        token: crypto.randomBytes(16).toString('hex'),
        stream: null,
        reader: null,
        wss: null,
        ws: null,
        armTimer: null,
        bytesUp: 0,
        bytesDown: 0,
        openedAt: 0,
        close: null,
    };

    byPane.set(paneId, session);
    flush(paneId);

    let stream;
    try {
        stream = await dial(paneId, config);
    } catch (error) {
        setState(session, 'error', error.message);
        return { success: false, message: error.message };
    }

    // The session may have been closed while the dial was in flight.
    if (byPane.get(paneId) !== session) {
        stream.destroy?.();
        return { success: false, message: 'Cancelled' };
    }

    session.stream = stream;
    session.reader = new Reader(stream);

    // A stream that came through a proxy arrives paused, holding whatever the
    // server sent before the proxy's reply had finished being read. The reader
    // above is attached, so it is safe to let it flow. A no-op on an SSH channel
    // or a direct dial, neither of which was paused.
    stream.resume();

    try {
        await withTimeout(
            negotiateWithServer(session.reader, stream, config.password),
            HANDSHAKE_TIMEOUT,
            'The VNC server did not answer in time'
        );
    } catch (error) {
        stream.destroy?.();
        setState(session, 'error', error.message);
        return {
            success: false,
            message: error.message,
            needsPassword: Boolean(error.needsPassword),
            authFailed: Boolean(error.authFailed),
        };
    }

    if (byPane.get(paneId) !== session) {
        stream.destroy?.();
        return { success: false, message: 'Cancelled' };
    }

    let port;
    try {
        port = await listen(session);
    } catch (error) {
        stream.destroy?.();
        const message = `Could not open a local viewer port: ${error.message}`;
        setState(session, 'error', message);
        return { success: false, message };
    }

    // A prepared session holds an authenticated connection to someone's screen.
    // If the view never attaches, that is not something to leave lying around.
    session.armTimer = setTimeout(() => {
        if (session.state === 'ready') {
            close(paneId, { reason: 'The viewer never attached' });
        }
    }, ARM_TIMEOUT);

    setState(session, 'ready');

    return {
        success: true,
        url: `ws://127.0.0.1:${port}/${session.token}`,
        // View options, none of them secret: the renderer needs them to build
        // the RFB object, and they are stored per host rather than per session.
        shared: session.config.shared,
        viewOnly: session.config.viewOnly,
        scaling: session.config.scaling,
        quality: session.config.quality,
        compression: session.config.compression,
        address: describeDesktop(session.config),
    };
}

/** Record the desktop's own name, which only the renderer learns (ServerInit). */
function setDesktopName(paneId, name) {
    const session = byPane.get(paneId);
    if (!session) return false;
    session.desktopName = String(name || '').slice(0, 200);
    flush(paneId);
    return true;
}

/**
 * Tear a desktop down. `silent` skips the notification, for the case where the
 * pane is being replaced or has gone away and nothing is listening.
 */
function close(paneId, { silent = false, reason = '' } = {}) {
    const session = byPane.get(paneId);
    if (!session) return { success: true };

    clearTimeout(session.armTimer);
    session.armTimer = null;

    if (session.wss) {
        try {
            session.wss.close();
        } catch {
            // Never listened.
        }
        session.wss = null;
    }

    if (session.ws) {
        try {
            session.ws.close();
        } catch {
            // Already closing.
        }
        session.ws = null;
    }

    session.reader?.detach();
    session.stream?.destroy?.();
    session.stream = null;

    byPane.delete(paneId);

    if (!silent) {
        notify('vnc-update', { paneId, session: null });
        if (reason) console.log(`VNC session for ${paneId} closed: ${reason}`);
    }
    dirtyPanes.delete(paneId);

    return { success: true };
}

/** Drop the desktop for a pane whose SSH session has gone away. */
function cleanup(paneId) {
    if (!byPane.has(paneId)) return;
    close(paneId);
}

module.exports = {
    setNotifier,
    get,
    open,
    close,
    cleanup,
    setDesktopName,
    // Exported so the handshake can be exercised against a scripted server.
    negotiateWithServer,
    chooseSecurity,
    parseVersion,
    Reader,
};
