import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FlashIcon, SearchRemoveIcon } from 'hugeicons-react';
import ConfirmDialog from './ui/ConfirmDialog';
import SnippetDialog from './snippets/SnippetDialog';
import SnippetCard from './snippets/SnippetCard';
import SnippetsToolbar from './snippets/SnippetsToolbar';
import EmptyFrame from './ui/EmptyFrame';
import { useSnippets } from '../hooks/useSnippets';
import {
    describeScope,
    placeholdersIn,
    composeSnippet,
    isPackage,
} from '../lib/snippets';
import { toastOptions } from '../lib/toast';
import { CARD_GRID } from '../lib/layout';
import { useFlipOrder } from '../hooks/useFlipOrder';

/**
 * The snippet library.
 *
 * A sibling of Hosts and Keychain rather than a settings page: it is a
 * collection the user builds up and reaches for, not a preference they set
 * once. Editing here writes straight through, and every open palette is told,
 * so a snippet changed in one place is current everywhere.
 *
 * Laid out the way Hosts is, because it is the same kind of page: a toolbar
 * that says what you are looking at and changes it, a row of context under it,
 * and a list that scrolls on its own. Commands and packages share the list
 * since they share one palette; the tile's icon and step count tell them apart.
 */

/** How the page was left last time. Not worth a round trip to the store. */
const VIEW_KEY = 'snippets.view';

