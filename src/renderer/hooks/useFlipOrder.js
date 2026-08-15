import { useLayoutEffect, useRef } from 'react';
import { slideCard } from '../lib/cardMotion';

/**
 * Slide cards between their old and new positions whenever the order changes.
 *
 * First, Last, Invert, Play: by the time a layout effect runs the browser has
 * already put every card in its new place, so each one is offset back to where
 * it was and then animated to zero. React is not involved in the movement at
 * all: a reorder costs one measure pass and a compositor-only transform per
 * card, which is what keeps it smooth with a folder full of them. The tween
 * itself is GSAP's, from `lib/cardMotion`, as the tab strip's is.
 *
 * Positions are held relative to the container's scrolled content rather than
 * the viewport. Measured against the viewport, scrolling the list would read as
 * every card having moved at once, and the whole grid would animate.
 *
 * `resetKey` is for changes that are not reorders: switching between the grid
 * and the list moves everything, and animating between two entirely different
 * layouts looks like a fault rather than a transition. When it changes the pass
 * only records positions.
 *
 * ## Reflow
 *
 * A grid that takes its column count from its own width rewraps when the
 * assistant panel is dragged, and none of that goes through React: no state
 * changes, so no layout effect runs, so the cards used to jump between layouts
 * with nothing in between. A ResizeObserver covers that case.
 *
 * It animates on the column count changing, not on the width changing. Between
 * two wraps the cards are only stretching, which is already continuous and
 * needs no help; animating that would put a 220ms tail on every frame of a drag
 * and turn a smooth resize into something rubbery. Every observation still
 * records positions, so the frame before a wrap is the one a wrap animates
 * from.
 */
function countColumns(container) {
    // "240px 240px 240px" while it is a grid, "none" while it is a list.
    const columns = getComputedStyle(container).gridTemplateColumns;
    return columns && columns !== 'none' ? columns.split(' ').length : 1;
}

export function useFlipOrder(containerRef, orderKey, { enabled = true, resetKey = '' } = {}) {
    const previous = useRef(new Map());
    const lastReset = useRef(resetKey);
    const columns = useRef(0);

    // Held in a ref so the observer, which is set up once, always runs the
    // current pass rather than the one from the render that created it.
    const pass = useRef(null);
    pass.current = (moving) => {
        const container = containerRef.current;
        if (!container) return;

        // A panel that is not on screen measures as nothing. Recording that
        // would throw away the last real positions and animate every card in
        // from the corner the next time it is shown.
        if (!container.offsetWidth) return;

        const bounds = container.getBoundingClientRect();
        const next = new Map();

        for (const card of container.querySelectorAll('[data-card-id]')) {
            const rect = card.getBoundingClientRect();
            const position = {
                x: rect.left - bounds.left + container.scrollLeft,
                y: rect.top - bounds.top + container.scrollTop,
            };
            next.set(card.dataset.cardId, position);

            if (!moving) continue;

            const before = previous.current.get(card.dataset.cardId);
            if (!before) continue;

            const dx = before.x - position.x;
            const dy = before.y - position.y;
            // Sub-pixel drift from a reflow is not movement worth animating.
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

            slideCard(card, dx, dy);
        }

        previous.current = next;
    };

    useLayoutEffect(() => {
        const settling = lastReset.current !== resetKey;
        lastReset.current = resetKey;
        pass.current(enabled && !settling);
    }, [containerRef, orderKey, enabled, resetKey]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return undefined;

        // Seeded before the first observation, which fires immediately and
        // would otherwise read as the count having changed.
        columns.current = countColumns(container);

        const observer = new ResizeObserver(() => {
            // Collapsing to nothing is a panel being put away, not a rewrap.
            // The count it reports there is meaningless and would make the
            // next real observation look like a change.
            if (!container.offsetWidth) return;

            const count = countColumns(container);
            const wrapped = count !== columns.current;
            columns.current = count;
            // Transforms do not change what the observer measures, so animating
            // from inside the callback cannot feed itself.
            pass.current(enabled && wrapped);
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [containerRef, enabled]);
}
