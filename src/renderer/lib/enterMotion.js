import { gsap } from 'gsap';
import { cubicBezier, seconds } from './motion';

/**
 * The small self-contained movements: everything in the app that arrives on
 * screen and plays its way in, plus the two that answer an action rather than
 * an arrival, the press ripple and a section folding open.
 *
 * These were a class each in input.css, `animate-dialog-in` and the rest, which
 * is a pleasant way to write them and a poor way to control them. A CSS
 * animation cannot be told to stop halfway, cannot report that it finished
 * without a name-checked event listener, and replays in full any time React
 * rebuilds the element for a reason of its own. Every one of them is a tween
 * now, and `useEnter` is how a component asks for one.
 *
 * ## Why `fromTo` and not `from`
 *
 * Both ends are written out. `gsap.from` reads the element as it stands to work
 * out where the movement should finish, which is correct exactly once: play it
 * twice over the same element, as StrictMode does on every mount, and the
 * second reads the first one's opening frame as the state it should be aiming
 * for. An entrance always ends in the same place, fully on and untransformed,
 * so there is nothing to be gained by asking.
 *
 * ## Why they clear up after themselves
 *
 * An entrance is over once it is over. `clearProps` hands the transform and the
 * opacity back to the stylesheet at the end, so nothing is left holding an
 * inline value that a later hover or a Tailwind class then has to fight. It is
 * also what lets the selection bar keep being centred by `-translate-x-1/2`
 * once it has risen into place.
 */

/** CSS's own `ease-out`, which several of these were written against. */
const EASE_OUT = cubicBezier(0, 0, 0.58, 1);

/** The app's house curve, on everything that should settle rather than stop. */
const EASE_SOFT = cubicBezier(0.16, 1, 0.3, 1);

/** A shade firmer, for the things that travel further. */
const EASE_LIFT = cubicBezier(0.22, 1, 0.36, 1);

/**
 * Where each kind of thing comes from, and how long it takes.
 *
 * `scale` and `y` are GSAP's own shorthands rather than a transform string, so
 * two of them can be interpolated separately and neither has to know the
 * other's units.
 */
const ENTRANCE = {
    /** Backdrops, popovers and anything that should simply be there. */
    fade: { ms: 200, ease: EASE_OUT, from: { opacity: 0 } },

    /** Dialogs, menus and the select list: up and out of nothing. */
    dialog: { ms: 180, ease: EASE_SOFT, from: { opacity: 0, scale: 0.97, y: 6 } },

    /** A right-click menu, which comes down from where it was asked for. */
    menu: { ms: 150, ease: EASE_OUT, from: { opacity: 0, scale: 0.95, y: -5 } },

    /**
     * Tooltips open the instant the pointer lands, so this has to be short
     * enough not to become the delay it was meant to replace. The offset it
     * grows from is passed in per side, so the bubble comes out of its trigger
     * rather than drifting in from a fixed direction.
     */
    tooltip: { ms: 120, ease: EASE_SOFT, from: { opacity: 0, scale: 0.96 } },

    /**
     * The hosts page selection bar, which rises because it appears under the
     * cursor rather than where the pointer is looking, and something that
     * simply exists on the next frame reads as a repaint rather than an answer.
     * `xPercent` is its own centring, held across the movement and handed back
     * to the stylesheet at the end.
     */
    selection: { ms: 180, ease: EASE_LIFT, from: { opacity: 0, y: 12, xPercent: -50 } },

    /** The connecting splash and the session screen's other faces. */
    connect: { ms: 350, ease: EASE_SOFT, from: { opacity: 0, y: 6 } },
};

/** Where every entrance ends, whatever it started from. */
const ARRIVED = { opacity: 1, scale: 1, x: 0, y: 0 };

/**
 * Play a thing in. `from` takes anything the caller has to work out for itself,
 * which is the tooltip's offset and nothing else so far.
 */
export function playEnter(node, kind, from) {
    const step = ENTRANCE[kind];
    if (!node || !step) return null;

    return gsap.fromTo(
        node,
        { ...step.from, ...from },
        {
            ...ARRIVED,
            // Held rather than animated away: it is what centres the element,
            // not part of the movement.
            xPercent: step.from.xPercent ?? 0,
            duration: seconds(step.ms),
            ease: step.ease,
            clearProps: 'opacity,transform',
            overwrite: 'auto',
        },
    );
}

/**
 * Land an entrance at once.
 *
 * StrictMode mounts, unmounts and remounts, so the cleanup has to leave the
 * element where the entrance would have left it. Merely killing the tween would
 * strand it at whatever frame it had reached, and since these run `clearProps`
 * at the end, being stranded means keeping an inline opacity of nearly zero
 * over an element that is meant to be on screen.
 */
export function finishEnter(tween) {
    if (!tween) return;
    tween.progress(1);
    tween.kill();
}

/**
 * The circle that spreads from where a control was pressed.
 *
 * Linear on purpose: it is a ripple across a surface, not something arriving,
 * and easing it makes it read as a shape rather than as a spread. It takes
 * itself out of the DOM at the end, which is what the `animationend` listener
 * this replaced was for.
 */
export function playRipple(node) {
    if (!node) return null;

    return gsap.fromTo(
        node,
        { scale: 0, opacity: 1 },
        {
            scale: 4,
            opacity: 0,
            duration: seconds(600),
            ease: 'none',
            onComplete: () => node.remove(),
        },
    );
}

/**
 * The thumb under a segmented control, moving to the segment now chosen.
 *
 * Moved by whole multiples of its own width, so it stays exact at any segment
 * count, and through `xPercent` rather than a percentage in a transform string,
 * so GSAP is interpolating a number rather than reparsing a string each frame.
 */
export function slideThumb(node, index, animate) {
    if (!node) return null;

    const to = { xPercent: Math.max(index, 0) * 100, opacity: index < 0 ? 0 : 1 };
    if (!animate) return gsap.set(node, to);

    return gsap.to(node, {
        ...to,
        duration: seconds(200),
        ease: cubicBezier(0.16, 1, 0.3, 1),
        overwrite: 'auto',
    });
}

/**
 * A section folding open or shut.
 *
 * `height: 'auto'` is GSAP's, and it is the whole reason this is worth doing
 * here: it measures the natural height, animates the pixels, and puts `auto`
 * back at the end, so the section is free to grow afterwards. Held at a
 * measured pixel height instead, a block that later gained a line would keep
 * the old one and clip it.
 */
export function foldSection(node, open, onComplete) {
    if (!node) return null;

    const move = {
        duration: seconds(250),
        ease: cubicBezier(0.4, 0, 0.2, 1),
        overwrite: 'auto',
        onComplete,
    };

    return open
        ? gsap.fromTo(node, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, ...move })
        : gsap.to(node, { height: 0, opacity: 0, ...move });
}