function SnippetsPanel({ isActive = true, reachedForPage = 0, allHosts = [] }) {
    const { snippets, save, remove } = useSnippets();
    const [editing, setEditing] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('all');
    const [tag, setTag] = useState('');
    const [view, setView] = useState(() => (
        localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
    ));

    const searchRef = useRef(null);

    useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

    // The editor belongs to this page. Home stays mounted behind a terminal
    // tab, so without this the sheet would sit over the shell you switched to.
    useEffect(() => {
        if (isActive) return;
        setEditing(null);
        setConfirming(null);
    }, [isActive]);

    // Reaching for this page while standing on it asks for the editor over it
    // to go. The sheet is handed the signal rather than unmounted, so it slides
    // out onto the page being asked for instead of blinking off it.
    useEffect(() => {
        setConfirming(null);
    }, [reachedForPage]);

    /* ------------------------------------------------------------------ *
     * What is on screen
     * ------------------------------------------------------------------ */

    const counts = useMemo(() => ({
        all: snippets.length,
        command: snippets.filter(entry => !isPackage(entry)).length,
        package: snippets.filter(isPackage).length,
    }), [snippets]);

    /**
     * Each snippet with its composed text worked out once.
     *
     * A package's text is its steps joined; a command's is itself. Resolved
     * here rather than per card so searching, the preview line and the broken
     * mark all come from the same answer.
     */
    const resolved = useMemo(() => snippets.map((snippet) => {
        const { text, missing, steps } = composeSnippet(snippet, snippets);
        return {
            snippet,
            body: text,
            steps: steps.length,
            broken: missing.length > 0,
            values: placeholdersIn(text).length,
            scope: describeScope(snippet, allHosts),
        };
    }), [snippets, allHosts]);

    /** Every tag in the library, most used first, so the row is worth having. */
    const tags = useMemo(() => {
        const tally = new Map();
        for (const snippet of snippets) {
            for (const entry of snippet.tags || []) {
                tally.set(entry, (tally.get(entry) || 0) + 1);
            }
        }
        return [...tally.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([name]) => name);
    }, [snippets]);

    // A tag that stops existing (its last snippet was retagged or deleted)
    // would otherwise filter the list down to nothing with no way to tell why.
    useEffect(() => {
        if (tag && !tags.includes(tag)) setTag('');
    }, [tag, tags]);

    const searching = query.trim().length > 0;

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();

        return resolved.filter(({ snippet, body }) => {
            if (kind === 'command' && isPackage(snippet)) return false;
            if (kind === 'package' && !isPackage(snippet)) return false;
            if (tag && !snippet.tags?.includes(tag)) return false;
            if (!needle) return true;

            return snippet.name.toLowerCase().includes(needle)
                || body.toLowerCase().includes(needle)
                || (snippet.description || '').toLowerCase().includes(needle)
                || snippet.tags?.some(entry => entry.includes(needle));
        });
    }, [resolved, query, kind, tag]);

    // Cards slide between positions when a filter reorders the library, and
    // when the grid rewraps because the column it was using no longer fits.
    // Switching to the list is not a reorder, so that pass only re-measures.
    const gridRef = useRef(null);
    const orderKey = useMemo(() => visible.map(entry => entry.snippet.id).join(), [visible]);
    useFlipOrder(gridRef, orderKey, { resetKey: view });

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */

    const handleSave = useCallback(async (snippet) => {
        const isEdit = Boolean(snippet.id);
        const wasPackage = isPackage(snippet);
        setEditing(null);
        await save(snippet);
        toast.success(
            isEdit
                ? (wasPackage ? 'Package updated' : 'Snippet updated')
                : (wasPackage ? 'Package added' : 'Snippet added'),
            toastOptions({ duration: 1800 })
        );
    }, [save]);

    const handleDuplicate = useCallback(async (snippet) => {
        // Without the id it saves as a new record rather than overwriting.
        const { id, ...rest } = snippet;
        await save({ ...rest, name: `${snippet.name} copy` });
        toast.success(`Duplicated “${snippet.name}”`, toastOptions({ duration: 2200 }));
    }, [save]);

    const handleDelete = useCallback((snippet) => {
        // A command another package references is not gone quietly: the package
        // stops running rather than running short, so it is worth saying which.
        const usedBy = isPackage(snippet)
            ? []
            : snippets.filter(entry =>
                isPackage(entry) && (entry.steps || []).some(step => step.ref === snippet.id));

        setConfirming({
            title: isPackage(snippet) ? 'Delete this package?' : 'Delete this snippet?',
            message: usedBy.length > 0
                ? `“${snippet.name}” is a step in ${usedBy.length === 1
                    ? `“${usedBy[0].name}”`
                    : `${usedBy.length} packages`}. Deleting it will stop ${usedBy.length === 1 ? 'that package' : 'them'} from running until the step is taken out.`
                : `“${snippet.name}” will be removed from the library.`,
            confirmLabel: isPackage(snippet) ? 'Delete package' : 'Delete snippet',
            onConfirm: async () => {
                setConfirming(null);
                await remove(snippet.id);
                toast.success(`Deleted “${snippet.name}”`, toastOptions({ duration: 2200 }));
            },
        });
    }, [remove, snippets]);

    /* ------------------------------------------------------------------ *
     * Keyboard
     * ------------------------------------------------------------------ */

    useEffect(() => {
        if (!isActive) return;

        const handler = (event) => {
            if (event.defaultPrevented) return;
            const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');

            // The two ways every list in every app offers to start searching,
            // matching what Hosts binds.
            if (((event.ctrlKey || event.metaKey) && event.key === 'f' && !event.altKey)
                || (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isActive]);

    const handleSearchKeyDown = useCallback((event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (query) setQuery('');
        else event.currentTarget.blur();
    }, [query]);

    /* ------------------------------------------------------------------ *
     * Render
     * ------------------------------------------------------------------ */

    const filtering = searching || kind !== 'all' || Boolean(tag);
    const clearFilters = () => { setQuery(''); setKind('all'); setTag(''); };

    return (
        <div className="flex flex-col gap-4 h-full min-h-0" id="snippets-panel">
            <SnippetsToolbar
                ref={searchRef}
                query={query}
                onQueryChange={setQuery}
                onQueryKeyDown={handleSearchKeyDown}
                kind={kind}
                onKindChange={setKind}
                counts={counts}
                view={view}
                onViewChange={setView}
                onNewPackage={() => setEditing({ kind: 'package' })}
                onNewSnippet={() => setEditing({ kind: 'command' })}
            />

            {/* The row Hosts gives its breadcrumb: where you are in the
                collection on the left, and one quiet thing worth knowing on the
                right. */}
            <div className="flex items-center justify-between gap-4 shrink-0 min-h-[28px]">
                {tags.length > 0 ? (
                    <div className="flex items-center gap-1 flex-wrap min-w-0">
                        {tags.map(entry => (
                            <button
                                key={entry}
                                type="button"
                                onClick={() => setTag(current => (current === entry ? '' : entry))}
                                aria-pressed={tag === entry}
                                className={`h-6 px-2 rounded-md text-[11px] font-medium border transition-colors ${tag === entry
                                    ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                                    : 'border-gray-200 dark:border-surface-control text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white'}`}
                            >
                                {entry}
                            </button>
                        ))}
                        {filtering && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="ml-1 h-6 px-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                ) : filtering ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Filtered.{' '}
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="font-medium text-gray-900 dark:text-white hover:underline"
                        >
                            Clear
                        </button>
                    </p>
                ) : <span />}

                {/* Said once, quietly, where the thing it describes is. A feature
                    nobody discovers is the same as one that is not there. */}
                {snippets.length > 0 && (
                    <p className="hidden md:block text-[11px] text-gray-400 dark:text-neutral-500 shrink-0">
                        Press{' '}
                        <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-surface-control font-mono text-[10px] text-gray-600 dark:text-gray-300">
                            Ctrl+Shift+K
                        </kbd>{' '}
                        in a session to send one in
                    </p>
                )}
            </div>

            {/* The panel scrolls its own list, so the toolbar and the tag row
                stay put however long the library gets. */}
            <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2 pb-1">
                {visible.length === 0 ? (
                    <EmptyState empty={snippets.length === 0} searching={searching} query={query} />
                ) : (
                    <div ref={gridRef} className={view === 'list' ? 'flex flex-col gap-1.5' : CARD_GRID}>
                        {visible.map(entry => (
                            <SnippetCard
                                key={entry.snippet.id}
                                snippet={entry.snippet}
                                body={entry.body}
                                steps={entry.steps}
                                broken={entry.broken}
                                scope={entry.scope}
                                values={entry.values}
                                view={view}
                                onEdit={() => setEditing(entry.snippet)}
                                onDuplicate={() => handleDuplicate(entry.snippet)}
                                onDelete={() => handleDelete(entry.snippet)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {editing && (
                <SnippetDialog
                    snippet={editing.id ? editing : { ...editing, id: undefined }}
                    hosts={allHosts}
                    library={snippets}
                    dismiss={reachedForPage}
                    onSave={handleSave}
                    onClose={() => setEditing(null)}
                />
            )}

            {confirming && (
                <ConfirmDialog {...confirming} onCancel={() => setConfirming(null)} />
            )}
        </div>
    );
}

/** Three different nothings, and only one of them is a problem to solve. */
function EmptyState({ empty, searching, query }) {
    // Clearing is offered in the row above, beside the tags doing the hiding.
    if (!empty) {
        return (
            <EmptyFrame
                icon={<SearchRemoveIcon size={28} strokeWidth={1.5} />}
                title={searching ? 'No matches' : 'Nothing shown'}
                note={searching ? `“${query.trim()}”` : 'Nothing matches those filters.'}
            />
        );
    }

    return (
        <EmptyFrame
            icon={<FlashIcon size={28} strokeWidth={1.5} />}
            title="No snippets yet"
            note="Save the commands you retype on every box."
        />
    );
}

export default memo(SnippetsPanel);
