const net = require('net');
const ssh = require('./ssh');
const store = require('./store');
const {
    bindAddress,
    normalizeTunnel,
    validateTunnel,
    describeTunnel,
} = require('./tunnel-config');

/**
 * Port forwarding over a tab's existing SSH connection.
 *
 *   local    a local listener; each connection opens a `direct-tcpip` channel
 *            and the *server* dials the destination.
 *   dynamic  the same, behind a SOCKS5 handshake that names the destination
 *            per connection instead of pinning one.
 *   remote   the server listens; each connection it accepts arrives here as a
 *            `forwarded-tcpip` channel and *we* dial the destination.
 *
 * Runtime state is keyed by tab, so it dies with the session that carries it.
 */

/** Counters are coalesced to this cadence, because a busy tunnel must not storm IPC. */
const UPDATE_INTERVAL = 250;

/** SOCKS5 reply codes (RFC 1928 §6). */
const SOCKS = {
    OK: 0x00,
    FAILURE: 0x01,
    REFUSED: 0x05,
    CMD_UNSUPPORTED: 0x07,
    ATYP_UNSUPPORTED: 0x08,
};

// tabId -> { runtimes: Map<tunnelId, runtime>, client, dispatcher }
const byTab = new Map();

let notify = () => {};
let updateTimer = null;
const dirtyTabs = new Set();

function setNotifier(fn) {
    notify = fn;
}

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

/** The renderer-visible shape. Sockets and channels stay on this side. */
function snapshot(runtime) {
    return {
        ...runtime.config,
        state: runtime.state,
        message: runtime.message,
        // What the server actually bound, which differs from what was asked for
        // whenever a remote forward requested port 0.
        boundPort: runtime.boundPort,
        activeConnections: runtime.connections.size,
        totalConnections: runtime.totalConnections,
        bytesUp: runtime.bytesUp,
        bytesDown: runtime.bytesDown,
        lastError: runtime.lastError,
    };
}

function list(tabId) {
    const entry = byTab.get(tabId);
    if (!entry) return [];
    return [...entry.runtimes.values()].map(snapshot);
}

function markDirty(tabId) {
    dirtyTabs.add(tabId);
    if (updateTimer) return;

    updateTimer = setInterval(() => {
        if (dirtyTabs.size === 0) {
            clearInterval(updateTimer);
            updateTimer = null;
            return;
        }
        for (const id of [...dirtyTabs]) {
            dirtyTabs.delete(id);
            notify('tunnels-update', { tabId: id, tunnels: list(id) });
        }
    }, UPDATE_INTERVAL);
}

/** Push immediately, used for state changes, where a quarter-second lag is visible. */
function flush(tabId) {
    dirtyTabs.delete(tabId);
    notify('tunnels-update', { tabId, tunnels: list(tabId) });
}

function setState(runtime, state, message = '') {
    runtime.state = state;
    runtime.message = message;
    if (state === 'error') runtime.lastError = message;
    flush(runtime.tabId);
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

function entryFor(tabId) {
    let entry = byTab.get(tabId);
    if (!entry) {
        entry = { runtimes: new Map(), client: null, dispatcher: null };
        byTab.set(tabId, entry);
    }
    return entry;
}

function makeRuntime(tabId, config) {
    return {
        tabId,
        config,
        state: 'stopped',
        message: '',
        lastError: '',
        boundPort: 0,
        server: null,
        connections: new Set(),
        totalConnections: 0,
        bytesUp: 0,
        bytesDown: 0,
    };
}

function clientFor(tabId) {
    return ssh.sessions.get(tabId)?.client || null;
}

/* ------------------------------------------------------------------ *
 * Connection plumbing
 * ------------------------------------------------------------------ */

/**
 * Join a local socket to an SSH channel and account for both directions.
 * Either side closing takes the other with it, so a half-open pair can never
 * hold the tunnel's connection count above zero.
 */
function bridge(runtime, socket, channel) {
    const pair = { socket, channel };
    runtime.connections.add(pair);
    runtime.totalConnections += 1;

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        runtime.connections.delete(pair);
        socket.destroy();
        channel.destroy?.();
        markDirty(runtime.tabId);
    };

    socket.on('error', close);
    socket.on('close', close);
    channel.on('error', close);
    channel.on('close', close);

    socket.pipe(channel);
    channel.pipe(socket);

    // Attached after the pipes so neither stream is put into flowing mode
    // before it has somewhere to flow to.
    socket.on('data', (chunk) => {
        runtime.bytesUp += chunk.length;
        markDirty(runtime.tabId);
    });
    channel.on('data', (chunk) => {
        runtime.bytesDown += chunk.length;
        markDirty(runtime.tabId);
    });

    markDirty(runtime.tabId);
}

