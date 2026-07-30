import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const ACTIVE_STATES = new Set(['queued', 'scanning', 'running']);

/**
 * Mirrors the main-process transfer queue for one tab. The main process sends
 * whole snapshots, so there is no incremental state to reconcile here.
 */
export function useTransfers(tabId) {
    const [transfers, setTransfers] = useState([]);
    const [conflict, setConflict] = useState(null);
    // Answering has to happen outside the state updater, because StrictMode runs
    // updaters twice, and sending the same answer twice is not free.
    const conflictRef = useRef(null);
    conflictRef.current = conflict;

    useEffect(() => {
        let disposed = false;

        window.api.transfers.list(tabId)
            .then((list) => { if (!disposed) setTransfers(list || []); })
            .catch(() => {});

        const offUpdate = window.api.transfers.onUpdate((payload) => {
            if (payload.tabId === tabId) setTransfers(payload.transfers);
        });

        const offConflict = window.api.transfers.onConflict((payload) => {
            if (payload.tabId === tabId) setConflict(payload);
        });

        // The transfer was canceled while its prompt was still on screen.
        const offResolved = window.api.transfers.onConflictResolved(({ requestId }) => {
            setConflict(current => (current?.requestId === requestId ? null : current));
        });

        return () => {
            disposed = true;
            offUpdate();
            offConflict();
            offResolved();
        };
    }, [tabId]);

    const respondToConflict = useCallback((decision) => {
        const pending = conflictRef.current;
        if (!pending) return;
        conflictRef.current = null;
        setConflict(null);
        window.api.transfers.respondToConflict(pending.requestId, decision);
    }, []);

    const cancel = useCallback((id) => window.api.transfers.cancel(id), []);
    const cancelAll = useCallback(() => window.api.transfers.cancelAll(tabId), [tabId]);
    const retry = useCallback((id) => window.api.transfers.retry(id), []);
    const clearFinished = useCallback(() => window.api.transfers.clearFinished(tabId), [tabId]);

    const summary = useMemo(() => {
        const active = transfers.filter(t => ACTIVE_STATES.has(t.state));
        const failed = transfers.filter(t => t.state === 'error');

        const totalBytes = active.reduce((sum, t) => sum + t.totalBytes, 0);
        const doneBytes = active.reduce((sum, t) => sum + t.transferredBytes, 0);
        const speed = active.reduce((sum, t) => sum + (t.speed || 0), 0);

        return {
            active: active.length,
            failed: failed.length,
            finished: transfers.filter(t => !ACTIVE_STATES.has(t.state)).length,
            percent: totalBytes ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0,
            speed,
            eta: speed > 0 && totalBytes > doneBytes ? (totalBytes - doneBytes) / speed : 0,
        };
    }, [transfers]);

    return { transfers, summary, conflict, respondToConflict, cancel, cancelAll, retry, clearFinished };
}
