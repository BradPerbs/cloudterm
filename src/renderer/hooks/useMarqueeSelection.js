import { useCallback, useEffect, useRef } from 'react';

/**
 * Rubber-band selection: press on the empty space between cards and drag a box
 * over the ones you want.
 *
 * Built the same way as `useCardDrag`, and for the same reason: the box has to
 * follow the pointer every frame, and re-rendering a grid of cards sixty times
 * a second to move a rectangle is not a thing anyone should pay for. So the box
 * is a DOM node the caller renders once and this hook moves, and React only
 * hears about the gesture when the *set of selected cards* actually changes,
 * which is a few times per drag rather than a few hundred.
 *
 * Everything is measured in the scroll container's content space (client
 * coordinates plus its scroll offset) rather than the viewport's. That is what
 * makes the band survive autoscrolling: the corner you started from stays
 * pinned to the card it was next to, however far the list travels underneath.
 *
 * Cards are measured once, when the band starts. Nothing reorders while a band
 * is being drawn, so re-reading every card's rectangle each frame would buy
 * nothing but layout thrash.
 */

/** How far a press on empty space has to travel before it is a band. */
const START_THRESHOLD = 4;

/** How close to the container's edge the band autoscrolls, and how fast. */
const EDGE_ZONE = 72;
const EDGE_SPEED = 14;

/** A press on any of these is aimed at the thing, not at the space around it. */
const INTERACTIVE = '[data-card-id], button, a, input, select, textarea, [data-action]';

const clamp = (value, max) => Math.max(0, Math.min(value, max));

const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const sameKeys = (a, b) => a.size === b.size && [...a].every(key => b.has(key));

/** Every card on the page, in the container's content space. */
function measureCards(container) {
    const bounds = container.getBoundingClientRect();
    const { scrollLeft, scrollTop } = container;

    return Array.from(container.querySelectorAll('[data-card-id]')).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
            key: node.dataset.cardId,
            rect: {
                left: rect.left - bounds.left + scrollLeft,
                top: rect.top - bounds.top + scrollTop,
                right: rect.right - bounds.left + scrollLeft,
                bottom: rect.bottom - bounds.top + scrollTop,
            },
        };
    });
}

