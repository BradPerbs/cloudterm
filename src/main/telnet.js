/**
 * Telnet sessions.
 *
 * The shape is ssh.js's (one session per pane, keyed by the pane id, a
 * MessagePort carrying the bytes) with everything SSH does around the bytes
 * removed, because telnet has none of it. There is no handshake to verify, no
 * host key, and no authentication this end participates in: a telnet server
 * asks for a login over the connection itself, the way it would to a physical
 * terminal, so the credentials on a telnet host record are simply never read.
 *
 * That is worth being blunt about rather than papering over. Telnet sends
 * everything, passwords included, in the clear. It is here because a console
 * server, a PDU or a switch that has never had an SSH daemon still has to be
 * reached, and reaching it from this app is better than reaching it from a
 * second one. It is not here as an alternative to SSH.
 *
 * The protocol itself is in telnet-protocol.js.
 */

const store = require('./store');
const proxy = require('./proxy');
const { describeProxyChain, proxyHops } = require('./proxy-config');
const { createPipe } = require('./session-pipe');
const { recordOpen, recordClose } = require('./session-activity');
const { createNegotiator } = require('./telnet-protocol');

// tabId -> { socket, pipe, negotiator, hostId, hostName, address, openedAt }
const sessions = new Map();

/** Long enough for a device on the far side of a VPN, short enough to give up. */
const CONNECT_TIMEOUT = 20000;

/**
 * A socket error in the terms of the thing that went wrong, rather than in
 * errno. "ECONNREFUSED 10.0.0.1:23" is precise and tells a user nothing they
 * can act on.
 */
const ERRORS = {
    ECONNREFUSED: 'Connection refused. Nothing is listening on that port',
    ETIMEDOUT: 'Timed out reaching the host',
    EHOSTUNREACH: 'No route to that host',
    ENETUNREACH: 'The network is unreachable',
    ENOTFOUND: 'Host not found',
    EAI_AGAIN: 'Host not found (DNS did not answer)',
    ECONNRESET: 'The host closed the connection',
};

const describeError = (error) => ERRORS[error?.code] || error?.message || 'Connection failed';

function get(tabId) {
    return sessions.get(tabId);
}

function describe(tabId) {
    const session = sessions.get(tabId);
    return {
        hostId: session?.hostId || '',
        hostName: session?.hostName || '',
        subject: session?.address || '',
    };
}

/**
 * Tear a session down. Every path that ends one comes through here (closing
 * the pane, a dropped link, locking the app), which is why the log entry lives
 * here rather than at each call site.
 */
function destroy(tabId, { reason = 'closed' } = {}) {
    const session = sessions.get(tabId);
    if (!session) return false;

    sessions.delete(tabId);

    recordClose({
        reason,
        hostId: session.hostId,
        hostName: session.hostName,
        address: session.address,
        openedAt: session.openedAt,
    });

    // Before the socket goes: the transcript's closing line should be written
    // while there is still a session to attribute it to.
    session.pipe.close();

    try {
        session.socket.destroy();
    } catch (error) {
        console.error(`Error tearing down telnet session ${tabId}:`, error.message);
    }

    return true;
}

function destroyAll() {
    for (const tabId of [...sessions.keys()]) destroy(tabId, { reason: 'locked' });
}

/**
 * Open a telnet session for a pane.
 *
 * Resolves once, with whether the socket came up. Anything after that is the
 * session's own business and reaches the renderer over the port.
 */
