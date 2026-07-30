import { forwardRef } from 'react';
import {
    FilterIcon,
    GridViewIcon,
    LeftToRightListBulletIcon,
    PackageAddIcon,
    PlusSignIcon,
} from 'hugeicons-react';
import Button, { IconButton } from '../ui/Button';
import MenuButton from '../ui/MenuButton';
import SegmentedControl from '../ui/SegmentedControl';
import SearchField from '../ui/SearchField';

const VIEWS = [
    { value: 'grid', title: 'Grid', icon: <GridViewIcon size={14} strokeWidth={2} /> },
    { value: 'list', title: 'List', icon: <LeftToRightListBulletIcon size={14} strokeWidth={2} /> },
];

const KIND_LABELS = {
    all: 'Everything',
    command: 'Commands only',
    package: 'Packages only',
};

/**
 * The Snippets page's header, built to the same plan as the Hosts one: a search
 * field that takes the width, then the controls that change what you are
 * looking at, in the same order — a filter menu, the layout switch, then the
 * two ways to add something.
 *
 * No title and no summary line, for the reason Hosts has none: the sidebar item
 * is already lit and the cards are plainly snippets, so both only spent the
 * widest part of the row saying what nothing contradicts. The counts they
 * carried are still reachable — the filter menu shows one per kind, and an
 * empty result already says so in the body of the page.
 *
 * The kind filter is a menu rather than a segmented control for the reason sort
 * is on Hosts: at the 900px minimum window there is not room for a third
 * segmented control beside the search field and the layout switch.
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
}, searchRef) {
    return (
        <div className="flex items-center gap-2 shrink-0">
            <SearchField
                ref={searchRef}
                value={query}
                onChange={onQueryChange}
                onKeyDown={onQueryKeyDown}
                ariaLabel="Search snippets"
            />

            {/* Grouped so the row's flexing is all spent on the search field:
                these keep the size they ask for. */}
            <div className="flex items-center gap-2 shrink-0">
                <MenuButton
                    icon={<FilterIcon size={16} strokeWidth={2} />}
                    title={`Showing: ${KIND_LABELS[kind]}`}
                    active={kind !== 'all'}
                    items={Object.entries(KIND_LABELS).map(([value, label]) => ({
                        label,
                        hint: value === kind ? '✓' : String(counts[value] ?? 0),
                        onSelect: () => onKindChange(value),
                    }))}
                />

                <SegmentedControl
                    segments={VIEWS}
                    value={view}
                    onChange={onViewChange}
                    ariaLabel="Card layout"
                />

                {/* A hairline between "how it is shown" and "what there is",
                    so the two primary actions do not read as a fourth filter. */}
                <span className="w-px h-6 bg-gray-200 dark:bg-surface-control mx-0.5" aria-hidden="true" />

                <IconButton
                    onClick={onNewPackage}
                    title="New package"
                    icon={<PackageAddIcon size={18} strokeWidth={1.75} />}
                />
                <Button
                    variant="primary"
                    onClick={onNewSnippet}
                    icon={<PlusSignIcon size={16} strokeWidth={2.5} />}
                >
                    New Snippet
                </Button>
            </div>
        </div>
    );
});

export default SnippetsToolbar;
