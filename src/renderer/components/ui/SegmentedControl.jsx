import { useCallback, useLayoutEffect, useRef } from 'react';
import { slideThumb } from '../../lib/enterMotion';
import { useTooltip } from './Tooltip';

const SIZES = {
    sm: { height: 'h-6', pad: 'px-2.5', text: 'text-[10px]', gap: 'gap-1' },
    md: { height: 'h-7', pad: 'px-3', text: 'text-[11px]', gap: 'gap-1.5' },
};

const BADGE_TONES = {
    info: 'bg-blue-500',
    danger: 'bg-red-500',
};

/**
 * A segmented switch: one recessed track, one thumb that slides to whichever
 * segment is live. Sliding rather than repainting is the whole point. The
 * movement is what tells you the two options are one control with one answer,
 * where two independently-filled buttons just look like two buttons.
 *
 * Segments are `{ value, label, icon?, disabled?, badge?, badgeTone?, title? }`.
 * `badgeTone` is 'info' (default) or 'danger', for a count that means something
 * went wrong rather than something is in progress. `title` is the tooltip: the
 * one thing a segment that has shed its text label still has to say.
 */
export default function SegmentedControl({
    segments,
    value,
    onChange,
    size = 'md',
    ariaLabel,
    className = '',
}) {
    const { height, pad, text, gap } = SIZES[size] || SIZES.md;
    const listRef = useRef(null);
    const thumbRef = useRef(null);

    const activeIndex = segments.findIndex(segment => segment.value === value);

    /**
     * The thumb's place is GSAP's, so it is not in a `style` prop: a re-render
     * mid-slide would write the far end of the movement straight onto it. The
     * first draw puts it where it belongs without animating, so a control that
     * opens on its second segment does not slide there from the first.
     */
    const shown = useRef(null);

    useLayoutEffect(() => {
        slideThumb(thumbRef.current, activeIndex, shown.current !== null);
        shown.current = activeIndex;
    }, [activeIndex]);

    /** Arrow keys walk the tablist, skipping anything disabled. */
    const handleKeyDown = useCallback((event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;

        event.preventDefault();

        const total = segments.length;
        for (let offset = 1; offset <= total; offset++) {
            const index = (activeIndex + step * offset + total * offset) % total;
            const candidate = segments[index];
            if (candidate && !candidate.disabled) {
                onChange(candidate.value);
                listRef.current?.querySelectorAll('[role="tab"]')[index]?.focus();
                return;
            }
        }
    }, [segments, activeIndex, onChange]);

    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label={ariaLabel}
            onKeyDown={handleKeyDown}
            className={`relative inline-grid p-[3px] rounded-[10px] border
                bg-gray-100 dark:bg-surface-base
                border-gray-200/70 dark:border-surface-control ${className}`}
            style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
        >
            {/* The thumb. One segment wide, moved by whole multiples of itself,
                so the transform stays exact at any segment count. */}
            <span
                ref={thumbRef}
                aria-hidden="true"
                className="absolute top-[3px] bottom-[3px] left-[3px] rounded-[7px]
                    bg-white dark:bg-surface-control
                    shadow-[0_1px_2px_rgba(0,0,0,0.07)]
                    ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
                style={{ width: `calc((100% - 6px) / ${segments.length})` }}
            />

            {segments.map((segment) => (
                <Segment
                    key={segment.value}
                    segment={segment}
                    isActive={segment.value === value}
                    onSelect={onChange}
                    sizing={{ height, pad, text, gap }}
                />
            ))}
        </div>
    );
}

/**
 * One segment.
 *
 * Its own component only so that it can hold a tooltip's state: a hook cannot
 * be called from inside the map above, and the tab has to stay a direct child
 * of the tablist for both the grid columns and the ARIA to survive, so there
 * is nowhere to put a wrapper.
 */
function Segment({ segment, isActive, onSelect, sizing }) {
    const { height, pad, text, gap } = sizing;
    const { triggerProps, tooltip } = useTooltip({ label: segment.title });

    return (
        <>
            <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={segment.label ? undefined : segment.title}
                tabIndex={isActive ? 0 : -1}
                // `aria-disabled` rather than `disabled`: a disabled control
                // dispatches no pointer events, and an unavailable segment is
                // the one whose tooltip actually has something to say: it is
                // where "Connect to browse files" is written. Arrow-key
                // navigation reads the segment list, not the DOM, so it still
                // skips this one.
                aria-disabled={segment.disabled || undefined}
                onClick={() => { if (!segment.disabled) onSelect(segment.value); }}
                {...triggerProps}
                className={`relative z-10 flex items-center justify-center rounded-[7px]
                    font-semibold whitespace-nowrap outline-none
                    transition-colors duration-150
                    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                    ${height} ${pad} ${text} ${gap}
                    ${isActive
                        ? 'text-gray-900 dark:text-white'
                        : segment.disabled
                            ? 'text-gray-400/70 dark:text-neutral-600 cursor-not-allowed'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
            >
                {segment.icon}
                {segment.label}

                {/* Positioned out of flow so the control does not
                    resize, or jump, when a badge appears. */}
                {segment.badge > 0 && (
                    <span
                        className={`absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1
                            rounded-full text-white
                            text-[9px] font-bold leading-none tabular-nums
                            flex items-center justify-center
                            ring-2 ring-white dark:ring-surface-raised
                            ${BADGE_TONES[segment.badgeTone] || BADGE_TONES.info}`}
                    >
                        {segment.badge > 9 ? '9+' : segment.badge}
                    </span>
                )}
            </button>
            {tooltip}
        </>
    );
}
