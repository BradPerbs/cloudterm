import { useCallback, useEffect, useState } from 'react';

/** A bridge call that no-ops if the preload predates this feature. */
const call = (method, ...args) =>
    (window.api.bmc ? window.api.bmc[method](...args) : Promise.resolve(null));

/**
 * Live view of one pane's BMC session, as the main process sees it.
 *
 * Thin for the same reason useVnc is: what the *page* is doing (which URL it is
 * on, whether it can go back) is guest state and belongs to the view, which
 * holds the `<webview>`. What main knows, and this reports, is the part the
 * renderer cannot see: whether the login was filled in, and whether the load
 * failed for a reason worth naming.
 *
 * Note the shape of the update payload. Unlike `vnc-update`, which nests a
 * `session`, bmc.js sends the pane state flat, so there is nothing to unwrap.
 *
 * Guarded like useVnc: the preload bridge is established once per page load, so
 * during development new renderer code can briefly run against an older
 * `window.api`, and degrading to "no session" beats throwing out of an effect.
 */
export function useBmc(paneId) {
    const [session, setSession] = useState(null);

    useEffect(() => {
        if (!paneId || !window.api.bmc) return undefined;

        let cancelled = false;

        window.api.bmc.get(paneId)
            .then((current) => { if (!cancelled) setSession(current || null); })
            .catch(() => {});

        const unsubscribe = window.api.bmc.onUpdate((payload) => {
            if (payload?.paneId === paneId) setSession(payload);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [paneId]);

    const open = useCallback((hostId) => call('open', paneId, hostId), [paneId]);
    const close = useCallback((hostId) => call('close', paneId, hostId), [paneId]);
    const attach = useCallback((webContentsId) => call('attach', paneId, webContentsId), [paneId]);
    const login = useCallback(() => call('login', paneId), [paneId]);

    return { session, open, close, attach, login };
}
