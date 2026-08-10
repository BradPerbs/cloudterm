/**
 * Shape and validation for a host's BMC (IPMI) settings.
 *
 * Kept free of dependencies for the same reason as desktop-config.js and
 * tunnel-config.js: the store (persistence), the runtime (bmc.js), the pane
 * and the backup importer all need to agree on one record shape without any of
 * them requiring the others.
 *
 * What this is, and what it deliberately is not:
 *
 * A BMC block is the address of a service processor's *web* interface, plus
 * enough to log into it. The app does not reimplement that interface; it opens
 * the vendor's own page in a pane and fills the login form. So the record holds
 * a URL, an identity and a trust decision about the certificate, and nothing
 * about power state, sensors or consoles. Those all live behind the vendor UI.
 *
 * Two structural choices worth stating:
 *
 *   `host` blank means the host's own address. A BMC is nearly always a second
 *   address for a machine already in the list, but it is a *different* address
 *   (a dedicated NIC, or a shared port on another VLAN), so it is a field
 *   rather than an assumption. Blank resolving to the host, the way
 *   desktop-config.js resolves a direct desktop, keeps it from having to be
 *   typed twice for the boards that share one.
 *
 *   `only` marks a host that is nothing but a BMC. The reason is the same one
 *   `desktop.only` exists for: plenty of service processors sit in front of a
 *   machine this app will never hold a shell on (an ESXi box, a NAS, a switch),
 *   and the pane must not try to open an SSH session for them.
 */

/**
 * Which of these a board speaks is not reliably guessable, so `auto` asks it.
 *
 * The two concrete answers are here for the board that needs to be told: one
 * that serves both and redirects the wrong way, or one on a port where the
 * probe's answer is not the one you want. `auto` is the default because the
 * honest state of the world is that service processors disagree, and a person
 * setting one up should not have to know which way this one went.
 *
 * Detection lives in bmc.js, since it opens sockets and this file does not.
 */
const SCHEMES = ['auto', 'https', 'http'];

/** The ones that name an actual protocol, for anything resolving a URL. */
const CONCRETE_SCHEMES = ['https', 'http'];

const DEFAULT_PORTS = { https: 443, http: 80 };

/**
 * Which firmware is on the far end.
 *
 * This selects a login recipe (see bmc-login.js), not a protocol. Every entry
 * here reaches the same place by the same means: load the vendor's login page,
 * fill it, submit it. The vendor only decides *where* the page is and which
 * inputs on it are the username and the password.
 *
 *   auto        probe the board and pick. See detectVendor in bmc.js.
 *   supermicro  X9/X10/X11 and the ASPEED reference UI built on it
 *   idrac       Dell iDRAC 7, 8 and 9
 *   ilo         HPE iLO 4, 5 and 6
 *   openbmc     OpenBMC's webui-vue, and the boards shipping it
 *   ami         AMI MegaRAC, which is what most of the white-box world ships:
 *               Tyan, ASRock Rack, Gigabyte, Quanta
 *   basic       no login page at all: the board answers with HTTP 401 and the
 *               credentials go in the auth challenge rather than a form
 *   manual      open the page and leave it alone
 */
const VENDORS = ['auto', 'supermicro', 'idrac', 'ilo', 'openbmc', 'ami', 'basic', 'manual'];

