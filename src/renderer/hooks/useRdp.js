import { useCallback, useEffect, useState } from 'react';

/** A bridge call that no-ops if the preload predates this feature. */
const call = (method, ...args) =>
    (window.api.rdp ? window.api.rdp[method](...args) : Promise.resolve(null));

/**
 * Live view of one pane's RDP session, as the main process sees it.
 *
 * The counterpart to useVnc, and deliberately the same shape: the byte counters
 * and the connection state live in main because main owns the bridge, while
 * everything about the *session* (the framebuffer, the input, whether the
 * canvas has painted) is IronRDP's and belongs to RdpView, which holds it.
 *
 * Guarded like useVnc: the preload bridge is established once per page load, so
 * during development new renderer code can briefly run against an older
 * `window.api`, and degrading to "no session" beats throwing out of an effect.
 */
export function useRdp(paneId) {
    const [session, setSession] = useState(null);

    useEffect(() => {
        if (!paneId || !window.api.rdp) return undefined;

        let cancelled = false;

        window.api.rdp.get(paneId)
            .then((current) => { if (!cancelled) setSession(current || null); })
            .catch(() => {});

        const unsubscribe = window.api.rdp.onUpdate((payload) => {
            if (payload?.paneId === paneId) setSession(payload.session || null);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [paneId]);

    const open = useCallback((hostId) => call('open', paneId, hostId), [paneId]);
    const close = useCallback((hostId) => call('close', paneId, hostId), [paneId]);

    /**
     * The session as main has it, right now.
     *
     * `session` above is pushed on an interval, so at the moment a connection
     * fails it can still be a beat behind — and that is exactly the moment the
     * reason is wanted. This asks.
     */
    const get = useCallback(() => call('get', paneId), [paneId]);

    return { session, open, close, get };
}
