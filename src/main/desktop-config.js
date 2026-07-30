/**
 * Shape and validation for a host's remote-desktop settings.
 *
 * Kept free of dependencies for the same reason as tunnel-config.js: the store
 * (persistence), the runtime (vnc.js, rdp.js) and the backup importer all need
 * to agree on one record shape without requiring each other.
 *
 * Two structural choices:
 *
 *   protocol vnc    RFB, to anything running a VNC server
 *            rdp    Windows Remote Desktop
 *
 *   transport tunnel  the stream rides the tab's existing SSH connection, so
 *                     `host` is resolved by the *server* and the desktop port
 *                     never has to be reachable, or even listening on
 *                     anything but loopback.
 *             direct  this machine dials the desktop itself. For a box on the
 *                     LAN with no SSH on it, or a server already behind a VPN.
 *
 * A record written before RDP existed has no `protocol`, and normalises to
 * `vnc`, which is what it was.
 */

/** Where a VNC server listens for display :0. Display N is 5900 + N. */
const DEFAULT_VNC_PORT = 5900;

/** The RDP well-known port. */
const DEFAULT_RDP_PORT = 3389;

/** Tunnelled means "loopback, as the SSH server sees it", which is the point. */
const DEFAULT_TUNNEL_HOST = '127.0.0.1';

const PROTOCOLS = ['vnc', 'rdp'];
const TRANSPORTS = ['tunnel', 'direct'];

/**
 * How the framebuffer is fitted to the pane.
 *   fit     scale the remote screen down to the pane, preserving aspect
 *   actual  1:1 pixels, pan around a pane smaller than the screen
 *   resize  ask the server to match the pane (needs SetDesktopSize support
 *           under VNC; RDP negotiates this at connect time)
 */
const SCALING_MODES = ['fit', 'actual', 'resize'];

// noVNC's own ranges for the Tight encoding knobs.
const DEFAULT_QUALITY = 6;
const DEFAULT_COMPRESSION = 2;

/**
 * The desktop size an RDP session asks for when it cannot measure the pane.
 * RDP fixes the resolution at connect time, unlike RFB where the server
 * dictates it, so a number has to be chosen rather than discovered.
 */
const DEFAULT_RDP_WIDTH = 1280;
const DEFAULT_RDP_HEIGHT = 800;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function toPort(value, fallback) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function toLevel(value, fallback) {
    const level = Number(value);
    return Number.isInteger(level) && level >= 0 && level <= 9 ? level : fallback;
}

/** The default port depends on which protocol the record is for. */
function defaultPort(protocol) {
    return protocol === 'rdp' ? DEFAULT_RDP_PORT : DEFAULT_VNC_PORT;
}

/**
 * So does the default transport, and for a more consequential reason.
 *
 * Tunnelling is the right default for VNC: a VNC server is usually on a machine
 * that is already being administered over SSH, and binding it to loopback is
 * the standard way to run one safely.
 *
 * RDP is the opposite case. It is a Windows service on a machine that very
 * likely has no SSH server at all, so defaulting it to `tunnel` would demand a
 * session that cannot be opened and leave the desktop unreachable.
 */
function defaultTransport(protocol) {
    return protocol === 'rdp' ? 'direct' : 'tunnel';
}

/**
 * Normalise a desktop block. Absent is not the same as disabled in the record
 * (a host saved before this existed simply has no block), but both normalise to
 * the same disabled default, so callers never branch on which it was.
 */
function normalizeDesktop(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const protocol = PROTOCOLS.includes(source.protocol) ? source.protocol : 'vnc';
    const transport = TRANSPORTS.includes(source.transport)
        ? source.transport
        : defaultTransport(protocol);

    return {
        enabled: Boolean(source.enabled),
        protocol,
        transport,
        // A host that is only a desktop. Windows boxes are the reason this
        // exists: there is no SSH server to carry a session, so the pane must
        // not try to open one and the Desktop view must not wait for it.
        only: Boolean(source.only),
        // Blank is meaningful for a tunnel (the server's own loopback) and not
        // for a direct dial, where validation asks for it.
        host: clean(source.host) || (transport === 'tunnel' ? DEFAULT_TUNNEL_HOST : ''),
        port: toPort(source.port, defaultPort(protocol)),
        viewOnly: Boolean(source.viewOnly),
        // Shared by default: connecting should not silently disconnect whoever
        // is already looking at that screen. VNC-only; RDP has no equivalent.
        shared: source.shared === undefined ? true : Boolean(source.shared),
        scaling: SCALING_MODES.includes(source.scaling) ? source.scaling : 'fit',
        quality: toLevel(source.quality, DEFAULT_QUALITY),
        compression: toLevel(source.compression, DEFAULT_COMPRESSION),

        // RDP identity. Not secret, so unlike the password these live in the
        // record proper: a username is not a credential on its own, and the
        // host list wants to be able to show who it connects as.
        username: clean(source.username),
        domain: clean(source.domain),
    };
}

/** Returns an empty string when the desktop is openable, or the reason it isn't. */
function validateDesktop(desktop) {
    if (!desktop?.enabled) return 'Remote desktop is not enabled for this host';

    const label = desktop.protocol === 'rdp' ? 'An RDP' : 'A VNC';
    if (!desktop.host) return `${label} address is required`;
    if (!desktop.port) return `${label} port is required`;

    // RDP authenticates before it will draw anything, so an empty username is
    // a guaranteed failure several seconds later rather than a usable session.
    if (desktop.protocol === 'rdp' && !desktop.username) {
        return 'An RDP username is required';
    }

    return '';
}

/** One-line summary, in the form the activity log names a desktop by. */
function describeDesktop(desktop) {
    if (!desktop) return '';
    const where = `${desktop.host}:${desktop.port}`;
    return desktop.transport === 'tunnel' ? `${where} (through SSH)` : where;
}

module.exports = {
    DEFAULT_VNC_PORT,
    DEFAULT_RDP_PORT,
    DEFAULT_TUNNEL_HOST,
    DEFAULT_RDP_WIDTH,
    DEFAULT_RDP_HEIGHT,
    PROTOCOLS,
    TRANSPORTS,
    SCALING_MODES,
    defaultPort,
    defaultTransport,
    normalizeDesktop,
    validateDesktop,
    describeDesktop,
};
