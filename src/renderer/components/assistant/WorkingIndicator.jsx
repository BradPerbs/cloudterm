import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { activityOf } from '../../lib/tool-bucket';
import { prefersReducedMotion } from '../../lib/motion';
import { useT } from '../../i18n';

/**
 * The line under the transcript while a turn is open and nothing is on screen
 * saying so: no words streaming, or words that have stopped for a moment, and
 * no question standing.
 *
 * It says what kind of work is going on, not just that some is. The phrase is
 * drawn from the tool that is running right now, so a command reads as work in
 * the shell and an edit as writing, and between tools it falls back to
 * thinking. The phrase turns over every few seconds, because a line that never
 * changes looks stuck by the tenth second, and after a few seconds the time
 * the turn has taken shows beside it for the same reason.
 *
 * The ring is exported for the tab strip, which turns the same one on a tab
 * whose chat is working, so the two read as one thing.
 */

/** How often the phrase turns over, in ms. */
const TURN_EVERY = 2600;

/** How long one phrase takes to roll out and the next to roll in, in ms. */
const ROLL = 240;

/** The newest call still running, or null between calls. */
function runningTool(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item.kind === 'user') return null;
        if (item.kind === 'tool' && item.status === 'running') return item;
    }
    return null;
}

/** When the turn in progress started: the message that opened it. */
function turnStart(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item.kind === 'user') return Number(item.id) || 0;
    }
    return 0;
}

/** Seconds as "12s" or "1m 04s". */
export function elapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** Whole seconds since `since`, ticking. */
function useSeconds(since) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return Math.max(0, Math.floor((now - since) / 1000));
}

/** A thin ring with a quarter of it drawn in, turning. Still, for reduced motion. */
export function Ring({ className = '' }) {
    return (
        <svg viewBox="0 0 12 12" className={`working-ring w-3 h-3 shrink-0 ${className}`} aria-hidden="true">
            <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
            <circle
                cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeDasharray="7.5 30"
            />
        </svg>
    );
}

/**
 * One phrase from the list for a kind of work, turning over every few
 * seconds. A new kind of work starts on a random phrase, so two turns in a
 * row do not open with the same words. Held still for reduced motion.
 */
function usePhrase(activity) {
    const t = useT();
    const phrases = useMemo(
        () => t(`assistant.working.${activity}`).split('|').map(phrase => phrase.trim()).filter(Boolean),
        [t, activity],
    );

    const [turn, setTurn] = useState(() => Math.floor(Math.random() * 1000));
    useEffect(() => {
        setTurn(Math.floor(Math.random() * 1000));
        if (prefersReducedMotion()) return undefined;
        const timer = setInterval(() => setTurn(value => value + 1), TURN_EVERY);
        return () => clearInterval(timer);
    }, [activity]);

    return `${phrases[turn % phrases.length] || t('assistant.working')}…`;
}

/**
 * A phrase with a glint passing over it, rolling up out of its cell when it
 * changes, with the new one rolling in under it.
 */
function RollingPhrase({ text }) {
    // The outgoing phrase stays for one roll, sharing the cell with the new
    // one, so the change reads as a single motion rather than a swap. Laid
    // out before paint, so the new phrase is never seen standing still for a
    // frame before its entrance starts.
    const shown = useRef(text);
    const rolls = useRef(0);
    const [leaving, setLeaving] = useState(null);
    useLayoutEffect(() => {
        if (shown.current === text) return undefined;
        const previous = shown.current;
        shown.current = text;
        if (prefersReducedMotion()) return undefined;
        rolls.current += 1;
        setLeaving({ text: previous, key: rolls.current });
        const timer = setTimeout(() => setLeaving(null), ROLL);
        return () => clearTimeout(timer);
    }, [text]);

    // The cell's width is eased to the new phrase's, so the clock beside it
    // glides over instead of jumping when the old one leaves.
    const current = useRef(null);
    const [width, setWidth] = useState(null);
    useLayoutEffect(() => {
        setWidth(current.current?.offsetWidth ?? null);
    }, [text]);

    return (
        <span className="working-cell" style={width ? { width } : undefined}>
            {leaving && (
                <span key={`out:${leaving.key}`} className="working-phrase working-out" aria-hidden="true">
                    {leaving.text}
                </span>
            )}
            <span
                key={`in:${text}`}
                ref={current}
                className={`working-phrase ${leaving ? 'working-in' : ''}`}
            >
                {text}
            </span>
        </span>
    );
}

export default function WorkingIndicator({ items }) {
    const t = useT();
    const tool = runningTool(items);
    const phrase = usePhrase(tool ? activityOf(tool.name) : 'think');

    // From the start of the turn rather than from when this line appeared: it
    // comes and goes as the reply streams and pauses, and a clock that went
    // back to nothing each time would say the turn was younger than it is.
    const [mounted] = useState(() => Date.now());
    const seconds = useSeconds(turnStart(items) || mounted);

    return (
        <div
            role="status"
            aria-label={t('assistant.working')}
            className="flex items-center gap-2 h-8 px-2.5 text-[11px] select-none
                text-gray-400 dark:text-gray-500"
        >
            <Ring />
            <RollingPhrase text={phrase} />
            {seconds >= 3 && (
                <span className="tabular-nums text-gray-400/70 dark:text-gray-600">
                    {elapsed(seconds)}
                </span>
            )}
        </div>
    );
}
