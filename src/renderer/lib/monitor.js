/**
 * Renderer-side vocabulary for reachability monitoring.
 *
 * The shape mirrors `src/main/monitor-config.js`. It is restated here rather
 * than shared because the renderer is sandboxed and cannot reach main-process
 * modules, and main stays the authority: every value sent from a control below
 * is clamped again before it reaches a timer or a socket.
 */

/**
 * How often hosts are checked. Anything between 15 seconds and an hour is
 * accepted on the record; these are the answers worth offering, and a minute is
 * the one almost everyone wants.
 */
export const INTERVALS = [
    { value: 30, label: '30s' },
    { value: 60, label: '1 min' },
    { value: 300, label: '5 min' },
    { value: 900, label: '15 min' },
];

export const TIMEOUTS = [
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 20, label: '20s' },
    { value: 30, label: '30s' },
];

/**
 * Consecutive failures before a host is called offline.
 *
 * One is offered, and it is the wrong answer for a laptop: a single dropped
 * packet on wifi becomes a notification. It is here because on a wired machine
 * watching something that matters, being told immediately is the point.
 */
export const THRESHOLDS = [
    { value: 1, label: 'Once' },
    { value: 2, label: 'Twice' },
    { value: 3, label: '3 times' },
];

/**
 * What a state looks like, in one place, because a host card and the settings
 * page both draw it and neither should be inventing its own red.
 *
 *   online   answering. Hollow rather than filled, so it is not mistaken for
 *            the solid dot that means a session is open on this host.
 *   offline  nothing accepted a connection.
 *   problem  the check itself cannot run: a deleted proxy, a host since
 *            switched to serial. Amber, because nothing is known about the
 *            server either way, which is not the same as it being down.
 */
export const STATE_STYLES = {
    online: {
        label: 'Answering',
        dot: 'border-2 border-emerald-500 bg-white dark:bg-surface-control',
        text: 'text-emerald-600 dark:text-emerald-400',
    },
    offline: {
        label: 'Not answering',
        dot: 'bg-rose-500',
        text: 'text-rose-600 dark:text-rose-400',
    },
    problem: {
        label: 'Cannot check',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-500',
    },
    unknown: {
        label: 'Not checked yet',
        dot: 'bg-gray-300 dark:bg-neutral-600',
        text: 'text-gray-500 dark:text-neutral-400',
    },
};

/**
 * Which of the four a status entry is.
 *
 * A configuration problem is stored as `offline` with an `error` on it, because
 * that is what it means for the notification and the log: this host is not
 * being watched successfully. It is drawn differently, hence this.
 */
export function stateOf(status) {
    if (!status) return '';
    if (status.error) return 'problem';
    return status.state || 'unknown';
}

/**
 * Whether a host can be watched at all, and why not when it cannot.
 *
 * The rules are `monitorSupport` in main/monitor-config.js, restated here for
 * the same reason protocols.js restates the protocol list: the renderer is
 * sandboxed and cannot reach a main-process module, and this one has to answer
 * for a form still being typed into rather than for a saved record. Main
 * refuses the same two cases again on its own side, so nothing depends on this
 * copy being the enforcement.
 *
 *   serial      no socket. A console cable is plugged in or it is not, and
 *               neither answer is about a server being up.
 *   jump-hosted no route from this machine by definition, so a check from here
 *               would report a healthy host offline every minute of its life.
 */
export function monitorSupport(host) {
    if (!host) return { ok: false, reason: '' };

    if (host.protocol === 'serial') {
        return { ok: false, reason: 'A serial console has no network address to check.' };
    }

    if (host.jumpHostId) {
        return {
            ok: false,
            reason: 'This host is reached through a jump host, so there is no route to it from '
                + 'this machine to check. Watch the jump host instead.',
        };
    }

    return { ok: true, reason: '' };
}

/**
 * The port a host is checked on when its own block does not name one.
 *
 * A desktop-only host has no shell, so the port field at the top of the editor
 * is whatever an earlier edit left there and means nothing. The desktop's own
 * port is what answers on that machine.
 */
export function defaultCheckPort(host) {
    if (host?.desktop?.enabled && host.desktop.only) return host.desktop.port || 0;
    return host?.port || 0;
}

/** Ages here are seconds and minutes, not dates. */
export function since(timestamp) {
    const age = Date.now() - (timestamp || 0);
    if (!timestamp || age < 60_000) return 'just now';

    const minutes = Math.floor(age / 60_000);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;

    return `${Math.floor(hours / 24)} d ago`;
}

/**
 * The whole story about one host, for a tooltip.
 *
 * Always leads with the address it is being checked on, because that is the
 * detail the row itself has no room for and the one worth hovering to find: a
 * host that reads as offline is very often a host being checked on a port
 * nobody meant.
 */
export function describeStatus(status) {
    const state = stateOf(status);
    if (!state) return '';

    if (state === 'problem') return status.error;

    const where = status.address ? `${status.address}: ` : '';

    if (state === 'offline') {
        return `${where}${status.message || 'not answering'}, since ${since(status.since)}`;
    }

    if (state === 'online') {
        const latency = status.latency ? ` in ${status.latency} ms` : '';
        return `${where}answered${latency}, checked ${since(status.checkedAt)}`;
    }

    return `${where}not checked yet`;
}
