import { gsap } from 'gsap';
import { cubicBezier, prefersReducedMotion, seconds } from './motion';

/**
 * Everything the tab strip animates, in one place, driven by GSAP.
 *
 * The strip used to do this from the stylesheet: a `transition` on the widths,
 * a keyframe each for opening and closing, and the Web Animations API for the
 * slides a drag makes. All of it is GSAP now, playing the same movements over
 * the same beats, so there is one thing to reach for when a tab has to move and
 * one place that decides how long it takes.
 *
 * ## Who owns a tab's width
 *
 * GSAP does, and it writes it inline. That is the whole reason the widths could
 * come out of the stylesheet: a CSS rule keyed on `[data-active]` lands the new
 * width the moment React commits the attribute, which is before any tween could
 * have started from the old one. An inline value written here is not disturbed
 * by the attribute changing underneath it, so a tween always begins from what is
 * actually on screen.
 *
 * `.session-tab` in input.css still carries the same numbers. They are what a
 * tab is sized by before its first tween has run, and what a tab being renamed
 * is sized by, since that is a different element and never gets an inline size.
 * Change the numbers in one place and change them in the other.
 *
 * ## What is still the stylesheet's
 *
 * Background and text colour. They are driven by `:hover` and by Tailwind's own
 * classes, which GSAP has no way to intercept, and they are cheap: colour is a
 * paint, not a layout.
 */

/** The two curves the strip moves on, as the stylesheet had them. */
const EASE_TAB = cubicBezier(0.16, 1, 0.3, 1);
const EASE_SLIDE = cubicBezier(0.22, 1, 0.36, 1);

/** The stylesheet's own numbers, in milliseconds. `seconds` converts. */
const DURATION = {
    // Long enough to read as the tab arriving, short enough not to hold up the
    // session behind it.
    open: 260,
    collapse: 200,
    // A change of focus is a change of width, and it travels the same distance
    // as an opening tab does, so it takes the same time.
    resize: 260,
    // The slide a displaced tab makes towards the place it has been given.
    // Shorter than a resize: it happens under a pointer that is still moving.
    slide: 200,
    plus: 260,
};

/**
 * Which tween on a tab is which, so a pass over the strip can end one kind of
 * movement without touching the others. Stored on the tween as `data`, the way
 * GSAP offers for exactly this.
 */
const KIND = {
    open: 'tab-open',
    size: 'tab-size',
    slide: 'tab-slide',
    collapse: 'tab-collapse',
};

const tweensOf = (node, kind) => gsap.getTweensOf(node).filter(tween => tween.data === kind);

/**
 * What a tab is allowed to be, at rest and while it is the focused one.
 *
 * The focused tab is the one being read, so it gets the room to be read in:
 * enough for a hostname the others have to truncate. `flexGrow` carries the
 * same weighting for the case where the strip is crowded enough that the share
 * bites before the width does.
 *
 * Written out with their units so GSAP never has to guess one. A unit inferred
 * wrongly onto `flex-grow` would be a declaration the browser drops on the
 * floor, and the strip would lose its weighting without saying so.
 */
const SIZE_REST = { minWidth: '52px', maxWidth: '130px', flexGrow: '1' };
const SIZE_FOCUSED = { minWidth: '76px', maxWidth: '172px', flexGrow: '1.45' };

const sizeFor = (active) => (active ? SIZE_FOCUSED : SIZE_REST);

/** A tab taking its size outright, with nothing to animate from. */
export function setTabSize(node, active) {
    if (!node) return;
    gsap.set(node, sizeFor(active));
}

/**
 * Focus moving on or off a tab.
 *
 * `overwrite: 'auto'` is what lets this be interrupted: a second click along
 * the strip drops whatever the first one had in flight and carries on from the
 * width currently on screen, rather than restarting from the far end.
 */
export function resizeTab(node, active) {
    if (!node) return null;

    return gsap.to(node, {
        ...sizeFor(active),
        duration: seconds(DURATION.resize),
        ease: EASE_TAB,
        overwrite: 'auto',
        data: KIND.size,
    });
}

