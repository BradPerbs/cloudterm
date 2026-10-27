import { useRef, useState } from 'react';
import { useTooltip } from '../ui/Tooltip';
import { effortLabel } from '../../lib/ai-catalog';
import { useT } from '../../i18n';

/**
 * How hard to think, as a dial rather than a list.
 *
 * The five settings are one scale, and a list of five radio rows says
 * otherwise: it makes "low" and "max" look like five different things to
 * choose between rather than two ends of the same run, and it costs five rows
 * of a menu that also has to hold the models. A track says "more of this" in
 * the space of one line, and the stops keep it honest about there being five
 * of them and nothing in between.
 *
 * A row of segmented pills was the other way to draw it, and was dropped for
 * one reason: the scale is two to six stops with names as long as "Extra
 * high" in some languages, and six equal pills in the model menu either cut
 * those names off or shrink to taps. The track carries any number of stops
 * and any length of name, because the names live in the heading above it and
 * in the stops' tooltips.
 *
 * Built by hand rather than out of `input[type=range]`, which is what this was
 * first, for one reason: every stop has to be able to say its own name before
 * it is picked. A range input is a single hit area, so the labels would have
 * had to be a bubble chasing the pointer along it, and anything laid over the
 * input to catch a hover would have eaten the drag. Here the whole track is
 * one pointer handler and the stops are only hover targets on top of it, so
 * pressing on one still starts a drag: the press reaches the track underneath
 * by bubbling, which is the thing a native input could not offer.
 *
 * That leaves the keyboard and the screen reader to do by hand, which is the
 * block at the bottom: `role="slider"`, the arrows, Home and End.
 *
 * The movement is most of the look: a fill that sweeps from the left edge to
 * the thumb, stops that light up as it passes them, and a thumb that slides
 * rather than jumps and swells slightly while it is held. A click three stops
 * away is a move along the scale and should look like one.
 *
 * It acts on whatever `onChange` is handed, which in the composer is the
 * conversation's own effort: moving it in one tab leaves the others alone.
 */

/**
 * How far the middle of an end stop sits from the end of the track, which is
 * the thumb's radius plus enough that it does not look wedged into the corner.
 */
const INSET = 15;

/**
 * One stop.
 *
 * Its own component because each needs its own tooltip state, and a hook
 * cannot be called in a loop by the parent. The hit area is far wider than the
 * dot: a 4px target is a thing you hunt for, and the tooltip is the whole
 * point of these being here.
 */
function Stop({ option, left, tone }) {
    const { triggerProps, tooltip } = useTooltip({
        label: effortLabel(option),
        placement: 'top',
    });

    return (
        <span
            {...triggerProps}
            className="absolute top-0 bottom-0 w-7 -translate-x-1/2 flex items-center justify-center"
            style={{ left }}
        >
            <span aria-hidden="true" className={`w-1 h-1 rounded-full transition-colors duration-200 ${tone}`} />
            {tooltip}
        </span>
    );
}

export default function EffortSlider({ options, value, onChange }) {
    const t = useT();
    const trackRef = useRef(null);
    const [dragging, setDragging] = useState(false);

    const found = options.findIndex(option => option.value === value);
    const index = found < 0 ? 0 : found;
    const last = options.length - 1;

    // The travel is divided by the gaps between stops, and a scale with one
    // stop has none. Kept at 1 so the arithmetic stays finite; `last` is still
    // what indexes the list.
    const gaps = Math.max(1, last);

    /** Where a stop sits, as a css length, so the track stays fluid. */
    const at = (position) => `calc(${INSET}px + ${(position / gaps).toFixed(4)} * (100% - ${INSET * 2}px))`;

    /** The stop nearest a point on the track. */
    const pick = (clientX) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect) return;
        const span = rect.width - INSET * 2;
        const ratio = span > 0 ? (clientX - rect.left - INSET) / span : 0;
        const next = Math.min(last, Math.round(Math.min(1, Math.max(0, ratio)) * gaps));
        if (options[next].value !== value) onChange(options[next].value);
    };

    const onPointerDown = (event) => {
        // Claimed for the whole gesture, so a drag that wanders off the track,
        // or off the menu entirely, still steers it until the button is let go.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        setDragging(true);
        pick(event.clientX);
    };

    const onPointerMove = (event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event.clientX);
    };

    const endDrag = (event) => {
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const onKeyDown = (event) => {
        const STEPS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
        let next = null;
        if (STEPS[event.key]) next = index + STEPS[event.key];
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = last;
        if (next === null) return;

        event.preventDefault();
        next = Math.min(last, Math.max(0, next));
        if (next !== index) onChange(options[next].value);
    };

    // The far end is the one with a price on it, in the colour this panel
    // already uses to mean "this one has a cost": the same amber as a call
    // waiting on you. Only the fill turns amber, and only while sitting
    // there: a permanent amber stop shouts over the thumb. The thumb stays
    // white throughout, so it is always the brightest thing on the track; at
    // the far end it glows amber and pulses, since the stop it sits on is
    // covered and cannot do the signalling itself.
    const atMax = index === last && last > 0;

    return (
        <div className="px-2.5 pt-0.5 pb-2">
            <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                aria-label={t('assistant.effort')}
                aria-valuemin={0}
                aria-valuemax={last}
                aria-valuenow={index}
                aria-valuetext={effortLabel(options[index])}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKeyDown}
                className={`relative h-8 rounded-full select-none touch-none
                    outline-none transition-colors
                    bg-gray-900/[0.06] dark:bg-black/25
                    ring-1 ring-black/[0.04] dark:ring-white/[0.06]
                    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                    ${dragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
            >
                {/* The fill, sweeping from the left edge to the thumb. First,
                    so the stops draw over it and the thumb covers its end. In
                    the app's own colours, so a retinted app retints it too. */}
                <span
                    aria-hidden="true"
                    className={`absolute top-[3px] bottom-[3px] left-[3px] rounded-full pointer-events-none
                        transition-[width,background-color] duration-200 ease-out
                        ${atMax ? 'bg-amber-500' : 'bg-gray-800 dark:bg-surface-active'}`}
                    style={{ width: `calc(${at(index)} - 3px)` }}
                />

                {options.map((option, position) => (
                    <Stop
                        key={option.value}
                        option={option}
                        left={at(position)}
                        tone={position <= index
                            ? 'bg-white/80'
                            : 'bg-gray-900/25 dark:bg-white/25'}
                    />
                ))}

                {/* Last, so it covers the stop it is sitting on. Sliding rather
                    than jumping, swelling slightly while held, glowing amber
                    and pulsing at the far end where the price is. */}
                <span
                    aria-hidden="true"
                    className={`absolute top-1/2 w-6 h-6 rounded-full pointer-events-none
                        -translate-x-1/2 -translate-y-1/2
                        transition-[left,transform,box-shadow] duration-200 ease-out
                        bg-white ring-1 ring-black/10
                        ${dragging ? 'scale-110' : ''}
                        ${atMax
                            ? 'shadow-[0_2px_14px_rgba(245,158,11,0.8)] animate-pulse'
                            : 'shadow-[0_2px_8px_rgba(0,0,0,0.35)]'}`}
                    style={{ left: at(index) }}
                />
            </div>
        </div>
    );
}
