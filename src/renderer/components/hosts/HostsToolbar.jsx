import { forwardRef } from 'react';
import {
    FolderAddIcon,
    GridViewIcon,
    LeftToRightListBulletIcon,
    PlusSignIcon,
} from 'hugeicons-react';
import Button, { IconButton } from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import SearchField from '../ui/SearchField';
import SortMenu from './SortMenu';
import { useT } from '../../i18n';

const VIEWS = [
    { value: 'grid', titleKey: 'hosts.viewGrid', icon: <GridViewIcon size={14} strokeWidth={2} /> },
    { value: 'list', titleKey: 'hosts.viewList', icon: <LeftToRightListBulletIcon size={14} strokeWidth={2} /> },
];

/**
 * The Hosts page's header: the four controls that change what you are looking
 * at, led by the search field.
 *
 * Nothing here describes the page. The sidebar item is already lit and the cards
 * are plainly hosts, so a title and a count of what you can see only spent the
 * widest part of the row saying what nothing contradicts. Search takes that
 * width instead. The one count that was not merely restating the view (how
 * many hosts sit outside the folder you are standing in) belongs to the path,
 * not to a header, and the breadcrumb below is where to put it if it is wanted.
 *
 * The search field carries the ref because the panel gives it focus from a
 * keystroke: it is the control people reach for first, and hunting for it with
 * the mouse is exactly what the shortcut exists to avoid.
 *
 * Narrowing by tag is inside the sort menu rather than in a row of its own. The
 * two are the same question asked twice (what am I looking at, and in what
 * order), and the row it used to have was a row of thirty chips that only
 * appeared once you had already discovered the feature it was advertising.
 */
const HostsToolbar = forwardRef(function HostsToolbar({
    query,
    onQueryChange,
    onQueryKeyDown,
    sort,
    onSortChange,
    tags,
    selectedTags,
    tagMode,
    onToggleTag,
    onTagModeChange,
    onClearTags,
    view,
    onViewChange,
    onNewFolder,
    onNewHost,
}, searchRef) {
    const t = useT();

    return (
        <div className="flex items-center gap-2 shrink-0">
            {/* The field takes the row's slack: this header has one thing in it
                that can use width and three that cannot, and stopping the field
                short only leaves a gap that reads as a mistake. */}
            <SearchField
                ref={searchRef}
                value={query}
                onChange={onQueryChange}
                onKeyDown={onQueryKeyDown}
                ariaLabel={t('hosts.search')}
            />

            {/* Grouped so the row's flexing is all spent on the search field:
                these keep the size they ask for, and the field takes whatever
                is left over. */}
            <div className="flex items-center gap-2 shrink-0">
                <SortMenu
                    sort={sort}
                    onSortChange={onSortChange}
                    tags={tags}
                    selectedTags={selectedTags}
                    tagMode={tagMode}
                    onToggleTag={onToggleTag}
                    onTagModeChange={onTagModeChange}
                    onClearTags={onClearTags}
                />

                <SegmentedControl
                    segments={VIEWS.map(entry => ({ ...entry, title: t(entry.titleKey) }))}
                    value={view}
                    onChange={onViewChange}
                    ariaLabel={t('hosts.layout')}
                />

                {/* A hairline between "how it is shown" and "what there is",
                    so the two primary actions do not read as a fifth filter. */}
                <span className="w-px h-6 bg-gray-200 dark:bg-surface-control mx-0.5" aria-hidden="true" />

                <IconButton
                    onClick={onNewFolder}
                    title={t('hosts.newFolder')}
                    icon={<FolderAddIcon size={18} strokeWidth={1.75} />}
                />
                <Button
                    variant="primary"
                    onClick={onNewHost}
                    icon={<PlusSignIcon size={16} strokeWidth={2.5} />}
                >
                    {t('hosts.newHost')}
                </Button>
            </div>
        </div>
    );
});

export default HostsToolbar;
