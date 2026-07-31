import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { PlusSignIcon, Route02Icon, SearchRemoveIcon } from 'hugeicons-react';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import EmptyFrame from './ui/EmptyFrame';
import SearchField from './ui/SearchField';
import ProxyCard from './proxies/ProxyCard';
import ProxyDialog from './proxies/ProxyDialog';
import { useProxies } from '../hooks/useProxies';
import { nameProxy, proxyLabel, proxyRoute } from '../lib/proxies';
import { toastOptions } from '../lib/toast';
import { CARD_GRID } from '../lib/layout';
import { useFlipOrder } from '../hooks/useFlipOrder';

/**
 * The saved proxies.
 *
 * A sibling of Hosts and the keychain rather than a settings page, and for the
 * same reason the keychain is one: it is a collection the user builds up and
 * points hosts at, not a preference set once. A proxy belongs here rather than on
 * each host for the reason a private key does: the credential belongs to the
 * proxy, and one company proxy is usually the route for the whole list.
 *
 * Laid out the way the keychain is: the search field leads the header with the
 * one action at its right, then a grid that scrolls on its own. No page title,
 * because the sidebar item is already lit and the cards are plainly proxies.
 *
 * Which hosts a proxy is carrying is worked out here rather than on the cards,
 * because it answers two questions at once: the count a card shows, and who stops
 * connecting if the proxy is deleted.
 */
