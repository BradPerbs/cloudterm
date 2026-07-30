import { useCallback, useEffect, useState } from 'react';

/**
 * The snippet library.
 *
 * Unlike tunnels, snippets are global and there is no runtime in main pushing
 * updates, so the list is cached here and every mounted copy of the hook is
 * told when it changes. Without that, editing a snippet in Settings would
 * leave the palette in an open terminal showing the old one until it was
 * remounted.
 *
 * Every bridge call is guarded the same way `useTunnels` guards its own: the
 * preload API is established once per page load, so during development the
 * renderer can hot-reload against a `window.api` that predates this feature.
 * Degrading to an empty library beats throwing out of an effect.
 */

let cache = null;
const listeners = new Set();

function publish(list) {
    cache = list;
    for (const listener of listeners) listener(list);
}

async function reload() {
    if (!window.api?.snippets) return [];
    try {
        const list = (await window.api.snippets.list()) || [];
        publish(list);
        return list;
    } catch {
        publish([]);
        return [];
    }
}

export function useSnippets() {
    const [snippets, setSnippets] = useState(() => cache || []);
    const [loading, setLoading] = useState(() => cache === null);

    useEffect(() => {
        listeners.add(setSnippets);

        // One fetch for the first hook to mount; later ones read the cache and
        // are kept current by the same publish.
        if (cache === null) {
            reload().finally(() => setLoading(false));
        } else {
            setSnippets(cache);
            setLoading(false);
        }

        return () => listeners.delete(setSnippets);
    }, []);

    const save = useCallback(async (snippet) => {
        if (!window.api?.snippets) return null;
        const saved = await window.api.snippets.save(snippet);
        await reload();
        return saved;
    }, []);

    const remove = useCallback(async (snippetId) => {
        if (!window.api?.snippets) return false;
        await window.api.snippets.remove(snippetId);
        await reload();
        return true;
    }, []);

    return { snippets, loading, save, remove, refresh: reload };
}