export function useMarqueeSelection({
    scrollRef,     // the element that scrolls the cards, and holds the band
    bandRef,       // an empty absolutely-positioned div inside it
    enabled = true,
    getSelection,  // () => Set of `kind:id`, as it stands right now
    onChange,      // (Set of `kind:id`) => void
}) {
    const gesture = useRef(null);
    const config = useRef(null);
    config.current = { scrollRef, bandRef, getSelection, onChange };

    const hideBand = useCallback(() => {
        const node = config.current.bandRef?.current;
        if (node) node.style.display = 'none';
        document.body.classList.remove('org-banding');
    }, []);

    /* ------------------------------------------------------------------ *
     * The gesture
     * ------------------------------------------------------------------ */

    const frame = useCallback(() => {
        const current = gesture.current;
        if (!current?.started) return;

        const container = config.current.scrollRef?.current;
        if (!container) return;

        const bounds = container.getBoundingClientRect();
        const { x, y } = current.pointer;

        // Scrolled before the box is measured, so a band held at the edge keeps
        // growing rather than stalling at whatever was on screen when it got there.
        if (y < bounds.top + EDGE_ZONE) {
            container.scrollTop -= EDGE_SPEED * Math.min(1, (bounds.top + EDGE_ZONE - y) / EDGE_ZONE);
        } else if (y > bounds.bottom - EDGE_ZONE) {
            container.scrollTop += EDGE_SPEED * Math.min(1, (y - bounds.bottom + EDGE_ZONE) / EDGE_ZONE);
        }

        const pointerX = clamp(x - bounds.left + container.scrollLeft, container.scrollWidth);
        const pointerY = clamp(y - bounds.top + container.scrollTop, container.scrollHeight);

        const box = {
            left: Math.min(current.anchorX, pointerX),
            top: Math.min(current.anchorY, pointerY),
            right: Math.max(current.anchorX, pointerX),
            bottom: Math.max(current.anchorY, pointerY),
        };

        const node = config.current.bandRef?.current;
        if (node) {
            node.style.display = 'block';
            node.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
            node.style.width = `${box.right - box.left}px`;
            node.style.height = `${box.bottom - box.top}px`;
        }

        // Holding a modifier adds to what was already picked; without one the
        // band is the whole answer, so anything it leaves goes with it.
        const next = new Set(current.additive ? current.base : []);
        for (const card of current.cards) {
            if (overlaps(box, card.rect)) next.add(card.key);
        }

        if (!sameKeys(next, current.applied)) {
            current.applied = next;
            config.current.onChange(next);
        }

        current.raf = requestAnimationFrame(frame);
    }, []);

    const begin = useCallback(() => {
        const current = gesture.current;
        const container = config.current.scrollRef?.current;
        if (!container) return;

        current.started = true;
        current.cards = measureCards(container);
        document.body.classList.add('org-banding');
        current.raf = requestAnimationFrame(frame);
    }, [frame]);

    const end = useCallback((cancelled) => {
        const current = gesture.current;
        if (!current) return;

        gesture.current = null;
        current.detach();
        if (current.raf) cancelAnimationFrame(current.raf);

        if (!current.started) {
            // Never travelled far enough to be a band, so it was a click on the
            // background, which everywhere else in the world means "never mind".
            if (!current.additive && config.current.getSelection().size > 0) {
                config.current.onChange(new Set());
            }
            return;
        }

        hideBand();
        if (cancelled) config.current.onChange(new Set(current.base));
    }, [hideBand]);

    const handlePointerDown = useCallback((event) => {
        if (!enabled || event.button !== 0 || gesture.current) return;
        // Only the space between the cards starts a band; a press on a card is
        // that card's to deal with, and it may be the start of a drag.
        if (event.target.closest?.(INTERACTIVE)) return;

        const container = config.current.scrollRef?.current;
        if (!container || !container.contains(event.target)) return;

        const bounds = container.getBoundingClientRect();

        const onMove = (moveEvent) => {
            const current = gesture.current;
            if (!current || moveEvent.pointerId !== current.pointerId) return;

            // The button came up where we could not hear it: over the window
            // chrome, or outside the app entirely.
            if (moveEvent.buttons === 0) {
                end(false);
                return;
            }

            current.pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
            if (current.started) return;

            const travelled = Math.hypot(
                moveEvent.clientX - current.startX,
                moveEvent.clientY - current.startY,
            );
            if (travelled >= START_THRESHOLD) begin();
        };
        const onUp = (upEvent) => {
            if (upEvent.pointerId !== gesture.current?.pointerId) return;
            end(false);
        };
        const onCancel = () => end(true);

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
        window.addEventListener('blur', onCancel);

        gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            pointer: { x: event.clientX, y: event.clientY },
            anchorX: clamp(event.clientX - bounds.left + container.scrollLeft, container.scrollWidth),
            anchorY: clamp(event.clientY - bounds.top + container.scrollTop, container.scrollHeight),
            additive: event.ctrlKey || event.metaKey || event.shiftKey,
            base: new Set(config.current.getSelection()),
            applied: new Set(config.current.getSelection()),
            cards: [],
            started: false,
            detach: () => {
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onUp, true);
                window.removeEventListener('pointercancel', onCancel, true);
                window.removeEventListener('blur', onCancel);
            },
        };
    }, [begin, enabled, end]);

    // Escape puts the selection back to what it was before the band. Bound only
    // while one is being drawn, so it cannot shadow the panel's own use of the key.
    useEffect(() => {
        const onKey = (event) => {
            if (event.key !== 'Escape' || !gesture.current?.started) return;
            event.preventDefault();
            event.stopPropagation();
            end(true);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [end]);

    // A band outliving the page it belongs to would leave the crosshair cursor
    // on the whole window.
    useEffect(() => () => {
        gesture.current?.detach();
        if (gesture.current?.raf) cancelAnimationFrame(gesture.current.raf);
        gesture.current = null;
        hideBand();
    }, [hideBand]);

    return { surfaceProps: { onPointerDown: handlePointerDown } };
}
