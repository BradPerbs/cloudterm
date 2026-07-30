import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    Folder01Icon,
    File01Icon,
    FileLinkIcon,
    ArrowUp01Icon,
    ArrowDown01Icon,
    PencilEdit01Icon,
} from 'hugeicons-react';
import { formatSize, formatDate, formatMode } from '../../lib/format';

const ROW_HEIGHT = 32;
// Rows kept above and below the viewport so fast scrolling doesn't flash blank.
const OVERSCAN = 8;

const COLUMNS = [
    { key: 'name', label: 'Name', className: 'flex-1 min-w-0' },
    { key: 'size', label: 'Size', className: 'w-24 text-right' },
    { key: 'modifyTime', label: 'Modified', className: 'w-40 text-right' },
    { key: 'mode', label: 'Permissions', className: 'w-32 text-right' },
];

function iconFor(entry) {
    if (entry.isSymlink) return FileLinkIcon;
    if (entry.isDirectory) return Folder01Icon;
    return File01Icon;
}

function iconColour(entry) {
    if (entry.broken) return 'text-red-400';
    if (entry.isSymlink) return 'text-purple-500';
    if (entry.isDirectory || entry.targetIsDirectory) return 'text-yellow-500';
    return 'text-gray-400 dark:text-neutral-500';
}

function Row({
    entry,
    index,
    selected,
    focused,
    editing,
    editValue,
    isEdited,
    onEditChange,
    onEditCommit,
    onEditCancel,
    onClick,
    onDoubleClick,
    onContextMenu,
    onDropFiles,
}) {
    const Icon = iconFor(entry);
    const inputRef = useRef(null);
    const [dropTarget, setDropTarget] = useState(false);

    useEffect(() => {
        if (!editing || !inputRef.current) return;
        const input = inputRef.current;
        input.focus();
        // Preselect the stem so a rename doesn't fight the extension.
        const dot = entry.name.lastIndexOf('.');
        if (dot > 0 && !entry.isDirectory) input.setSelectionRange(0, dot);
        else input.select();
    }, [editing, entry.name, entry.isDirectory]);

    const isFolder = entry.isDirectory || entry.targetIsDirectory;

    return (
        <div
            role="row"
            aria-selected={selected}
            className={`sftp-row absolute left-0 right-0 flex items-center gap-3 px-3 text-sm cursor-default select-none ${
                selected ? 'sftp-row-selected' : 'hover:bg-gray-100 dark:hover:bg-surface-control/60'
            } ${focused ? 'sftp-row-focused' : ''} ${dropTarget ? 'sftp-row-drop' : ''}`}
            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onDragOver={isFolder ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                setDropTarget(true);
            } : undefined}
            onDragLeave={isFolder ? () => setDropTarget(false) : undefined}
            onDrop={isFolder ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                setDropTarget(false);
                onDropFiles?.(event, entry);
            } : undefined}
        >
            <Icon size={16} strokeWidth={2} className={`shrink-0 ${iconColour(entry)}`} />

            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                {editing ? (
                    <input
                        ref={inputRef}
                        value={editValue}
                        onChange={(event) => onEditChange(event.target.value)}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') onEditCommit();
                            if (event.key === 'Escape') onEditCancel();
                        }}
                        onBlur={onEditCommit}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        className="flex-1 min-w-0 bg-white dark:bg-surface-base border border-blue-500 rounded px-1.5 py-0.5 text-sm outline-none text-gray-900 dark:text-white"
                        spellCheck={false}
                    />
                ) : (
                    <>
                        <span className={`truncate ${
                            entry.hidden ? 'text-gray-500 dark:text-gray-500' : 'text-gray-900 dark:text-white'
                        }`}>
                            {entry.name}
                        </span>
                        {entry.isSymlink && entry.linkTarget && (
                            <span className="text-xs text-gray-400 dark:text-neutral-600 truncate shrink-[2]">
                                → {entry.linkTarget}
                            </span>
                        )}
                        {isEdited && (
                            <PencilEdit01Icon
                                size={12}
                                strokeWidth={2.5}
                                className="shrink-0 text-amber-500"
                                title="Open in your editor (saves upload automatically)"
                            />
                        )}
                    </>
                )}
            </div>

            <span className="w-24 text-right tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
                {entry.isDirectory ? '-' : formatSize(entry.size)}
            </span>
            <span className="w-40 text-right tabular-nums text-gray-500 dark:text-gray-400 shrink-0 text-xs">
                {formatDate(entry.modifyTime)}
            </span>
            <span className="w-32 text-right font-mono text-xs text-gray-400 dark:text-neutral-500 shrink-0">
                {formatMode(entry.mode, entry)}
            </span>
        </div>
    );
}

