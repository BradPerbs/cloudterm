import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Whether the watched hosts are answering.
 *
 * Main owns all of it: the timer, the states, the Windows notifications and the
 * list behind the bell. This hook is a window onto that, shared by everything
 * that shows a piece of it -- the dot on a host card, the bell in the title bar
 * and the monitoring settings page are routinely on screen together, and they
 * are looking at one answer rather than three.
 *
 * So the subscription is established once for the page rather than once per
 * consumer, the way `useProxies` shares its list. Main pushes after every sweep,
 * which is what keeps a card current without anything having asked.
 */

let cache = null;
const listeners = new Set();
let subscribed = false;
let fetching = false;

/**
 * Whether the first read has come back at all, however it came back.
 *
 * Readers tell "not asked yet" from "asked, and there was nothing", which is
 * the difference between drawing nothing for one frame and drawing nothing for
 * the rest of the run with no explanation.
 */
let settled = false;

/**
 * Bumped on every change, and the only thing the subscribers are handed.
 *
 * The state itself is read from `cache` at render, because a failed first read
 * publishes no state and still has to re-render everyone waiting on it: handing
 * out the state directly would mean calling `setState(null)` on a reader that
 * already holds null, which React correctly does nothing about.
 */
let version = 0;

function emit() {
    version += 1;
    for (const listener of listeners) listener(version);
}

function publish(next) {
    cache = next;
    settled = true;
    emit();
}

/**
 * Attach to main.
 *
 * The subscription is established once for the page. The first read is not: it
 * is retried by the next component to mount for as long as it keeps failing,
 * because the way it fails is the app being locked. Asking once and giving up
 * leaves every reader holding nothing for the rest of the run.
 *
 * Guarded like every other bridge call in this app: the preload surface is
 * fixed at page load, so during development the renderer can hot-reload against
 * a `window.api` that predates this feature.
 */
function ensureSubscribed() {
    if (!window.api?.monitor) {
        settled = true;
        return;
    }

    if (!subscribed) {
        subscribed = true;
        window.api.monitor.onState(publish);
    }

    if (cache || fetching) return;

    fetching = true;
    window.api.monitor.status()
        .then(publish)
        .catch(() => {
            // Locked, or a main process that predates this feature and has no
            // such channel. Either way the next mount asks again.
        })
        .finally(() => {
            fetching = false;
            settled = true;
            emit();
        });
}

export default function useMonitor() {
    const [, setVersion] = useState(version);

    useEffect(() => {
        listeners.add(setVersion);
        ensureSubscribed();
        // Anything that landed between this module first loading and this
        // component mounting.
        setVersion(version);

        return () => listeners.delete(setVersion);
    }, []);

    const state = cache;

    /** Keyed for the host list, which asks about one host at a time. */
    const statuses = useMemo(() => {
        const map = new Map();
        for (const entry of state?.hosts || []) map.set(entry.hostId, entry);
        return map;
    }, [state]);

    const configure = useCallback(async (patch) => {
        if (!window.api?.monitor) return null;
        const next = await window.api.monitor.configure(patch);
        publish(next);
        return next;
    }, []);

    const checkNow = useCallback(async () => {
        if (!window.api?.monitor) return null;
        const next = await window.api.monitor.checkNow();
        publish(next);
        return next;
    }, []);

    const markRead = useCallback(async () => {
        if (!window.api?.monitor) return null;
        const next = await window.api.monitor.markRead();
        publish(next);
        return next;
    }, []);

    const clearEvents = useCallback(async () => {
        if (!window.api?.monitor) return null;
        const next = await window.api.monitor.clearEvents();
        publish(next);
        return next;
    }, []);

    return {
        state,
        // False only until the first answer arrives. A page that draws nothing
        // while this is false is waiting; one that draws nothing after it is
        // broken, and should say so rather than being a blank panel.
        ready: settled,
        settings: state?.settings || null,
        statuses,
        // Every host set to be watched, in order, each carrying its last result
        // or `unknown` if it has not been checked yet. Read this to show what is
        // being watched; `statuses` is the same thing keyed by id, for the card
        // that only asks about one host.
        hosts: state?.hosts || [],
        events: state?.events || [],
        unread: state?.unread || 0,
        // Why the last sweep is not to be believed, or '' when it is. Either
        // this machine has no network, or every host went quiet at the same
        // moment, which is nearly always the same thing seen from the other
        // end. Callers say so rather than showing a page of red dots as though
        // it were news.
        suspectReason: state?.suspectReason || '',
        configure,
        checkNow,
        markRead,
        clearEvents,
    };
}
