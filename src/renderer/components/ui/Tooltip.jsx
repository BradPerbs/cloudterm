import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEnterOn } from '../../hooks/useEnter';

/**
 * Tooltips for the app's icon-only controls.
 *
 * The native `title` attribute is not good enough here: it waits about a second
 * before appearing, draws itself in the OS's font rather than the app's, and
 * never shows at all on a disabled control, which is precisely the control
 * whose label is worth reading, because it also has to say *why* it is off. A
 * header of bare glyphs is unlabelled for that whole second, so these open on
 * contact instead.
 *
 * Two ways in, because not every trigger can take a wrapper element:
 *
 *   <Tooltip label="Snippets" hint="Ctrl+Shift+K"><button …/></Tooltip>
 *
 *   const { triggerProps, tooltip } = useTooltip({ label: 'Split pane' });
 *   <button {...triggerProps} …/>{tooltip}
 *
 * The second is for triggers whose parent cares what its children are: a
 * `role="tablist"` grid, say, where an extra span would break both the columns
 * and the ARIA.
 */

// Distance from the trigger, and how close the bubble may come to the window
// edge before it is nudged back inside.
const GAP = 8;
const EDGE = 8;

// The arrow stays off the bubble's rounded ends.
const ARROW_INSET = 12;

// Each side grows out of the trigger rather than drifting in from a fixed
// direction. The origin is the bubble's own, so it is left in the style prop;
// the offset is what it travels, so it is handed to `useEnterOn`.
const ENTRANCE = {
    top: { origin: 'bottom center', x: 0, y: 4 },
    bottom: { origin: 'top center', x: 0, y: -4 },
    left: { origin: 'right center', x: 4, y: 0 },
    right: { origin: 'left center', x: -4, y: 0 },
};

// The arrow is a rotated square; only the two edges facing away from the bubble
// carry a border, so it reads as a continuation of the outline.
const ARROW_EDGES = {
    top: 'border-r border-b',
    bottom: 'border-l border-t',
    left: 'border-t border-r',
    right: 'border-b border-l',
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the bubble goes, given the trigger's rectangle and the bubble's own
 * measured size. Flips to the opposite side when the preferred one has no room,
 * then clamps into the window, and reports where the arrow has to sit so that
 * it keeps pointing at the trigger after any nudge.
 */
function place(placement, trigger, bubble) {
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    let side = placement;
    if (side === 'bottom' && trigger.bottom + GAP + bubble.height > viewHeight - EDGE
        && trigger.top - GAP - bubble.height > EDGE) side = 'top';
    else if (side === 'top' && trigger.top - GAP - bubble.height < EDGE
        && trigger.bottom + GAP + bubble.height < viewHeight - EDGE) side = 'bottom';
    else if (side === 'right' && trigger.right + GAP + bubble.width > viewWidth - EDGE
        && trigger.left - GAP - bubble.width > EDGE) side = 'left';
    else if (side === 'left' && trigger.left - GAP - bubble.width < EDGE
        && trigger.right + GAP + bubble.width < viewWidth - EDGE) side = 'right';

    const vertical = side === 'top' || side === 'bottom';

    const top = vertical
        ? (side === 'bottom' ? trigger.bottom + GAP : trigger.top - GAP - bubble.height)
        : trigger.top + trigger.height / 2 - bubble.height / 2;
    const left = vertical
        ? trigger.left + trigger.width / 2 - bubble.width / 2
        : (side === 'right' ? trigger.right + GAP : trigger.left - GAP - bubble.width);

    const placedLeft = clamp(left, EDGE, viewWidth - bubble.width - EDGE);
    const placedTop = clamp(top, EDGE, viewHeight - bubble.height - EDGE);

    const arrow = vertical
        ? clamp(trigger.left + trigger.width / 2 - placedLeft, ARROW_INSET, bubble.width - ARROW_INSET)
        : clamp(trigger.top + trigger.height / 2 - placedTop, ARROW_INSET, bubble.height - ARROW_INSET);

    return { side, top: placedTop, left: placedLeft, arrow };
}

/** The arrow hangs half outside the bubble, centred on `offset`. */
function arrowStyle(side, offset) {
    if (side === 'bottom') return { top: -4, left: offset - 4 };
    if (side === 'top') return { bottom: -4, left: offset - 4 };
    if (side === 'right') return { left: -4, top: offset - 4 };
    return { right: -4, top: offset - 4 };
}

function TooltipBubble({ label, hint, placement, trigger }) {
    const bubbleRef = useRef(null);
    const [position, setPosition] = useState(null);

    // Layout effect, not an effect: the bubble has to be measured and moved
    // before the browser paints, or it flashes at the top-left of the window
    // on the way to where it belongs.
    useLayoutEffect(() => {
        const element = bubbleRef.current;
        if (!element) return;
        setPosition(place(placement, trigger, {
            width: element.offsetWidth,
            height: element.offsetHeight,
        }));
    }, [placement, trigger]);

    const side = position?.side || placement;

    // Read on mount, so this is the side asked for rather than the side the
    // measuring above may have flipped it to. The two only differ when the
    // bubble did not fit, and by then it has already started coming out.
    useEnterOn(bubbleRef, 'tooltip', { x: ENTRANCE[side].x, y: ENTRANCE[side].y });

    return createPortal(
        <div
            ref={bubbleRef}
            role="tooltip"
            // Never a hover target itself: a bubble that could take the pointer
            // would flicker the moment it grew under it.
            // The shadow is deliberately lighter than the menus': those are
            // large surfaces that have to sit clearly above the page, whereas
            // this is a chip the size of its own text, and the same drop under
            // it reads as a smudge rather than a lift.
            className="fixed z-[10000] pointer-events-none
                flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                bg-white dark:bg-surface-raised
                border border-gray-200 dark:border-surface-control
                shadow-[0_2px_8px_rgba(0,0,0,0.07)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.22)]
                text-[11px] font-medium leading-none whitespace-nowrap
                text-gray-700 dark:text-gray-200"
            style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                // Rendered once before it is measured, so hold it back for that
                // frame rather than letting it show up in the wrong place.
                visibility: position ? 'visible' : 'hidden',
                transformOrigin: ENTRANCE[side].origin,
            }}
        >
            <span
                aria-hidden="true"
                className={`absolute w-2 h-2 rotate-45
                    bg-white dark:bg-surface-raised
                    border-gray-200 dark:border-surface-control
                    ${ARROW_EDGES[side]}`}
                style={arrowStyle(side, position?.arrow ?? ARROW_INSET)}
            />

            <span className="relative">{label}</span>

            {/* Same treatment the menu gives its shortcuts, so a chord looks
                like the same kind of thing wherever it is shown. */}
            {hint && (
                <span className="relative text-[10px] tabular-nums text-gray-400 dark:text-neutral-500">
                    {hint}
                </span>
            )}
        </div>,
        document.body
    );
}

