/**
 * Reaching a TCP address through a proxy.
 *
 * One entry point, `openSocket`, which every outbound connection in the app goes
 * through: the SSH transport, telnet, and the direct dial behind a VNC or RDP
 * pane. With no proxy configured it is `net.connect` with friendlier errors, so
 * call sites have a single path rather than one for each case.
 *
 * What comes back is always a Duplex that is already talking to the far end, so
 * ssh2 (`config.sock`), `tls.connect({ socket })` and the desktop bridges take it
 * without knowing whether a proxy was involved.
 *
 * The three protocols here are all pre-1998 and all trivially framed, which is
 * why they are spoken by hand rather than pulled in as a dependency:
 *
 *   SOCKS5   RFC 1928, with RFC 1929 for username/password.
 *   SOCKS4   and SOCKS4a, which is the same request with a hostname on the end.
 *   HTTP     CONNECT, with Basic `Proxy-Authorization`.
 *
 * Two things they have in common and that the code below is careful about.
 *
 * The handshake is a *prefix* of the stream. A proxy is allowed to send the last
 * byte of its reply and the first byte of the far end's greeting in one TCP
 * segment, so anything read past the reply has to be handed back rather than
 * dropped: see `release`. Getting this wrong loses the server's SSH version
 * string or the first TLS record, on a busy link, occasionally.
 *
 * Which is why **a socket that went through a proxy comes back paused**, and why
 * a caller has to `resume()` it once its own reader is attached. Node only holds
 * unshifted bytes for a stream that is explicitly paused: left flowing with no
 * listener, the next drain emits them into a `data` event nobody has subscribed
 * to yet and they are gone. ssh2 resumes the socket it is handed, so the SSH path
 * needs nothing; telnet.js, vnc.js and rdp.js each do it where they attach.
 *
 * The destination is untrusted text. It comes from a stored host record, and for
 * HTTP CONNECT it is written straight into a request line, so a hostname
 * carrying a newline would be a header injection. `assertAuthority` refuses one
 * before anything is written.
 */

const dns = require('dns');
const net = require('net');
const { nameProxy } = require('./proxy-config');

/** Long enough for a host on the far side of a VPN, short enough to give up. */
const CONNECT_TIMEOUT = 20000;

/** A proxy that needs more than this to answer a CONNECT is not answering. */
const MAX_HTTP_HEADER = 16 * 1024;

/**
 * A socket error in the terms of the thing that went wrong rather than in errno.
 * The code is left on the error so a caller with its own phrasing (telnet.js has
 * one, for the message it prints into a live pane) can still use that instead.
 */
const ERRORS = {
    ECONNREFUSED: 'Connection refused. Nothing is listening on that port',
    ETIMEDOUT: 'Timed out reaching the host',
    EHOSTUNREACH: 'No route to that host',
    ENETUNREACH: 'The network is unreachable',
    ENOTFOUND: 'Host not found',
    EAI_AGAIN: 'Host not found (DNS did not answer)',
    ECONNRESET: 'The host closed the connection',
    EACCES: 'Permission denied opening that connection',
};

const SOCKS5_REPLIES = {
    0x01: 'The proxy reported a general failure',
    0x02: 'The proxy is configured not to allow that connection',
    0x03: 'The network is unreachable from the proxy',
    0x04: 'That host is unreachable from the proxy',
    0x05: 'Connection refused by the far end',
    0x06: 'The connection expired on the way there',
    0x07: 'The proxy does not support outgoing connections',
    0x08: 'The proxy does not support that kind of address',
};

const SOCKS4_REPLIES = {
    0x5b: 'The proxy rejected or could not make the connection',
    0x5c: 'The proxy wanted an identd on this machine and found none',
    0x5d: 'The proxy could not confirm the ident it was given',
};

/** Every failure from a proxy is named after the proxy, or nobody can fix it. */
function refuse(hop, reason) {
    const error = new Error(`${nameProxy(hop)}: ${reason}`);
    // Marks a message that already says where it happened, so a caller does not
    // prefix it with an address a second time.
    error.proxy = true;
    return error;
}

