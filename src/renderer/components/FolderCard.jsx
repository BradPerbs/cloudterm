import { memo, useCallback } from 'react';
import { MoreVerticalIcon, CloudIcon } from 'hugeicons-react';
import { syncedFolder } from '../lib/server-sync';
import IconTile from './hosts/IconTile';
import MenuButton, { dropdownItems } from './ui/MenuButton';
import { useT } from '../i18n';

/**
 * One folder, as a tile in the grid or a row in the list.
 *
 * Unlike a host card this is also a container: a card dropped on it goes
 * *inside*, which is why it draws a ring rather than an insertion bar when it
 * is the target. `dropInto` and `dropEdge` are mutually exclusive; the panel
 * decides which from where the pointer is.
 *
 * `items` is what this folder can be told to do, in `ContextMenu`'s shape,
 * decided by the panel and offered both from the button on the card and from a
 * right-click on it.
 */

const stop = (event) => event.stopPropagation();

const FOLDER = 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z';

/** Swapped in while the folder is the drop target, so "this one, and inside
    it" is legible at a glance. */
const FOLDER_OPEN = 'M4 4h5l2 2h7a2 2 0 0 1 2 2v1H6.5a2 2 0 0 0-1.94 1.5L3 17V6a2 2 0 0 1 2-2zm2.5 7H21l-2.2 7.5A2 2 0 0 1 16.9 20H4a1 1 0 0 1-.97-1.24l2.02-6.5A1.5 1.5 0 0 1 6.5 11z';

/**
 * A cloud cut out of the folder's face, appended to `FOLDER` and filled
 * even-odd.
 *
 * A hole rather than a second glyph on top: the tile's background is
 * translucent, so anything drawn over the folder would have to guess the colour
 * of the card underneath it. It also keeps the silhouette and the weight of an
 * ordinary folder, one detail apart, which is what lets a mixed grid still read
 * as a grid of folders.
 */
const CLOUD_CUTOUT = 'M7.9 16a1.9 1.9 0 0 1 1.05-3.45 2.9 2.9 0 0 1 5.5-.2 2.1 2.1 0 0 1 1.85 3.65z';

/**
 * Why a machine-managed folder is here, on the hover.
 *
 * The account folder says it in a badge as well, because that is the one the
 * question gets asked about: it appears on its own the first time an account is
 * connected, in among folders the user did make.
 */
const SYNC_TITLES = {
    account: 'hosts.syncedAccount',
    project: 'hosts.syncedProject',
};

/** "3 hosts · 1 folder", and a plain word when there is nothing in it. */
function describeContents(t, { hosts, folders }) {
    const parts = [];
    if (hosts > 0) parts.push(t('hosts.count', { count: hosts }));
    if (folders > 0) parts.push(t('hosts.folderCount', { count: folders }));
    return parts.join(' · ') || t('hosts.folderEmpty');
}

function FolderCard({
    folder,
    counts = { hosts: 0, folders: 0 },
    view = 'grid',
    dragging = false,
    dropInto = false,
    selected = false,
    items = [],
    onOpen,
    onPick,
    onContextMenu,
    ...dragProps      // data-card-id and the pointer handle, from useCardDrag
}) {
    const t = useT();
    const isList = view === 'list';

    const handleClick = useCallback((event) => {
        if (event.target.closest('[data-action]')) return;
        // Held modifier: picking this card out, not going into it.
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            onPick?.(event);
            return;
        }
        onOpen();
    }, [onOpen, onPick]);

    const handleKeyDown = useCallback((event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onOpen();
    }, [onOpen]);

    const contents = describeContents(t, counts);

    // Not a prop: it is a plain question about the folder's own id, and one
    // place to ask it is one place for the answer to be wrong.
    const synced = syncedFolder(folder.id);

    return (
        <div
            className={`folder-card org-card group relative cursor-pointer
                ${isList ? 'rounded-xl px-2.5 py-2' : 'rounded-2xl p-2.5'}
                ${dragging ? 'org-card-dragging' : ''}
                ${dropInto ? 'org-card-into' : ''}
                ${selected ? 'org-card-selected' : ''}`}
            // Also a container, not just a sortable card: this is what the
            // pointer looks for to decide a drop means "file it in here".
            data-drop-folder={folder.id}
            data-selected={selected || undefined}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            // The whole card, including the controls on it: a right-click
            // anywhere on a folder should be about that folder.
            onContextMenu={onContextMenu}
            {...dragProps}
        >
            <div className="flex items-center gap-2.5">
                <IconTile size={isList ? 'sm' : 'md'} className="text-gray-500 dark:text-gray-300">
                    <svg
                        className={`${isList ? 'w-[18px] h-[18px]' : 'w-[21px] h-[21px]'} transition-transform ${dropInto ? 'scale-110' : ''}`}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        opacity="0.85"
                    >
                        {/* An SVG ignores a `title` attribute, it wants a
                            `<title>` child, so the glyph would otherwise be a
                            silent one. */}
                        {synced && !dropInto && <title>{t(SYNC_TITLES[synced])}</title>}

                        {/* Even-odd only where there is a hole to punch: the
                            open folder is two overlapping subpaths, and that
                            rule would eat the overlap. */}
                        <path
                            fillRule={synced && !dropInto ? 'evenodd' : undefined}
                            d={dropInto ? FOLDER_OPEN : (synced ? FOLDER + CLOUD_CUTOUT : FOLDER)}
                        />
                    </svg>
                </IconTile>

                <div className={`min-w-0 flex-1 ${isList ? 'flex items-center gap-3' : ''}`}>
                    <div className={isList ? 'min-w-0 flex-1' : 'min-w-0'}>
                        <div className="flex items-center gap-1.5 min-w-0">
                            <h3 className="min-w-0 font-semibold text-gray-900 dark:text-white text-sm truncate leading-tight">
                                {folder.name}
                            </h3>

                            {/* Read-only, so it stays part of the card's own
                                click target rather than opting out of it the
                                way the menu does: a badge that swallows the
                                click is a dead spot on a card that opens.

                                Only on the account folder. Every project inside
                                it is synced too, and a column of identical
                                pills saying so would be noise; their glyph and
                                the folder they are sitting in have said it. */}
                            {synced === 'account' && (
                                <span
                                    title={t(SYNC_TITLES.account)}
                                    // The same fill as the icon tile beside it,
                                    // and translucent rather than a step of the
                                    // ramp: the card moves up the ramp on hover,
                                    // and a solid chip would be swallowed by it.
                                    className="shrink-0 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md
                                        bg-gray-900/[0.06] dark:bg-white/10 text-gray-600 dark:text-gray-300"
                                >
                                    <CloudIcon size={11} strokeWidth={2.5} />
                                    {t('hosts.syncedBadge')}
                                </span>
                            )}
                        </div>
                        {!isList && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight mt-0.5">
                                {contents}
                            </p>
                        )}
                    </div>

                    {isList && (
                        <p className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                            {contents}
                        </p>
                    )}
                </div>

                <div
                    data-action="menu"
                    onClick={stop}
                    className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                >
                    <MenuButton
                        icon={<MoreVerticalIcon size={16} strokeWidth={2} />}
                        title={t('hosts.folderActions')}
                        items={dropdownItems(items)}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(FolderCard);
