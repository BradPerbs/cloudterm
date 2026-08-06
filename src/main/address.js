/**
 * An address typed by hand, rather than a host picked from the list.
 *
 * This is what PuTTY's Host Name box takes, and it is deliberately the whole
 * of what the launcher accepts: an address, optionally a user in front of it
 * and a port behind it. Everything else about the connection (the login, the
 * host key) is asked for at the point it is needed, because an address on its
 * own is all the user has offered.
 *
 *   10.0.0.5              192.168.1.20:2222
 *   root@10.0.0.5         deploy@box.example.com:2222
 *   [2001:db8::1]:22      ssh://root@10.0.0.5
 *
 * The gate matters as much as the parse. The same box is the host search, so
 * every keystroke is run through here, and a bare word has to come back as
 * "not an address" or typing `prod` would offer to dial a machine called prod.
 * A bare word is only an address when something in the text says so: a scheme,
 * a user, a port, brackets, or a name with a dot in it.
 *
 * Kept free of dependencies, and mirrored by `src/renderer/lib/address.js`,
 * which needs the same answer on every keystroke without a round trip to ask
 * for it. Restated there rather than shared, the way protocols.js restates
 * protocol-config.js.
 */

const DEFAULT_PORT = 22;

/** Hostnames are bounded at 253 characters, labels at 63. */
const MAX_HOSTNAME = 253;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Leading zeros are refused rather than trimmed. `010` is ten to one resolver
 * and eight to another, and an address that means two different things is not
 * one we should be picking between on the user's behalf.
 */
const DECIMAL = /^(?:0|[1-9]\d{0,2})$/;

const SCHEME = /^ssh:\/\//i;

/** Nothing here that is not part of an IPv6 literal. Bracketed, so it is one. */
const IPV6_CHARS = /^[0-9a-f:.]+$/i;

const NOTHING = { ok: false, username: '', host: '', port: DEFAULT_PORT };

function isIpv4(value) {
    const parts = value.split('.');
    return parts.length === 4
        && parts.every(part => DECIMAL.test(part) && Number(part) <= 255);
}

function isHostname(value) {
    if (!value || value.length > MAX_HOSTNAME) return false;

    // A trailing dot is a fully qualified name written out in full, and is not
    // a label of its own.
    const labels = value.replace(/\.$/, '').split('.');
    if (!labels.every(label => LABEL.test(label))) return false;

    // A name never ends in a number, which is what separates a real one from an
    // address that has been mistyped or is still being typed. Without this,
    // `192.168.1.` and `10.0.0.256` both come back as perfectly good hostnames
    // and the launcher offers to dial them.
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

/**
 * Read an address out of whatever was typed.
 *
 * `ok` is the only thing callers should branch on: it means both that this
 * parsed and that it is worth offering as something to dial. A half-typed
 * address (`192.168.1.`) is not an error, it is simply not one yet.
 */
function parseAddress(input) {
    let text = String(input ?? '').trim();
    if (!text) return { ...NOTHING };

    // Anything with a space in it is a sentence, and a sentence is a search.
    if (/\s/.test(text)) return { ...NOTHING };

    // Each of these is the text saying "this is an address", which is what
    // lets a bare word through at the end.
    let explicit = false;

    if (SCHEME.test(text)) {
        explicit = true;
        text = text.replace(SCHEME, '');
        if (!text) return { ...NOTHING };
    }

    // The last `@`, not the first: a hostname can never contain one, so
    // everything before the final one belongs to the user name.
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
        // More than one colon and this is an unbracketed IPv6 literal, where
        // there is no telling a port from the last group. Brackets are how
        // that is said, so they are required rather than guessed around.
        if (host.indexOf(':') !== colon) return { ...NOTHING };

        explicit = true;
        port = toPort(host.slice(colon + 1));
        host = host.slice(0, colon);
        if (!port || !host) return { ...NOTHING };
    }

    if (isIpv4(host)) return { ok: true, username, host, port };
    if (!isHostname(host)) return { ...NOTHING };

    // `prod` on its own is a search term. `prod.internal`, `root@prod` and
    // `prod:2222` are addresses, because the user wrote something that only
    // makes sense about a machine.
    if (!explicit && !host.includes('.')) return { ...NOTHING };

    return { ok: true, username, host, port };
}

/** The address written back out, in the shortest form that still means it. */
function formatAddress({ username, host, port } = {}) {
    if (!host) return '';
    const literal = host.includes(':') ? `[${host}]` : host;
    const where = !port || Number(port) === DEFAULT_PORT ? literal : `${literal}:${port}`;
    return username ? `${username}@${where}` : where;
}

module.exports = {
    DEFAULT_PORT,
    parseAddress,
    formatAddress,
};
