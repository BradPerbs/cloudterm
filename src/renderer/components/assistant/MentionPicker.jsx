import { memo, useEffect, useRef } from 'react';
import {
    CommandLineIcon,
    FlashIcon,
    Key01Icon,
    Note01Icon,
    PackageIcon,
    Route02Icon,
} from 'hugeicons-react';
import { OsIcon } from '../../lib/os-icons';
import useEnter from '../../hooks/useEnter';
import { useT } from '../../i18n';

/**
 * What `@` opens: the saved hosts, the specs, the other snippets, the proxies
 * and the keys, filtered by what has been typed after it.
 *
 * A list rather than a menu, and drawn over the composer rather than in it,
 * because it answers a question the user is halfway through asking. The
 * keyboard drives it from the textarea, which keeps the caret where it is:
 * the arrows move the highlight, Enter and Tab take the highlighted row,
 * Escape puts the list away and leaves what was typed alone.
 *
 * The rows are grouped by kind with a small heading each, so a query that
 * matches a host and a runbook reads as two answers rather than one jumbled
 * list. Specs have a group of their own: they are what the spec menu this
 * replaces used to offer, and they are the thing most often reached for.
 */

/** What each group looks like, and what its heading says. */
const GROUPS = {
    host: { label: 'nav.hosts' },
    spec: { icon: Note01Icon, tint: 'text-sky-600 dark:text-sky-300', label: 'assistant.specs' },
    snippet: { icon: FlashIcon, tint: 'text-emerald-600 dark:text-emerald-300', label: 'nav.snippets' },
    proxy: { icon: Route02Icon, tint: 'text-violet-600 dark:text-violet-300', label: 'nav.proxies' },
    key: { icon: Key01Icon, tint: 'text-amber-600 dark:text-amber-300', label: 'nav.keychain' },
    skill: { icon: CommandLineIcon, tint: 'text-violet-600 dark:text-violet-300', label: 'assistant.skills' },
};

/** The order the groups are listed in, which is also the order the arrows walk. */
const ORDER = ['host', 'spec', 'snippet', 'proxy', 'key', 'skill'];

/** Which group an item sits in: a spec is a snippet, listed on its own. */
export const groupOf = item => (item.kind === 'snippet' && item.snippetKind === 'spec' ? 'spec' : item.kind);

/**
 * One item's mark. A host wears its own OS icon, since that is how it is drawn
 * everywhere else; a snippet's depends on which of the three kinds it is.
 */
export function MentionIcon({ item, size = 14 }) {
    if (item.kind === 'host') {
        return <OsIcon os={item.os} distro={item.distro} className="w-3.5 h-3.5 shrink-0" />;
    }
    const group = GROUPS[groupOf(item)] || GROUPS.snippet;
    const Icon = item.kind === 'snippet' && item.snippetKind === 'package' ? PackageIcon : group.icon;
    return <Icon size={size} strokeWidth={1.75} className={`shrink-0 ${group.tint}`} />;
}

/** How well an item answers what has been typed after the `@`. */
function score(item, needle) {
    if (!needle) return 1;
    const name = String(item.name || '').toLowerCase();
    if (name.startsWith(needle)) return 3;
    if (name.includes(needle)) return 2;
    if (String(item.hint || '').toLowerCase().includes(needle)) return 1;
    if (item.tags?.some(tag => String(tag).toLowerCase().includes(needle))) return 1;
    return 0;
}

/**
 * The items worth showing: the best few dozen, then put in group order so
 * the list draws the way the arrows walk it.
 */
export function matchMentions(items, query, limit = 40) {
    const needle = String(query || '').trim().toLowerCase();
    return (items || [])
        .map((item, index) => ({ item, index, rank: score(item, needle) }))
        .filter(entry => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank || a.index - b.index)
        .slice(0, limit)
        .sort((a, b) => ORDER.indexOf(groupOf(a.item)) - ORDER.indexOf(groupOf(b.item))
            || b.rank - a.rank || a.index - b.index)
        .map(entry => entry.item);
}

function MentionPicker({ items, query, active, onPick, onHover }) {
    const t = useT();
    const listRef = useRef(null);
    const ref = useEnter('dialog');

    // The highlighted row stays in view while the arrows walk past the end of
    // what is drawn.
    useEffect(() => {
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label={t('assistant.tag')}
            className="absolute bottom-full left-0 right-0 mb-2 z-40 rounded-xl overflow-hidden
                bg-white dark:bg-surface-raised
                border border-gray-200 dark:border-surface-control
                shadow-xl shadow-black/10 dark:shadow-black/40"
        >
            <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
                {items.length === 0 ? (
                    <p className="px-2.5 py-3 text-center text-[11px] text-gray-500 dark:text-neutral-400">
                        {query ? t('assistant.tagNoMatches', { query }) : t('assistant.tagEmpty')}
                    </p>
                ) : items.map((item, index) => {
                    const group = groupOf(item);
                    const heading = index === 0 || groupOf(items[index - 1]) !== group;
                    return (
                        <div key={`${item.kind}:${item.id}`}>
                            {heading && (
                                <div className={`px-2.5 pb-1 ${index === 0 ? 'pt-1' : 'pt-2.5'}
                                    text-[11px] font-semibold text-gray-500 dark:text-neutral-400`}>
                                    {t(GROUPS[group]?.label || 'nav.snippets')}
                                </div>
                            )}
                            <button
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                data-active={index === active ? 'true' : 'false'}
                                onMouseMove={() => onHover(index)}
                                // The pointer must not take the caret out of the
                                // textarea before the click lands on the row.
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => onPick(item)}
                                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left
                                    transition-colors
                                    ${index === active
                                        ? 'bg-gray-100 dark:bg-surface-control'
                                        : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
                            >
                                <MentionIcon item={item} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-medium truncate text-gray-900 dark:text-white">
                                        {item.name}
                                    </span>
                                    {item.hint && (
                                        <span className="block text-[11px] truncate text-gray-500 dark:text-neutral-400">
                                            {item.hint}
                                        </span>
                                    )}
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default memo(MentionPicker);
