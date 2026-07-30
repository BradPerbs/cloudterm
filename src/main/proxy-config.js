/**
 * Shape and validation for proxy records.
 *
 * Kept free of dependencies for the same reason tunnel-config.js and
 * desktop-config.js are: the store (persistence), the client (proxy.js), the
 * three transports that dial through one and the backup importer all have to
 * agree on one record shape without any of them requiring the others.
 *
 * A proxy is a saved server, not a per-host address, for the same reason a jump
 * host is a reference to another saved host: the credential belongs to the proxy
 * rather than to whatever is reached through it, and one company proxy is
 * usually the route for every host in the list.
 *
 *   socks5   RFC 1928, with RFC 1929 username/password if the proxy wants it.
 *            The only one that can carry a hostname, IPv6 and credentials, so
 *            it is the default and the one to reach for.
 *   socks4   The older, simpler form: IPv4 only, and the username is an ident
 *            string rather than a credential. `remoteDns` turns it into SOCKS4a,
 *            which can send a hostname.
 *   http     CONNECT, as every corporate web proxy speaks it. Credentials go in
 *            a Basic `Proxy-Authorization` header.
 *
 * `viaProxyId` is how proxies chain: it names the proxy *this* one is reached
 * through, so the links point the same direction a host's `jumpHostId` does and
 * resolve into a dial order the same way.
 */

const PROXY_TYPES = ['socks5', 'socks4', 'http'];

/** Where each kind of proxy conventionally listens. */
const DEFAULT_PORTS = { socks5: 1080, socks4: 1080, http: 8080 };

const TYPE_LABELS = { socks5: 'SOCKS5', socks4: 'SOCKS4', http: 'HTTP CONNECT' };

/**
 * How long a proxy gets to accept the socket and answer the handshake.
 *
 * Per record rather than global: a proxy on this machine answers in a
 * millisecond, and one at the far end of a corporate VPN can take ten seconds
 * to decide whether it likes you.
 */
const DEFAULT_TIMEOUT = 15000;
const MIN_TIMEOUT = 1000;
const MAX_TIMEOUT = 120000;

/**
 * How many proxies one connection may be chained through.
 *
 * A bound rather than a limit anybody will reach: two is already unusual. It
 * exists so a chain that cycle detection somehow let through still ends.
 */
const MAX_PROXY_HOPS = 8;

let counter = 0;

function nextId() {
    counter += 1;
    return `proxy-${Date.now()}-${counter}`;
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function toPort(value, fallback) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function toTimeout(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return DEFAULT_TIMEOUT;
    return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.round(ms)));
}

/** The port a kind of proxy uses when the record does not say. */
const defaultPort = (type) => DEFAULT_PORTS[type] || DEFAULT_PORTS.socks5;

/** Whether this kind of proxy has authentication worth the name. */
const supportsAuth = (type) => type === 'socks5' || type === 'http';

/**
 * Coerce anything the renderer or a restored backup might carry into a record
 * the client can be handed directly.
 */
function normalizeProxy(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = PROXY_TYPES.includes(source.type) ? source.type : 'socks5';

    return {
        id: clean(source.id) || nextId(),
        name: clean(source.name),
        type,
        host: clean(source.host),
        port: toPort(source.port, defaultPort(type)),
        // SOCKS4 has no password half: the field is an ident string, sent in the
        // clear, which servers either ignore or match against identd.
        username: clean(source.username),
        /**
         * Who resolves the destination hostname.
         *
         * On by default, and it is the setting that matters most for what a
         * proxy is usually for. A name resolved here leaks which host is being
         * reached to whatever answers DNS on this machine, and on a split
         * network it resolves to an address that means nothing on the far side
         * of the proxy. Letting the proxy resolve it is both more private and
         * more likely to work.
         */
        remoteDns: source.remoteDns === undefined ? true : Boolean(source.remoteDns),
        // The proxy this one is reached through, by reference to another saved
        // record. Blank is the ordinary case: dialled straight from here.
        viaProxyId: clean(source.viaProxyId),
        timeout: toTimeout(source.timeout),
    };
}

const normalizeProxies = (list) =>
    (Array.isArray(list) ? list : []).map(normalizeProxy);

/** Returns an empty string when the proxy is usable, or the reason it isn't. */
function validateProxy(proxy) {
    if (!proxy?.host) return 'A proxy address is required';
    if (!proxy.port) return 'A proxy port is required';
    if (!PROXY_TYPES.includes(proxy.type)) return 'Choose what kind of proxy this is';
    return '';
}

const proxyLabel = (type) => TYPE_LABELS[type] || TYPE_LABELS.socks5;

/** One-line summary, in the form the activity log names a proxy by. */
function describeProxy(proxy) {
    if (!proxy) return '';
    return `${proxyLabel(proxy.type)} ${proxy.host}:${proxy.port}`;
}

/** How a proxy is named in a message: what the user called it, or its address. */
const nameProxy = (proxy) => proxy?.name || describeProxy(proxy);

/** A chain in dial order, as one string. Blank for a direct connection. */
const describeProxyChain = (chain) =>
    (Array.isArray(chain) ? chain : []).map(nameProxy).join(' → ');

/**
 * The proxy half of a connection path, in the shape a pane header shows.
 *
 * Structure only, no wording: every transport builds its path out of these plus
 * whatever else it went through, and the renderer decides how it reads. Kept here
 * so the four callers (SSH, telnet, and the two desktop bridges) cannot drift
 * into describing the same hop three different ways.
 */
const proxyHops = (chain) => (Array.isArray(chain) ? chain : []).map(hop => ({
    kind: 'proxy',
    label: nameProxy(hop),
    detail: describeProxy(hop),
}));

module.exports = {
    PROXY_TYPES,
    DEFAULT_PORTS,
    TYPE_LABELS,
    DEFAULT_TIMEOUT,
    MAX_PROXY_HOPS,
    defaultPort,
    supportsAuth,
    normalizeProxy,
    normalizeProxies,
    validateProxy,
    proxyLabel,
    describeProxy,
    describeProxyChain,
    proxyHops,
    nameProxy,
};
