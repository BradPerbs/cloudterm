/**
 * Shape and validation for port-forwarding records.
 *
 * Kept free of dependencies so the store (persistence), the runtime
 * (tunnels.js) and the ssh_config importer can all agree on one record shape
 * without any of them having to require the others.
 *
 *   local    listen here, connect from the server        (ssh -L)
 *   remote   listen on the server, connect from here     (ssh -R)
 *   dynamic  listen here as a SOCKS5 proxy               (ssh -D)
 */

const TUNNEL_TYPES = ['local', 'remote', 'dynamic'];

/** Loopback by default: a tunnel is for this machine unless asked otherwise. */
const DEFAULT_LISTEN_HOST = '127.0.0.1';

/** Addresses that expose a listener beyond this machine. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*']);

let counter = 0;

function nextId() {
    counter += 1;
    return `tunnel-${Date.now()}-${counter}`;
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function toPort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0;
}

/** ssh_config spells "every interface" `*`; Node wants a real bind address. */
function bindAddress(listenHost) {
    const host = clean(listenHost);
    if (!host || host === '*') return '0.0.0.0';
    return host;
}

const isWildcardHost = (listenHost) => WILDCARD_HOSTS.has(clean(listenHost));

function normalizeTunnel(raw = {}) {
    const type = TUNNEL_TYPES.includes(raw.type) ? raw.type : 'local';
    const isDynamic = type === 'dynamic';

    return {
        id: clean(raw.id) || nextId(),
        type,
        name: clean(raw.name),
        listenHost: clean(raw.listenHost) || DEFAULT_LISTEN_HOST,
        listenPort: toPort(raw.listenPort),
        // A SOCKS proxy picks its own destination per connection, so carrying a
        // stale one on the record would only ever mislead the editor.
        destHost: isDynamic ? '' : clean(raw.destHost),
        destPort: isDynamic ? 0 : toPort(raw.destPort),
        autoStart: Boolean(raw.autoStart),
    };
}

const normalizeTunnels = (list) =>
    (Array.isArray(list) ? list : []).map(normalizeTunnel);

/** Returns an empty string when the tunnel is startable, or the reason it isn't. */
function validateTunnel(tunnel) {
    const { type, listenPort, destHost, destPort } = tunnel;

    // Port 0 means "let the server choose", only meaningful for a remote bind.
    if (type === 'remote') {
        if (listenPort < 0 || listenPort > 65535) return 'Remote port must be between 0 and 65535';
    } else if (listenPort < 1) {
        return 'Listen port is required';
    }

    if (type === 'dynamic') return '';

    if (!destHost) return 'Destination host is required';
    if (destPort < 1) return 'Destination port is required';

    return '';
}

/** One-line summary, in the direction the traffic actually travels. */
function describeTunnel(tunnel) {
    const listen = `${tunnel.listenHost}:${tunnel.listenPort || '*'}`;

    if (tunnel.type === 'dynamic') return `${listen} → SOCKS5`;
    if (tunnel.type === 'remote') return `server ${listen} → ${tunnel.destHost}:${tunnel.destPort}`;
    return `${listen} → ${tunnel.destHost}:${tunnel.destPort}`;
}

/* ------------------------------------------------------------------ *
 * ssh_config forward specs
 * ------------------------------------------------------------------ */

/**
 * Split `host:port`, `[v6::addr]:port` or a bare `port`.
 * Returns null when there is nothing usable.
 *
 * The bracket form has to be checked first, because a bare `lastIndexOf(':')` on an
 * IPv6 literal would take the address apart at the wrong colon.
 */
function splitHostPort(text) {
    const value = clean(text);
    if (!value) return null;

    const bracketed = value.match(/^\[([^\]]+)\]:(\d+)$/);
    if (bracketed) return { host: bracketed[1], port: Number(bracketed[2]) };

    if (/^\d+$/.test(value)) return { host: '', port: Number(value) };

    const index = value.lastIndexOf(':');
    if (index <= 0) return { host: value, port: 0 };

    const port = Number(value.slice(index + 1));
    if (!Number.isInteger(port)) return { host: value, port: 0 };

    return { host: value.slice(0, index), port };
}

/**
 * Turn an ssh_config forward directive into a tunnel record.
 *
 *   LocalForward   [bind:]port  host:hostport
 *   RemoteForward  [bind:]port  host:hostport
 *   DynamicForward [bind:]port
 *
 * OpenSSH also accepts the whole thing as one space-free argument; both spellings
 * arrive here as an already-tokenised array.
 */
function tunnelFromForward(type, args) {
    const listen = splitHostPort(args[0]);
    if (!listen || !listen.port) return null;

    // A bare `port` with no bind address falls through to the loopback default
    // that normalizeTunnel applies, which is what OpenSSH does in both
    // directions unless the config says otherwise.
    const base = {
        type,
        listenHost: listen.host,
        listenPort: listen.port,
        autoStart: true,
    };

    if (type === 'dynamic') return normalizeTunnel(base);

    const destination = splitHostPort(args[1]);
    if (!destination || !destination.host || !destination.port) return null;

    return normalizeTunnel({ ...base, destHost: destination.host, destPort: destination.port });
}

module.exports = {
    TUNNEL_TYPES,
    DEFAULT_LISTEN_HOST,
    bindAddress,
    isWildcardHost,
    normalizeTunnel,
    normalizeTunnels,
    validateTunnel,
    describeTunnel,
    splitHostPort,
    tunnelFromForward,
};