/**
 * Ask the server to open a channel to `host:port`. `forwardOut` throws rather
 * than calling back when the transport has gone, so the call itself is guarded.
 */
function openChannel(runtime, socket, host, port, callback) {
    const client = clientFor(runtime.tabId);
    if (!client) {
        callback(new Error('The SSH connection is no longer open'));
        return;
    }

    try {
        client.forwardOut(
            socket.remoteAddress || '127.0.0.1',
            socket.remotePort || 0,
            host,
            port,
            callback
        );
    } catch (error) {
        callback(error);
    }
}

/* ------------------------------------------------------------------ *
 * Local forwarding
 * ------------------------------------------------------------------ */

function handleLocalConnection(runtime, socket) {
    const { destHost, destPort } = runtime.config;

    socket.pause();
    openChannel(runtime, socket, destHost, destPort, (error, channel) => {
        if (error) {
            runtime.lastError = error.message;
            markDirty(runtime.tabId);
            socket.destroy();
            return;
        }
        bridge(runtime, socket, channel);
        socket.resume();
    });
}

/* ------------------------------------------------------------------ *
 * Dynamic forwarding (SOCKS5)
 * ------------------------------------------------------------------ */

/** `05 REP 00 01 0.0.0.0 0`. Every client accepts the null bound address. */
function socksReply(code) {
    return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

/**
 * Read the address out of a SOCKS5 request, or null if more bytes are needed.
 * Throws with a reply code for anything malformed or unsupported.
 */
function readSocksTarget(buffer) {
    if (buffer.length < 4) return null;

    const type = buffer[3];
    let offset = 4;
    let host = '';

    if (type === 0x01) {
        if (buffer.length < offset + 6) return null;
        host = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
        offset += 4;
    } else if (type === 0x03) {
        const length = buffer[offset];
        if (buffer.length < offset + 1 + length + 2) return null;
        host = buffer.subarray(offset + 1, offset + 1 + length).toString('utf8');
        offset += 1 + length;
    } else if (type === 0x04) {
        if (buffer.length < offset + 18) return null;
        const groups = [];
        for (let i = 0; i < 16; i += 2) groups.push(buffer.readUInt16BE(offset + i).toString(16));
        host = groups.join(':');
        offset += 16;
    } else {
        const error = new Error('Unsupported address type');
        error.socksCode = SOCKS.ATYP_UNSUPPORTED;
        throw error;
    }

    const port = buffer.readUInt16BE(offset);
    return { host, port, rest: buffer.subarray(offset + 2) };
}

function handleSocksConnection(runtime, socket) {
    let stage = 'greeting';
    let buffer = Buffer.alloc(0);

    const fail = (code) => {
        socket.end(socksReply(code));
    };

    const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (stage === 'greeting') {
            if (buffer.length < 2) return;
            if (buffer[0] !== 0x05) {
                // SOCKS4 and anything else: there is no reply format we could
                // use that this client would understand, so just drop it.
                socket.destroy();
                return;
            }
            const methods = buffer[1];
            if (buffer.length < 2 + methods) return;

            buffer = buffer.subarray(2 + methods);
            stage = 'request';
            socket.write(Buffer.from([0x05, 0x00])); // no authentication
        }

        if (stage !== 'request') return;
        if (buffer.length < 4) return;

        if (buffer[0] !== 0x05) {
            socket.destroy();
            return;
        }

        let target;
        try {
            target = readSocksTarget(buffer);
        } catch (error) {
            fail(error.socksCode || SOCKS.FAILURE);
            return;
        }
        if (!target) return; // still short

        if (buffer[1] !== 0x01) {
            fail(SOCKS.CMD_UNSUPPORTED); // only CONNECT is meaningful over SSH
            return;
        }

        stage = 'connecting';
        socket.removeListener('data', onData);
        socket.pause();

        openChannel(runtime, socket, target.host, target.port, (error, channel) => {
            if (error) {
                runtime.lastError = `${target.host}:${target.port}: ${error.message}`;
                markDirty(runtime.tabId);
                fail(SOCKS.REFUSED);
                return;
            }

            socket.write(socksReply(SOCKS.OK));
            // Anything the client pipelined behind the request belongs to the
            // stream now, and would be lost if the pipe started without it.
            if (target.rest.length > 0) channel.write(target.rest);

            bridge(runtime, socket, channel);
            socket.resume();
        });
    };

    socket.on('data', onData);
    socket.on('error', () => socket.destroy());
}

