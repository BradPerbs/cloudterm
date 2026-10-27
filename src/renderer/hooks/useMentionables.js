import { useEffect, useMemo, useState } from 'react';
import { useProxies } from './useProxies';
import { useSnippets } from './useSnippets';
import { hostOs } from '../lib/os-icons';

/**
 * Everything a message can tag with `@`: the saved hosts, the snippets
 * (commands, packages and specs), the proxies and the keys, as one flat list
 * the picker filters.
 *
 * Hosts come from the panel, which already holds them. Snippets and proxies
 * come from their own hooks, which every page that shows them shares and keeps
 * current. The keychain has no such hook, so it is read here, and again when
 * the window comes back to the front, which is when a key added on the
 * Keychain page would have been added.
 *
 * Nothing here goes anywhere but the picker, and nothing secret is read: a
 * mention is sent as a kind and an id, and main resolves it from the store
 * when the message is sent (see `src/main/ai/mentions.js`).
 */

/** The first line with anything on it, for a row's second line. */
const firstLine = text => String(text || '').split('\n').find(line => line.trim())?.trim() || '';

function useKeys() {
    const [keys, setKeys] = useState([]);

    useEffect(() => {
        let cancelled = false;
        const read = () => {
            if (!window.api?.keys?.list) return;
            window.api.keys.list()
                .then(list => { if (!cancelled) setKeys(list || []); })
                .catch(() => {});
        };
        read();
        window.addEventListener('focus', read);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', read);
        };
    }, []);

    return keys;
}

/** `address:port`, with the port left off when it is the protocol's usual one. */
function hostAddress(host) {
    if (host.protocol === 'serial') return host.serial?.path || '';
    const port = host.port && Number(host.port) !== 22 ? host.port : '';
    return [host.host, port].filter(Boolean).join(':');
}

export function useMentionables({ hosts = [] } = {}) {
    const { proxies } = useProxies();
    const { snippets } = useSnippets();
    const keys = useKeys();

    return useMemo(() => {
        const items = [];

        for (const host of hosts) {
            if (!host?.id) continue;
            const address = hostAddress(host);
            items.push({
                kind: 'host',
                id: host.id,
                name: host.name || host.host || host.id,
                hint: host.username ? `${host.username}@${address}` : address,
                os: hostOs(host),
                distro: host.distro,
                tags: host.tags || [],
            });
        }

        for (const snippet of snippets) {
            if (!snippet?.id) continue;
            items.push({
                kind: 'snippet',
                id: snippet.id,
                name: snippet.name,
                hint: snippet.description || firstLine(snippet.command),
                snippetKind: snippet.kind || 'command',
                tags: snippet.tags || [],
            });
        }

        for (const proxy of proxies) {
            if (!proxy?.id) continue;
            items.push({
                kind: 'proxy',
                id: proxy.id,
                name: proxy.name || proxy.host,
                hint: `${String(proxy.type || '').toUpperCase()} ${proxy.host}:${proxy.port}`.trim(),
            });
        }

        for (const key of keys) {
            if (!key?.id) continue;
            items.push({
                kind: 'key',
                id: key.id,
                name: key.name || key.id,
                hint: key.type || '',
            });
        }

        return items;
    }, [hosts, snippets, proxies, keys]);
}

export default useMentionables;
