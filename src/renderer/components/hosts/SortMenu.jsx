import { useMemo, useState } from 'react';
import { Search01Icon, SortingAZ01Icon, Tick02Icon } from 'hugeicons-react';
import MenuButton from '../ui/MenuButton';
import Tag from '../ui/Tag';
import { SORT_LABELS, SORT_MANUAL, SORT_NAME, SORT_NAME_DESC, SORT_RECENT } from '../../lib/organize';

const SORT_ORDER = [SORT_NAME, SORT_NAME_DESC, SORT_RECENT, SORT_MANUAL];

/** Past this many tags the list is worth a search box rather than a scroll. */
const SEARCHABLE_FROM = 8;

/**
 * How the Hosts page is ordered and what it is narrowed to, in one dropdown.
 *
 * The tag filter used to be a row of chips under the toolbar, which had two
 * problems. It only existed once something was tagged, so on a fresh collection
 * the feature was invisible — there was nothing on the page to suggest tags
 * could narrow it. And when it did exist it spent a whole row on every tag in
 * the collection, pushing the cards down for a control used occasionally.
 *
 * So it lives here instead, beside sorting, because both answer the same
 * question: what am I looking at and in what order. The button carries a count
 * when a filter is live, since a page narrowed for a reason two clicks out of
 * sight is a page that looks like it has lost hosts. The tags actually picked
 * are named again above the grid, where they can be dropped one at a time.
 *
 * Picking a sort closes the menu — it is one choice and it is made. Picking a
 * tag does not: filters are built up, and a menu that shut on the first tag
 * would have to be reopened for the second.
 */
export default function SortMenu({
    sort,
    onSortChange,
    tags,
    selectedTags,
    tagMode,
    onToggleTag,
    onTagModeChange,
    onClearTags,
}) {
    const filtering = selectedTags.length > 0;

    const label = `Sort: ${SORT_LABELS[sort]}`;
    const title = filtering
        ? `${label} · filtered by ${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'}`
        : label;

    return (
        <MenuButton
            icon={<SortingAZ01Icon size={16} strokeWidth={2} />}
            title={title}
            active={sort !== SORT_NAME || filtering}
            badge={selectedTags.length}
            menuClassName="w-[264px] p-1"
        >
            {(close) => (
                <>
                    <SectionLabel>Sort</SectionLabel>

                    {SORT_ORDER.map(mode => (
                        <Row
                            key={mode}
                            role="menuitemradio"
                            checked={mode === sort}
                            onClick={() => { close(); onSortChange(mode); }}
                        >
                            <span className="flex-1 truncate font-medium">{SORT_LABELS[mode]}</span>
                        </Row>
                    ))}

                    {/* Only once something is tagged. A section of controls for
                        a feature nobody has used yet is a section of chrome.

                        Its own component so that the search box inside it is
                        mounted with the menu and dies with it: a term left over
                        from last time would quietly hide most of the list the
                        next time the menu is opened. */}
                    {tags.length > 0 && (
                        <TagSection
                            tags={tags}
                            selected={selectedTags}
                            mode={tagMode}
                            onToggle={onToggleTag}
                            onModeChange={onTagModeChange}
                            onClear={onClearTags}
                        />
                    )}
                </>
            )}
        </MenuButton>
    );
}

