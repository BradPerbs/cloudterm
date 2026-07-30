import { memo, useCallback } from 'react';
import { Delete02Icon, Edit02Icon, MoreVerticalIcon } from 'hugeicons-react';
import IconTile from './hosts/IconTile';
import MenuButton from './ui/MenuButton';

/**
 * One folder, as a tile in the grid or a row in the list.
 *
 * Unlike a host card this is also a container: a card dropped on it goes
 * *inside*, which is why it draws a ring rather than an insertion bar when it
 * is the target. `dropInto` and `dropEdge` are mutually exclusive; the panel
 * decides which from where the pointer is.
 */

const stop = (event) => event.stopPropagation();

/** "3 hosts · 1 folder", and a plain word when there is nothing in it. */
function describeContents({ hosts, folders }) {
    const parts = [];
    if (hosts > 0) parts.push(`${hosts} host${hosts === 1 ? '' : 's'}`);
    if (folders > 0) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
    return parts.join(' · ') || 'Empty';
}

function FolderCard({
    folder,
    counts = { hosts: 0, folders: 0 },
    view = 'grid',
    dragging = false,
    dropInto = false,
    selected = false,
    onOpen,
    onEdit,
    onDelete,
    onPick,
    ...dragProps      // data-card-id and the pointer handle, from useCardDrag
}) {
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

    const contents = describeContents(counts);

    const menuItems = [
        { label: 'Open', onSelect: onOpen },
        { label: 'Rename', icon: <Edit02Icon size={14} strokeWidth={2} />, onSelect: onEdit },
        { separator: true },
        {
            label: 'Delete',
            hint: 'keeps contents',
            icon: <Delete02Icon size={14} strokeWidth={2} />,
            danger: true,
            onSelect: onDelete,
        },
    ];

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
            {...dragProps}
        >
            <div className="flex items-center gap-2.5">
                <IconTile size={isList ? 'sm' : 'md'} className="text-gray-500 dark:text-gray-300">
                    {/* Swaps to an open folder while it is the drop target, so
                        "this one, and inside it" is legible at a glance. */}
                    <svg
                        className={`${isList ? 'w-[18px] h-[18px]' : 'w-[21px] h-[21px]'} transition-transform ${dropInto ? 'scale-110' : ''}`}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        opacity="0.85"
                    >
                        {dropInto
                            ? <path d="M4 4h5l2 2h7a2 2 0 0 1 2 2v1H6.5a2 2 0 0 0-1.94 1.5L3 17V6a2 2 0 0 1 2-2zm2.5 7H21l-2.2 7.5A2 2 0 0 1 16.9 20H4a1 1 0 0 1-.97-1.24l2.02-6.5A1.5 1.5 0 0 1 6.5 11z" />
                            : <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />}
                    </svg>
                </IconTile>

                <div className={`min-w-0 flex-1 ${isList ? 'flex items-center gap-3' : ''}`}>
                    <div className={isList ? 'min-w-0 flex-1' : 'min-w-0'}>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate leading-tight">
                            {folder.name}
                        </h3>
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
                        title="Folder actions"
                        items={menuItems}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(FolderCard);
