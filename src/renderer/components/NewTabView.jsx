import { memo, useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search01Icon, PlusSignIcon, CloudServerIcon, SearchRemoveIcon, Plug01Icon } from 'hugeicons-react';
import EmptyFrame from './ui/EmptyFrame';
import { OsIcon, hostOs } from '../lib/os-icons';
import { parseAddress, formatAddress } from '../lib/address';
import { useT } from '../i18n';

const RECENT_LIMIT = 5;

// A key cap. It centres its glyph with flex rather than letting it sit on the
// text baseline: the arrows are tall, narrow glyphs next to a word like "esc",
// so baseline alignment reads as the symbol hanging off-centre. The fixed box
// also keeps every cap the same size wherever it is used, instead of taking its
// height from whatever line-height it happens to inherit.
function Kbd({ children }) {
    return (
        <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 leading-none rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 text-[10px] font-sans font-medium text-gray-500 dark:text-neutral-400">
            {children}
        </kbd>
    );
}

function HostRow({ host, folderName, selected, onSelect, onConnect }) {
    const ref = useRef(null);

    useEffect(() => {
        if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    return (
        <button
            ref={ref}
            type="button"
            onMouseMove={onSelect}
            onClick={onConnect}
            className={`host-row w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                selected
                    ? 'bg-gray-900/[0.06] dark:bg-surface-hover'
                    : 'hover:bg-gray-900/[0.04] dark:hover:bg-surface-control'
            }`}
            data-selected={selected ? 'true' : 'false'}
        >
            <span className="w-7 h-7 flex items-center justify-center shrink-0">
                <OsIcon os={hostOs(host)} distro={host.distro} className="w-6 h-6" />
            </span>

            <span className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {host.name}
                </span>
                <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                    {host.username}@{host.host}{host.port && host.port !== 22 ? `:${host.port}` : ''}
                </span>
            </span>

            {folderName && (
                <span className="shrink-0 px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-neutral-800 text-[11px] text-gray-500 dark:text-neutral-400 max-w-[120px] truncate">
                    {folderName}
                </span>
            )}

            <span className={`shrink-0 transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}>
                <Kbd>↵</Kbd>
            </span>
        </button>
    );
}

/**
 * The row for an address that is not a saved host, offered whenever what has
 * been typed reads as one. Deliberately the same shape as a host row, because
 * it does the same thing: press it and this tab is that session.
 *
 * It sits last, under the matches. A query that matches a saved host almost
 * always means that host, and Enter without arrowing should keep meaning the
 * saved one; when nothing matches, this is the only row and Enter lands here.
 */
function AddressRow({ address, selected, onSelect, onConnect }) {
    const t = useT();
    const ref = useRef(null);

    useEffect(() => {
        if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    return (
        <button
            ref={ref}
            type="button"
            onMouseMove={onSelect}
            onClick={onConnect}
            className={`host-row w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                selected
                    ? 'bg-gray-900/[0.06] dark:bg-surface-hover'
                    : 'hover:bg-gray-900/[0.04] dark:hover:bg-surface-control'
            }`}
            data-selected={selected ? 'true' : 'false'}
        >
            <span className="w-7 h-7 flex items-center justify-center shrink-0 text-gray-400 dark:text-neutral-500">
                <Plug01Icon className="w-6 h-6" size={24} strokeWidth={1.5} />
            </span>

            <span className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {t('newTab.connectTo')} <span className="font-mono">{formatAddress(address)}</span>
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {t('newTab.notSavedNote')}
                </span>
            </span>

            <span className={`shrink-0 transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}>
                <Kbd>↵</Kbd>
            </span>
        </button>
    );
}

function SectionLabel({ children }) {
    return (
        <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-neutral-500">
            {children}
        </div>
    );
}

/**
 * The "new tab" launcher, a command-palette style picker. Replaces the old
 * Connect-to-Host modal: choosing a host turns this tab into that session in
 * place, the way a browser's new tab becomes the page you open.
 *
 * The search box doubles as PuTTY's Host Name box. Anything typed into it that
 * reads as an address is offered as one, so reaching a machine that was never
 * saved is the same gesture as reaching one that was: type it, press Enter,
 * answer the login on the pane. See `onQuickConnect` and lib/address.js.
 */
function NewTabView({ hosts, folders, isActive, onConnect, onQuickConnect, onNewHost, onClose }) {
    const t = useT();
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const searchRef = useRef(null);

    const folderNames = useMemo(
        () => Object.fromEntries((folders || []).map(f => [f.id, f.name])),
        [folders]
    );

    // Keep the caret here whenever this tab is the visible one, so the
    // keyboard flow works without hunting for the field.
    useEffect(() => {
        if (isActive) searchRef.current?.focus();
    }, [isActive]);

    const { sections, flat } = useMemo(() => {
        const q = query.trim().toLowerCase();

        if (q) {
            const matches = hosts.filter(host =>
                [host.name, host.host, host.username, host.distro, host.os]
                    .some(field => field && String(field).toLowerCase().includes(q))
            );
            return { sections: [{ labelKey: null, items: matches }], flat: matches };
        }

        const recent = hosts
            .filter(h => h.lastConnectedAt)
            .sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
            .slice(0, RECENT_LIMIT);

        const recentIds = new Set(recent.map(h => h.id));
        const rest = hosts.filter(h => !recentIds.has(h.id));

        const sections = [];
        if (recent.length) sections.push({ labelKey: 'newTab.recent', items: recent });
        if (rest.length) sections.push({ labelKey: recent.length ? 'newTab.allHosts' : null, items: rest });

        return { sections, flat: [...recent, ...rest] };
    }, [hosts, query]);

    // What was typed, if it reads as somewhere to connect to. Parsed on every
    // keystroke, which it is cheap enough for, and deliberately strict: this is
    // the host search as well, so a word like `prod` has to stay a search.
    const address = useMemo(() => parseAddress(query), [query]);

    // The address row is the one after the last host, so the cursor runs over
    // the two lists as though they were one.
    const addressIndex = address.ok ? flat.length : -1;
    const total = flat.length + (address.ok ? 1 : 0);

    // Keep the highlight in range as the result set changes.
    useEffect(() => {
        setSelected(s => Math.min(s, Math.max(total - 1, 0)));
    }, [total]);

    const choose = useCallback((position) => {
        if (position === addressIndex) onQuickConnect?.(query.trim());
        else if (flat[position]) onConnect(flat[position]);
    }, [addressIndex, flat, query, onConnect, onQuickConnect]);

    const handleKeyDown = useCallback((event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected(s => (total ? (s + 1) % total : 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected(s => (total ? (s - 1 + total) % total : 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(selected);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    }, [total, selected, choose, onClose]);

    let cursor = -1;

    return (
        <div
            id="new-tab-view"
            className="absolute inset-0 flex flex-col overflow-hidden"
            onKeyDown={handleKeyDown}
        >
            <div className="w-full max-w-3xl mx-auto flex flex-col min-h-0 flex-1 px-6 pt-8 pb-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-6 shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                            {t('newTab.title')}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {t('newTab.subtitle')}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                        onClick={onNewHost}
                    >
                        <PlusSignIcon className="w-4 h-4" size={16} strokeWidth={2.5} />
                        <span>{t('hosts.newHost')}</span>
                    </button>
                </div>

                {/* Search: a hero control, so it takes the 12px control radius
                    rather than the 8px used by form fields. */}
                <div className="relative shrink-0">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <Search01Icon className="w-[18px] h-[18px]" size={18} strokeWidth={2} />
                    </span>
                    <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
                        placeholder={t('newTab.searchPlaceholder')}
                        spellCheck={false}
                        className="w-full h-12 pl-12 pr-24 rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 text-gray-900 dark:text-white text-[15px] outline-none transition-colors focus:border-gray-300 dark:focus:border-neutral-700 placeholder:text-gray-400 dark:placeholder:text-neutral-500"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-neutral-500 pointer-events-none tabular-nums">
                        {t('hosts.count', { count: flat.length })}
                    </span>
                </div>

                {/* Results */}
                <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 mt-2">
                    {total === 0 ? (
                        hosts.length === 0 ? (
                            <EmptyFrame
                                icon={<CloudServerIcon size={28} strokeWidth={1.5} />}
                                title={t('hosts.empty')}
                                note={t('hosts.emptyNote')}
                            />
                        ) : (
                            <EmptyFrame
                                icon={<SearchRemoveIcon size={28} strokeWidth={1.5} />}
                                title={t('common.noMatchesTitle')}
                                note={`“${query.trim()}”`}
                            />
                        )
                    ) : (
                        <>
                            {sections.map((section, index) => (
                                <div key={section.labelKey || index}>
                                    {section.labelKey && <SectionLabel>{t(section.labelKey)}</SectionLabel>}
                                    <div className="flex flex-col gap-0.5">
                                        {section.items.map((host) => {
                                            cursor += 1;
                                            const position = cursor;
                                            return (
                                                <HostRow
                                                    key={host.id}
                                                    host={host}
                                                    folderName={folderNames[host.folderId]}
                                                    selected={position === selected}
                                                    onSelect={() => setSelected(position)}
                                                    onConnect={() => onConnect(host)}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {address.ok && (
                                <div className="flex flex-col gap-0.5">
                                    {/* Labelled only when it is sitting under
                                        matches, where it would otherwise read
                                        as one more of them. */}
                                    {flat.length > 0 && <SectionLabel>{t('newTab.notSaved')}</SectionLabel>}
                                    <AddressRow
                                        address={address}
                                        selected={addressIndex === selected}
                                        onSelect={() => setSelected(addressIndex)}
                                        onConnect={() => choose(addressIndex)}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Keyboard hints */}
                <div className="shrink-0 flex items-center gap-4 pt-3 mt-1 border-t border-gray-100 dark:border-neutral-800/80 text-[11px] text-gray-400 dark:text-neutral-500">
                    <span className="flex items-center gap-1.5">
                        <Kbd>↑</Kbd><Kbd>↓</Kbd> {t('newTab.hintNavigate')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Kbd>↵</Kbd> {t('newTab.hintConnect')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Kbd>esc</Kbd> {t('newTab.hintClose')}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default memo(NewTabView);
