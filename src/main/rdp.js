const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { WebSocketServer } = require('ws');
const ssh = require('./ssh');
const store = require('./store');
const rdcleanpath = require('./rdcleanpath');
const { dial } = require('./desktop-dial');
const { validateDesktop, describeDesktop } = require('./desktop-config');
const { proxyHops } = require('./proxy-config');

/**
 * Remote desktop (RDP) for a pane.
 *
 * The shape is vnc.js's: a loopback WebSocket the renderer attaches to, bridged
 * to either a `direct-tcpip` channel over the tab's own SSH connection or a
 * plain socket. What happens on the stream is not, in two ways that matter.
 *
 * 1. The protocol runs in the *renderer*, not here.
 *
 *    RDP is far past the point where speaking it by hand is reasonable, so the
 *    session is driven by IronRDP compiled to WebAssembly, in the pane. This
 *    process does only the parts a sandboxed renderer cannot: open the socket,
 *    exchange X.224, establish TLS, and read back the server's certificate.
 *    That preamble is RDCleanPath (see rdcleanpath.js); after it, this is a pipe.
 *
 * 2. The password reaches the renderer, and under VNC it deliberately does not.
 *
 *    vnc.js completes the RFB handshake here precisely so a stored secret never
 *    travels main -> renderer. RDP cannot be done the same way: authentication
 *    is CredSSP, it is bound to the TLS session, and IronRDP performs it inside
 *    the WASM client. Terminating that here would mean re-implementing NTLM and
 *    Kerberos in this file.
 *
 *    So the exception is real and is narrowed rather than hidden: the password
 *    is read at `open` and returned once, to a renderer that draws remote pixels
 *    onto a canvas rather than remote markup into a DOM, and the view is written
 *    to hold it in a local, hand it to the session builder, and drop it. It is
 *    never stored in component state and never crosses IPC again.
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
 * Screen updates arrive faster than a busy renderer drains them, and without
 * this the buffered frames would be unbounded memory.
 */
const SEND_HIGH_WATER = 4 * 1024 * 1024;
const SEND_LOW_WATER = 1 * 1024 * 1024;

/** Generous, because a clipboard transfer rides the same channel. */
const MAX_WS_PAYLOAD = 8 * 1024 * 1024;

/** TPKT header: version, reserved, and a 16-bit total length. */
const TPKT_HEADER = 4;
const TPKT_VERSION = 3;

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
        username: session.config.username,
        domain: session.config.domain,
        bytesUp: session.bytesUp,
        bytesDown: session.bytesDown,
        openedAt: session.openedAt,
        // What this desktop is reached through, for the pane header's route mark.
        // Names and addresses only; the credentials stay on this side.
        route: session.route,
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
            notify('rdp-update', { paneId: id, session: get(id) });
        }
    }, UPDATE_INTERVAL);
}

/** Push immediately, for state changes where a quarter-second lag is visible. */
function flush(paneId) {
    dirtyPanes.delete(paneId);
    notify('rdp-update', { paneId, session: get(paneId) });
}

function setState(session, state, message = '') {
    session.state = state;
    session.message = message;
    if (state === 'error') session.lastError = message;
    flush(session.paneId);
}

/* ------------------------------------------------------------------ *
 * X.224, framed by TPKT
 * ------------------------------------------------------------------ */

/**
 * Read exactly one TPKT-framed PDU from a stream.
 *
 * The length is in the header, so this reads the header and then precisely the
 * rest. Taking whatever the first `'data'` event happens to carry would work on
 * loopback and split over a real link, which is the failure that only ever
 * shows up on someone else's network.
 */
