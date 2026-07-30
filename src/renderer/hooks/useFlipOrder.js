import { useLayoutEffect, useRef } from 'react';

/** Long enough to read as movement, short enough not to lag behind the pointer. */
const DURATION = 220;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Slide cards between their old and new positions whenever the order changes.
 *
 * First, Last, Invert, Play: by the time a layout effect runs the browser has
 * already put every card in its new place, so each one is offset back to where
 * it was and then animated to zero. React is not involved in the movement at
 * all: a reorder costs one measure pass and a compositor-only transform per
 * card, which is what keeps it smooth with a folder full of them.
 *
 * Positions are held relative to the container's scrolled content rather than
 * the viewport. Measured against the viewport, scrolling the list would read as
 * every card having moved at once, and the whole grid would animate.
 *
 * `resetKey` is for changes that are not reorders: switching between the grid
 * and the list moves everything, and animating between two entirely different
 * layouts looks like a fault rather than a transition. When it changes the pass
 * only records positions.
 */
export function useFlipOrder(containerRef, orderKey, { enabled = true, resetKey = '' } = {}) {
    const previous = useRef(new Map());
    const lastReset = useRef(resetKey);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const settling = lastReset.current !== resetKey;
        lastReset.current = resetKey;

        const bounds = container.getBoundingClientRect();
        const next = new Map();

        for (const card of container.querySelectorAll('[data-card-id]')) {
            const rect = card.getBoundingClientRect();
            const position = {
                x: rect.left - bounds.left + container.scrollLeft,
                y: rect.top - bounds.top + container.scrollTop,
            };
            next.set(card.dataset.cardId, position);

            if (!enabled || settling) continue;

            const before = previous.current.get(card.dataset.cardId);
            if (!before) continue;

            const dx = before.x - position.x;
            const dy = before.y - position.y;
            // Sub-pixel drift from a reflow is not movement worth animating.
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

            card.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                { duration: DURATION, easing: EASING },
            );
        }

        previous.current = next;
    }, [containerRef, orderKey, enabled, resetKey]);
}
