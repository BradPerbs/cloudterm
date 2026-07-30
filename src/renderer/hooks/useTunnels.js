import { useCallback, useEffect, useMemo, useState } from 'react';

/** A bridge call that no-ops if the preload predates this feature. */
const call = (method, ...args) =>
    (window.api.tunnels ? window.api.tunnels[method](...args) : Promise.resolve([]));

/**
 * Live view of one tab's port forwards.
 *
 * The main process owns the list: it seeds a runtime for every tunnel the host
 * has configured as soon as the session connects, so this hook reads rather
 * than tracks, and every mutation comes back through the same update event.
 *
 * Every call is guarded because the preload bridge is established once per page
 * load: during development the renderer hot-reloads without one, so new code
 * can briefly run against an older `window.api`. Degrading to an empty list
 * beats throwing out of an effect and taking the whole terminal tab down.
 */
export function useTunnels(tabId) {
    const [tunnels, setTunnels] = useState([]);

    useEffect(() => {
        if (!tabId || !window.api.tunnels) return undefined;

        let cancelled = false;

        window.api.tunnels.list(tabId)
            .then((list) => { if (!cancelled) setTunnels(list || []); })
            .catch(() => {});

        const unsubscribe = window.api.tunnels.onUpdate((payload) => {
            if (payload?.tabId === tabId) setTunnels(payload.tunnels || []);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [tabId]);

    const summary = useMemo(() => ({
        total: tunnels.length,
        active: tunnels.filter(tunnel => tunnel.state === 'active').length,
        failed: tunnels.filter(tunnel => tunnel.state === 'error').length,
        connections: tunnels.reduce((sum, tunnel) => sum + (tunnel.activeConnections || 0), 0),
    }), [tunnels]);

    const start = useCallback((tunnelId) => call('start', tabId, tunnelId), [tabId]);
    const stop = useCallback((tunnelId) => call('stop', tabId, tunnelId), [tabId]);
    const startAll = useCallback(() => call('startAll', tabId), [tabId]);
    const stopAll = useCallback(() => call('stopAll', tabId), [tabId]);

    /** Reconcile the runtime with the host after its tunnel list is edited. */
    const sync = useCallback((hostId) => call('sync', tabId, hostId), [tabId]);

    return { tunnels, summary, start, stop, startAll, stopAll, sync };
}
