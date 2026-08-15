import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Search01Icon, ArrowUp01Icon, ArrowDown01Icon, Cancel01Icon } from 'hugeicons-react';
import useEnter from '../../hooks/useEnter';
import { PANE_OVERLAY_TOP } from '../../lib/layout';
import Tooltip from '../ui/Tooltip';

/**
 * Find-in-scrollback for one terminal.
 *
 * The buffer is 10,000 lines deep, which is far more than anyone can page
 * through by eye, so this is the only way to reach most of what a session has
 * already printed.
 *
 * Escape is handled here rather than in the terminal's key handler on purpose:
 * while this bar is up it holds DOM focus, so xterm never sees the keystroke
 * and Escape keeps meaning what it means to vim the moment focus goes back.
 */

/**
 * Match highlighting.
 *
 * The addon requires `#RRGGBB` for the two background colours, so these cannot
 * be translucent: they replace the cell background outright while the text
 * keeps the theme's own foreground. That makes the pairing theme-dependent:
 * an amber wash that a light theme's near-black text reads well against is the
 * same wash a dark theme's near-white text disappears into, so the palette is
 * picked from the terminal's own background rather than fixed.
 */
const DARK_DECORATIONS = {
    matchBackground: '#5c4a12',
    matchBorder: '#9a7d1f',
    matchOverviewRuler: '#eab308',
    activeMatchBackground: '#9a5b12',
    activeMatchBorder: '#fb923c',
    activeMatchColorOverviewRuler: '#f97316',
};

const LIGHT_DECORATIONS = {
    matchBackground: '#ffe9a3',
    matchBorder: '#d9a821',
    matchOverviewRuler: '#eab308',
    activeMatchBackground: '#ffc078',
    activeMatchBorder: '#e2760c',
    activeMatchColorOverviewRuler: '#f97316',
};

/** Perceived brightness, so an unparseable colour falls through to "dark". */
function isLight(color) {
    const hex = String(color || '').replace('#', '');
    if (hex.length < 6) return false;

    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    if ([red, green, blue].some(Number.isNaN)) return false;

    return (0.299 * red + 0.587 * green + 0.114 * blue) > 140;
}

const TOGGLES = [
    { id: 'caseSensitive', label: 'Aa', title: 'Match case' },
    { id: 'wholeWord', label: 'ab', title: 'Match whole word' },
    { id: 'regex', label: '.*', title: 'Use regular expression' },
];