function readTpkt(stream, timeoutMs) {
    return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        let expected = 0;

        const finish = (error, value) => {
            clearTimeout(timer);
            stream.removeListener('data', onData);
            stream.removeListener('error', onError);
            stream.removeListener('end', onEnd);
            stream.removeListener('close', onEnd);
            if (error) reject(error);
            else resolve(value);
        };

        const timer = setTimeout(
            () => finish(new Error('The RDP server did not answer in time')),
            timeoutMs
        );

        const onData = (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            if (!expected) {
                if (buffer.length < TPKT_HEADER) return;
                if (buffer[0] !== TPKT_VERSION) {
                    finish(new Error('This does not look like an RDP server (bad TPKT header)'));
                    return;
                }
                expected = buffer.readUInt16BE(2);
                if (expected < TPKT_HEADER || expected > 65535) {
                    finish(new Error('The RDP server sent a malformed frame'));
                    return;
                }
            }

            if (buffer.length < expected) return;

            // Anything past the frame belongs to whoever reads next. Nothing
            // should follow a Connection Confirm (the server waits for TLS),
            // but a dropped byte here would desynchronise the whole session.
            finish(null, {
                pdu: buffer.subarray(0, expected),
                rest: buffer.subarray(expected),
            });
        };

        const onError = (error) => finish(error);
        const onEnd = () => finish(new Error('The server closed the connection during negotiation'));

        stream.on('data', onData);
        stream.on('error', onError);
        stream.on('end', onEnd);
        stream.on('close', onEnd);

        // A socket that came through a proxy arrives paused, holding anything the
        // server sent before the proxy's reply had finished being read: with a
        // TPKT frame that is exactly the response this function is waiting for.
        // A no-op on an SSH channel or a direct dial, neither of which was paused.
        stream.resume();
    });
}

/* ------------------------------------------------------------------ *
 * TLS
 * ------------------------------------------------------------------ */

/**
 * The certificate chain, innermost first, DER-encoded.
 *
 * Node exposes the chain as a linked list through `issuerCertificate`, which is
 * self-referential at the root and so needs the seen-set to terminate.
 */
function certificateChain(peerCertificate) {
    const chain = [];
    const seen = new Set();

    let current = peerCertificate;
    while (current?.raw) {
        const fingerprint = current.fingerprint256 || current.raw.toString('hex');
        if (seen.has(fingerprint)) break;
        seen.add(fingerprint);
        chain.push(Buffer.from(current.raw));

        if (!current.issuerCertificate || current.issuerCertificate === current) break;
        current = current.issuerCertificate;
    }

    return chain;
}

/** SNI wants a hostname; sending an IP literal is invalid and Node warns about it. */
const isIpLiteral = (host) => net.isIP(host) !== 0;

/**
 * Wrap the stream in TLS and hand back the chain.
 *
 * The certificate is not verified here, and that is the same posture as mstsc's
 * default: an RDP server's certificate is self-signed unless someone has been
 * to the trouble of issuing one, so rejecting unknown issuers would refuse
 * nearly every server this will ever meet.
 *
 * It is not the end of the story, though. The chain goes to the client, and
 * CredSSP binds the authentication to this exact certificate, so a substituted
 * one fails there, where the credential would otherwise have been exposed.
 * Under the `tunnel` transport this all happens inside SSH in any case.
 */
/**
 * What a Windows self-signed RDP certificate can actually do.
 *
 * Those certificates are issued with `keyUsage = keyEncipherment,
 * dataEncipherment` and no `digitalSignature`. Every TLS 1.3 suite, and every
 * ECDHE suite before it, has the server *sign* the handshake, so BoringSSL,
 * which is the TLS Electron's Node is built against, refuses the certificate
 * outright with KEY_USAGE_BIT_INCORRECT. `rejectUnauthorized: false` does not
 * help: this is enforced separately from whether the certificate is trusted.
 *
 * With RSA key exchange the client encrypts the premaster secret *to* the
 * certificate instead, which is exactly the use its keyUsage permits, and the
 * handshake completes.
 *
 * The cost is forward secrecy, which is why this is a fallback and not the
 * default: a server with a proper certificate keeps 1.3. It is also a smaller
 * cost than it looks here: the certificate is self-signed and unverified in
 * either case, and what actually authenticates the session is CredSSP running
 * inside the tunnel this sets up.
 */