/** The tag half of the menu: what to narrow to, and how to combine two of them. */
function TagSection({ tags, selected, mode, onToggle, onModeChange, onClear }) {
    const [query, setQuery] = useState('');

    const picked = useMemo(() => new Set(selected), [selected]);

    /**
     * What was picked when the menu opened, which is what the list is ordered
     * by — not what is picked now.
     *
     * Picked tags lead, because with thirty tags the ones already doing the
     * filtering must not be somewhere below a scroll. But re-sorting as they
     * are clicked would move the list under the pointer, and the second tag
     * anyone picks is usually the one that was next to the first. So the order
     * is settled on open and held for as long as the menu is up; this component
     * is mounted with the panel, so reopening re-sorts.
     */
    const [openedWith] = useState(() => new Set(selected));

    const ordered = useMemo(() => {
        const term = query.trim().toLowerCase();
        const matching = term ? tags.filter(entry => entry.tag.includes(term)) : tags;

        return [
            ...matching.filter(entry => openedWith.has(entry.tag)),
            ...matching.filter(entry => !openedWith.has(entry.tag)),
        ];
    }, [tags, openedWith, query]);

    return (
        <>
            <div className="-mx-1 my-1.5 border-t border-gray-100 dark:border-surface-control" />

            <SectionLabel
                aside={selected.length > 0 && (
                    <div className="flex items-center gap-1">
                        {/* Only once there are two, because with one picked tag
                            "all" and "any" are the same filter and the control
                            would be asking a question with one answer. */}
                        {selected.length > 1 && (
                            <div className="flex items-center rounded-md overflow-hidden
                                border border-gray-200 dark:border-surface-control">
                                {['all', 'any'].map(entry => (
                                    <button
                                        key={entry}
                                        type="button"
                                        onClick={() => onModeChange(entry)}
                                        aria-pressed={mode === entry}
                                        title={entry === 'all'
                                            ? 'Hosts carrying every picked tag'
                                            : 'Hosts carrying at least one picked tag'}
                                        className={`h-[18px] px-1.5 text-[10px] font-bold uppercase transition-colors ${
                                            mode === entry
                                                ? 'bg-gray-900 dark:bg-white text-white dark:text-black'
                                                : 'text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {entry}
                                    </button>
                                ))}
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={onClear}
                            className="px-1 text-[10px] font-bold uppercase tracking-wider
                                text-gray-400 dark:text-neutral-500
                                hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                )}
            >
                Filter by tag
            </SectionLabel>

            {tags.length > SEARCHABLE_FROM && (
                <div className="relative mx-1 mb-1">
                    <Search01Icon
                        size={13}
                        strokeWidth={2}
                        className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none
                            text-gray-400 dark:text-neutral-500"
                    />
                    <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={`Search ${tags.length} tags…`}
                        spellCheck={false}
                        aria-label="Search tags"
                        className="w-full h-7 pl-7 pr-2 rounded-lg text-[11px]
                            bg-gray-100 dark:bg-surface-base
                            text-gray-900 dark:text-white
                            placeholder:text-gray-400 dark:placeholder:text-neutral-500
                            border border-transparent outline-none transition-colors
                            focus:border-gray-300 dark:focus:border-neutral-600"
                    />
                </div>
            )}

            {ordered.length === 0 ? (
                <p className="px-2.5 py-3 text-[11px] text-center text-gray-400 dark:text-neutral-500">
                    No tag matches “{query.trim()}”
                </p>
            ) : (
                <div className="max-h-[13rem] overflow-y-auto">
                    {ordered.map(({ tag, count }) => (
                        <Row
                            key={tag}
                            checked={picked.has(tag)}
                            onClick={() => onToggle(tag)}
                            title={picked.has(tag)
                                ? `Stop filtering by “${tag}”`
                                : `Filter by “${tag}”`}
                        >
                            <span className="flex-1 min-w-0 flex">
                                <Tag tag={tag} />
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-neutral-500">
                                {count}
                            </span>
                        </Row>
                    ))}
                </div>
            )}
        </>
    );
}

/** A heading over a run of rows, with room on the right for the section's own controls. */
function SectionLabel({ children, aside }) {
    return (
        <div className="flex items-center justify-between gap-2 pl-2.5 pr-1 pt-1.5 pb-1 min-h-[24px]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500">
                {children}
            </span>
            {aside}
        </div>
    );
}

/**
 * One line of the menu: something on the left, a tick on the right when it is
 * the answer.
 *
 * A picked row also keeps the fill that hovering gives it, because the chip
 * itself cannot say whether it is picked — it is the same solid colour either
 * way — and a column of thirty vivid pills needs the answer readable down the
 * left edge rather than only at the tick column.
 *
 * The tick keeps its space when it is not shown, so ticking a row does not
 * shuffle everything beside it a few pixels left.
 */
function Row({ checked, onClick, title, role = 'menuitemcheckbox', children }) {
    return (
        <button
            type="button"
            role={role}
            aria-checked={checked}
            title={title}
            onClick={onClick}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left
                transition-colors hover:bg-gray-100 dark:hover:bg-surface-control ${
                checked
                    ? 'bg-gray-100 dark:bg-surface-control text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300'
            }`}
        >
            {children}
            <span className="shrink-0 w-3.5 flex items-center justify-center text-gray-900 dark:text-white">
                {checked && <Tick02Icon size={13} strokeWidth={2.5} />}
            </span>
        </button>
    );
}