const VENDOR_LABELS = {
    auto: 'Detect automatically',
    supermicro: 'Supermicro',
    idrac: 'Dell iDRAC',
    ilo: 'HPE iLO',
    openbmc: 'OpenBMC',
    ami: 'AMI MegaRAC',
    basic: 'HTTP Basic auth',
    manual: 'No auto-login',
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A port, or zero.
 *
 * Zero is a real answer here rather than a rejected one: it means "the default
 * for whichever scheme is in use", which is the only sensible thing a record can
 * store when the scheme itself is still to be detected.
 */
function toPort(value, fallback) {
    const port = Number(value);
    if (port === 0) return 0;
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

/**
 * The default port depends on the scheme, and on nothing else.
 *
 * Zero for `auto`, which is the record's way of saying "whichever port the
 * scheme we detect uses". Resolved with the scheme, in bmc.js.
 */
function defaultPort(scheme) {
    if (scheme === 'auto') return 0;
    return DEFAULT_PORTS[scheme] || DEFAULT_PORTS.https;
}

/**
 * Normalise the path the UI lives at.
 *
 * Stored with a leading slash and without a trailing one, so that joining it to
 * an origin is concatenation rather than a set of cases. Empty is the common
 * answer and means the board's root, which is what every vendor here redirects
 * from anyway.
 */
function toPath(value) {
    const raw = clean(value).replace(/\/+$/, '');
    if (!raw) return '';
    return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * Normalise a BMC block. Absent is not the same as disabled in the record (a
 * host saved before this existed simply has no block), but both normalise to
 * the same disabled default, so callers never branch on which it was.
 */
function normalizeBmc(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    // A record written before `auto` existed names its scheme, and keeps it.
    const scheme = SCHEMES.includes(source.scheme) ? source.scheme : 'auto';

    return {
        enabled: Boolean(source.enabled),
        only: Boolean(source.only),
        vendor: VENDORS.includes(source.vendor) ? source.vendor : 'auto',
        scheme,
        // Blank means the host's own address. Resolved in the store, not here,
        // because this module is not given the host to read it from.
        host: clean(source.host),
        port: toPort(source.port, defaultPort(scheme)),
        path: toPath(source.path),

        // Not a credential on its own, so unlike the password this lives in the
        // record proper: the host list wants to be able to show who it logs in
        // as without unlocking the vault.
        username: clean(source.username),

        // Off means "open the page and stop there". Worth having as a switch
        // rather than as the absence of a password, because a board behind a
        // one-time code or an SSO redirect has a password that simply must not
        // be typed into the first form on the page.
        autoLogin: source.autoLogin === undefined ? true : Boolean(source.autoLogin),

        /*
         * The certificate the user has agreed to, as a SHA-256 fingerprint.
         *
         * Every BMC ships a self-signed certificate, so refusing them outright
         * would make this feature reach nothing at all, and accepting them all
         * silently would make the pane the one place in the app where identity
         * is not checked. So it is trust on first use, recorded per host, in
         * the shape known-hosts.js records an SSH host key: the first
         * certificate is shown and accepted, and a *changed* one stops the load
         * and asks again.
         */
        trustedCert: clean(source.trustedCert),
    };
}

/** Returns an empty string when the BMC is openable, or the reason it isn't. */
function validateBmc(bmc) {
    if (!bmc?.enabled) return 'IPMI is not enabled for this host';
    if (!bmc.host) return 'An IPMI address is required';
    // No port check. Zero is the record saying "use the scheme's default", and
    // the scheme may not be settled until the board has been probed.

    // Auto-login with nobody to log in as is a form that gets half filled and a
    // failure the user reads as "the password is wrong". Better to say so here.
    if (bmc.autoLogin && bmc.vendor !== 'manual' && !bmc.username) {
        return 'An IPMI username is required to log in automatically';
    }

    return '';
}

/**
 * The URL to load, from a *resolved* block: one whose `host` has been filled in
 * and whose scheme and port are concrete. `auto` is not a scheme a URL can name,
 * so it falls back to HTTPS rather than producing `auto://`; callers that care
 * resolve it first, in bmc.js, where sockets can be opened to find out.
 *
 * The port is left off when it is the scheme's default, because it ends up in
 * the pane's address line and `https://10.0.0.5` is what the user calls that
 * machine. IPv6 is bracketed here rather than expected to arrive bracketed:
 * the field is typed by hand, and an address that came out of `ip addr` has no
 * brackets on it.
 */
function bmcUrl(bmc) {
    if (!bmc?.host) return '';

    const scheme = CONCRETE_SCHEMES.includes(bmc.scheme) ? bmc.scheme : 'https';

    const host = bmc.host.includes(':') && !bmc.host.startsWith('[')
        ? `[${bmc.host}]`
        : bmc.host;

    const resolvedPort = bmc.port || DEFAULT_PORTS[scheme];
    const port = resolvedPort === DEFAULT_PORTS[scheme] ? '' : `:${resolvedPort}`;
    return `${scheme}://${host}${port}${bmc.path}`;
}

/** One-line summary, in the form the activity log names a BMC by. */
function describeBmc(bmc) {
    if (!bmc) return '';
    const url = bmcUrl(bmc);
    return bmc.username ? `${url} as ${bmc.username}` : url;
}

module.exports = {
    SCHEMES,
    CONCRETE_SCHEMES,
    VENDORS,
    VENDOR_LABELS,
    DEFAULT_PORTS,
    defaultPort,
    normalizeBmc,
    validateBmc,
    bmcUrl,
    describeBmc,
};
