import { forwardRef } from 'react';
import {
    FilterIcon,
    GridViewIcon,
    LeftToRightListBulletIcon,
    PackageAddIcon,
    PlusSignIcon,
} from 'hugeicons-react';
import { IconButton, CollapsingButton } from '../ui/Button';
import MenuButton from '../ui/MenuButton';
import SegmentedControl from '../ui/SegmentedControl';
import SearchField from '../ui/SearchField';
import { useT } from '../../i18n';

const VIEWS = [
    { value: 'grid', titleKey: 'hosts.viewGrid', icon: <GridViewIcon size={14} strokeWidth={2} /> },
    { value: 'list', titleKey: 'hosts.viewList', icon: <LeftToRightListBulletIcon size={14} strokeWidth={2} /> },
];

const KINDS = ['all', 'command', 'package'];

/**
 * The Snippets page's header, built to the same plan as the Hosts one: a search
 * field that takes the width, then the controls that change what you are
 * looking at, in the same order: a filter menu, the layout switch, then the
 * two ways to add something.
 *
 * No title and no summary line, for the reason Hosts has none: the sidebar item
 * is already lit and the cards are plainly snippets, so both only spent the
 * widest part of the row saying what nothing contradicts. The counts they
 * carried are still reachable, since the filter menu shows one per kind, and an
 * empty result already says so in the body of the page.
 *
 * The kind filter is a menu rather than a segmented control for the reason sort
 * is on Hosts: at the 900px minimum window there is not room for a third
 * segmented control beside the search field and the layout switch.
 *
 * `compact` is the page saying it is short of width, and the row answers it the
 * way Hosts does: the primary button's label goes first, since everything else
 * here keeps the size it asks for, and the row wraps rather than overflowing if
 * even that leaves it short.
 */
const SnippetsToolbar = forwardRef(function SnippetsToolbar({
    query,
    onQueryChange,
    onQueryKeyDown,
    kind,
    onKindChange,
    counts,
    view,
    onViewChange,
    onNewPackage,
    onNewSnippet,
    compact = false,
}, searchRef) {
    const t = useT();

    return (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
            <SearchField
                ref={searchRef}
                value={query}
                onChange={onQueryChange}
                onKeyDown={onQueryKeyDown}
                ariaLabel={t('snippets.search')}
            />

            {/* Grouped so the row's flexing is all spent on the search field:
                these keep the size they ask for. `ml-auto` only does anything
                once the row has wrapped, where it holds them to the right edge
                rather than letting them sit under the start of the field. */}
            <div className="flex items-center gap-2 shrink-0 ml-auto">
                <MenuButton
                    icon={<FilterIcon size={16} strokeWidth={2} />}
                    title={t('snippets.showing', { kind: t(`snippets.kind.${kind}`) })}
                    active={kind !== 'all'}
                    items={KINDS.map(value => ({
                        label: t(`snippets.kind.${value}`),
                        hint: value === kind ? '✓' : String(counts[value] ?? 0),
                        onSelect: () => onKindChange(value),
                    }))}
                />

                <SegmentedControl
                    segments={VIEWS.map(entry => ({ ...entry, title: t(entry.titleKey) }))}
                    value={view}
                    onChange={onViewChange}
                    ariaLabel={t('hosts.layout')}
                />

                {/* A hairline between "how it is shown" and "what there is",
                    so the two primary actions do not read as a fourth filter. */}
                <span className="w-px h-6 bg-gray-200 dark:bg-surface-control mx-0.5" aria-hidden="true" />

                <IconButton
                    onClick={onNewPackage}
                    title={t('snippets.newPackage')}
                    icon={<PackageAddIcon size={18} strokeWidth={1.75} />}
                />
                <CollapsingButton
                    compact={compact}
                    onClick={onNewSnippet}
                    label={t('snippets.newSnippet')}
                    icon={<PlusSignIcon size={16} strokeWidth={2.5} />}
                />
            </div>
        </div>
    );
});

export default SnippetsToolbar;