/**
 * Refuse a destination that could not be written safely.
 *
 * Length and shape only: whether the host exists is the network's business. The
 * control characters are the point, see the note at the top of this file.
 */
function assertAuthority({ host, port }) {
    if (!host) throw new Error('No address to connect to');
    if (/[\s\0\r\n]/.test(host)) throw new Error(`"${host}" is not a usable address`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${port} is not a usable port`);
    }
}

/* ------------------------------------------------------------------ *
 * Reading a handshake off a stream
 * ------------------------------------------------------------------ */

/**
 * Exact reads over a stream that is about to be handed to someone else.
 *
 * `read(n)` resolves with precisely n bytes, `readUntil(delimiter)` with
 * everything up to and including the delimiter, and each carries its own
 * deadline: a proxy that accepts the socket and then says nothing is the failure
 * this guards against.
 *
 * `release` is the important half. It pauses the stream, drops the listeners and
 * pushes whatever was read past the handshake back to the front of the buffer,
 * so the next reader (the next proxy in the chain, or ssh2, or TLS) starts on the
 * byte it expects. Pausing before that is what keeps the stream from emitting
 * those bytes into a `data` event nothing is listening for.
 *
 * The resume at the end of the constructor is the other side of that: a reader
 * created after a `release` finds the stream paused, and adding a `data` listener
 * to a paused stream does not start it flowing again.
 */
function createReader(stream, timeoutMs) {
    // A missing timeout would be 1 ms to `setTimeout`, which is a handshake that
    // fails before it has been sent. Defaulted rather than trusted.
    const deadline = timeoutMs || CONNECT_TIMEOUT;
    let buffer = Buffer.alloc(0);
    let pending = null;
    let failure = null;
    let timer = null;

    const clear = () => {
        clearTimeout(timer);
        timer = null;
    };

    const settle = (error, value) => {
        const request = pending;
        pending = null;
        clear();
        if (error) request.reject(error);
        else request.resolve(value);
    };

    const take = (length) => {
        const out = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        return out;
    };

    const serve = () => {
        if (!pending) return;

        if (pending.need) {
            if (buffer.length < pending.need) return;
            settle(null, take(pending.need));
            return;
        }

        const at = buffer.indexOf(pending.delimiter);
        if (at === -1) {
            if (buffer.length > pending.max) {
                settle(new Error('The proxy sent more than a reply should ever be'));
            }
            return;
        }
        settle(null, take(at + pending.delimiter.length));
    };

    const die = (error) => {
        failure = error;
        if (pending) settle(error);
    };

    const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        serve();
    };
    const onEnd = () => die(new Error('The proxy closed the connection'));
    const onError = (error) => die(error);

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('close', onEnd);
    stream.on('error', onError);
    // Explicit, because the stream may have been paused by an earlier reader's
    // `release`, and `on('data')` alone will not restart a paused stream.
    stream.resume();

    const request = (spec) => new Promise((resolve, reject) => {
        if (failure) {
            reject(failure);
            return;
        }
        pending = { ...spec, resolve, reject };
        timer = setTimeout(
            () => settle(new Error('The proxy did not answer in time')),
            deadline
        );
        // Whatever arrived while nothing was waiting may already be enough.
        serve();
    });

    return {
        read: (need) => request({ need }),
        readUntil: (delimiter, max) => request({ delimiter, max }),
        release() {
            clear();
            // Only reachable if a caller abandoned a read, which nothing here
            // does. Rejected rather than left hanging so it could never wedge.
            if (pending) settle(new Error('The proxy handshake was abandoned'));
            stream.removeListener('data', onData);
            stream.removeListener('end', onEnd);
            stream.removeListener('close', onEnd);
            stream.removeListener('error', onError);

            if (!stream.destroyed) {
                // Paused whether or not anything was over-read, so that a socket
                // off this module is always in the same state. A handoff that
                // only sometimes needs a resume is a handoff that works in
                // testing and drops the first packet in the field.
                stream.pause();
                if (buffer.length > 0) stream.unshift(buffer);
            }
            buffer = Buffer.alloc(0);
        },
    };
}

function write(stream, bytes) {
    if (!stream.writable) throw new Error('The connection to the proxy closed');
    stream.write(bytes);
}

/* ------------------------------------------------------------------ *
 * Addresses
 * ------------------------------------------------------------------ */

const portBytes = (port) => Buffer.from([(port >> 8) & 0xff, port & 0xff]);

/** The four octets of a dotted-quad, or null if it is not one. */
function ipv4Bytes(text) {
    const octets = String(text).split('.').map(Number);
    if (octets.length !== 4) return null;
    if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    return Buffer.from(octets);
}

/**
 * The sixteen bytes of an IPv6 literal, or null if it cannot be read.
 *
 * Written out because Node has no parser to borrow: `net.isIP` will tell you a
 * string is an address and gives you nothing to put on the wire. Handles the
 * `::` run, a zone index, and the trailing IPv4 form (`::ffff:10.0.0.1`), which
 * is the one a dual-stack machine actually hands out.
 */
function ipv6Bytes(text) {
    const literal = String(text).split('%')[0];
    const halves = literal.split('::');
    if (halves.length > 2) return null;

    const groups = (part) => (part ? part.split(':').filter(Boolean) : []);

    const expand = (list) => {
        const words = [];
        for (const group of list) {
            if (group.includes('.')) {
                const packed = ipv4Bytes(group);
                if (!packed) return null;
                words.push(packed.readUInt16BE(0), packed.readUInt16BE(2));
                continue;
            }
            if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
            words.push(parseInt(group, 16));
        }
        return words;
    };

    const front = expand(groups(halves[0]));
    const back = expand(halves.length === 2 ? groups(halves[1]) : []);
    if (!front || !back) return null;

    const missing = 8 - front.length - back.length;
    // Only a `::` may stand in for the zeroes it left out.
    if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

    const words = [...front, ...new Array(missing).fill(0), ...back];
    if (words.length !== 8) return null;

    const out = Buffer.alloc(16);
    words.forEach((word, index) => out.writeUInt16BE(word, index * 2));
    return out;
}

/**
 * Resolve a name here, for a proxy the user has asked to keep DNS local.
 *
 * The opposite of the default, and worth having: a proxy that refuses hostnames
 * (some hardened SOCKS servers do) or a split network where only this side can
 * resolve the name.
 */
async function resolveLocally(host, family) {
    try {
        const { address } = await dns.promises.lookup(host, family ? { family } : {});
        return address;
    } catch (error) {
        throw new Error(`Could not resolve ${host} on this machine: ${error.code || error.message}`);
    }
}

/* ------------------------------------------------------------------ *
 * SOCKS5
 * ------------------------------------------------------------------ */

/** The address half of a SOCKS5 request: a literal where we have one, else a name. */
async function socks5Address(hop, target) {
    const literal = net.isIP(target.host);

    if (literal === 4) {
        return Buffer.concat([Buffer.from([0x01]), ipv4Bytes(target.host), portBytes(target.port)]);
    }
    if (literal === 6) {
        const packed = ipv6Bytes(target.host);
        if (!packed) throw refuse(hop, `Could not read ${target.host} as an IPv6 address`);
        return Buffer.concat([Buffer.from([0x04]), packed, portBytes(target.port)]);
    }

    if (!hop.remoteDns) {
        const resolved = await resolveLocally(target.host);
        return socks5Address(hop, { ...target, host: resolved });
    }

    const name = Buffer.from(target.host, 'utf8');
    if (name.length > 255) throw refuse(hop, 'That hostname is too long for SOCKS5 to carry');
    return Buffer.concat([
        Buffer.from([0x03, name.length]),
        name,
        portBytes(target.port),
    ]);
}

async function authenticateSocks5(stream, reader, hop) {
    const username = Buffer.from(hop.username || '', 'utf8');
    const password = Buffer.from(hop.password || '', 'utf8');

    if (username.length > 255 || password.length > 255) {
        throw refuse(hop, 'SOCKS5 allows at most 255 bytes each for a username and a password');
    }

    write(stream, Buffer.concat([
        Buffer.from([0x01, username.length]),
        username,
        Buffer.from([password.length]),
        password,
    ]));

    // Version, then status. The version byte is not checked: the RFC says 0x01
    // and a good number of servers echo the 0x05 from the greeting instead.
    const reply = await reader.read(2);
    if (reply[1] !== 0x00) throw refuse(hop, 'It rejected the stored username and password');
}

/** Read and discard the bound address a reply carries, which is ATYP-shaped. */
async function drainSocks5Bound(reader, hop, type) {
    if (type === 0x01) {
        await reader.read(6);
        return;
    }
    if (type === 0x04) {
        await reader.read(18);
        return;
    }
    if (type === 0x03) {
        const [length] = await reader.read(1);
        await reader.read(length + 2);
        return;
    }
    throw refuse(hop, 'It replied with an address type this app does not know');
}

async function negotiateSocks5(stream, hop, target) {
    const reader = createReader(stream, hop.timeout);

    try {
        const hasCredentials = Boolean(hop.username || hop.password);
        const methods = hasCredentials ? [0x00, 0x02] : [0x00];

        write(stream, Buffer.from([0x05, methods.length, ...methods]));

        const greeting = await reader.read(2);
        if (greeting[0] !== 0x05) throw refuse(hop, 'It did not answer as a SOCKS5 proxy');

        const method = greeting[1];
        if (method === 0xff) {
            throw refuse(hop, hasCredentials
                ? 'It accepted neither anonymous access nor a username and password'
                : 'It wants credentials, and none are stored for it');
        }
        if (method === 0x02) {
            if (!hasCredentials) {
                throw refuse(hop, 'It asked for credentials, and none are stored for it');
            }
            await authenticateSocks5(stream, reader, hop);
        } else if (method !== 0x00) {
            throw refuse(hop, `It asked for an authentication method this app cannot speak (0x${method.toString(16)})`);
        }

        write(stream, Buffer.concat([
            // CONNECT, with the reserved byte the RFC requires to be zero.
            Buffer.from([0x05, 0x01, 0x00]),
            await socks5Address(hop, target),
        ]));

        const head = await reader.read(4);
        if (head[0] !== 0x05) throw refuse(hop, 'It sent a malformed reply');
        if (head[1] !== 0x00) {
            const reason = SOCKS5_REPLIES[head[1]] || `It refused the connection (code ${head[1]})`;
            throw refuse(hop, `${reason} (to ${target.host}:${target.port})`);
        }

        await drainSocks5Bound(reader, hop, head[3]);
    } finally {
        reader.release();
    }
}

/* ------------------------------------------------------------------ *
 * SOCKS4 and SOCKS4a
 * ------------------------------------------------------------------ */

async function negotiateSocks4(stream, hop, target) {
    const reader = createReader(stream, hop.timeout);

    try {
        if (net.isIP(target.host) === 6) {
            throw refuse(hop, 'SOCKS4 cannot carry an IPv6 address. This host needs a SOCKS5 or HTTP proxy');
        }

        let host = target.host;
        let address = ipv4Bytes(host);

        if (!address && !hop.remoteDns) {
            host = await resolveLocally(host, 4);
            address = ipv4Bytes(host);
        }

        // SOCKS4a: an address of 0.0.0.1 means the hostname follows the ident,
        // which is the only way this protocol can name a host it cannot resolve.
        const byName = address === null;
        const ident = Buffer.from(hop.username || '', 'utf8');

        const parts = [
            Buffer.from([0x04, 0x01]),
            portBytes(target.port),
            byName ? Buffer.from([0, 0, 0, 1]) : address,
            ident,
            Buffer.from([0x00]),
        ];
        if (byName) {
            const name = Buffer.from(host, 'utf8');
            parts.push(name, Buffer.from([0x00]));
        }

        write(stream, Buffer.concat(parts));

        // Version, status, then the bound port and address, always eight bytes.
        const reply = await reader.read(8);
        if (reply[1] !== 0x5a) {
            const reason = SOCKS4_REPLIES[reply[1]] || `It refused the connection (code ${reply[1]})`;
            throw refuse(hop, `${reason} (to ${target.host}:${target.port})`);
        }
    } finally {
        reader.release();
    }
}

/* ------------------------------------------------------------------ *
 * HTTP CONNECT
 * ------------------------------------------------------------------ */

async function negotiateHttp(stream, hop, target) {
    const reader = createReader(stream, hop.timeout);

    try {
        let host = target.host;
        if (!hop.remoteDns && net.isIP(host) === 0) host = await resolveLocally(host);

        // An IPv6 literal has to be bracketed in a request line, or the colons
        // in it read as the port separator.
        const authority = net.isIP(host) === 6
            ? `[${host}]:${target.port}`
            : `${host}:${target.port}`;

        const lines = [
            `CONNECT ${authority} HTTP/1.1`,
            `Host: ${authority}`,
            // Explicit, because a proxy that treats the tunnel as closeable
            // between requests would tear the session down under us.
            'Proxy-Connection: keep-alive',
        ];

        if (hop.username || hop.password) {
            const credential = Buffer
                .from(`${hop.username || ''}:${hop.password || ''}`, 'utf8')
                .toString('base64');
            lines.push(`Proxy-Authorization: Basic ${credential}`);
        }

        write(stream, Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1'));

        const head = (await reader.readUntil(Buffer.from('\r\n\r\n'), MAX_HTTP_HEADER))
            .toString('latin1');

        const statusLine = head.split('\r\n')[0];
        const status = Number(statusLine.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);

        if (!status) throw refuse(hop, 'It did not answer with an HTTP status line');
        if (status === 407) {
            throw refuse(hop, hop.username || hop.password
                ? 'It rejected the stored username and password'
                : 'It wants credentials, and none are stored for it');
        }
        if (status < 200 || status > 299) {
            const reason = statusLine.replace(/^HTTP\/1\.[01]\s*/, '').trim() || String(status);
            throw refuse(hop, `It answered ${reason} (to ${target.host}:${target.port})`);
        }
    } finally {
        reader.release();
    }
}

/* ------------------------------------------------------------------ *
 * Dialling
 * ------------------------------------------------------------------ */

const NEGOTIATORS = {
    socks5: negotiateSocks5,
    socks4: negotiateSocks4,
    http: negotiateHttp,
};

const negotiate = (stream, hop, target) =>
    (NEGOTIATORS[hop.type] || negotiateSocks5)(stream, hop, target);

/**
 * A plain TCP connection, with the dial deadline cleared once it is up.
 *
 * The timeout guards the dial only: a session that goes quiet for twenty seconds
 * is a session doing its job, and leaving the timer armed would kill it.
 */
function dialDirect(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        socket.setNoDelay(true);
        // Defaulted here as well as by the caller: `setTimeout` throws on
        // anything that is not a number, and a record short of a field would
        // otherwise take the dial down before it started.
        socket.setTimeout(timeoutMs || CONNECT_TIMEOUT);

        const cleanup = () => {
            socket.removeListener('error', onError);
            socket.removeListener('timeout', onTimeout);
            socket.removeListener('connect', onConnect);
        };

        function fail(error) {
            cleanup();
            socket.destroy();
            reject(error);
        }

        function onError(cause) {
            const error = new Error(ERRORS[cause?.code] || cause?.message || 'Connection failed');
            // Kept so a caller with its own phrasing can still recognise it.
            error.code = cause?.code;
            fail(error);
        }

        function onTimeout() {
            fail(new Error('Timed out reaching the host'));
        }

        function onConnect() {
            cleanup();
            socket.setTimeout(0);
            resolve(socket);
        }

        socket.once('error', onError);
        socket.once('timeout', onTimeout);
        socket.once('connect', onConnect);
    });
}

/**
 * Open a connection to `host:port`, through `chain` if there is one.
 *
 * `chain` is in dial order: the first entry is dialled from this machine, and
 * each one after it is reached through the one before, exactly as an SSH jump
 * chain is. The last entry is the one asked to reach the destination.
 *
 * Every hop is negotiated on the same socket, one after another, which is all a
 * proxy chain is: the second proxy has no idea it is not being spoken to
 * directly.
 *
 * A socket that went through a proxy comes back **paused**; a direct one is
 * untouched. Attach a reader, then `resume()`. See the note at the top of this
 * file for why that is not optional.
 */
async function openSocket({ host, port, chain = [], timeout = CONNECT_TIMEOUT } = {}) {
    const target = { host: String(host || '').trim(), port: Number(port) };
    assertAuthority(target);

    const hops = Array.isArray(chain) ? chain : [];
    if (hops.length === 0) return dialDirect(target.host, target.port, timeout);

    for (const hop of hops) {
        assertAuthority({ host: hop.host, port: hop.port });
    }

    let socket;
    try {
        socket = await dialDirect(hops[0].host, hops[0].port, hops[0].timeout);
    } catch (error) {
        throw refuse(hops[0], `Could not reach it. ${error.message}`);
    }

    try {
        for (const [index, hop] of hops.entries()) {
            const next = hops[index + 1];
            await negotiate(socket, hop, next ? { host: next.host, port: next.port } : target);
        }
    } catch (error) {
        socket.destroy();
        throw error;
    }

    return socket;
}

/**
 * Check a chain without connecting anywhere in particular.
 *
 * Every hop but the last is negotiated for real, because reaching the next proxy
 * is the only way to get to it. The last one is taken as far as the protocol
 * allows without naming a destination, which for SOCKS5 includes the credentials
 * and for the other two is reachability alone. Deliberately not "connect to
 * somewhere on the internet and see": a button in a settings page should not
 * make an outbound connection to a third party.
 */
async function test(chain) {
    const hops = Array.isArray(chain) ? chain : [];
    if (hops.length === 0) return { success: false, message: 'There is no proxy to check' };

    const started = Date.now();
    let socket = null;

    try {
        for (const hop of hops) {
            assertAuthority({ host: hop.host, port: hop.port });
        }

        socket = await dialDirect(hops[0].host, hops[0].port, hops[0].timeout)
            .catch((error) => {
                throw refuse(hops[0], `Could not reach it. ${error.message}`);
            });

        for (let index = 0; index < hops.length - 1; index += 1) {
            const next = hops[index + 1];
            await negotiate(socket, hops[index], { host: next.host, port: next.port });
        }

        const last = hops[hops.length - 1];
        const before = hops.length - 1;
        const relayed = before > 0
            ? `Reached through ${before} ${before === 1 ? 'proxy' : 'proxies'} before it. `
            : '';

        if (last.type === 'socks5') {
            const reader = createReader(socket, last.timeout);
            try {
                const hasCredentials = Boolean(last.username || last.password);
                const methods = hasCredentials ? [0x00, 0x02] : [0x00];
                write(socket, Buffer.from([0x05, methods.length, ...methods]));

                const greeting = await reader.read(2);
                if (greeting[0] !== 0x05) throw refuse(last, 'It did not answer as a SOCKS5 proxy');

                if (greeting[1] === 0xff) {
                    throw refuse(last, hasCredentials
                        ? 'It accepted neither anonymous access nor a username and password'
                        : 'It wants credentials, and none are stored for it');
                }
                if (greeting[1] === 0x02) {
                    if (!hasCredentials) {
                        throw refuse(last, 'It asked for credentials, and none are stored for it');
                    }
                    await authenticateSocks5(socket, reader, last);
                    return {
                        success: true,
                        elapsed: Date.now() - started,
                        message: `${relayed}It accepted the stored username and password.`,
                    };
                }

                return {
                    success: true,
                    elapsed: Date.now() - started,
                    message: `${relayed}It answered, and asked for no credentials.`,
                };
            } finally {
                reader.release();
            }
        }

        return {
            success: true,
            elapsed: Date.now() - started,
            message: `${relayed}It accepted the connection. `
                + 'Credentials on this kind of proxy are only checked when something is actually connecting.',
        };
    } catch (error) {
        return { success: false, elapsed: Date.now() - started, message: error.message };
    } finally {
        socket?.destroy();
    }
}

module.exports = {
    openSocket,
    test,
    // Exported so the wire format can be exercised without a live proxy.
    ipv4Bytes,
    ipv6Bytes,
    createReader,
    assertAuthority,
};
