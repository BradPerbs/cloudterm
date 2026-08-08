/**
 * Shape and validation for reachability monitoring: the app-wide settings, and
 * the block a host carries saying whether it is watched.
 *
 * Kept free of dependencies for the same reason desktop-config.js is: the store
 * (persistence), the poller (monitor.js), the backup importer and the host
 * editor all have to agree on one record shape without any of them requiring
 * the others.
 *
 * What a check actually is, and what it deliberately is not:
 *
 *   It opens a TCP connection to a port on the host and closes it again. Not
 *   ICMP, which needs a raw socket and therefore administrator rights on
 *   Windows, and which answers a less useful question anyway: a machine whose
 *   NIC replies while sshd is dead is not a machine anyone would call up.
 *
 *   So "offline" here means "nothing accepted a connection on that port". A
 *   refusal is reported differently from a timeout, because the two are
 *   genuinely different news: refused is a machine that answered and had
 *   nothing listening, timed out is a machine that said nothing at all.
 */

/** How often a host is checked, and the values the settings page offers. */
const DEFAULT_INTERVAL = 60;
const INTERVAL_BOUNDS = { min: 15, max: 3600 };

/** How long a single connection attempt is given before it counts as a failure. */
const DEFAULT_TIMEOUT = 10;
const TIMEOUT_BOUNDS = { min: 2, max: 60 };

/**
 * Consecutive failures before a host is called offline.
 *
 * Not one, and that is the whole point of the setting. A single dropped packet
 * on a laptop's wifi is not a server going down, and a monitor that says it is
 * produces a notification every minute until nobody reads them any more.
 */
const DEFAULT_FAILURES = 2;
const FAILURE_BOUNDS = { min: 1, max: 5 };

const DEFAULT_SETTINGS = {
    // Off until asked for. Nothing should start opening connections to a host
    // list on the strength of the app having been installed.
    enabled: false,
    intervalSeconds: DEFAULT_INTERVAL,
    timeoutSeconds: DEFAULT_TIMEOUT,
    failures: DEFAULT_FAILURES,
    // The Windows toast. Separate from `enabled` because watching the host list
    // and being interrupted about it are two different appetites: the dot on a
    // host card is useful to someone who does not want a notification.
    notify: true,
    notifyOnRecovery: true,
};

/** The per-host block. `port` 0 means "whatever this host connects on". */
const DEFAULT_MONITOR = {
    enabled: false,
    port: 0,
};

const clamp = (value, { min, max }, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), min), max);
};

function toPort(value, fallback = 0) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

/**
 * Coerce anything the renderer or a restored settings file might carry into a
 * usable set of app-wide settings.
 */
function normalizeSettings(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};

    return {
        enabled: Boolean(source.enabled),
        intervalSeconds: clamp(source.intervalSeconds, INTERVAL_BOUNDS, DEFAULT_INTERVAL),
        timeoutSeconds: clamp(source.timeoutSeconds, TIMEOUT_BOUNDS, DEFAULT_TIMEOUT),
        failures: clamp(source.failures, FAILURE_BOUNDS, DEFAULT_FAILURES),
        notify: source.notify === undefined ? true : Boolean(source.notify),
        notifyOnRecovery: source.notifyOnRecovery === undefined
            ? true
            : Boolean(source.notifyOnRecovery),
    };
}

/**
 * Normalise a host's monitor block. Absent is not the same as disabled in the
 * record (a host saved before this existed simply has no block), but both
 * normalise to the same off default, so callers never branch on which it was.
 */
function normalizeMonitor(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};

    return {
        enabled: Boolean(source.enabled),
        // Blank is meaningful: it means the port this host already connects on,
        // resolved at check time so that changing the SSH port moves the check
        // with it rather than leaving it pointed at 22.
        port: toPort(source.port, 0),
    };
}

/**
 * Whether a host can be watched at all, and why not when it cannot.
 *
 * Two kinds of host are refused rather than watched badly:
 *
 *   serial      there is no socket. A console cable is either plugged in or it
 *               is not, and neither answer is about a server being up.
 *
 *   jump-hosted a host reached through a bastion has, by definition, no route
 *               from this machine; checking one from here would report it
 *               offline every minute of its perfectly healthy life. Reaching it
 *               properly would mean opening an SSH session to the bastion on a
 *               timer, which is a connection nobody asked for.
 */
function monitorSupport(host) {
    if (!host) return { ok: false, reason: 'That host no longer exists' };

    if (host.protocol === 'serial') {
        return {
            ok: false,
            reason: 'A serial console has no network address to check.',
        };
    }

    if (host.jumpHostId) {
        return {
            ok: false,
            reason: 'This host is reached through a jump host, so there is no route to it '
                + 'from this machine to check. Watch the jump host instead.',
        };
    }

    if (!host.host && !(host.desktop?.only && host.desktop?.host)) {
        return { ok: false, reason: 'This host has no address to check.' };
    }

    return { ok: true, reason: '' };
}

/**
 * The port a host is checked on when its block does not name one.
 *
 * A desktop-only host has no shell, so its `port` field is whatever was left
 * there by an earlier edit and means nothing. The desktop's own port is the one
 * that answers on that machine, so that is the one to knock on.
 */
function defaultCheckPort(host, sessionPort) {
    if (host?.desktop?.enabled && host.desktop.only) {
        return toPort(host.desktop.port, sessionPort || 0);
    }
    return toPort(host?.port, sessionPort || 0);
}

/** How an interval is written in a summary line. */
function describeInterval(seconds) {
    const value = clamp(seconds, INTERVAL_BOUNDS, DEFAULT_INTERVAL);
    if (value < 60) return `every ${value} seconds`;
    if (value === 60) return 'every minute';
    if (value % 3600 === 0) {
        const hours = value / 3600;
        return hours === 1 ? 'every hour' : `every ${hours} hours`;
    }
    return `every ${Math.round(value / 60)} minutes`;
}

module.exports = {
    DEFAULT_SETTINGS,
    DEFAULT_MONITOR,
    INTERVAL_BOUNDS,
    TIMEOUT_BOUNDS,
    FAILURE_BOUNDS,
    normalizeSettings,
    normalizeMonitor,
    monitorSupport,
    defaultCheckPort,
    describeInterval,
};
