import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search01Icon, ArrowLeft01Icon, Alert02Icon } from 'hugeicons-react';
import { useEnterOn } from '../../hooks/useEnter';
import { PANE_OVERLAY_TOP } from '../../lib/layout';
import { useSnippets } from '../../hooks/useSnippets';
import {
    filterSnippets,
    placeholdersIn,
    fillPlaceholders,
    composeSnippet,
    isPackage,
} from '../../lib/snippets';
import Tooltip from '../ui/Tooltip';

/**
 * Pick a snippet and put it in the terminal.
 *
 * Hangs off the pane's own header rather than opening over the window. A
 * snippet goes into *one* session, and in a split tab a centred modal with a
 * dimmed backdrop says the opposite: it covers the three panes it has nothing
 * to do with and hides the buffer you are about to type into. Anchored here it
 * reads as belonging to the pane, and the shell stays visible behind it.
 *
 * Two stages in one surface: choose, then fill in whatever `{{placeholders}}`
 * the command carries. Going back has to return to the list with the query
 * intact, which is awkward across two separate surfaces.
 *
 * Nothing is sent until the last step. A snippet marked *run immediately* still
 * shows its filled-in text before it goes, so the one thing that cannot be
 * taken back is always seen first.
 */

const FIELD_CLASS = 'w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-surface-control '
    + 'bg-gray-50 dark:bg-surface-base text-gray-900 dark:text-white text-sm font-mono outline-none '
    + 'transition-colors focus:border-gray-400 dark:focus:border-neutral-600';

/** One line, so a here-doc does not stretch a row to the height of the list. */
const preview = (command) => {
    const lines = String(command).split('\n');
    return lines.length > 1 ? `${lines[0]} …` : lines[0];
};