/* ------------------------------------------------------------------ *
 * Remote forwarding
 * ------------------------------------------------------------------ */

/**
 * One `'tcp connection'` listener serves every remote forward on a client, so
 * connections are routed by the address the server says it accepted them on.
 */
function ensureDispatcher(tabId, client) {
    const entry = entryFor(tabId);
    if (entry.dispatcher && entry.client === client) return;

    if (entry.dispatcher && entry.client) {
        entry.client.removeListener('tcp connection', entry.dispatcher);
    }

    entry.client = client;
    entry.dispatcher = (info, accept, reject) => {
        const runtime = [...entry.runtimes.values()].find(candidate =>
            candidate.config.type === 'remote'
            && candidate.state === 'active'
            && candidate.boundPort === info.destPort);

        if (!runtime) {
            reject();
            return;
        }
        acceptRemote(runtime, accept, reject);
    };

    client.on('tcp connection', entry.dispatcher);
}

/**
 * Dial the destination before accepting. Rejecting an unreachable target is
 * what OpenSSH does, and it lets the far end see a refused connection rather
 * than one that opens and immediately dies.
 */
function acceptRemote(runtime, accept, reject) {
    const { destHost, destPort } = runtime.config;
    const socket = net.connect(destPort, destHost);
    let settled = false;

    socket.once('connect', () => {
        if (settled) return;
        settled = true;
        bridge(runtime, socket, accept());
    });

    socket.once('error', (error) => {
        if (settled) {
            socket.destroy();
            return;
        }
        settled = true;
        runtime.lastError = `${destHost}:${destPort}: ${error.message}`;
        markDirty(runtime.tabId);
        socket.destroy();
        reject();
    });
}

