const ssh = require('./ssh');
const proxy = require('./proxy');

/**
 * Reaching a remote desktop's port, by either of the two transports.
 *
 * Extracted from vnc.js when RDP arrived: the two bridges disagree about
 * everything that happens *on* the stream and about nothing at all in getting
 * one, so this is the part that is genuinely common rather than merely similar.
 *
 * Both return a Duplex. That is the whole contract, and it is what lets the RDP
 * bridge hand either kind to `tls.connect({ socket })` without caring which it
 * got.
 */

/**
 * Open a `direct-tcpip` channel over the pane's own SSH connection.
 *
 * The address is resolved by the *server*, which is the point: the desktop port
 * never has to be reachable from here, or listening on anything but loopback.
 */
function dialThroughSsh(paneId, host, port) {
    return new Promise((resolve, reject) => {
        const client = ssh.sessions.get(paneId)?.client;
        if (!client) {
            reject(new Error('Connect this session over SSH first'));
            return;
        }
        try {
            // `forwardOut` throws rather than calling back once the transport
            // has gone, so the call itself is guarded.
            client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
                if (error) {
                    reject(new Error(
                        `The server could not reach ${host}:${port}: ${error.message}`
                    ));
                    return;
                }
                resolve(channel);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Dial the desktop from this machine. For a box on the LAN, or behind a VPN.
 *
 * `chain` is the host's proxy route, empty for the ordinary case. A proxied
 * failure already names the proxy and the destination, so only a direct one is
 * prefixed with the address.
 */
async function dialDirect(host, port, chain = []) {
    try {
        return await proxy.openSocket({ host, port, chain });
    } catch (error) {
        throw error.proxy ? error : new Error(`${host}:${port}: ${error.message}`);
    }
}

/**
 * Dial by whichever transport the host is configured for.
 *
 * A tunnelled desktop is a channel on an SSH connection that has already been
 * made, and any proxy was applied when *that* was dialled, so the chain on the
 * config is only read for a direct one.
 */
function dial(paneId, config) {
    return config.transport === 'tunnel'
        ? dialThroughSsh(paneId, config.host, config.port)
        : dialDirect(config.host, config.port, config.proxyChain);
}

module.exports = {
    dial,
    dialThroughSsh,
    dialDirect,
};