const RSA_KEY_EXCHANGE = [
    'AES256-GCM-SHA384',
    'AES128-GCM-SHA256',
    'AES256-SHA256',
    'AES128-SHA256',
    'AES256-SHA',
    'AES128-SHA',
].join(':');

/** BoringSSL's way of saying the certificate may not sign a handshake. */
const isKeyUsageRefusal = (error) => /KEY_USAGE_BIT_INCORRECT/i.test(error?.message || '');

function startTls(stream, host, timeoutMs, keyEnciphermentOnly = false) {
    return new Promise((resolve, reject) => {
        const options = {
            socket: stream,
            rejectUnauthorized: false,
            // RDP servers are routinely behind on TLS versions.
            minVersion: 'TLSv1.2',
        };
        if (!isIpLiteral(host)) options.servername = host;

        if (keyEnciphermentOnly) {
            // The retry described in RSA_KEY_EXCHANGE below: TLS 1.2 with RSA
            // key exchange, which is the only handshake a certificate without
            // `digitalSignature` can take part in. 1.3 has no such suite, so
            // the ceiling is not optional.
            options.maxVersion = 'TLSv1.2';
            options.ciphers = RSA_KEY_EXCHANGE;
        }

        const socket = tls.connect(options);

        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('The TLS handshake with the RDP server timed out'));
        }, timeoutMs);

        socket.once('secureConnect', () => {
            clearTimeout(timer);
            socket.removeListener('error', onError);
            resolve({ socket, chain: certificateChain(socket.getPeerCertificate(true)) });
        });

        const onError = (error) => {
            clearTimeout(timer);
            reject(new Error(`TLS handshake failed: ${error.message}`));
        };
        socket.once('error', onError);
    });
}

/* ------------------------------------------------------------------ *
 * Passthrough
 * ------------------------------------------------------------------ */

/**
 * Join the WebSocket to the TLS socket for the rest of the session.
 *
 * Both directions are flow-controlled. Screen updates outrun a busy renderer,
 * and a paste can outrun a slow link, so neither side is allowed to queue
 * without bound in the other's direction.
 */
function passthrough(session) {
    const { ws, tlsSocket } = session;

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        try {
            ws.close();
        } catch {
            // Already going.
        }
        tlsSocket.destroy();
        // A desktop that has lost its stream is over; the pane offers a retry.
        if (session.state === 'active') setState(session, 'closed', 'The desktop session ended');
    };

    // Server -> viewer.
    tlsSocket.on('data', (chunk) => {
        session.bytesDown += chunk.length;
        markDirty(session.paneId);

        if (ws.readyState !== ws.OPEN) return;
        ws.send(chunk, () => {
            if (tlsSocket.isPaused() && ws.bufferedAmount < SEND_LOW_WATER) tlsSocket.resume();
        });
        if (ws.bufferedAmount > SEND_HIGH_WATER) tlsSocket.pause();
    });

    // Viewer -> server.
    ws.on('message', (data) => {
        const chunk = Buffer.from(data);
        session.bytesUp += chunk.length;
        markDirty(session.paneId);

        if (!tlsSocket.write(chunk)) {
            ws.pause();
            tlsSocket.once('drain', () => ws.resume());
        }
    });

    tlsSocket.on('end', close);
    tlsSocket.on('close', close);
    tlsSocket.on('error', close);
    ws.on('close', close);
    ws.on('error', close);
}

/* ------------------------------------------------------------------ *
 * The RDCleanPath exchange
 * ------------------------------------------------------------------ */

/**
 * Take the session from the client's request to a relaying TLS socket.
 *
 * The destination in the request is *not* used to choose where to dial. It is
 * the address this process handed out a moment ago, and the stored config is
 * the authority on it, which keeps a renderer from being able to name an
 * arbitrary host and have it dialled through someone's SSH connection.
 */
