import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cancel01Icon, Search01Icon } from 'hugeicons-react';
import { OsIcon, hostOs } from '../../lib/os-icons';

const RECENT_LIMIT = 4;

/**
 * The host chooser a freshly split pane shows before it is a session.
 *
 * NewTabView does the same job for a whole tab, but it is laid out for one:
 * a hero heading, a 3xl column, generous padding. A pane can be a quarter of
 * the window, so this is the same idea at pane scale, and it never assumes it
 * has more than a couple of hundred pixels to work with.
 */
function PanePicker({ hosts, isActive, onPick, onCancel }) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const searchRef = useRef(null);
    const listRef = useRef(null);

    // A pane opened by a split is the one the user is looking at, so it takes
    // the caret without being clicked.
    useEffect(() => {
        if (isActive) searchRef.current?.focus();
    }, [isActive]);

    const matches = useMemo(() => {
        const needle = query.trim().toLowerCase();

        if (needle) {
            return hosts.filter(host =>
                [host.name, host.host, host.username, host.distro, host.os]
                    .some(field => field && String(field).toLowerCase().includes(needle))
            );
        }

        const recent = hosts
            .filter(host => host.lastConnectedAt)
            .sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
            .slice(0, RECENT_LIMIT);

        const recentIds = new Set(recent.map(host => host.id));
        return [...recent, ...hosts.filter(host => !recentIds.has(host.id))];
    }, [hosts, query]);

    useEffect(() => {
        setSelected(value => Math.min(value, Math.max(matches.length - 1, 0)));
    }, [matches.length]);

    // Keep the highlighted row in view while arrowing through a list that is
    // taller than the pane.
    useEffect(() => {
        listRef.current
            ?.querySelector('[data-selected="true"]')
            ?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    const handleKeyDown = useCallback((event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected(value => (matches.length ? (value + 1) % matches.length : 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected(value => (matches.length ? (value - 1 + matches.length) % matches.length : 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (matches[selected]) onPick(matches[selected]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
        }
    }, [matches, selected, onPick, onCancel]);

    const showRecentLabel = !query.trim() && matches.some(host => host.lastConnectedAt);

    return (
        <div
            className="absolute inset-0 flex flex-col bg-white dark:bg-surface-raised"
            onKeyDown={handleKeyDown}
        >
            <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-gray-200 dark:border-surface-control">
                <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                    Split with…
                </span>
                <span className="text-xs text-gray-400 dark:text-neutral-500 truncate">
                    {matches.length} {matches.length === 1 ? 'host' : 'hosts'}
                </span>
                <button
                    type="button"
                    onClick={onCancel}
                    title="Close pane"
                    className="ml-auto w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                >
                    <Cancel01Icon size={16} strokeWidth={2} />
                </button>
            </div>

            <div className="px-3 pt-3 shrink-0">
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <Search01Icon size={15} strokeWidth={2} />
                    </span>
                    <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
                        placeholder="Search hosts…"
                        spellCheck={false}
                        className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base text-gray-900 dark:text-white text-sm outline-none transition-colors focus:border-gray-300 dark:focus:border-neutral-700 placeholder:text-gray-400 dark:placeholder:text-neutral-500"
                    />
                </div>
            </div>

            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
                {matches.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                            {hosts.length === 0 ? 'No hosts yet' : 'No matching hosts'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {hosts.length === 0
                                ? 'Create one from the Hosts panel.'
                                : 'Try a different search.'}
                        </p>
                    </div>
                ) : (
                    matches.map((host, index) => (
                        <div key={host.id}>
                            {showRecentLabel && index === 0 && (
                                <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-neutral-500">
                                    Recent
                                </div>
                            )}
                            <button
                                type="button"
                                data-selected={index === selected ? 'true' : 'false'}
                                onMouseMove={() => setSelected(index)}
                                onClick={() => onPick(host)}
                                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left transition-colors ${
                                    index === selected
                                        ? 'bg-gray-900/[0.06] dark:bg-surface-hover'
                                        : 'hover:bg-gray-900/[0.04] dark:hover:bg-surface-control'
                                }`}
                            >
                                <OsIcon os={hostOs(host)} distro={host.distro} className="w-5 h-5 shrink-0" />
                                <span className="flex flex-col min-w-0 flex-1">
                                    <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                        {host.name}
                                    </span>
                                    <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                                        {host.username}@{host.host}
                                        {host.port && host.port !== 22 ? `:${host.port}` : ''}
                                    </span>
                                </span>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default memo(PanePicker);
