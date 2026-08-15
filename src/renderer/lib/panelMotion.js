import { gsap } from 'gsap';
import { APP_GUTTER, SIDEBAR_WIDTH } from './layout';
import { cubicBezier, seconds } from './motion';

/**
 * The two columns down either side of the window opening and shutting.
 *
 * Neither is an overlay laid across the page. Each is a column that changes
 * width, with everything inside it clipped rather than reflowed, so what is
 * already on screen stays where it is while the rest arrives beside it.
 *
 * ## Who owns the width
 *
 * GSAP does, and it writes it inline. React must not also put the animated
 * width in a `style` prop: a parent re-rendering mid-slide would write the far
 * end of the movement straight onto the element, and the column would jump
 * there and then be dragged back by the next tween frame. What React still
 * owns is everything that is not being animated, the padding and the clip and
 * whether a thing can be clicked.
 */

/**
 * Tailwind's `ease-in-out`, which both columns have always opened on. Keeping
 * one curve for both is what makes them read as the same piece of furniture
 * arriving from opposite sides.
 */
const EASE_REVEAL = cubicBezier(0.4, 0, 0.2, 1);

/**
 * The sidebar is a place you go and stay, so it can afford the longer move.
 * The assistant is a panel you flick in and out of mid-sentence while reading
 * the terminal, and 300ms of that gets old fast: short enough to feel like the
 * column simply widened, long enough that the eye follows the edge rather than
 * being handed a new layout.
 */
const SIDEBAR_MS = 300;
const ASSISTANT_MS = 180;

/** The sheet, which is put in front of you and then gets out of the way. */
const SHEET_IN_MS = 380;
const SHEET_OUT_MS = 220;

const EASE_SHEET_IN = cubicBezier(0.16, 1, 0.3, 1);
const EASE_SHEET_OUT = cubicBezier(0.5, 0, 0.75, 0);

/**
 * The sidebar, which collapses to nothing rather than to a rail.
 *
 * The shell supplies the left gutter, so the nav items line up with the burger
 * button above them. The sidebar only owns the gap to the content panel, which
 * goes with it, keeping the terminal flush with the bar.
 */
const sidebarState = (open) => ({
    width: open ? SIDEBAR_WIDTH : 0,
    paddingRight: open ? APP_GUTTER : 0,
    opacity: open ? 1 : 0,
});

/** The sidebar as it stands, with nothing to animate from. */
export function setSidebar(node, open) {
    if (!node) return;
    gsap.set(node, sidebarState(open));
}

/** The sidebar arriving or getting out of the way. */
export function slideSidebar(node, open) {
    if (!node) return null;

    return gsap.to(node, {
        ...sidebarState(open),
        duration: seconds(SIDEBAR_MS),
        ease: EASE_REVEAL,
        overwrite: 'auto',
    });
}

/** The assistant's column at a width, with nothing to animate from. */
export function setAssistantWidth(node, width) {
    if (!node) return;
    gsap.set(node, { width: width + APP_GUTTER });
}

/**
 * The assistant's column opening or shutting.
 *
 * Three movements on one timeline rather than three tweens that happen to be
 * the same length: the column widening, the rail button going, and the card
 * arriving are one gesture, and a timeline is a single thing to report the end
 * of. The old version had to guess that end with a timer set past the length of
 * the transition.
 *
 * Both fading elements are placed at the far end of their fade first, but only
 * if they have just arrived. The card is mounted for the slide that reveals it
 * and the rail is put back for the slide that hides it, and an element that has
 * just been built carries no opacity of its own, so it would be read as fully
 * on and have nothing to fade from. One that is already on screen is left
 * exactly where it is, which is what lets a panel flicked shut halfway open
 * carry on from the opacity it had reached rather than snapping back.
 *
 * `width` is the column's whole width, gutter included, so this does not have
 * to know which side of the rail the panel is on.
 */
export function revealAssistant({ column, rail, card, width, open, onComplete }) {
    const move = { duration: seconds(ASSISTANT_MS), ease: EASE_REVEAL, overwrite: 'auto' };

    if (rail && !rail.style.opacity) gsap.set(rail, { opacity: open ? 1 : 0 });
    if (card && !card.style.opacity) gsap.set(card, { opacity: open ? 0 : 1 });

    const reveal = gsap.timeline({ onComplete });

    reveal.to(column, { width: width + APP_GUTTER, ...move }, 0);
    if (rail) reveal.to(rail, { opacity: open ? 0 : 1, ...move }, 0);
    if (card) reveal.to(card, { opacity: open ? 1 : 0, ...move }, 0);

    return reveal;
}

/** The sheet where it starts: off the bottom, with nothing over the page yet. */
export function setSheetAway(card, scrim) {
    if (card) gsap.set(card, { yPercent: 100 });
    if (scrim) gsap.set(scrim, { opacity: 0 });
}

/**
 * A sheet rising over the page it came from, and dropping back off it.
 *
 * Entering and leaving are not the same motion. Arriving is the sheet being put
 * in front of you: it covers most of the distance immediately and then settles,
 * which is what a hard ease-out does. Leaving is the sheet getting out of the
 * way, so it eases in, barely moving at first and then dropping away, and takes
 * less time, because nobody wants to watch something they have already
 * dismissed.
 *
 * The scrim travels on the same timeline, so the caller has one thing to wait
 * on rather than a timer set to match whichever of two transitions is longer.
 *
 * `yPercent` rather than a pixel offset: the sheet is as tall as the region it
 * covers, and a window resized mid-slide would otherwise leave it short.
 */
export function slideSheet({ card, scrim, open, onComplete }) {
    const move = {
        duration: seconds(open ? SHEET_IN_MS : SHEET_OUT_MS),
        ease: open ? EASE_SHEET_IN : EASE_SHEET_OUT,
        overwrite: 'auto',
    };

    const sheet = gsap.timeline({ onComplete });

    sheet.to(card, { yPercent: open ? 0 : 100, ...move }, 0);
    if (scrim) sheet.to(scrim, { opacity: open ? 1 : 0, ...move }, 0);

    return sheet;
}