function SearchBar({ addon, background, onClose }) {
    const inputRef = useRef(null);

    /** Fades in over the pane rather than appearing. See lib/enterMotion. */
    const barRef = useEnter('fade');
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState({
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const [results, setResults] = useState({ index: -1, count: 0 });
    // A malformed pattern is the user mid-typing, not an error worth a toast.
    const [invalid, setInvalid] = useState(false);

    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
    }, []);

    useEffect(() => {
        if (!addon?.onDidChangeResults) return undefined;
        const subscription = addon.onDidChangeResults((payload) => {
            setResults({
                index: payload?.resultIndex ?? -1,
                count: payload?.resultCount ?? 0,
            });
        });
        return () => subscription?.dispose?.();
    }, [addon]);

    const search = useCallback((direction, { incremental = false } = {}) => {
        if (!addon) return;

        if (!query) {
            addon.clearDecorations?.();
            setResults({ index: -1, count: 0 });
            setInvalid(false);
            return;
        }

        const searchOptions = {
            ...options,
            decorations: isLight(background) ? LIGHT_DECORATIONS : DARK_DECORATIONS,
            incremental,
        };

        try {
            if (direction === 'previous') addon.findPrevious(query, searchOptions);
            else addon.findNext(query, searchOptions);
            setInvalid(false);
        } catch {
            // An unfinished regex ("[", "(?"), which throws out of the addon.
            setInvalid(true);
            setResults({ index: -1, count: 0 });
        }
    }, [addon, query, options, background]);

    // Re-run as the query or the toggles change. `incremental` keeps the
    // viewport where it is while the term is still being typed, so the buffer
    // does not jump on every keystroke.
    useEffect(() => {
        search('next', { incremental: true });
    }, [search]);

    const close = useCallback(() => {
        addon?.clearDecorations?.();
        onClose?.();
    }, [addon, onClose]);

    const handleKeyDown = useCallback((event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            search(event.shiftKey ? 'previous' : 'next');
            return;
        }
        // The chord that opened the bar, pressed again: select the term so it
        // can be replaced outright rather than opening a second one.
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
            event.preventDefault();
            event.stopPropagation();
            inputRef.current?.select();
        }
    }, [close, search]);

    const toggle = useCallback((id) => {
        setOptions(previous => ({ ...previous, [id]: !previous[id] }));
        inputRef.current?.focus();
    }, []);

    const step = useCallback((direction) => {
        search(direction);
        inputRef.current?.focus();
    }, [search]);

    const counter = invalid
        ? 'bad pattern'
        : !query
            ? ''
            : results.count === 0
                ? 'no results'
                // The addon reports -1 for the active index once the highlight
                // threshold is passed, so there is a count but nothing to be
                // "of". Showing `0/1200` there would just be wrong.
                : results.index < 0
                    ? String(results.count)
                    : `${results.index + 1}/${results.count}`;

    return (
        <div
            ref={barRef}
            // Hangs off the pane header rather than the top of the pane, which
            // would put it over the view switcher.
            style={{ top: PANE_OVERLAY_TOP }}
            className="absolute right-3 z-30 flex items-center gap-1 pl-2.5 pr-1.5 py-1.5
                rounded-xl bg-white/95 dark:bg-surface-raised/95 backdrop-blur
                border border-gray-200 dark:border-surface-control shadow-lg"
            role="search"
        >
            <Search01Icon size={14} strokeWidth={2} className="shrink-0 text-gray-400" />

            <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Find in terminal"
                spellCheck={false}
                aria-label="Find in terminal"
                className={`w-44 bg-transparent outline-none text-sm text-gray-900 dark:text-white
                    placeholder:text-gray-400 ${invalid ? 'text-red-500 dark:text-red-400' : ''}`}
            />

            <span
                className={`shrink-0 w-16 text-right text-[11px] font-mono tabular-nums ${
                    invalid || (query && results.count === 0)
                        ? 'text-red-500 dark:text-red-400'
                        : 'text-gray-400 dark:text-neutral-500'
                }`}
            >
                {counter}
            </span>

            <div className="flex items-center gap-0.5 pl-1 ml-0.5 border-l border-gray-200 dark:border-surface-control">
                {TOGGLES.map(({ id, label, title }) => (
                    <Tooltip key={id} label={title}>
                        <button
                            type="button"
                            aria-pressed={options[id]}
                            onClick={() => toggle(id)}
                            className={`w-6 h-6 flex items-center justify-center rounded-md text-[11px] font-mono font-semibold transition-colors ${
                                options[id]
                                    ? 'bg-gray-900 dark:bg-white text-white dark:text-black'
                                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control'
                            }`}
                        >
                            {label}
                        </button>
                    </Tooltip>
                ))}
            </div>

            <div className="flex items-center gap-0.5 pl-1 ml-0.5 border-l border-gray-200 dark:border-surface-control">
                <Tooltip label="Previous match" hint="Shift+Enter">
                    <button
                        type="button"
                        onClick={() => step('previous')}
                        disabled={!query}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors disabled:opacity-30"
                    >
                        <ArrowUp01Icon size={14} strokeWidth={2.5} />
                    </button>
                </Tooltip>
                <Tooltip label="Next match" hint="Enter">
                    <button
                        type="button"
                        onClick={() => step('next')}
                        disabled={!query}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors disabled:opacity-30"
                    >
                        <ArrowDown01Icon size={14} strokeWidth={2.5} />
                    </button>
                </Tooltip>
                <Tooltip label="Close" hint="Esc">
                    <button
                        type="button"
                        onClick={close}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <Cancel01Icon size={14} strokeWidth={2.5} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

export default memo(SearchBar);
