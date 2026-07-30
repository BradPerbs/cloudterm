import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The activity log, paged newest-first.
 *
 * Unlike the other collections this one is never edited from the renderer, so
 * there is no shared cache to keep in step; each mount asks for its own page.
 * What it does need is to stay live: an entry recorded while the page is open
 * (a connection made in another tab, a file deleted over SFTP) arrives on a
 * push channel and is put straight on top, rather than waiting for a refresh.
 *
 * Every bridge call is guarded the same way the other hooks guard theirs: the
 * preload API is fixed at page load, so during development the renderer can
 * hot-reload against a `window.api` that predates this feature.
 */

const PAGE_SIZE = 150;

/** "Only problems" covers both, so the query has to ask for both. */
const PROBLEM_OUTCOMES = ['failure', 'warning'];

/** Does a freshly recorded entry belong in the list as it is currently filtered? */
function matches(entry, { category, failuresOnly, search }) {
    if (category && entry.category !== category) return false;
    if (failuresOnly && entry.outcome !== 'failure' && entry.outcome !== 'warning') return false;

    const needle = search.trim().toLowerCase();
    if (!needle) return true;

    return [entry.target, entry.subject, entry.detail, entry.message, entry.action, entry.actor?.user]
        .some(field => String(field || '').toLowerCase().includes(needle));
}

export function useActivity({ category = '', failuresOnly = false, search = '' } = {}) {
    const [entries, setEntries] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [exhausted, setExhausted] = useState(false);

    // The filters as the live-append listener should see them. It is bound once,
    // and re-binding it on every keystroke would drop entries that landed
    // between the unsubscribe and the next subscribe.
    const filters = useRef({ category, failuresOnly, search });
    filters.current = { category, failuresOnly, search };

    const load = useCallback(async () => {
        if (!window.api?.activity) {
            setEntries([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const [page, counts] = await Promise.all([
                window.api.activity.list({
                    category,
                    outcome: failuresOnly ? PROBLEM_OUTCOMES : '',
                    search,
                    limit: PAGE_SIZE,
                }),
                window.api.activity.summary(),
            ]);

            setEntries(page.entries || []);
            setExhausted(Boolean(page.exhausted));
            setSummary(counts);
        } catch {
            setEntries([]);
            setExhausted(true);
        } finally {
            setLoading(false);
        }
    }, [category, failuresOnly, search]);

    // Typing in the filter box should not fire a query per keystroke.
    useEffect(() => {
        const timer = setTimeout(load, search ? 180 : 0);
        return () => clearTimeout(timer);
    }, [load, search]);

    const loadMore = useCallback(async () => {
        if (!window.api?.activity || exhausted) return;

        const oldest = entries[entries.length - 1];
        if (!oldest) return;

        try {
            const page = await window.api.activity.list({
                category: filters.current.category,
                outcome: filters.current.failuresOnly ? PROBLEM_OUTCOMES : '',
                search: filters.current.search,
                limit: PAGE_SIZE,
                // Inclusive of the boundary timestamp, so entries sharing a
                // millisecond cannot fall through the gap between pages.
                before: oldest.at,
            });

            const seen = new Set(entries.map(entry => entry.id));
            const fresh = (page.entries || []).filter(entry => !seen.has(entry.id));

            setEntries(prev => [...prev, ...fresh]);
            setExhausted(Boolean(page.exhausted));
        } catch {
            setExhausted(true);
        }
    }, [entries, exhausted]);

    // Entries recorded while the page is open.
    useEffect(() => {
        if (!window.api?.activity) return undefined;

        const stopAppend = window.api.activity.onAppend((entry) => {
            if (!entry || !matches(entry, filters.current)) return;
            setEntries(prev => (prev.some(e => e.id === entry.id) ? prev : [entry, ...prev]));
            setSummary(prev => (prev ? { ...prev, all: prev.all + 1, newest: entry.at } : prev));
        });

        const stopCleared = window.api.activity.onCleared(() => {
            setEntries([]);
            setExhausted(true);
            setSummary(prev => (prev ? { ...prev, all: 0, connection: 0, data: 0, files: 0, security: 0, failures: 0, warnings: 0 } : prev));
        });

        return () => {
            stopAppend();
            stopCleared();
        };
    }, []);

    const clear = useCallback(async () => {
        if (!window.api?.activity) return false;
        await window.api.activity.clear();
        await load();
        return true;
    }, [load]);

    const exportLog = useCallback(async () => {
        if (!window.api?.activity) return { success: false, message: 'Not available' };
        return window.api.activity.export();
    }, []);

    return { entries, summary, loading, exhausted, refresh: load, loadMore, clear, exportLog };
}
