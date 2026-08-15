import { gsap } from 'gsap';
import { cubicBezier, prefersReducedMotion, seconds } from './motion';

/**
 * The hosts page: cards changing places, and a card being carried between them.
 *
 * The same two jobs the tab strip has, and the same split. `useFlipOrder` works
 * out which card moved where and `useCardDrag` runs the gesture; this holds the
 * movements they ask for, so the grid and the strip agree on how long a card
 * takes to travel and on what it does when it is picked up.
 */

/** The curve everything on this page moves on. */
const EASE_CARD = cubicBezier(0.22, 1, 0.36, 1);

const DURATION = {
    // Long enough to read as movement, short enough not to lag behind the
    // pointer that caused it.
    slide: 220,
    // Putting a card down where it belongs.
    settle: 200,
    // Or into a folder, which swallows it, and is worth a beat longer because
    // there is a scale and a fade to read as well as a journey.
    absorb: 220,
    // The pick-up, and the same movement in reverse on the drop.
    lift: 160,
};

/**
 * A card sliding from where it was to where it now is.
 *
 * Offset back and animated to nothing, so the browser has already done the
 * layout and this is a compositor-only transform over the top of it.
 */
export function slideCard(node, dx, dy) {
    if (!node) return null;

    return gsap.fromTo(
        node,
        { x: dx, y: dy },
        {
            x: 0,
            y: 0,
            duration: seconds(DURATION.slide),
            ease: EASE_CARD,
            overwrite: 'auto',
        },
    );
}

/**
 * The clone that follows the pointer, taken up off the page.
 *
 * Slightly transparent on purpose: a card held over a folder covers the very
 * ring that says it would be filed there, and the drop target matters more than
 * the thing being dropped.
 *
 * The shadow travels with it rather than being a class swap, so putting the
 * card down plays the pick-up in reverse from wherever it had reached instead
 * of cutting between two states.
 */
export function liftGhost(node, lifted) {
    if (!node) return null;

    return gsap.to(node, {
        scale: lifted ? 1.03 : 1,
        opacity: lifted ? 0.88 : 1,
        duration: seconds(DURATION.lift),
        ease: EASE_CARD,
        overwrite: 'auto',
    });
}

/**
 * Fly the carried card to wherever it has ended up, and take it off the page.
 *
 * Resolves when the layer is gone, so the caller can wait for the card to land
 * before it does anything else. Under reduced motion there is nothing to wait
 * for and the layer goes at once.
 *
 * `absorb` is a drop into a folder: the card shrinks into it rather than
 * arriving on top of it, because the folder is what it is now inside.
 */
export function flyGhostHome(layer, { left, top, absorb }) {
    if (!layer) return Promise.resolve();

    if (prefersReducedMotion()) {
        layer.remove();
        return Promise.resolve();
    }

    return new Promise((done) => {
        gsap.to(layer, {
            x: left,
            y: top,
            scale: absorb ? 0.3 : 1,
            opacity: absorb ? 0 : 1,
            duration: seconds(absorb ? DURATION.absorb : DURATION.settle),
            ease: EASE_CARD,
            overwrite: 'auto',
            onComplete: () => {
                layer.remove();
                done();
            },
        });
    });
}

/** Place the carried card under the pointer, without animating there. */
export function holdGhost(layer, x, y) {
    if (!layer) return;
    gsap.set(layer, { x, y });
}
