/**
 * What the assistant panel is pointed at.
 *
 * Three modes, and the third is the reason this file exists.
 *
 *   follow    whatever session is in front of the user, and it moves as they
 *             move. A default for tool calls, not a fence: a question about one
 *             server is often answered by looking at the one beside it.
 *
 *   global    every saved host and open session, with nothing ruled out.
 *
 *   targets   an explicit set of sessions and saved hosts, and nothing else.
 *             This one is a fence. The main process refuses tool calls that
 *             name anything outside it, which is the whole point of picking:
 *             "these two boxes" said in the menu is worth more than the same
 *             sentence typed into the chat, where it is only a suggestion.
 *
 * A target may be a session that is open right now or a host that is not
 * connected at all. Both are things you can want the assistant to work on, and
 * the difference between them is whether it has to connect first.
 *
 * The functions here are pure and total: they take a selection and give one
 * back. Nothing in here knows about React, IPC, or how a row is drawn.
 */

export const FOLLOW = 'follow';
export const GLOBAL = 'global';
export const TARGETS = 'targets';

/** The starting point, and where an emptied selection lands. */
export function followScope() {
    return { mode: FOLLOW, sessionIds: [], hostIds: [] };
}

export function globalScope() {
    return { mode: GLOBAL, sessionIds: [], hostIds: [] };
}

/** Anything readable, in the shape the rest of this file expects. */
export function normalize(scope) {
    if (!scope || typeof scope !== 'object') return followScope();
    const sessionIds = Array.isArray(scope.sessionIds) ? scope.sessionIds.filter(Boolean) : [];
    const hostIds = Array.isArray(scope.hostIds) ? scope.hostIds.filter(Boolean) : [];
    if (scope.mode === GLOBAL) return globalScope();
    if (scope.mode === TARGETS && sessionIds.length + hostIds.length > 0) {
        return { mode: TARGETS, sessionIds, hostIds };
    }
    return followScope();
}

const KEY = { session: 'sessionIds', host: 'hostIds' };

export function isPicked(scope, kind, id) {
    if (scope.mode !== TARGETS) return false;
    return scope[KEY[kind]].includes(id);
}

/** How many things an explicit selection holds. Zero for the other two modes. */
export function count(scope) {
    return scope.mode === TARGETS ? scope.sessionIds.length + scope.hostIds.length : 0;
}

/**
 * Check or uncheck one row.
 *
 * Ticking anything from either list moves the panel into `targets`, because
 * that is what the tick means: the modes above are not a third thing that can
 * be true at the same time. Unticking the last one goes back to following,
 * rather than leaving a fence around nothing.
 */
export function toggle(scope, kind, id) {
    const base = scope.mode === TARGETS ? scope : { mode: TARGETS, sessionIds: [], hostIds: [] };
    const key = KEY[kind];
    const list = base[key];
    const next = {
        ...base,
        [key]: list.includes(id) ? list.filter(value => value !== id) : [...list, id],
    };
    return next.sessionIds.length + next.hostIds.length === 0 ? followScope() : next;
}

/**
 * Drop sessions that have closed underneath the selection.
 *
 * Hosts are left alone: an unconnected host is a perfectly good target, and a
 * session closing is often exactly how one gets there.
 */
export function prune(scope, openSessionIds) {
    if (scope.mode !== TARGETS) return scope;

    const open = new Set(openSessionIds);
    const kept = scope.sessionIds.filter(id => open.has(id));
    if (kept.length === scope.sessionIds.length) return scope;
    if (kept.length + scope.hostIds.length === 0) return followScope();
    return { ...scope, sessionIds: kept };
}

/**
 * What to call one session.
 *
 * The ordinal is part of the name rather than a badge beside it, because these
 * land in a sentence ("Ask about web-01 #2") and in the panel's own title,
 * where there is nothing to hang a separate element off. The menu rows draw
 * their own badge instead, so a truncated name keeps the one thing telling it
 * from the row above.
 */
export function describeSession(session, fallback = '') {
    if (!session) return fallback;
    const name = session.hostName || session.address || 'Current session';
    return session.ordinal > 0 ? `${name} #${session.ordinal}` : name;
}

/**
 * The selection as the main process takes it.
 *
 * `follow` is resolved here, against the session in front right now, so main
 * never has to know that the panel is tracking anything: it is told a session
 * id and a mode, the same as it always was.
 *
 * `sessionId` is the default a tool call falls back to when it names no
 * session. With two targets picked there is no honest default, so it is empty
 * and the tool asks for one by name. Guessing which of two servers "restart
 * nginx" meant is exactly the failure this feature exists to prevent.
 */
export function toWire(scope, activeSessionId) {
    if (scope.mode === GLOBAL) {
        return { scope: GLOBAL, sessionId: '', sessionIds: [], hostIds: [] };
    }
    if (scope.mode === TARGETS) {
        return {
            scope: TARGETS,
            sessionId: scope.sessionIds.length === 1 ? scope.sessionIds[0] : '',
            sessionIds: scope.sessionIds,
            hostIds: scope.hostIds,
        };
    }
    return { scope: 'session', sessionId: activeSessionId || '', sessionIds: [], hostIds: [] };
}

/**
 * What the panel calls itself, in two lengths.
 *
 * `label` is the header button. With several servers pinned it is only the
 * count, because the header draws their icons beside it and names them on
 * hover: repeating one of those names in text would pick a winner among equals
 * and eat the width the rest of them need.
 *
 * `sentence` goes after "Ask about" in the composer's placeholder, where there
 * are no icons to lean on and a count is still the honest summary.
 */
export function describe(scope, { sessions = [], hosts = [], activeSessionId = '' } = {}) {
    if (scope.mode === GLOBAL) return { label: 'All hosts', sentence: 'any host' };

    if (scope.mode === FOLLOW) {
        const session = sessions.find(entry => entry.sessionId === activeSessionId);
        // The two halves part company when there is nothing to name: the title
        // has to say why it is empty, and "Ask about No session open" does not
        // survive being read.
        if (!session) return { label: 'No session open', sentence: 'your servers' };
        const name = describeSession(session);
        return { label: name, sentence: name };
    }

    const names = [
        ...scope.sessionIds.map(id => describeSession(
            sessions.find(session => session.sessionId === id),
            'a closed session',
        )),
        ...scope.hostIds.map((id) => {
            const host = hosts.find(entry => entry.id === id);
            return host?.name || host?.host || 'a saved host';
        }),
    ];

    if (names.length === 0) return { label: 'No session open', sentence: 'your servers' };
    if (names.length === 1) return { label: names[0], sentence: names[0] };
    return { label: `${names.length} servers`, sentence: `${names.length} servers` };
}