/**
 * The tooltip behaviour on its own, for triggers that cannot be wrapped.
 *
 * Returns handlers to spread onto the trigger and the bubble to render. The
 * trigger's rectangle is read from the event, so nothing here needs a ref.
 */
export function useTooltip({ label, hint, placement = 'bottom', enabled = true } = {}) {
    const [trigger, setTrigger] = useState(null);

    const show = useCallback((event) => {
        const element = event.currentTarget;
        if (element) setTrigger(element.getBoundingClientRect());
    }, []);

    const hide = useCallback(() => setTrigger(null), []);

    // A label that goes away, or a trigger that is switched off, takes any
    // bubble it had open with it.
    const live = enabled && Boolean(label);
    useEffect(() => {
        if (!live) setTrigger(null);
    }, [live]);

    // The rectangle was measured once, so anything that could have moved the
    // trigger since dismisses rather than points at the wrong place.
    useEffect(() => {
        if (!trigger) return;

        const dismiss = () => setTrigger(null);
        const handleKey = (event) => {
            if (event.key === 'Escape') dismiss();
        };

        window.addEventListener('blur', dismiss);
        window.addEventListener('resize', dismiss);
        // Capture: most of what scrolls in this app is an inner panel, and a
        // scroll inside one does not bubble.
        document.addEventListener('scroll', dismiss, true);
        document.addEventListener('keydown', handleKey, true);

        return () => {
            window.removeEventListener('blur', dismiss);
            window.removeEventListener('resize', dismiss);
            document.removeEventListener('scroll', dismiss, true);
            document.removeEventListener('keydown', handleKey, true);
        };
    }, [trigger]);

    const triggerProps = {
        onMouseEnter: live ? show : undefined,
        onMouseLeave: hide,
        onFocus: (event) => {
            // Keyboard focus only. Clicking a button focuses it too, and a
            // label left hanging over the panel that click just opened is in
            // the way of the thing it was explaining.
            if (live && event.currentTarget.matches?.(':focus-visible')) show(event);
        },
        onBlur: hide,
        // The button has been pressed; its label has done its job.
        onMouseDown: hide,
    };

    return {
        triggerProps,
        tooltip: live && trigger
            ? <TooltipBubble label={label} hint={hint} placement={placement} trigger={trigger} />
            : null,
    };
}

/**
 * Wraps a single element. `label` is the name, `hint` an optional shortcut
 * shown dimmed beside it.
 */
export default function Tooltip({
    label,
    hint,
    placement = 'bottom',
    enabled = true,
    className = '',
    children,
}) {
    const { triggerProps, tooltip } = useTooltip({ label, hint, placement, enabled });

    if (!isValidElement(children)) return children ?? null;

    const disabled = Boolean(children.props.disabled);
    const patch = {};

    // A disabled control does not dispatch pointer events at all, so the
    // wrapper would never hear the hover. Taking the element out of hit
    // testing hands them to the wrapper instead; it cannot be clicked either
    // way, and the cursor moves up with them.
    if (disabled) {
        patch.className = `${children.props.className || ''} pointer-events-none`;
    }

    // The `title` this replaces was also naming the control for assistive
    // tech. Anything already named keeps the name it has.
    if (typeof label === 'string' && !children.props['aria-label'] && !children.props['aria-labelledby']) {
        patch['aria-label'] = hint ? `${label} (${hint})` : label;
    }

    return (
        <span
            {...triggerProps}
            className={`inline-flex shrink-0 ${disabled ? 'cursor-not-allowed' : ''} ${className}`}
        >
            {Object.keys(patch).length ? cloneElement(children, patch) : children}
            {tooltip}
        </span>
    );
}
