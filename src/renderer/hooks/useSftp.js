import { useState, useEffect, useCallback, useRef } from 'react';
import { dirnameRemote, normalizeRemote } from '../lib/remote-path';

/**
 * Directory state for one SFTP session: listing, history-aware navigation and
 * disk usage. Listing failures are returned to the caller rather than thrown
 * or latched into an error screen: a denied subdirectory should not blank the
 * pane the user is standing in.
 */
export function useSftp(tabId, { enabled = true } = {}) {
    const [path, setPath] = useState('');
    const [homePath, setHomePath] = useState('/');
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [initError, setInitError] = useState(null);
    const [ready, setReady] = useState(false);
    const [disk, setDisk] = useState(null);

    // History of visited directories, with a cursor for back/forward.
    const history = useRef({ stack: [], index: -1 });
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);

    const pathRef = useRef(path);
    pathRef.current = path;

    // Guards a slow listing from overwriting a newer one that already landed.
    const requestId = useRef(0);

    const syncHistoryFlags = useCallback(() => {
        setCanGoBack(history.current.index > 0);
        setCanGoForward(history.current.index < history.current.stack.length - 1);
    }, []);

    const refreshDisk = useCallback(async (target) => {
        try {
            const result = await window.api.sftp.diskUsage(tabId, target);
            setDisk(result.success ? result : null);
        } catch {
            setDisk(null);
        }
    }, [tabId]);

    /**
     * List `target` and show it. Returns the result so callers can report a
     * failure without the pane losing whatever it is already showing.
     */
    const open = useCallback(async (target, { push = true, silent = false } = {}) => {
        const destination = normalizeRemote(target);
        const ticket = ++requestId.current;

        if (!silent) setLoading(true);

        let result;
        try {
            result = await window.api.sftp.list(tabId, destination);
        } catch (error) {
            result = { success: false, message: error.message };
        }

        // A newer navigation already won; drop this one entirely. Flagged so
        // the caller does not report an error for a listing nobody wanted.
        if (ticket !== requestId.current) return { success: false, superseded: true };

        setLoading(false);

        if (!result.success) return result;

        setEntries(result.files);
        setPath(destination);

        if (push) {
            const { stack, index } = history.current;
            if (stack[index] !== destination) {
                const trimmed = stack.slice(0, index + 1);
                trimmed.push(destination);
                history.current = { stack: trimmed, index: trimmed.length - 1 };
            }
        }
        syncHistoryFlags();
        refreshDisk(destination);

        return result;
    }, [tabId, syncHistoryFlags, refreshDisk]);

    const refresh = useCallback(
        (options) => open(pathRef.current, { push: false, ...options }),
        [open]
    );

    const goUp = useCallback(() => open(dirnameRemote(pathRef.current)), [open]);
    const goHome = useCallback(() => open(homePath), [open, homePath]);

    const goBack = useCallback(() => {
        const { stack, index } = history.current;
        if (index <= 0) return Promise.resolve({ success: false });
        history.current = { stack, index: index - 1 };
        syncHistoryFlags();
        return open(stack[index - 1], { push: false });
    }, [open, syncHistoryFlags]);

    const goForward = useCallback(() => {
        const { stack, index } = history.current;
        if (index >= stack.length - 1) return Promise.resolve({ success: false });
        history.current = { stack, index: index + 1 };
        syncHistoryFlags();
        return open(stack[index + 1], { push: false });
    }, [open, syncHistoryFlags]);

    /** Accept `~`, `..` and relative input from the path bar. */
    const openTyped = useCallback(async (input) => {
        const trimmed = (input || '').trim();
        if (!trimmed) return { success: false, message: 'Enter a path' };

        if (trimmed.startsWith('/')) return open(trimmed);

        if (trimmed === '~' || trimmed.startsWith('~/')) {
            const resolved = await window.api.sftp.realpath(tabId, trimmed);
            return open(resolved.success ? resolved.path : homePath);
        }

        return open(`${pathRef.current}/${trimmed}`);
    }, [open, tabId, homePath]);

    // Open the subsystem, then land in the user's home directory.
    useEffect(() => {
        if (!enabled) return;

        let disposed = false;

        (async () => {
            setLoading(true);
            setInitError(null);

            const opened = await window.api.sftp.init(tabId);
            if (disposed) return;

            if (!opened.success) {
                setInitError(opened.message || 'Could not open SFTP');
                setLoading(false);
                return;
            }

            const home = await window.api.sftp.home(tabId);
            if (disposed) return;

            const start = home.success ? home.path : '/';
            setHomePath(start);

            const listed = await open(start);
            if (disposed) return;

            if (!listed.success) {
                // Home is unreadable on some locked-down accounts; root is the
                // safest place to drop the user instead of failing outright.
                const fallback = await open('/');
                if (!fallback.success && !disposed) {
                    setInitError(listed.message || 'Could not read the remote directory');
                }
            }

            if (!disposed) setReady(true);
        })();

        return () => { disposed = true; };
    }, [tabId, enabled, open]);

    return {
        path,
        homePath,
        entries,
        loading,
        ready,
        initError,
        disk,
        canGoBack,
        canGoForward,
        open,
        openTyped,
        refresh,
        goUp,
        goHome,
        goBack,
        goForward,
    };
}
