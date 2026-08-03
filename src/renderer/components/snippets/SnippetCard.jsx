import { memo, useCallback } from 'react';
import {
    Copy01Icon,
    Delete02Icon,
    Edit02Icon,
    MoreVerticalIcon,
    CodeIcon,
    Layers01Icon,
} from 'hugeicons-react';
import IconTile from '../hosts/IconTile';
import MenuButton from '../ui/MenuButton';
import Tooltip from '../ui/Tooltip';

/**
 * One snippet, as a tile in the grid or a row in the list.
 *
 * Built to the same rule as HostCard, and for the same reason: two lines,
 * always. What it is called, then what it runs, with everything else riding on
 * the end of that second line. A package could show its steps stacked up, but a
 * card that grows a line for some records and not others makes a grid of them
 * look broken; the step count says the same thing in the space there is, and
 * the editor is where the steps are actually read.
 */

/** The card opens the editor, so the controls on it opt out of that click. */
const stop = (event) => event.stopPropagation();

/** One line, so a here-doc cannot stretch a row to the height of the panel. */
const firstLine = (text) => {
    const lines = String(text || '').split('\n');
    return lines.length > 1 ? `${lines[0]} …` : lines[0];
};

function SnippetCard({
    snippet,
    body,
    steps,
    broken,
    scope,
    values,
    view = 'grid',
    onEdit,
    onDuplicate,
    onDelete,
}) {
    const isList = view === 'list';
    const asPackage = snippet.kind === 'package';

    const handleClick = useCallback((event) => {
        if (event.target.closest('[data-action]')) return;
        onEdit();
    }, [onEdit]);

    // Enter and Space reach the card through the keyboard; without them a
    // snippet could be tabbed to and not opened.
    const handleKeyDown = useCallback((event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onEdit();
    }, [onEdit]);

    // Only ever what is true of this snippet. Ordered so the two that change
    // what happens when you pick it come first.
    const extras = [
        asPackage ? `${steps} step${steps === 1 ? '' : 's'}` : '',
        asPackage && snippet.chain ? 'stops on failure' : '',
        snippet.runImmediately ? 'runs on insert' : '',
        values > 0 ? `${values} value${values === 1 ? '' : 's'}` : '',
        scope,
        ...(snippet.tags || []),
    ].filter(Boolean);

    const menuItems = [
        { label: asPackage ? 'Edit package' : 'Edit snippet', icon: <Edit02Icon size={14} strokeWidth={2} />, onSelect: onEdit },
        { label: 'Duplicate', icon: <Copy01Icon size={14} strokeWidth={2} />, onSelect: onDuplicate },
        { separator: true },
        { label: 'Delete', icon: <Delete02Icon size={14} strokeWidth={2} />, danger: true, onSelect: onDelete },
    ];

    return (
        <div
            // What useFlipOrder follows a card by when the grid rewraps.
            data-card-id={snippet.id}
            className={`org-card group relative cursor-pointer
                ${isList ? 'rounded-xl px-2.5 py-2' : 'rounded-2xl p-2.5'}`}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
        >
            <div className="flex items-center gap-2.5">
                <IconTile size={isList ? 'sm' : 'md'}>
                    <span className={broken ? 'text-red-500' : 'text-gray-500 dark:text-neutral-400'}>
                        {asPackage
                            ? <Layers01Icon size={isList ? 16 : 18} strokeWidth={2} />
                            : <CodeIcon size={isList ? 16 : 18} strokeWidth={2} />}
                    </span>
                    {/* A package that cannot run is the one thing about a record
                        that stops it working, so it is marked on the icon rather
                        than written into the meta where it would scroll past. */}
                    {broken && (
                        // The position goes on the wrapper, not the dot: the dot
                        // taken out of flow would leave Tooltip's span with no
                        // size, and nothing to hover.
                        <Tooltip
                            label="A step points at a snippet that no longer exists"
                            className="absolute -right-0.5 -bottom-0.5"
                        >
                            <span
                                className="block w-2.5 h-2.5 rounded-full bg-red-500
                                    ring-2 ring-white dark:ring-surface-control"
                            />
                        </Tooltip>
                    )}
                </IconTile>

                <div className={`min-w-0 flex-1 ${isList ? 'flex items-center gap-3' : ''}`}>
                    <div className={isList ? 'min-w-0 flex-1' : 'min-w-0'}>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate leading-tight">
                            {snippet.name}
                        </h3>
                        {/* Same tone as HostCard's second line: `neutral-500`
                            is #565f89, which on a #24283b card is barely 2:1. */}
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight mt-0.5">
                            <span className={`font-mono ${broken ? 'text-red-500 dark:text-red-400' : ''}`}>
                                {broken ? 'A step was deleted, so this will not run' : firstLine(body)}
                            </span>
                            {!isList && extras.map(entry => (
                                <span key={entry}>
                                    <span className="mx-1 opacity-50">·</span>
                                    {entry}
                                </span>
                            ))}
                        </p>
                    </div>

                    {/* The list has room to give these a column of their own,
                        where the grid has to fold them onto the command line. */}
                    {isList && extras.length > 0 && (
                        <p className="shrink-0 max-w-[45%] truncate text-[11px] text-gray-500 dark:text-gray-400">
                            {extras.join(' · ')}
                        </p>
                    )}
                </div>

                {/* Idle cards stay quiet; the controls come up on hover, and on
                    keyboard focus so they are still reachable without a mouse. */}
                <div
                    data-action="menu"
                    onClick={stop}
                    className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                >
                    <MenuButton
                        icon={<MoreVerticalIcon size={16} strokeWidth={2} />}
                        title="Snippet actions"
                        items={menuItems}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(SnippetCard);
