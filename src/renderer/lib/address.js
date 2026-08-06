/**
 * An address typed into a picker, rather than a host chosen from it.
 *
 * The rules and the wording mirror `src/main/address.js`. They are restated
 * here rather than shared because the picker runs this on every keystroke to
 * decide whether to offer the row at all, and asking main that question over
 * IPC would put a round trip between the key and the character. Main parses it
 * again for real when the row is actually used, and main's answer is the one
 * that decides what gets dialled.
 *
 * See that file for what is accepted and, more to the point, why a bare word
 * is not: this is the host search box as well, so `prod` has to stay a search.
 */

const DEFAULT_PORT = 22;

const MAX_HOSTNAME = 253;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const DECIMAL = /^(?:0|[1-9]\d{0,2})$/;
const SCHEME = /^ssh:\/\//i;
const IPV6_CHARS = /^[0-9a-f:.]+$/i;

const NOTHING = { ok: false, username: '', host: '', port: DEFAULT_PORT };

function isIpv4(value) {
    const parts = value.split('.');
    return parts.length === 4
        && parts.every(part => DECIMAL.test(part) && Number(part) <= 255);
}

function isHostname(value) {
    if (!value || value.length > MAX_HOSTNAME) return false;

    const labels = value.replace(/\.$/, '').split('.');
    if (!labels.every(label => LABEL.test(label))) return false;

    // A name never ends in a number, which is what keeps `192.168.1.` and
    // `10.0.0.256` from reading as perfectly good hostnames while an address
    // is still being typed or has been mistyped.
    return !/^\d+$/.test(labels[labels.length - 1]);
}

function isIpv6(value) {
    return IPV6_CHARS.test(value) && value.includes(':');
}

function toPort(value) {
    if (!/^\d{1,5}$/.test(value)) return 0;
    const port = Number(value);
    return port >= 1 && port <= 65535 ? port : 0;
}

/** Read an address out of whatever was typed. Branch on `ok` and nothing else. */
export function parseAddress(input) {
    let text = String(input ?? '').trim();
    if (!text) return { ...NOTHING };

    if (/\s/.test(text)) return { ...NOTHING };

    let explicit = false;

    if (SCHEME.test(text)) {
        explicit = true;
        text = text.replace(SCHEME, '');
        if (!text) return { ...NOTHING };
    }

    let username = '';
    const at = text.lastIndexOf('@');
    if (at !== -1) {
        explicit = true;
        username = text.slice(0, at);
        text = text.slice(at + 1);
        if (!username || username.length > 64 || !text) return { ...NOTHING };
    }

    let host = text;
    let port = DEFAULT_PORT;

    if (host.startsWith('[')) {
        explicit = true;
        const close = host.indexOf(']');
        if (close === -1) return { ...NOTHING };

        const after = host.slice(close + 1);
        host = host.slice(1, close);

        if (after) {
            if (!after.startsWith(':')) return { ...NOTHING };
            port = toPort(after.slice(1));
            if (!port) return { ...NOTHING };
        }

        return isIpv6(host) ? { ok: true, username, host, port } : { ...NOTHING };
    }

    const colon = host.lastIndexOf(':');
    if (colon !== -1) {
        if (host.indexOf(':') !== colon) return { ...NOTHING };

        explicit = true;
        port = toPort(host.slice(colon + 1));
        host = host.slice(0, colon);
        if (!port || !host) return { ...NOTHING };
    }

    if (isIpv4(host)) return { ok: true, username, host, port };
    if (!isHostname(host)) return { ...NOTHING };

    if (!explicit && !host.includes('.')) return { ...NOTHING };

    return { ok: true, username, host, port };
}

/** The address written back out, in the shortest form that still means it. */
export function formatAddress({ username, host, port } = {}) {
    if (!host) return '';
    const literal = host.includes(':') ? `[${host}]` : host;
    const where = !port || Number(port) === DEFAULT_PORT ? literal : `${literal}:${port}`;
    return username ? `${username}@${where}` : where;
}