function ProxiesPanel({ isActive = true, reachedForPage = 0, allHosts = [] }) {
    const { proxies, save, remove, duplicate, test } = useProxies();
    const [editing, setEditing] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const [query, setQuery] = useState('');
    // proxyId -> the last check run from this page, so a result stays next to
    // the proxy it describes instead of in a toast that has already gone.
    const [checks, setChecks] = useState({});

    const searchRef = useRef(null);

    // The editor belongs to this page. Home stays mounted behind a terminal tab,
    // so without this the sheet would sit over the shell you switched to.
    useEffect(() => {
        if (isActive) return;
        setEditing(null);
        setConfirming(null);
    }, [isActive]);

    // Reaching for this page while standing on it asks for the editor over it to
    // go. The sheet is handed the signal rather than unmounted, so it slides out
    // onto the page being asked for instead of blinking off it. The confirm is a
    // centred dialog with no exit to cut short, so it simply stops.
    useEffect(() => {
        setConfirming(null);
    }, [reachedForPage]);

    /* ------------------------------------------------------------------ *
     * What is on screen
     * ------------------------------------------------------------------ */

    const entries = useMemo(() => {
        const dependants = new Map();
        for (const host of allHosts) {
            if (!host.proxyId) continue;
            if (!dependants.has(host.proxyId)) dependants.set(host.proxyId, []);
            dependants.get(host.proxyId).push(host);
        }

        // Named order, because the store hands them back in the order they were
        // added and nothing on this page offers to sort them.
        return [...proxies]
            .sort((a, b) => nameProxy(a).localeCompare(nameProxy(b)))
            .map((proxy) => {
                const hosts = dependants.get(proxy.id) || [];
                return {
                    proxy,
                    hosts,
                    usedBy: hosts.length,
                    // In dial order, so a card can say the address it shows is
                    // not the one this machine actually connects to.
                    route: proxyRoute(proxies, proxy.id),
                    // Proxies chained through this one break the same way hosts
                    // do, so deleting has to be able to name them.
                    chained: proxies.filter(entry => entry.viaProxyId === proxy.id),
                };
            });
    }, [proxies, allHosts]);

    const searching = query.trim().length > 0;

    /**
     * What a proxy can be found by: what someone called it, where it is, what it
     * speaks, the username on it, and the names of the hosts using it. That last
     * one matters because "which proxy does the build box go through" is a
     * question about a host, asked on this page.
     */
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return entries;

        return entries.filter(({ proxy, hosts }) => [
            proxy.name,
            proxy.host,
            String(proxy.port),
            proxyLabel(proxy.type),
            proxy.username,
            hosts.map(host => host.name).join(' '),
        ].filter(Boolean).join(' ').toLowerCase().includes(needle));
    }, [entries, query]);

    // Cards slide between positions when the list is reordered by a search, and
    // when the grid rewraps because the column it was using no longer fits.
    const gridRef = useRef(null);
    const orderKey = useMemo(() => visible.map(entry => entry.proxy.id).join(), [visible]);
    useFlipOrder(gridRef, orderKey);

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */

    const handleSave = useCallback(async (record) => {
        const isEdit = Boolean(record.id);
        try {
            await save(record);
        } catch (error) {
            toast.error(`Could not save that proxy: ${error.message}`, toastOptions());
            // Rethrown so the sheet stays open rather than animating away as
            // though the record had been written.
            throw error;
        }
        toast.success(isEdit ? 'Proxy updated' : 'Proxy added', toastOptions({ duration: 1800 }));
    }, [save]);

    const handleDuplicate = useCallback(async (proxy) => {
        await duplicate(proxy.id);
        toast.success(`Duplicated “${nameProxy(proxy)}”`, toastOptions({ duration: 2200 }));
    }, [duplicate]);

    /** Check a saved proxy from its card. The editor has its own, for drafts. */
    const handleTest = useCallback(async (proxy) => {
        setChecks(current => ({ ...current, [proxy.id]: { running: true } }));

        const result = await test({ proxyId: proxy.id });

        setChecks(current => ({ ...current, [proxy.id]: { ...result, running: false } }));

        if (result.success) {
            toast.success(`${nameProxy(proxy)} answered. ${result.message}`, toastOptions({ duration: 4000 }));
        } else {
            toast.error(result.message, toastOptions({ duration: 5000 }));
        }
    }, [test]);

    /**
     * Ask before deleting, and say what stops working.
     *
     * A host left pointing at a proxy that is gone does not fail here. The
     * reference is cleared on delete, which means those hosts start dialling
     * straight out, and that is a change to how they reach the network worth
     * agreeing to rather than discovering.
     */
    const confirmDelete = useCallback((entry) => {
        const { proxy, hosts, chained } = entry;
        const label = nameProxy(proxy);

        const consequences = [
            hosts.length > 0
                ? `${hosts.length === 1 ? 'One host' : `${hosts.length} hosts`} will connect directly instead`
                : '',
            chained.length > 0
                ? `${chained.length === 1 ? 'One proxy' : `${chained.length} proxies`} chained through it will be dialled from this machine instead`
                : '',
        ].filter(Boolean);

        setConfirming({
            title: 'Delete this proxy?',
            message: consequences.length > 0
                ? `“${label}” is in use. ${consequences.join('. ')}.`
                : `“${label}” will be removed. Nothing is using it.`,
            confirmLabel: 'Delete proxy',
            details: [...hosts.map(host => host.name), ...chained.map(nameProxy)],
            onConfirm: async () => {
                setConfirming(null);
                try {
                    await remove(proxy.id);
                } catch (error) {
                    toast.error(`Could not delete that proxy: ${error.message}`, toastOptions());
                    return;
                }
                toast.success(`Deleted “${label}”`, toastOptions({ duration: 2200 }));
            },
        });
    }, [remove]);

    /* ------------------------------------------------------------------ *
     * Keyboard
     * ------------------------------------------------------------------ */

    useEffect(() => {
        if (!isActive) return;

        const handler = (event) => {
            if (event.defaultPrevented) return;
            const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');

            // The two ways every list in every app offers to start searching,
            // matching what Hosts, Snippets and the keychain bind.
            if (((event.ctrlKey || event.metaKey) && event.key === 'f' && !event.altKey)
                || (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isActive]);

    const handleSearchKeyDown = useCallback((event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (query) setQuery('');
        else event.currentTarget.blur();
    }, [query]);

    /* ------------------------------------------------------------------ *
     * Render
     * ------------------------------------------------------------------ */

    return (
        <div className="flex flex-col gap-4 h-full min-h-0" id="proxies-panel">
            <div className="flex items-center gap-2 shrink-0">
                <SearchField
                    ref={searchRef}
                    value={query}
                    onChange={setQuery}
                    onKeyDown={handleSearchKeyDown}
                    ariaLabel="Search proxies"
                />

                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="primary"
                        onClick={() => setEditing({})}
                        icon={<PlusSignIcon size={16} strokeWidth={2.5} />}
                    >
                        New Proxy
                    </Button>
                </div>
            </div>

            {/* Only while it is narrowed, and nothing in its place otherwise: the
                keychain page keeps its search field directly above its grid, and
                an always-present row holding nothing would be a gap between the
                two for the sake of a line that is usually not there. */}
            {searching && (
                <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
                    Filtered.{' '}
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="font-medium text-gray-900 dark:text-white hover:underline"
                    >
                        Clear
                    </button>
                </p>
            )}

            {/* The panel scrolls its own grid, so the header stays put however
                many proxies the collection grows to. */}
            <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2 pb-1">
                {visible.length === 0 ? (
                    <EmptyFrame
                        icon={searching
                            ? <SearchRemoveIcon size={28} strokeWidth={1.5} />
                            : <Route02Icon size={28} strokeWidth={1.5} />}
                        title={searching ? 'No matches' : 'No proxies yet'}
                        note={searching
                            ? `“${query.trim()}”`
                            : 'Add a SOCKS or HTTP proxy and any host can be dialled through it: '
                                + 'terminal sessions, SFTP, port forwards and remote desktops alike.'}
                    />
                ) : (
                    <div ref={gridRef} className={CARD_GRID}>
                        {visible.map(entry => (
                            <ProxyCard
                                key={entry.proxy.id}
                                entry={entry}
                                check={checks[entry.proxy.id]}
                                onEdit={() => setEditing(entry.proxy)}
                                onDuplicate={() => handleDuplicate(entry.proxy)}
                                onTest={() => handleTest(entry.proxy)}
                                onDelete={() => confirmDelete(entry)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {editing && (
                <ProxyDialog
                    proxy={editing.id ? editing : null}
                    proxies={proxies}
                    dismiss={reachedForPage}
                    onSave={handleSave}
                    onTest={test}
                    onClose={() => setEditing(null)}
                />
            )}

            {confirming && <ConfirmDialog {...confirming} onCancel={() => setConfirming(null)} />}
        </div>
    );
}

export default memo(ProxiesPanel);