function SnippetRow({ snippet, body, steps, broken, active, onPick, onHover }) {
    const ref = useRef(null);

    useEffect(() => {
        if (active) ref.current?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    return (
        <button
            ref={ref}
            type="button"
            onClick={onPick}
            onMouseMove={onHover}
            className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors ${
                active ? 'bg-gray-100 dark:bg-surface-control' : ''
            }`}
        >
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium text-gray-900 dark:text-white truncate">
                    {snippet.name}
                </span>

                {isPackage(snippet) && (
                    <Tooltip label={broken
                        ? 'A step points at a snippet that no longer exists'
                        : `${steps} step${steps === 1 ? '' : 's'}, ${snippet.chain ? 'stopping at the first failure' : 'one after another'}`}>
                        <span className={`shrink-0 text-[9px] uppercase tracking-wide px-1 py-px rounded border ${broken
                            ? 'text-red-600 dark:text-red-400 border-red-300/60 dark:border-red-500/40'
                            : 'text-gray-500 dark:text-neutral-400 border-gray-300/70 dark:border-surface-control'}`}>
                            {broken ? 'broken' : `${steps} steps`}
                        </span>
                    </Tooltip>
                )}

                {snippet.runImmediately && (
                    <Tooltip label="Runs as soon as it is inserted">
                        <span
                            className="shrink-0 text-[9px] uppercase tracking-wide px-1 py-px rounded text-amber-600 dark:text-amber-500 border border-amber-300/60 dark:border-amber-500/40"
                        >
                            runs
                        </span>
                    </Tooltip>
                )}

                {snippet.tags?.slice(0, 2).map(tag => (
                    <span key={tag} className="shrink-0 text-[10px] text-gray-400 dark:text-neutral-500">
                        {tag}
                    </span>
                ))}
            </div>

            <div className="text-[11px] font-mono text-gray-500 dark:text-neutral-400 truncate mt-0.5">
                {preview(body)}
            </div>
        </button>
    );
}

export default function SnippetPalette({ hostId, hostName, onInsert, onClose }) {
    const { snippets, loading } = useSnippets();
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    // Set once a snippet with placeholders is chosen; null while browsing.
    const [filling, setFilling] = useState(null);
    const [values, setValues] = useState({});
    const panelRef = useRef(null);

    /** Fades in over the pane rather than appearing. See lib/enterMotion. */
    useEnterOn(panelRef, 'fade');
    const inputRef = useRef(null);

    /**
     * Each match with its composed text worked out once.
     *
     * A package's text is its steps joined; a command's is itself. Composing
     * here rather than per row keeps the row a pure render, and means picking
     * uses exactly the text the row previewed.
     */
    const matches = useMemo(
        () => filterSnippets(snippets, { hostId, query }).map((snippet) => {
            const { text, missing, steps } = composeSnippet(snippet, snippets);
            return { snippet, text, steps: steps.length, broken: missing.length > 0 };
        }),
        [snippets, hostId, query]
    );

    // Typing changes the list under the cursor, so the cursor goes back to the
    // top rather than pointing at whatever sits at the old offset.
    useEffect(() => setActiveIndex(0), [query, snippets.length]);

    // Whatever went wrong with the last pick, cleared as soon as the user does
    // anything else so it cannot outlive what it was about.
    const [problem, setProblem] = useState('');
    useEffect(() => setProblem(''), [query]);

    // `preventScroll`, because the pane behind this holds a terminal viewport
    // that the browser would happily scroll to "reveal" a field it thinks is
    // out of view, moving the buffer under the panel.
    useEffect(() => {
        if (!filling) inputRef.current?.focus({ preventScroll: true });
    }, [filling]);

    /**
     * Click anywhere else and it goes away, the way a menu does. The header
     * button carries `data-snippet-trigger` and is skipped: without that, its
     * mousedown would close the panel and its click would immediately reopen
     * it, so the button could never be used to dismiss what it opened.
     */
    useEffect(() => {
        const handlePointerDown = (event) => {
            if (panelRef.current?.contains(event.target)) return;
            if (event.target.closest?.('[data-snippet-trigger]')) return;
            onClose();
        };

        document.addEventListener('mousedown', handlePointerDown, true);
        return () => document.removeEventListener('mousedown', handlePointerDown, true);
    }, [onClose]);

    const send = useCallback((snippet, filled) => {
        onInsert(filled, snippet.runImmediately);
        onClose();
    }, [onInsert, onClose]);

    /**
     * `entry` is a row from `matches`, so the text picked is the text shown.
     *
     * A package missing a step is refused rather than run without it. Skipping
     * a step in a series is the dangerous failure: "stop the service, deploy,
     * start the service" must not quietly become "deploy, start the service".
     */
    const pick = useCallback((entry) => {
        if (!entry) return;
        const { snippet, text, broken } = entry;

        if (broken) {
            setProblem(`"${snippet.name}" has a step whose snippet was deleted. Fix it in the Snippets panel.`);
            return;
        }

        const names = placeholdersIn(text);
        if (names.length === 0) {
            send(snippet, text);
            return;
        }

        setValues(Object.fromEntries(names.map(name => [name, ''])));
        setFilling({ snippet, names, text });
    }, [send]);

    const confirmFill = useCallback(() => {
        if (!filling) return;
        // `filling.text`, not the snippet's own command: for a package that is
        // the composed series, and it is what the preview above showed.
        send(filling.snippet, fillPlaceholders(filling.text, values));
    }, [filling, values, send]);

    const handleKeyDown = useCallback((event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            // From the fill step, Escape returns to the list rather than
            // discarding a half-typed answer along with the whole palette.
            if (filling) setFilling(null);
            else onClose();
            return;
        }

        if (filling) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                confirmFill();
            }
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex(index => (matches.length ? (index + 1) % matches.length : 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(index => (matches.length ? (index - 1 + matches.length) % matches.length : 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            pick(matches[activeIndex]);
        }
    }, [filling, matches, activeIndex, pick, onClose, confirmFill]);

    const filled = filling ? fillPlaceholders(filling.text, values) : '';
    const unanswered = filling ? filling.names.filter(name => !values[name]) : [];

    return (
        <div
            ref={panelRef}
            style={{ top: PANE_OVERLAY_TOP, maxHeight: `calc(100% - ${PANE_OVERLAY_TOP + 16}px)` }}
            className="absolute right-3 z-30 w-[26rem] max-w-[calc(100%-1.5rem)] flex flex-col
                rounded-xl bg-white/97 dark:bg-surface-raised/97 backdrop-blur
                border border-gray-200 dark:border-surface-control shadow-xl
                overflow-hidden"
            role="dialog"
            aria-label="Snippets"
            onKeyDown={handleKeyDown}
        >
            {filling ? (
                <>
                    <div className="flex items-center gap-2 px-2 h-10 border-b border-gray-100 dark:border-surface-control">
                        <Tooltip label="Back to the list" hint="Esc">
                            <button
                                type="button"
                                onClick={() => setFilling(null)}
                                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                            >
                                <ArrowLeft01Icon size={15} strokeWidth={2.5} />
                            </button>
                        </Tooltip>
                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">
                            {filling.snippet.name}
                        </span>
                    </div>

                    <div className="p-3 flex flex-col gap-2.5 overflow-y-auto">
                        {filling.names.map((name, index) => (
                            <label key={name} className="flex flex-col gap-1">
                                <span className="text-[11px] font-semibold text-gray-500 dark:text-neutral-400">
                                    {name}
                                </span>
                                <input
                                    autoFocus={index === 0}
                                    value={values[name] || ''}
                                    onChange={(event) => setValues(previous => ({
                                        ...previous,
                                        [name]: event.target.value,
                                    }))}
                                    spellCheck={false}
                                    className={FIELD_CLASS}
                                />
                            </label>
                        ))}
                    </div>

                    <div className="px-3 py-2.5 border-t border-gray-100 dark:border-surface-control bg-gray-50/80 dark:bg-surface-base/60">
                        <pre className="text-[11px] font-mono text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
                            {filled}
                        </pre>

                        {unanswered.length > 0 && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1.5">
                                {unanswered.length === 1
                                    ? `${unanswered[0]} is empty and will be left as written.`
                                    : `${unanswered.length} values are empty and will be left as written.`}
                            </p>
                        )}

                        <div className="flex items-center justify-between gap-3 mt-2.5">
                            <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                                Esc to go back
                            </span>
                            <button
                                type="button"
                                onClick={confirmFill}
                                className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black text-[13px] font-semibold hover:opacity-90 active:scale-95 transition-all"
                            >
                                {filling.snippet.runImmediately ? 'Insert and run' : 'Insert'}
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <div className="flex items-center gap-2 px-3 h-10 border-b border-gray-100 dark:border-surface-control">
                        <Search01Icon size={14} strokeWidth={2} className="shrink-0 text-gray-400" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={hostName ? `Snippet for ${hostName}` : 'Run a snippet'}
                            spellCheck={false}
                            aria-label="Search snippets"
                            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-white placeholder:text-gray-400"
                        />
                        <span className="shrink-0 text-[10px] font-mono text-gray-400 dark:text-neutral-500">
                            Esc
                        </span>
                    </div>

                    <div className="p-1.5 overflow-y-auto">
                        {loading ? (
                            <p className="px-3 py-6 text-center text-[13px] text-gray-500 dark:text-gray-400">
                                Loading…
                            </p>
                        ) : matches.length === 0 ? (
                            <div className="px-4 py-6 text-center">
                                <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300">
                                    {snippets.length === 0 ? 'No snippets yet' : 'Nothing matches'}
                                </p>
                                <p className="text-[11px] text-gray-500 dark:text-neutral-500 mt-1">
                                    {snippets.length === 0
                                        ? 'Save the commands you retype in the Snippets panel.'
                                        : 'No snippet on this host matches what you typed.'}
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-px">
                                {matches.map((entry, index) => (
                                    <SnippetRow
                                        key={entry.snippet.id}
                                        snippet={entry.snippet}
                                        body={entry.text}
                                        steps={entry.steps}
                                        broken={entry.broken}
                                        active={index === activeIndex}
                                        onPick={() => pick(entry)}
                                        onHover={() => setActiveIndex(index)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {problem && (
                        <p className="px-3 py-2 border-t border-gray-100 dark:border-surface-control flex items-start gap-1.5 text-[11px] text-red-500">
                            <Alert02Icon size={13} strokeWidth={2} className="shrink-0 mt-px" />
                            {problem}
                        </p>
                    )}

                    {matches.length > 0 && (
                        <div className="px-3 py-1.5 border-t border-gray-100 dark:border-surface-control flex items-center justify-between text-[10px] text-gray-400 dark:text-neutral-500">
                            <span>↑↓ move · ⏎ insert</span>
                            <span>{matches.length} of {snippets.length}</span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