/**
 * A tab arriving in the strip.
 *
 * The far end is left to GSAP to read off the tab as it stands, which is the
 * inline size just written for it plus the padding the stylesheet gives it. So
 * a tab lands on whatever width it was going to have, which depends on it
 * opening focused and on how much room the rest of the strip has left.
 *
 * Padding and opacity go back to the stylesheet once it is over. The widths do
 * not: inline is where they live from here on.
 */
export function openTab(node) {
    if (!node || prefersReducedMotion()) return null;

    return gsap.from(node, {
        maxWidth: 0,
        minWidth: 0,
        paddingLeft: 0,
        paddingRight: 0,
        opacity: 0,
        duration: seconds(DURATION.open),
        ease: EASE_TAB,
        clearProps: 'paddingLeft,paddingRight,opacity',
        data: KIND.open,
    });
}

/**
 * Land an opening tab at its full size at once.
 *
 * A tab moving in or out of a group hangs off a different element once it is
 * inside the outline, so React builds it again, and a tab built again plays the
 * animation for one being opened. It is not being opened, it is being carried
 * past, so that is called off here.
 *
 * Before anything is measured, and in a sweep of its own: a tab still opening
 * measures narrow, and every tab after it in the row would be measured
 * somewhere it is not about to be.
 *
 * `progress(1)` before the kill, so the tab is left at the far end of the tween,
 * which is the size it was headed for, rather than stranded at whatever width
 * it had reached. Killing a tween does not undo what it has already written,
 * and a tab left holding an opening tween's first frame is a tab with no width
 * and no opacity: invisible, and read by the next opening tween as the size it
 * should be animating towards.
 *
 * The clear afterwards is the same thought spelled out rather than left to the
 * tween's own `clearProps`, which only runs if it did reach its end.
 */
export function finishTabOpen(node) {
    if (!node) return;

    const opening = tweensOf(node, KIND.open);
    if (!opening.length) return;

    for (const tween of opening) {
        tween.progress(1);
        tween.kill();
    }
    gsap.set(node, { clearProps: 'paddingLeft,paddingRight,opacity' });
}

/**
 * A tab collapsing out of the strip.
 *
 * It holds its place while it goes, so the strip takes the space back over the
 * same beat rather than snapping shut under the pointer that just clicked.
 * Nothing is cleared at the end: the tab keeps the collapsed size it lands on
 * until it is taken out of the strip for good.
 */
export function collapseTab(node, done) {
    if (!node) return null;

    return gsap.to(node, {
        maxWidth: 0,
        minWidth: 0,
        paddingLeft: 0,
        paddingRight: 0,
        opacity: 0,
        duration: seconds(DURATION.collapse),
        ease: EASE_TAB,
        overwrite: 'auto',
        data: KIND.collapse,
        onComplete: done,
    });
}

/**
 * How far a tab is currently pushed sideways, a tween in flight included.
 *
 * Asked of GSAP rather than read back off the computed transform, because GSAP
 * is the only thing writing one and it keeps the number to hand. For a tab it
 * has never touched it parses the computed value, so this is still right for a
 * tab that has never moved.
 */
export const tabShift = (node) => parseFloat(gsap.getProperty(node, 'x')) || 0;

/**
 * Place a tab sideways of where the row put it. Through GSAP rather than
 * straight onto `style.transform`, so its idea of the tab's transform stays
 * true and the next tween starts from where the tab actually is.
 */
export function holdTab(node, x) {
    if (!node) return;
    gsap.set(node, { x });
}

/** End a slide in flight, leaving the tab wherever it had reached. */
export function stopTabSlide(node) {
    if (!node) return;
    for (const tween of tweensOf(node, KIND.slide)) tween.kill();
}

/**
 * A displaced tab sliding to the place it has just been given: offset back to
 * where it was, then animated to nothing.
 */
export function slideTab(node, from) {
    if (!node) return null;

    return gsap.fromTo(
        node,
        { x: from },
        {
            x: 0,
            duration: seconds(DURATION.slide),
            ease: EASE_SLIDE,
            overwrite: 'auto',
            data: KIND.slide,
        },
    );
}

/** The plus turning into the tab it is about to open, and back. */
export function spinPlus(node, open) {
    if (!node) return;
    gsap.to(node, {
        rotate: open ? 90 : 0,
        duration: seconds(DURATION.plus),
        ease: EASE_TAB,
        overwrite: 'auto',
    });
}
