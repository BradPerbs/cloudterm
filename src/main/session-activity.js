/**
 * The two log lines every session produces, phrased identically whatever it
 * connected over.
 *
 * The activity log is read as one list. A telnet session that said "closed" in
 * a different shape from an SSH one, or measured its duration differently,
 * would read as a different kind of event rather than the same event on another
 * transport. ssh.js writes these inline and predates this module; these two
 * functions match what it produces on purpose.
 */

const activity = require('./activity');

const CLOSE_REASONS = {
    closed: 'Closed from the app',
    dropped: 'The connection dropped',
    locked: 'The app was locked',
    replaced: 'Replaced by a new session on the same tab',
};

/** How long a session lasted, phrased for a log line. */
function describeDuration(openedAt) {
    if (!openedAt) return '';
    const seconds = Math.round((Date.now() - openedAt) / 1000);
    if (seconds < 60) return `lasted ${seconds}s`;
    if (seconds < 3600) return `lasted ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `lasted ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * One entry per attempt, whether it came up or not. Called once per dial: the
 * callers guard it with the same `settled` flag ssh.js uses, so a session is
 * never logged as both opened and refused.
 */
function recordOpen({ success, message, hostId, hostName, address, detail }) {
    activity.record({
        category: 'connection',
        action: 'session.open',
        outcome: success ? 'success' : 'failure',
        target: hostName || '',
        subject: address || '',
        detail: success ? (detail || '') : '',
        message: success ? '' : (message || ''),
        hostId: hostId || '',
        hostName: hostName || '',
    });
}

function recordClose({ reason = 'closed', hostId, hostName, address, openedAt }) {
    activity.record({
        category: 'connection',
        action: 'session.close',
        outcome: reason === 'dropped' ? 'failure' : 'info',
        target: hostName || '',
        subject: address || '',
        detail: [CLOSE_REASONS[reason] || CLOSE_REASONS.closed, describeDuration(openedAt)]
            .filter(Boolean).join(' · '),
        hostId: hostId || '',
        hostName: hostName || '',
    });
}

module.exports = { CLOSE_REASONS, describeDuration, recordOpen, recordClose };
