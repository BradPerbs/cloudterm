import { useCallback, useEffect, useState } from 'react';

/** A bridge call that no-ops if the preload predates this feature. */
const call = (method, ...args) =>
    (window.api.vnc ? window.api.vnc[method](...args) : Promise.resolve(null));

/**
 * Live view of one pane's remote desktop session, as the main process sees it.
 *
 * Deliberately thin: the byte counters and the connection state live in main,
 * because main owns the bridge. What the *viewer* is doing (whether the canvas
 * has painted, what the framebuffer size is) is RFB state and belongs to
 * VncView, which holds the noVNC object.
 *
 * Guarded like useTunnels: the preload bridge is established once per page load,
 * so during development new renderer code can briefly run against an older
 * `window.api`, and degrading to "no session" beats throwing out of an effect.
 */
export function useVnc(paneId) {
    const [session, setSession] = useState(null);

    useEffect(() => {
        if (!paneId || !window.api.vnc) return undefined;

        let cancelled = false;

        window.api.vnc.get(paneId)
            .then((current) => { if (!cancelled) setSession(current || null); })
            .catch(() => {});

        const unsubscribe = window.api.vnc.onUpdate((payload) => {
            if (payload?.paneId === paneId) setSession(payload.session || null);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [paneId]);

    const open = useCallback((hostId) => call('open', paneId, hostId), [paneId]);
    const close = useCallback((hostId) => call('close', paneId, hostId), [paneId]);
    const reportName = useCallback((name) => call('reportName', paneId, name), [paneId]);

    return { session, open, close, reportName };
}