function connect({ tabId, hostId, cols, rows }, { window } = {}) {
    return new Promise(async (resolve) => {
        destroy(tabId, { reason: 'replaced' });

        const target = store.resolveCredentials(hostId);
        if (!target) {
            resolve({ success: false, message: 'Host not found' });
            return;
        }
        if (!target.host) {
            resolve({ success: false, message: 'This host has no address' });
            return;
        }
        // A proxy this host names and that no longer exists. Reported rather
        // than ignored: see the note in store.resolveCredentials.
        if (target.error) {
            resolve({ success: false, message: target.error });
            return;
        }

        const label = store.describeHost(hostId);
        const port = target.port || 23;

        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;

            recordOpen({
                success: result.success,
                message: result.message,
                hostId,
                hostName: label.name,
                address: label.address,
                detail: target.proxyChain?.length
                    ? `over telnet, proxied by ${describeProxyChain(target.proxyChain)}`
                    : 'over telnet',
            });

            resolve(result);
        };

        /*
         * The socket, dialled straight out or through the host's proxy.
         *
         * `openSocket` owns the dial deadline and clears it once the connection
         * is up, because a console that is quiet for twenty seconds is a console
         * doing its job rather than a stall.
         */
        let socket;
        try {
            socket = await proxy.openSocket({
                host: target.host,
                port,
                chain: target.proxyChain,
                timeout: CONNECT_TIMEOUT,
            });
        } catch (error) {
            settle({ success: false, message: describeError(error) });
            return;
        }

        socket.on('error', (error) => {
            const message = describeError(error);
            if (!settled) {
                settle({ success: false, message });
                return;
            }
            // A live session that failed: say so in the pane, since the close
            // that follows only reports that it ended.
            sessions.get(tabId)?.pipe.deliver(`\r\n\x1b[1;31m>> ${message}\x1b[0m\r\n`);
        });

        const negotiator = createNegotiator({
            terminalType: 'xterm-256color',
            // Protocol bytes go straight out. They are not application data
            // and must not be escaped by `encode`, which is for what the
            // user typed.
            send: (bytes) => {
                if (socket.writable) socket.write(bytes);
            },
        });

        const pipe = createPipe({
            tabId,
            window,
            label: { hostName: label.name, address: label.address, hostId },
            protocol: 'telnet',
            onInput: (data) => {
                if (socket.writable) socket.write(negotiator.encode(data));
            },
            onResize: (nextCols, nextRows) => negotiator.resize(nextCols, nextRows),
        });

        sessions.set(tabId, {
            socket,
            pipe,
            negotiator,
            hostId,
            hostName: label.name,
            address: label.address,
            openedAt: Date.now(),
        });

        // The size the pane already is, before the server has asked. Held
        // by the negotiator and sent the moment NAWS is agreed.
        negotiator.resize(cols || 80, rows || 24);
        negotiator.start();

        socket.on('data', (chunk) => {
            const output = negotiator.receive(chunk);
            if (output.length) pipe.deliver(output);
        });

        // A socket that came through a proxy is handed over paused, holding
        // anything the device said before the handshake finished being read.
        // The reader is attached now, so it is safe to let it flow. A no-op
        // on a direct dial, which was never paused.
        socket.resume();

        socket.on('close', () => {
            // A reconnect may already have registered a fresh session under
            // this pane id; a stale close must not tear that one down.
            const session = sessions.get(tabId);
            if (!session || session.socket !== socket) return;
            session.pipe.disconnected();
            if (window && !window.isDestroyed()) {
                window.webContents.send('ssh-disconnected', tabId);
            }
            destroy(tabId, { reason: 'dropped' });
        });

        // Same contract as SSH's: written as soon as the session is up,
        // with no prompt detection, and replayed on every reconnect.
        //
        // Worth knowing what that means here. A telnet device usually opens
        // with a login prompt, so a command set on a telnet host is typed
        // into whatever the device happens to be showing, which is the
        // login prompt unless the device has no login. That is the setting
        // doing exactly what it says; it is only ever what was typed into
        // it, and it is empty by default.
        if (target.initCommand) {
            try {
                socket.write(negotiator.encode(`${target.initCommand}\r`));
            } catch (error) {
                console.error(`Could not send the connect command for ${tabId}:`, error.message);
            }
        }

        // The path the socket took, for the pane header. The same shape ssh.js
        // returns, minus any notion of a relay: telnet has no channel to open one
        // on, so a proxy is the only thing that can stand in the way.
        settle({
            success: true,
            message: 'Connected',
            route: [
                ...proxyHops(target.proxyChain),
                { kind: 'host', label: label.name, detail: label.address },
            ],
        });
    });
}

module.exports = {
    sessions,
    get,
    describe,
    connect,
    destroy,
    destroyAll,
};
