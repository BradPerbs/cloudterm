/**
 * Renderer-side view of a proxy record.
 *
 * The shape and the vocabulary mirror `src/main/proxy-config.js`. They are
 * restated here rather than shared because the renderer is sandboxed and cannot
 * reach main-process modules. Main stays the authority and normalises every
 * record again before a socket is ever opened through it.
 */

export const PROXY_TYPES = [
    {
        id: 'socks5',
        label: 'SOCKS5',
        summary: 'The one to reach for',
        detail: 'RFC 1928. Carries hostnames, IPv6 and a username and password, so it is the only one of the three that can do everything a connection here might need.',
    },
    {
        id: 'socks4',
        label: 'SOCKS4',
        summary: 'The older, plainer form',
        detail: 'IPv4 only, and the username is an ident string rather than a credential. Use it for an old appliance that speaks nothing newer.',
    },
    {
        id: 'http',
        label: 'HTTP CONNECT',
        summary: 'A corporate web proxy',
        detail: 'The tunnel every company proxy offers. Credentials go over as a Basic authorization header, so the proxy sees them: prefer SOCKS5 where there is a choice.',
    },
];

export const DEFAULT_PORTS = { socks5: 1080, socks4: 1080, http: 8080 };

/** Matches proxy-config.js. Shown in the editor as seconds. */
export const DEFAULT_TIMEOUT = 15000;

export const proxyLabel = (type) =>
    PROXY_TYPES.find(entry => entry.id === type)?.label || 'SOCKS5';

/** Whether this kind of proxy has authentication worth the name. */
export const supportsAuth = (type) => type === 'socks5' || type === 'http';

/** `SOCKS5 10.0.0.1:1080`, the form a log line and a card both name one by. */
export const describeProxy = (proxy) => (proxy
    ? `${proxyLabel(proxy.type)} ${proxy.host || '?'}:${proxy.port || '?'}`
    : '');

/** What the user called it, or its address if they called it nothing. */
export const nameProxy = (proxy) => proxy?.name || describeProxy(proxy);

/**
 * The route a proxy id resolves to, in dial order.
 *
 * `viaProxyId` says which proxy *this* one is reached through, so the walk
 * collects them innermost first and reverses, exactly as the main process does.
 * A dangling or looping reference simply stops the walk: this is for display, and
 * the connection layer is where a broken route is reported.
 */
export function proxyRoute(proxies, proxyId) {
    const byId = new Map(proxies.map(entry => [entry.id, entry]));
    const route = [];
    const seen = new Set();

    let currentId = proxyId || '';
    while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const found = byId.get(currentId);
        if (!found) break;
        route.push(found);
        currentId = found.viaProxyId || '';
    }

    return route.reverse();
}

/**
 * The proxies that could carry this one.
 *
 * Anything already reached *through* the proxy being edited is out: choosing it
 * would close a loop, which the connection layer refuses at dial time, far too
 * late to be told about a choice this form offered. The proxy itself needs no
 * separate check, since a route starting at it reaches it immediately.
 */
export function chainCandidates(proxies, proxyId) {
    const byId = new Map(proxies.map(entry => [entry.id, entry]));

    const passesThrough = (startId) => {
        const seen = new Set();
        let currentId = startId;
        while (currentId && !seen.has(currentId)) {
            if (currentId === proxyId) return true;
            seen.add(currentId);
            currentId = byId.get(currentId)?.viaProxyId || '';
        }
        return false;
    };

    return proxies.filter(candidate => !passesThrough(candidate.id));
}