/**
 * Windowed file list. Only the visible slice is mounted, so a directory with
 * tens of thousands of entries scrolls at the same cost as a small one.
 */
function FileTable({
    entries,
    selection,
    focusedIndex,
    sort,
    onSortChange,
    onRowClick,
    onRowDoubleClick,
    onRowContextMenu,
    onBackgroundClick,
    onBackgroundContextMenu,
    onDropOnFolder,
    renaming,
    renameValue,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    editedPaths,
    currentPath,
    draft,
    emptyState,
}) {
    const viewportRef = useRef(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(0);

    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const observer = new ResizeObserver(() => setHeight(viewport.clientHeight));
        observer.observe(viewport);
        setHeight(viewport.clientHeight);

        return () => observer.disconnect();
    }, []);

    // Keep the keyboard cursor on screen as it moves.
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || focusedIndex < 0) return;

        const top = focusedIndex * ROW_HEIGHT;
        const bottom = top + ROW_HEIGHT;

        if (top < viewport.scrollTop) {
            viewport.scrollTop = top;
        } else if (bottom > viewport.scrollTop + viewport.clientHeight) {
            viewport.scrollTop = bottom - viewport.clientHeight;
        }
    }, [focusedIndex]);

    const handleScroll = useCallback((event) => setScrollTop(event.currentTarget.scrollTop), []);

    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil((height || 400) / ROW_HEIGHT) + OVERSCAN * 2;
    const last = Math.min(entries.length, first + visible);

    const rows = [];
    for (let index = first; index < last; index++) {
        const entry = entries[index];
        const fullPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
        rows.push(
            <Row
                key={entry.name}
                entry={entry}
                index={index}
                selected={selection.has(entry.name)}
                focused={focusedIndex === index}
                editing={renaming === entry.name}
                editValue={renameValue}
                isEdited={editedPaths.has(fullPath)}
                onEditChange={onRenameChange}
                onEditCommit={onRenameCommit}
                onEditCancel={onRenameCancel}
                onClick={(event) => onRowClick(event, entry, index)}
                onDoubleClick={() => onRowDoubleClick(entry)}
                onContextMenu={(event) => onRowContextMenu(event, entry, index)}
                onDropFiles={onDropOnFolder}
            />
        );
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-3 h-8 border-b border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-raised text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {COLUMNS.map(column => (
                    <button
                        key={column.key}
                        onClick={() => onSortChange(column.key)}
                        className={`${column.className} flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors ${
                            column.key === 'name' ? 'justify-start pl-7' : 'justify-end'
                        }`}
                    >
                        <span>{column.label}</span>
                        {sort.key === column.key && (
                            sort.direction === 'asc'
                                ? <ArrowUp01Icon size={12} strokeWidth={3} />
                                : <ArrowDown01Icon size={12} strokeWidth={3} />
                        )}
                    </button>
                ))}
            </div>

            {/* Rows */}
            <div
                ref={viewportRef}
                onScroll={handleScroll}
                onClick={onBackgroundClick}
                onContextMenu={onBackgroundContextMenu}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative"
            >
                {draft}

                {entries.length === 0 ? emptyState : (
                    <div style={{ height: entries.length * ROW_HEIGHT }} className="relative">
                        {rows}
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(FileTable);
export { ROW_HEIGHT };