function startRemote(runtime) {
    const client = clientFor(runtime.tabId);
    if (!client) {
        setState(runtime, 'error', 'The SSH connection is no longer open');
        return;
    }

    const { listenHost, listenPort } = runtime.config;
    const address = listenHost || '';

    ensureDispatcher(runtime.tabId, client);

    try {
        client.forwardIn(address, listenPort, (error, assignedPort) => {
            if (error) {
                setState(
                    runtime,
                    'error',
                    // The usual cause by far, and not something the message says.
                    `${error.message}. The port may be in use, or the server may need "GatewayPorts yes"`
                );
                return;
            }
            runtime.boundPort = assignedPort || listenPort;
            setState(runtime, 'active');
        });
    } catch (error) {
        setState(runtime, 'error', error.message);
    }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

function startListener(runtime) {
    const { type, listenHost, listenPort } = runtime.config;

    const server = net.createServer((socket) => {
        if (type === 'dynamic') handleSocksConnection(runtime, socket);
        else handleLocalConnection(runtime, socket);
    });

    server.on('error', (error) => {
        const reason = error.code === 'EADDRINUSE'
            ? `Port ${listenPort} is already in use on this machine`
            : error.code === 'EACCES'
                ? `Not allowed to listen on port ${listenPort}`
                : error.message;

        runtime.server = null;
        try {
            server.close();
        } catch {
            // Never opened.
        }
        setState(runtime, 'error', reason);
    });

    server.listen(listenPort, bindAddress(listenHost), () => {
        runtime.boundPort = server.address()?.port || listenPort;
        setState(runtime, 'active');
    });

    runtime.server = server;
}

function start(tabId, tunnelId) {
    const runtime = byTab.get(tabId)?.runtimes.get(tunnelId);
    if (!runtime) return { success: false, message: 'Tunnel not found' };
    if (runtime.state === 'active' || runtime.state === 'starting') {
        return { success: true, message: 'Already running' };
    }

    const invalid = validateTunnel(runtime.config);
    if (invalid) {
        setState(runtime, 'error', invalid);
        return { success: false, message: invalid };
    }

    if (!clientFor(tabId)) {
        setState(runtime, 'error', 'Not connected');
        return { success: false, message: 'Not connected' };
    }

    runtime.lastError = '';
    setState(runtime, 'starting');

    if (runtime.config.type === 'remote') startRemote(runtime);
    else startListener(runtime);

    return { success: true };
}

/**
 * Take a tunnel down. Existing connections go with it: a stopped tunnel that
 * still carried traffic would be worse than no button at all.
 */
function stop(tabId, tunnelId, { silent = false } = {}) {
    const runtime = byTab.get(tabId)?.runtimes.get(tunnelId);
    if (!runtime) return { success: false, message: 'Tunnel not found' };

    if (runtime.server) {
        try {
            runtime.server.close();
        } catch {
            // Already closed with the session.
        }
        runtime.server = null;
    }

    if (runtime.config.type === 'remote' && runtime.state === 'active') {
        const client = clientFor(tabId);
        try {
            // The callback is not optional in practice: ssh2 only asks the
            // server to acknowledge the unbind when there is one to deliver the
            // reply to, and only drops its own forwarding entry once it has.
            client?.unforwardIn(runtime.config.listenHost || '', runtime.boundPort, (error) => {
                if (error) {
                    console.error(`Could not release remote forward on ${runtime.boundPort}:`, error.message);
                }
            });
        } catch {
            // The transport is gone, which unbinds it anyway.
        }
    }

    for (const { socket, channel } of [...runtime.connections]) {
        socket.destroy();
        channel.destroy?.();
    }
    runtime.connections.clear();
    runtime.boundPort = 0;

    if (silent) {
        runtime.state = 'stopped';
        runtime.message = '';
    } else {
        setState(runtime, 'stopped');
    }

    return { success: true };
}

/**
 * Reconcile the runtime registry with what the host has configured. Tunnels
 * that vanished from the host are stopped and dropped; a running tunnel whose
 * definition changed is restarted so what runs matches what is shown.
 */
function sync(tabId, hostId) {
    const entry = entryFor(tabId);
    const configured = store.getHostTunnels(hostId).map(normalizeTunnel);
    const seen = new Set();

    for (const config of configured) {
        seen.add(config.id);
        const existing = entry.runtimes.get(config.id);

        if (!existing) {
            entry.runtimes.set(config.id, makeRuntime(tabId, config));
            continue;
        }

        const changed = describeTunnel(existing.config) !== describeTunnel(config)
            || existing.config.type !== config.type;

        if (changed && (existing.state === 'active' || existing.state === 'starting')) {
            stop(tabId, config.id, { silent: true });
            existing.config = config;
            start(tabId, config.id);
        } else {
            existing.config = config;
        }
    }

    for (const id of [...entry.runtimes.keys()]) {
        if (seen.has(id)) continue;
        stop(tabId, id, { silent: true });
        entry.runtimes.delete(id);
    }

    flush(tabId);
    return list(tabId);
}

/** Bring up everything the host marked auto-start. Called on connect and reconnect. */
function autoStart(tabId, hostId) {
    const tunnels = sync(tabId, hostId);
    for (const tunnel of tunnels) {
        if (tunnel.autoStart) start(tabId, tunnel.id);
    }
    return list(tabId);
}

function startAll(tabId) {
    const entry = byTab.get(tabId);
    if (!entry) return [];
    for (const id of entry.runtimes.keys()) start(tabId, id);
    return list(tabId);
}

function stopAll(tabId) {
    const entry = byTab.get(tabId);
    if (!entry) return [];
    for (const id of entry.runtimes.keys()) stop(tabId, id);
    return list(tabId);
}

/** Drop every tunnel for a tab whose session has gone away. */
function cleanup(tabId) {
    const entry = byTab.get(tabId);
    if (!entry) return;

    for (const id of entry.runtimes.keys()) stop(tabId, id, { silent: true });

    if (entry.dispatcher && entry.client) {
        entry.client.removeListener('tcp connection', entry.dispatcher);
    }

    byTab.delete(tabId);
    dirtyTabs.delete(tabId);
    notify('tunnels-update', { tabId, tunnels: [] });
}

module.exports = {
    setNotifier,
    list,
    sync,
    autoStart,
    start,
    stop,
    startAll,
    stopAll,
    cleanup,
};
