import { useRef } from 'react';
import { useTooltip } from '../ui/Tooltip';

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
 */

/**
 * How far the middle of an end stop sits from the end of the track, which is
 * the thumb's radius plus enough that it does not look wedged into the corner.
 */
const INSET = 12;

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
        label: option.label,
        placement: 'top',
    });

    return (
        <span
            {...triggerProps}
            className="absolute top-0 bottom-0 w-7 -translate-x-1/2 flex items-center justify-center"
            style={{ left }}
        >
            <span aria-hidden="true" className={`w-1 h-1 rounded-full ${tone}`} />
            {tooltip}
        </span>
    );
}

export default function EffortSlider({ options, value, onChange }) {
    const trackRef = useRef(null);

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
        pick(event.clientX);
    };

    const onPointerMove = (event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event.clientX);
    };

    const onPointerUp = (event) => {
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

    return (
        <div className="px-2.5 pt-0.5 pb-2">
            <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                aria-label="Effort"
                aria-valuemin={0}
                aria-valuemax={last}
                aria-valuenow={index}
                aria-valuetext={options[index].label}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onKeyDown={onKeyDown}
                className="relative h-6 rounded-full cursor-pointer select-none touch-none
                    outline-none transition-colors
                    bg-gray-900/[0.06] dark:bg-black/25
                    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
            >
                {options.map((option, position) => (
                    <Stop
                        key={option.value}
                        option={option}
                        left={at(position)}
                        // The far end is the one with a price on it, in the
                        // colour this panel already uses to mean "this one has
                        // a cost": the same amber as a call waiting on you.
                        tone={position === last
                            ? 'bg-amber-500'
                            : 'bg-gray-900/30 dark:bg-white/30'}
                    />
                ))}

                {/* Last, so it covers the stop it is sitting on. Sliding rather
                    than jumping, because a click three stops away is a move
                    along the scale and should look like one.

                    It takes the amber with it at the far end: the thumb hides
                    whichever stop it is on, and the one marking would be worth
                    seeing when you are actually sitting on it. */}
                <span
                    aria-hidden="true"
                    className={`absolute top-1/2 w-4 h-4 rounded-full pointer-events-none
                        -translate-x-1/2 -translate-y-1/2
                        transition-[left] duration-150 ease-out
                        shadow-[0_1px_3px_rgba(0,0,0,0.35)]
                        ${index === last ? 'bg-amber-500' : 'bg-gray-900 dark:bg-white'}`}
                    style={{ left: at(index) }}
                />
            </div>
        </div>
    );
}
