const { app, net, Notification, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const proxy = require('./proxy');
const vault = require('./vault');
const activity = require('./activity');
const { normalizeSettings, DEFAULT_SETTINGS } = require('./monitor-config');

/**
 * Watching whether the hosts you care about are still answering.
 *
 * A check is one TCP connection to one port, opened and immediately closed. The
 * reasoning for that rather than ICMP is in monitor-config.js; the short version
 * is that a raw socket needs administrator rights on Windows and answers a less
 * useful question anyway.
 *
 * Three things this module is careful about, and they matter more than the
 * polling itself, because each one is a way of producing notifications nobody
 * will read:
 *
 *   Flapping      a host is not called offline until it has failed several
 *                 checks in a row, and a notification is written on the
 *                 transition only, never on each failed check.
 *
 *   This machine  if every host fails in the same sweep, the common factor is
 *                 almost certainly the network this app is running on. Those
 *                 sweeps are recorded as inconclusive rather than as the whole
 *                 fleet going down at once. Not forever, though: see
 *                 MAX_SUSPECT_SWEEPS, because a total failure that persists is
 *                 worth reporting whichever end of the cable it is on.
 *
 *   Waking up     a laptop coming out of sleep has missed every interval it was
 *                 due and has a NIC that is not up yet. Checks are held off for
 *                 a moment rather than fired into a network that does not exist.
 *
 * Nothing here runs while the app is locked. A locked app cannot read a proxy
 * password, and the person in front of it has not proven they are allowed to
 * know which servers are down.
 */

/** How many hosts are checked at once. Enough to keep a sweep brief. */
const CONCURRENCY = 8;

/**
 * How long after waking before checks resume. A NIC that has not finished
 * coming up refuses connections in a way indistinguishable from a dead server.
 */
const RESUME_GRACE = 20000;

/**
 * Consecutive all-hosts-failed sweeps tolerated before the suppression above
 * gives up and lets the counters run. Three sweeps of total silence is no
 * longer a plausible blip in the local network.
 */
const MAX_SUSPECT_SWEEPS = 3;

const statePath = () => path.join(app.getPath('userData'), 'monitor.json');

let settings = null;
let timer = null;
let sweeping = false;
let pausedUntil = 0;
let lastSweepAt = 0;
// '' when the last sweep is to be believed, otherwise why it is not: 'offline'
// for a machine with no network, 'all-failed' for every host going quiet at
// once, which is nearly always the same thing seen from the other end.
let suspectReason = '';
let suspectSweeps = 0;
let changeTimer = null;
let notify = () => {};
let getWindow = () => null;

// hostId -> { state, since, checkedAt, failures, message, latency, error }
const statuses = new Map();

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function load() {
    if (settings) return settings;

    try {
        settings = normalizeSettings(JSON.parse(fs.readFileSync(statePath(), 'utf8')));
    } catch {
        // First run, or an unreadable file. The defaults have monitoring off,
        // which is the right thing to fall back to either way.
        settings = { ...DEFAULT_SETTINGS };
    }

    return settings;
}

function persist() {
    try {
        fs.writeFileSync(statePath(), JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Failed to save the monitoring settings:', error.message);
    }
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const describeDuration = (ms) => {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 90) return `${seconds} seconds`;

    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes} minutes`;

    const hours = Math.round(minutes / 60);
    return hours === 1 ? 'an hour' : `${hours} hours`;
};

/**
 * The shape the renderer reads.
 *
 * Names, addresses and states only. The proxy chain a check was dialled through
 * carries decrypted passwords and stays here, which is why the targets are
 * resolved per sweep rather than held in something the renderer is handed.
 */
function snapshot() {
    const current = load();

    /*
     * Every host that is set to be watched, whether or not it has ever been
     * checked, with the last result folded in where there is one.
     *
     * The list comes from the records rather than from `statuses`, and that is
     * the whole point of it. States only exist once a sweep has run, so a list
     * built from them is empty on the first paint, empty while monitoring is
     * switched off, and empty for the minute after someone switches on their
     * first host: three moments in which the honest answer is "these, not
     * checked yet" and the answer it would give is "nothing".
     */
    const hosts = store.listMonitoredHosts().map((entry) => {
        const status = statuses.get(entry.hostId);

        return {
            hostId: entry.hostId,
            name: entry.name,
            address: entry.address,
            state: status?.state || 'unknown',
            since: status?.since || 0,
            checkedAt: status?.checkedAt || 0,
            message: status?.message || '',
            latency: status?.latency || 0,
            // A host that cannot be checked is known to be broken before any
            // check is attempted, so the record's own complaint stands in until
            // a sweep has one of its own.
            error: status?.error || entry.error,
        };
    });

    return {
        settings: current,
        running: Boolean(timer),
        sweeping,
        // Set while the last sweep looked like a problem at this end rather than
        // at the far end. The monitoring page says so out loud, because "nothing
        // is down" and "we stopped being able to tell" are different answers.
        suspectReason,
        lastSweepAt,
        hosts,
    };
}

function publish() {
    notify('monitor-state', snapshot());
}

/**
 * Raise a Windows notification, if the settings and the platform allow one.
 *
 * Silent about its own failures on purpose. A toast that could not be shown is
 * not worth a second attempt at telling someone something, and the crossing is
 * in the activity log either way.
 */
function toast(title, body) {
    const current = load();
    // `enabled` as well as `notify`, for the sweep that was already in flight
    // when monitoring was switched off. Its results are still worth folding in;
    // interrupting someone over them is not.
    if (!current.enabled || !current.notify) return;

    try {
        if (!Notification.isSupported()) return;

        const notification = new Notification({ title, body });

        // Clicking it should bring the app forward. Anyone who clicks a toast
        // about a server being down wants to look at the app, not dismiss it.
        notification.on('click', () => {
            const window = getWindow();
            if (!window || window.isDestroyed()) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
        });

        notification.show();
    } catch (error) {
        console.error('Could not show a notification:', error.message);
    }
}

/**
 * A host changed state.
 *
 * The one place a notification and a log entry are written, so the two can
 * never disagree about what happened. Both, and nothing else: the crossing is
 * worth interrupting someone over once and worth keeping forever, and the
 * activity log is what keeps it. There is no third copy held in memory for a
 * panel to read, because the log already answers everything one could.
 */
function announce(entry, state, { downtime = 0 } = {}) {
    const where = entry.address;

    if (state === 'offline') {
        const title = `${entry.name} is offline`;
        const body = `${where}: ${entry.message}`;

        toast(title, body);

        activity.record({
            category: 'connection',
            action: 'host.offline',
            outcome: 'failure',
            target: entry.name,
            subject: where,
            hostId: entry.hostId,
            hostName: entry.name,
            message: entry.message,
            detail: 'Reachability check',
        });
        return;
    }

    const title = `${entry.name} is back`;
    const body = downtime
        ? `${where} answered after ${describeDuration(downtime)}`
        : `${where} answered`;

    if (load().notifyOnRecovery) toast(title, body);

    activity.record({
        category: 'connection',
        action: 'host.online',
        outcome: 'success',
        target: entry.name,
        subject: where,
        hostId: entry.hostId,
        hostName: entry.name,
        detail: downtime ? `Back after ${describeDuration(downtime)}` : 'Reachability check',
    });
}

/* ------------------------------------------------------------------ *
 * Checking
 * ------------------------------------------------------------------ */

/**
 * Knock on one port.
 *
 * Resolves rather than throws for a host that is down, because a host being
 * down is the ordinary result here rather than an error in the checking.
 */
async function probe(target, timeoutMs) {
    const started = Date.now();

    let socket;
    try {
        socket = await proxy.openSocket({
            host: target.host,
            port: target.port,
            chain: target.proxyChain,
            timeout: timeoutMs,
        });
    } catch (error) {
        // openSocket has already phrased this: "Timed out reaching the host",
        // "Connection refused. Nothing is listening on that port", and so on.
        return { ok: false, message: error.message, latency: 0 };
    }

    // Nothing is spoken on this connection. Opening it was the whole question,
    // and holding it open would be a second session on every host every minute.
    try {
        socket.destroy();
    } catch {
        // Already gone, which is just as closed as we wanted it.
    }

    return { ok: true, message: 'Answered', latency: Date.now() - started };
}

/** Runs `task` over `items`, at most `limit` at a time. */
async function pooled(items, limit, task) {
    const results = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await task(items[index]);
        }
    });

    await Promise.all(workers);

    return results;
}

/** Whether this machine thinks it has a network at all. */
function onlineHere() {
    try {
        return typeof net?.isOnline === 'function' ? net.isOnline() : true;
    } catch {
        return true;
    }
}

/**
 * Check every watched host once.
 *
 * `manual` is the button on the settings page. All it overrides is the grace
 * period after waking, which is the one skip a person standing there asking for
 * a check has better information about than this module does.
 *
 * It pointedly does not override the master switch. A manual sweep with
 * monitoring off would leave states on the host cards that nothing was left
 * running to correct, which is a worse answer than the button being unavailable
 * and the page saying why.
 */
async function sweep({ manual = false } = {}) {
    if (sweeping) return snapshot();
    if (!load().enabled) return snapshot();
    if (vault.isLocked()) return snapshot();
    if (!manual && Date.now() < pausedUntil) return snapshot();

    const targets = store.getMonitorTargets();

    // Drop anything switched off or deleted since the last sweep, so a host
    // that is no longer watched stops showing a state on its card.
    const watched = new Set(targets.map(target => target.hostId));
    let changed = false;
    for (const hostId of [...statuses.keys()]) {
        if (!watched.has(hostId)) {
            statuses.delete(hostId);
            changed = true;
        }
    }

    if (targets.length === 0) {
        suspectReason = '';
        lastSweepAt = Date.now();
        if (changed) publish();
        return snapshot();
    }

    if (!onlineHere()) {
        /*
         * This machine has no network at all. Every host would fail and none of
         * it would mean anything, so nothing is checked and nothing is recorded.
         *
         * `lastSweepAt` deliberately does not move: it says when a host was last
         * actually checked, and letting it tick along through an outage would
         * have the settings page reporting fresh results that were never taken.
         */
        const already = suspectReason === 'offline';
        suspectReason = 'offline';
        if (!already) publish();
        return snapshot();
    }

    sweeping = true;
    const timeoutMs = load().timeoutSeconds * 1000;

    try {
        const results = await pooled(targets, CONCURRENCY, async (target) => {
            // A host whose proxy has been deleted, or which has since become
            // uncheckable. Reported as a configuration problem, which is a
            // different thing from a server that did not answer.
            if (target.error) return { target, ok: false, message: target.error, config: true };

            const result = await probe(target, timeoutMs);
            return { target, ...result, config: false };
        });

        const checkable = results.filter(result => !result.config);
        const failed = checkable.filter(result => !result.ok);

        /*
         * Every single host failed at once, and there is more than one of them.
         * That is this machine's network far more often than it is every server
         * in the list, so the sweep is thrown away rather than believed.
         *
         * Bounded, because a sweep that keeps coming back empty eventually has
         * to be taken at face value: after MAX_SUSPECT_SWEEPS the counters run
         * as normal and the notifications go out.
         */
        const total = checkable.length > 1 && failed.length === checkable.length;
        if (total) suspectSweeps += 1;
        else suspectSweeps = 0;

        const inconclusive = total && suspectSweeps <= MAX_SUSPECT_SWEEPS;
        suspectReason = inconclusive ? 'all-failed' : '';

        for (const result of results) {
            if (inconclusive && !result.config) continue;
            apply(result);
        }

        lastSweepAt = Date.now();
        publish();
    } catch (error) {
        // A sweep must never take the app down with it.
        console.error('A reachability sweep failed:', error.message);
    } finally {
        sweeping = false;
    }

    return snapshot();
}

/**
 * Fold one result into a host's state, and announce a transition if that is
 * what it was.
 */
function apply({ target, ok, message, latency, config }) {
    const previous = statuses.get(target.hostId);
    const now = Date.now();

    const entry = {
        hostId: target.hostId,
        name: target.name,
        // `host:port` for a real target; a misconfigured one has neither, and
        // the error says all there is to say.
        address: target.host ? `${target.host}:${target.port}` : '',
        state: previous?.state || 'unknown',
        since: previous?.since || now,
        checkedAt: now,
        failures: previous?.failures || 0,
        message: message || '',
        latency: latency || 0,
        error: config ? message : '',
    };

    if (ok) {
        entry.failures = 0;

        if (entry.state !== 'online') {
            const downtime = entry.state === 'offline' ? now - entry.since : 0;
            entry.state = 'online';
            entry.since = now;

            // A host that has only just been switched on is not a recovery.
            // Nothing was ever reported down, so there is nothing to say.
            if (previous?.state === 'offline') {
                statuses.set(target.hostId, entry);
                announce(entry, 'online', { downtime });
                return;
            }
        }

        statuses.set(target.hostId, entry);
        return;
    }

    entry.failures += 1;

    // A configuration problem is not a server that stopped answering, and
    // retrying it three times does not make it more true. It goes straight to
    // offline so the editor's own explanation is what the user is sent to.
    const threshold = config ? 1 : load().failures;

    if (entry.state !== 'offline' && entry.failures >= threshold) {
        entry.state = 'offline';
        entry.since = now;
        statuses.set(target.hostId, entry);
        announce(entry, 'offline');
        return;
    }

    statuses.set(target.hostId, entry);
}

/* ------------------------------------------------------------------ *
 * Schedule
 * ------------------------------------------------------------------ */

function startTimer() {
    stopTimer();
    timer = setInterval(() => { sweep(); }, load().intervalSeconds * 1000);
    // Nothing here should hold the process open on its own.
    timer.unref?.();
}

function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
}

function status() {
    load();
    return snapshot();
}

/**
 * Change the settings. Returns the new status, so a settings page never has to
 * ask twice to find out what it just did.
 */
function configure(patch = {}) {
    const before = load();
    settings = normalizeSettings({ ...before, ...patch });
    persist();

    if (!settings.enabled) {
        stopTimer();
        // States from when it was on would sit on the host cards indefinitely,
        // going staler by the minute, with nothing left to correct them.
        statuses.clear();
        suspectReason = '';
        suspectSweeps = 0;
    } else if (!before.enabled || before.intervalSeconds !== settings.intervalSeconds) {
        startTimer();
        // Turning it on, or changing how often, should do something visible
        // rather than wait out an interval.
        if (!before.enabled) sweep();
    }

    publish();
    return snapshot();
}

/** The button. Sweeps now rather than at the top of the next interval. */
function checkNow() {
    return sweep({ manual: true });
}

/**
 * The host list changed under us. Which hosts are watched, and on what port, is
 * read fresh at every sweep, so the only thing needed here is to bring the next
 * one forward: switching monitoring on for a host should colour its card in a
 * moment rather than at the top of the next interval.
 *
 * Debounced, because a bulk edit writes the store once per record.
 */
function hostsChanged() {
    if (changeTimer) return;

    changeTimer = setTimeout(() => {
        changeTimer = null;

        // With the master switch off there is nothing to sweep, and the state
        // has still changed: how many hosts are set to be watched is part of
        // what the settings page reports, and it is exactly what someone is
        // changing when they switch monitoring on for a host before turning the
        // feature on. Publishing here is what stops that page insisting nothing
        // has been set up.
        if (load().enabled) sweep();
        else publish();
    }, 1000);
    changeTimer.unref?.();
}

/**
 * Called once the app is ready. Safe to call with monitoring switched off or
 * the app locked: it settles into doing nothing and picks up when the state it
 * needs arrives.
 */
function start(notifier, windowGetter) {
    if (typeof notifier === 'function') notify = notifier;
    if (typeof windowGetter === 'function') getWindow = windowGetter;

    /*
     * A laptop that has been asleep has missed every interval it was due, and
     * comes back with a network stack that is not ready. Checking immediately
     * would report the entire host list down, one notification each, seconds
     * after the lid came up.
     */
    powerMonitor.on('resume', () => {
        pausedUntil = Date.now() + RESUME_GRACE;
        // The counts are about a network that no longer exists. Starting from
        // zero is the honest state to come back in.
        for (const entry of statuses.values()) entry.failures = 0;
        suspectSweeps = 0;
    });

    // A locked app skips its sweeps, and answers no IPC at all, so unlocking is
    // both the moment the states are most out of date and the first moment the
    // renderer can be told anything. Published even with monitoring off, or the
    // settings page behind the lock screen would be left holding nothing.
    vault.onUnlocked(() => {
        if (load().enabled) sweep();
        else publish();
    });

    // Which hosts are watched lives in the store, so every write is a reason to
    // look again.
    store.onChanged(hostsChanged);

    if (!load().enabled) return;

    startTimer();
    sweep();
}

function stop() {
    stopTimer();
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = null;
}

module.exports = {
    status,
    configure,
    checkNow,
    start,
    stop,
};
