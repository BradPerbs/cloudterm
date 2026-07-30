import { useCallback, useEffect, useState } from 'react';

/**
 * The saved proxies.
 *
 * Built the way `useSnippets` is, and for the same reason: the collection is
 * global, there is no runtime in main pushing updates, and it is read in two
 * places at once. The Proxies page and the proxy picker in the host editor are
 * routinely open one after the other, so a proxy added in the first has to be
 * offered by the second without anything being remounted.
 *
 * Every bridge call is guarded the same way: the preload API is established once
 * per page load, so during development the renderer can hot-reload against a
 * `window.api` that predates this feature. Degrading to an empty list beats
 * throwing out of an effect.
 */

let cache = null;
const listeners = new Set();

function publish(list) {
    cache = list;
    for (const listener of listeners) listener(list);
}

async function reload() {
    if (!window.api?.proxies) return [];
    try {
        const list = (await window.api.proxies.list()) || [];
        publish(list);
        return list;
    } catch {
        publish([]);
        return [];
    }
}

export function useProxies() {
    const [proxies, setProxies] = useState(() => cache || []);
    const [loading, setLoading] = useState(() => cache === null);

    useEffect(() => {
        listeners.add(setProxies);

        // One fetch for the first hook to mount; later ones read the cache and
        // are kept current by the same publish.
        if (cache === null) {
            reload().finally(() => setLoading(false));
        } else {
            setProxies(cache);
            setLoading(false);
        }

        return () => listeners.delete(setProxies);
    }, []);

    const save = useCallback(async (proxy) => {
        if (!window.api?.proxies) return null;
        const saved = await window.api.proxies.save(proxy);
        await reload();
        return saved;
    }, []);

    const remove = useCallback(async (proxyId) => {
        if (!window.api?.proxies) return false;
        await window.api.proxies.remove(proxyId);
        await reload();
        return true;
    }, []);

    const duplicate = useCallback(async (proxyId) => {
        if (!window.api?.proxies) return null;
        const copy = await window.api.proxies.duplicate(proxyId);
        await reload();
        return copy;
    }, []);

    /**
     * Check a proxy against the real thing.
     *
     * Takes `{ proxyId }` for something already saved or `{ proxy }` for a draft
     * still in the editor, and answers `{ success, message, elapsed }`. Nothing
     * is written either way, so it is safe to press while typing.
     */
    const test = useCallback(async (payload) => {
        if (!window.api?.proxies) {
            return { success: false, message: 'Reload the app to use this' };
        }
        try {
            return await window.api.proxies.test(payload);
        } catch (error) {
            return { success: false, message: error.message };
        }
    }, []);

    return { proxies, loading, save, remove, duplicate, test, refresh: reload };
}
