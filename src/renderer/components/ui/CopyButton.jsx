import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy01Icon, Tick01Icon } from 'hugeicons-react';

/**
 * Take one string to the clipboard, and say that it went.
 *
 * A bare icon with no chrome of its own, hidden until the block it belongs to
 * is hovered: it sits on top of code and command output, where anything with a
 * fill or a border is a second object competing with the thing being copied.
 * The parent must therefore carry `group`, and this stays visible while it has
 * keyboard focus so it is reachable without a pointer.
 *
 * The confirmation is the icon becoming a tick for a moment, rather than a
 * toast. Copying a command and then the path it printed is two clicks a second
 * apart, and a bubble in the corner of the window for each of them is noise
 * reporting the thing you are already looking at.
 *
 * `navigator.clipboard` first, with the main process as the fallback: the
 * former needs a secure context and a live user gesture, both of which a click
 * in a packaged app has, and the latter is there for when it does not.
 */

/** How long the tick stays up. Long enough to notice, short enough to forget. */
const CONFIRM_MS = 1400;

export default function CopyButton({ text, label = 'Copy', className = '' }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef(0);

    // A block can be collapsed or scrolled out of the transcript while the tick
    // is up, and a timer firing into an unmounted component is a warning in the
    // console and a leak in principle.
    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = useCallback(async (event) => {
        // The output of a tool call sits inside a row that toggles when it is
        // clicked, so this must not read as a click on that.
        event.preventDefault();
        event.stopPropagation();

        const body = String(text ?? '');
        if (!body) return;

        try {
            await navigator.clipboard.writeText(body);
        } catch {
            try {
                await window.api?.clipboard?.writeText?.(body);
            } catch {
                // Nothing to say that the tick not appearing does not say.
                return;
            }
        }

        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
    }, [text]);

    return (
        <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copied' : label}
            title={copied ? 'Copied' : label}
            className={`w-5 h-5 flex items-center justify-center rounded shrink-0
                select-none transition-all outline-none
                focus-visible:ring-1 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                ${copied
                    ? 'opacity-100 text-gray-700 dark:text-gray-300'
                    : `opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                       text-gray-400 dark:text-gray-600
                       hover:text-gray-900 dark:hover:text-gray-200`}
                ${className}`}
        >
            {copied
                ? <Tick01Icon size={12} strokeWidth={2.5} />
                : <Copy01Icon size={12} strokeWidth={2} />}
        </button>
    );
}