async function negotiate(session, requestData) {
    const request = rdcleanpath.parseRequest(requestData);

    // The token issued at `open`, come back around. IronRDP carries it in
    // `proxyAuth` because that is where a Devolutions Gateway would look for its
    // own credential; here it means the request came from the viewer this
    // session was prepared for, and not from anything else that reached the
    // socket first.
    const expected = Buffer.from(session.authToken);
    const offered = Buffer.from(request.proxyAuth || '');
    if (offered.length !== expected.length || !crypto.timingSafeEqual(offered, expected)) {
        throw new Error('The viewer did not present the right session token');
    }

    /**
     * Dial, do the X.224 exchange, and start TLS.
     *
     * Whole rather than resumable because a refused TLS handshake takes the
     * connection with it: the server has read a ClientHello it rejected and is
     * not going to read a second one, so a retry has to start from the socket.
     */
    const reach = async (keyEnciphermentOnly) => {
        const stream = await dial(session.paneId, session.config);

        // Closed while the dial was in flight.
        if (byPane.get(session.paneId) !== session) {
            stream.destroy?.();
            throw new Error('Cancelled');
        }
        session.stream = stream;

        stream.write(request.x224ConnectionRequest);
        const { pdu: x224Response, rest } = await readTpkt(stream, HANDSHAKE_TIMEOUT);

        // The server should be waiting for TLS, so anything already buffered
        // here is a server that does not speak what we think it speaks.
        if (rest.length) {
            throw new Error('The RDP server sent unexpected data before TLS');
        }

        const started = await startTls(
            stream, session.config.host, HANDSHAKE_TIMEOUT, keyEnciphermentOnly
        );
        return { ...started, x224Response };
    };

    let reached;
    try {
        reached = await reach(false);
    } catch (error) {
        // A certificate that may not sign is the one TLS failure worth a second
        // attempt, and only on terms it can meet. Anything else is reported as
        // it happened.
        if (!isKeyUsageRefusal(error)) throw error;

        session.stream?.destroy?.();
        reached = await reach(true);
    }

    const { socket, chain, x224Response } = reached;

    if (byPane.get(session.paneId) !== session) {
        socket.destroy();
        throw new Error('Cancelled');
    }

    session.tlsSocket = socket;

    const address = `${session.config.host}:${session.config.port}`;
    session.ws.send(rdcleanpath.buildResponse(address, x224Response, chain));

    passthrough(session);
    session.openedAt = Date.now();
    setState(session, 'active');
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
            // RDP compresses its own bulk data; deflating it again costs CPU on
            // every frame and saves nothing.
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

/** Wait for the client's RDCleanPath request, then bring the session up. */
function attach(session, ws) {
    ws.binaryType = 'nodebuffer';
    setState(session, 'connecting');

    ws.once('message', async (data) => {
        try {
            await negotiate(session, data);
        } catch (error) {
            // Tell the client why, so the pane can say something better than
            // "the socket closed".
            try {
                ws.send(rdcleanpath.buildError(rdcleanpath.ERROR_GENERAL));
            } catch {
                // The viewer is already gone.
            }

            session.stream?.destroy?.();
            session.tlsSocket?.destroy();

            if (error.message !== 'Cancelled') {
                setState(session, 'error', error.message);
            }

            try {
                ws.close();
            } catch {
                // Already closing.
            }
        }
    });

    ws.on('error', () => {
        // Nothing to add: whatever went wrong on the socket ends the session
        // through the same path as a close.
    });
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

/**
 * Prepare a desktop for a pane and return the address its viewer should attach
 * to, along with the credentials the client authenticates with.
 *
 * Unlike the VNC bridge, this cannot reach the server before returning: the
 * X.224 Connection Request that opens an RDP session comes *from* the client,
 * so there is nothing to send until the viewer has attached. What can be
 * checked without a socket is checked here anyway, because a missing SSH
 * session or an unconfigured username should not be reported as a connection
 * that mysteriously failed a moment later.
 */
async function open(paneId, hostId) {
    // Re-opening is how the view retries, so a stale session is replaced rather
    // than refused.
    close(paneId, { silent: true });

    const config = store.resolveDesktop(hostId);
    if (!config) return { success: false, message: 'Host not found' };

    const invalid = validateDesktop(config);
    if (invalid) return { success: false, message: invalid };

    if (config.protocol !== 'rdp') {
        return { success: false, message: 'This host is not configured for RDP' };
    }

    // A proxy the host names and that is no longer there. Reported rather than
    // dialled around: see the note in store.resolveCredentials.
    if (config.proxyError) return { success: false, message: config.proxyError };

    // The tunnel cannot exist without the SSH session that carries it, and
    // saying so now is better than a refused connection later.
    if (config.transport === 'tunnel' && !ssh.sessions.get(paneId)?.client) {
        return { success: false, message: 'Connect this session over SSH first' };
    }

    const session = {
        paneId,
        hostId,
        // The password is deliberately not kept on the session. It is returned
        // from this call and then this process has no further use for it;
        // CredSSP happens in the client.
        config: {
            transport: config.transport,
            host: config.host,
            port: config.port,
            username: config.username,
            domain: config.domain,
            scaling: config.scaling,
            /*
             * The host's proxy route, which unlike the RDP password has to be
             * kept: the socket is not opened until the viewer attaches and sends
             * its X.224 request, so the dial happens long after this call
             * returns. It stays on this side, `snapshot` names its fields one by
             * one and this is not among them.
             */
            proxyChain: config.proxyChain,
        },
        state: 'ready',
        message: '',
        lastError: '',
        /*
         * The path to this desktop, built once here.
         *
         * Only a directly dialled desktop has one of its own: under `tunnel` it
         * is a channel on the pane's SSH session, and that session's own path is
         * already on the header. So the proxy hops are all there is to add, and
         * they are the ones from the host record, resolved by the store.
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
        // IronRDP requires an auth token: it is the Devolutions Gateway's
        // proxy credential, and the builder refuses to connect without one.
        // There is no gateway here, so rather than pass a placeholder it is
        // issued per session and checked when the request arrives: the path
        // token authorises the socket, this authorises what is asked over it.
        authToken: crypto.randomBytes(16).toString('hex'),
        stream: null,
        tlsSocket: null,
        wss: null,
        ws: null,
        armTimer: null,
        bytesUp: 0,
        bytesDown: 0,
        openedAt: 0,
    };

    byPane.set(paneId, session);

    let port;
    try {
        port = await listen(session);
    } catch (error) {
        byPane.delete(paneId);
        return {
            success: false,
            message: `Could not open a local viewer port: ${error.message}`,
        };
    }

    // If the view never attaches, this is a listening socket with a live
    // credential waiting behind it. Not something to leave lying around.
    session.armTimer = setTimeout(() => {
        if (session.state === 'ready') {
            close(paneId, { reason: 'The viewer never attached' });
        }
    }, ARM_TIMEOUT);

    flush(paneId);

    return {
        success: true,
        url: `ws://127.0.0.1:${port}/${session.token}`,
        authToken: session.authToken,
        destination: `${config.host}:${config.port}`,
        // See the note at the top of this file: this is the one place a stored
        // secret crosses to the renderer, because CredSSP runs there.
        username: config.username,
        domain: config.domain,
        password: config.password || '',
        scaling: config.scaling,
        address: describeDesktop(session.config),
    };
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

    session.tlsSocket?.destroy();
    session.tlsSocket = null;
    session.stream?.destroy?.();
    session.stream = null;

    byPane.delete(paneId);

    if (!silent) {
        notify('rdp-update', { paneId, session: null });
        if (reason) console.log(`RDP session for ${paneId} closed: ${reason}`);
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
    // Exported so the framing can be exercised against a scripted server.
    readTpkt,
    certificateChain,
    // And so the terms of the certificate fallback can be pinned down.
    RSA_KEY_EXCHANGE,
    isKeyUsageRefusal,
};
