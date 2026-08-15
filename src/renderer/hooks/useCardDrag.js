import { useCallback, useEffect, useRef, useState } from 'react';
import { reorderList, resolveDropMode } from '../lib/organize';
import { flyGhostHome, holdGhost, liftGhost } from '../lib/cardMotion';

/**
 * Picking a card up and putting it down.
 *
 * Built on pointer events rather than the HTML5 drag API, which cannot be made
 * to feel like anything: it hands the browser a screenshot of the element,
 * animates nothing, fires no coordinates you can trust between drops, and on
 * Windows draws its own cursor over the top. What is wanted instead is the card
 * itself lifting under the cursor and everything else moving out of its way,
 * which needs the pointer position on every frame, so the drag is driven here.
 *
 * Three pieces:
 *
 *   - a *ghost*, cloned from the card at the moment it is picked up, positioned
 *     in a fixed layer and moved by transform alone inside a rAF loop. Nothing
 *     re-renders while the pointer moves.
 *   - a *placeholder*, which is the real card left dimmed in the list. It is
 *     also what stops the reorder oscillating: the pointer sitting over the
 *     card being carried means "no change".
 *   - a *preview* order, published as state. The panel renders it, and
 *     `useFlipOrder` animates the difference.
 *
 * Committing is the caller's business; this reports what the drop meant.
 */

/** How far a press has to travel before it stops being a click. */
const START_THRESHOLD = 5;

/** How close to the container's edge the pointer autoscrolls, and how fast. */
const EDGE_ZONE = 72;
const EDGE_SPEED = 16;

/** Holding a card over a folder opens it, so a deep move is one gesture. */
const SPRING_DELAY = 650;

/**
 * Quiet period after a reorder. The cards it displaced are still gliding to
 * their new places, and hit-testing lands on whichever one happens to be under
 * the cursor mid-flight; without this the list flickers between two orders.
 */
const REORDER_COOLDOWN = 140;

const escapeId = (value) => (window.CSS?.escape ? window.CSS.escape(value) : value);

export function useCardDrag({
    scrollRef,
    enabled = true,
    axis = 'x',
    lists,          // { folder: [items], host: [items] } in the order shown
    canFile,        // (kind, id, folderId) => boolean
    dragCount,      // (kind, id) => how many cards this drag is carrying
    onFile,         // (kind, id, folderId) => Promise | void
    onReorder,      // (kind, orderedIds) => Promise | void
    onSpringOpen,   // (folderId) => void
}) {
    const [carrying, setCarrying] = useState(null);   // { kind, id }
    const [into, setInto] = useState(null);           // { id }; id may be '' for the root
    const [preview, setPreview] = useState(null);     // { kind, ids }

    // The pointer loop reads these rather than the render's closures, so it is
    // never one frame behind the list it is rearranging.
    const drag = useRef(null);
    const intoRef = useRef(null);
    const previewRef = useRef(null);
    const config = useRef(null);
    config.current = { lists, canFile, dragCount, onFile, onReorder, onSpringOpen, axis, scrollRef };

    const setIntoTarget = useCallback((target) => {
        const same = (intoRef.current?.id ?? null) === (target?.id ?? null);
        if (same) return;
        intoRef.current = target;
        setInto(target);
    }, []);

    const clearPreview = useCallback(() => {
        if (!previewRef.current) return;
        previewRef.current = null;
        setPreview(null);
    }, []);

    const cancelSpring = useCallback(() => {
        const current = drag.current;
        if (!current?.spring) return;
        clearTimeout(current.spring.timer);
        current.spring = null;
    }, []);

    const armSpring = useCallback((folderId) => {
        const current = drag.current;
        if (!current || current.spring?.id === folderId) return;
        cancelSpring();
        current.spring = {
            id: folderId,
            timer: setTimeout(() => {
                if (drag.current) drag.current.spring = null;
                // Whatever slot the card was being offered belonged to the list
                // that is about to leave the screen.
                clearPreview();
                config.current.onSpringOpen?.(folderId);
            }, SPRING_DELAY),
        };
    }, [cancelSpring, clearPreview]);

    /* ------------------------------------------------------------------ *
     * Where the pointer is, and what that would mean
     * ------------------------------------------------------------------ */

    /** True when the pointer is asking for a slot this list can actually give. */
    const proposeReorder = useCallback((kind, targetId, position) => {
        const current = drag.current;
        if (kind !== current.kind) return false;   // a host has no slot among folders

        // Still settling from the last one, but a slot is what is being asked
        // for all the same, and the card already holds the one it was given.
        const now = performance.now();
        if (now - (current.lastReorder || 0) < REORDER_COOLDOWN) return true;

        const base = previewRef.current?.kind === kind
            ? previewRef.current.ids
            : config.current.lists[kind].map(item => item.id);

        // Nothing to do, or nothing that can be done: the card is already in
        // that slot, or it is not in this list at all, which is where a card
        // carried in through a spring-open finds itself.
        const next = reorderList(base.map(id => ({ id })), current.id, targetId, position);
        if (!next) return false;

        current.lastReorder = now;
        const ids = next.map(entry => entry.id);
        previewRef.current = { kind, ids };
        setPreview({ kind, ids });
        return true;
    }, []);

    const hitTest = useCallback((x, y) => {
        const current = drag.current;
        const element = document.elementFromPoint(x, y);

        /**
         * The body of the list, which stands for the folder you are looking at.
         *
         * It is what makes a spring-open a whole gesture rather than half of
         * one. Once the list springs open, the card in the air came from the
         * folder you just left: there is no card on screen standing for "here"
         * — you are inside it — the crumb for it is inert, and it has no place
         * in this list to sit between. So everything in the room that is not
         * another folder has to mean "leave it in this one".
         *
         * For a card that belongs to the list already this asks nothing new:
         * `canFile` says no to the folder the card is in, so an ordinary drag
         * over empty space still means what it always did, which is nothing.
         */
        const body = element?.closest?.('[data-drop-body]')?.dataset.dropBody;
        const leaveItHere = () => {
            cancelSpring();
            setIntoTarget(
                body !== undefined && config.current.canFile(current.kind, current.id, body)
                    ? { id: body }
                    : null,
            );
        };

        const card = element?.closest?.('[data-card-id]');
        if (card) {
            const separator = card.dataset.cardId.indexOf(':');
            const kind = card.dataset.cardId.slice(0, separator);
            const id = card.dataset.cardId.slice(separator + 1);

            // Over the card being carried: the pointer has caught up with the
            // move it already made, which is not a new one.
            if (id === current.id) {
                setIntoTarget(null);
                cancelSpring();
                return;
            }

            const mode = resolveDropMode({
                rect: card.getBoundingClientRect(),
                x,
                y,
                axis: config.current.axis,
                dragKind: current.kind,
                targetKind: kind,
            });

            if (mode === 'into') {
                if (config.current.canFile(current.kind, current.id, id)) {
                    setIntoTarget({ id });
                    armSpring(id);
                    return;
                }
                leaveItHere();
                return;
            }

            if (mode && proposeReorder(kind, id, mode)) {
                cancelSpring();
                setIntoTarget(null);
                return;
            }

            // A card with no slot to offer is just part of the room.
            leaveItHere();
            return;
        }

        // Anything else that declares itself a folder: the breadcrumb, which is
        // the only way to say "out of here": there is no card to aim at for that.
        const container = element?.closest?.('[data-drop-folder]');
        if (container) {
            const folderId = container.dataset.dropFolder;
            cancelSpring();
            setIntoTarget(config.current.canFile(current.kind, current.id, folderId) ? { id: folderId } : null);
            return;
        }

        leaveItHere();
    }, [armSpring, cancelSpring, proposeReorder, setIntoTarget]);

    const autoScroll = useCallback((y) => {
        const container = config.current.scrollRef?.current;
        if (!container) return;

        const bounds = container.getBoundingClientRect();
        let delta = 0;
        if (y < bounds.top + EDGE_ZONE) {
            delta = -EDGE_SPEED * Math.min(1, (bounds.top + EDGE_ZONE - y) / EDGE_ZONE);
        } else if (y > bounds.bottom - EDGE_ZONE) {
            delta = EDGE_SPEED * Math.min(1, (y - bounds.bottom + EDGE_ZONE) / EDGE_ZONE);
        }
        if (delta) container.scrollTop += delta;
    }, []);

    /* ------------------------------------------------------------------ *
     * The gesture
     * ------------------------------------------------------------------ */

    const frame = useCallback(() => {
        const current = drag.current;
        if (!current?.started) return;

        const { x, y } = current.pointer;
        holdGhost(current.layer, x - current.offsetX, y - current.offsetY);

        autoScroll(y);
        hitTest(x, y);

        current.raf = requestAnimationFrame(frame);
    }, [autoScroll, hitTest]);

    const begin = useCallback(() => {
        const current = drag.current;
        const rect = current.node.getBoundingClientRect();

        const layer = document.createElement('div');
        layer.className = 'org-drag-layer';
        layer.style.width = `${rect.width}px`;
        layer.style.height = `${rect.height}px`;
        holdGhost(layer, rect.left, rect.top);

        const ghost = current.node.cloneNode(true);
        ghost.removeAttribute('data-card-id');
        ghost.classList.add('org-ghost');
        // A clone freezes the hover controls mid-fade, and a menu button that
        // cannot be clicked is just clutter stuck to the card you are carrying.
        ghost.querySelectorAll('[data-action]').forEach(node => node.remove());
        layer.appendChild(ghost);

        // One card is being carried but several are going: without this the
        // drop is a surprise, and the surprise is that eleven things moved.
        const count = config.current.dragCount?.(current.kind, current.id) || 1;
        if (count > 1) {
            const badge = document.createElement('div');
            badge.className = 'org-ghost-count';
            badge.textContent = String(count);
            layer.appendChild(badge);
        }

        document.body.appendChild(layer);

        // Taken up off the page. Tweened rather than swapped between two
        // classes, so putting the card down plays the same movement in reverse
        // from wherever it had reached. The shadow stays a class, since it is
        // the one part with a colour that has to answer to the theme.
        ghost.classList.add('org-ghost-lifted');
        liftGhost(ghost, true);
        document.body.classList.add('org-dragging');

        current.started = true;
        current.layer = layer;
        current.ghost = ghost;
        current.sourceRect = rect;
        current.offsetX = current.pointer.x - rect.left;
        current.offsetY = current.pointer.y - rect.top;

        setCarrying({ kind: current.kind, id: current.id });
        current.raf = requestAnimationFrame(frame);
    }, [frame]);

    /** Fly the ghost to wherever the card has ended up, then drop it. */
    const settle = useCallback((current, destination) => {
        const { layer, ghost } = current;

        // Put down as it travels, which is the pick-up run backwards.
        ghost.classList.remove('org-ghost-lifted');
        liftGhost(ghost, false);

        return flyGhostHome(layer, destination);
    }, []);

    const end = useCallback(async (cancelled) => {
        const current = drag.current;
        if (!current) return;

        drag.current = null;
        current.detach?.();
        if (current.spring) clearTimeout(current.spring.timer);
        if (current.raf) cancelAnimationFrame(current.raf);

        // Never travelled far enough to be a drag, so it was a click and the
        // card's own handler should still see it.
        if (!current.started) return;

        // A drag that ends on the card it started from would otherwise fire a
        // click, and on these cards a click opens a session.
        const swallow = (event) => { event.stopPropagation(); event.preventDefault(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);

        const target = cancelled ? null : intoRef.current;
        const order = cancelled ? null : previewRef.current;

        if (cancelled) clearPreview();

        // Where it is going: into a folder, or the slot it now holds in the list.
        let destination = null;
        if (target) {
            const node = document.querySelector(`[data-drop-folder="${escapeId(target.id)}"]`);
            if (node) {
                const rect = node.getBoundingClientRect();
                destination = {
                    // Centred, so the shrink reads as being drawn into the folder.
                    left: rect.left + rect.width / 2 - current.sourceRect.width / 2,
                    top: rect.top + rect.height / 2 - current.sourceRect.height / 2,
                    absorb: true,
                };
            } else {
                // Filed into the folder that is already open, which has nothing
                // on screen to fly to. It goes down where it was let go of,
                // and the list it lands in is the one behind it.
                destination = {
                    left: current.pointer.x - current.offsetX,
                    top: current.pointer.y - current.offsetY,
                    absorb: true,
                };
            }
        }
        if (!destination) {
            const node = document.querySelector(
                `[data-card-id="${escapeId(`${current.kind}:${current.id}`)}"]`,
            );
            const rect = node ? node.getBoundingClientRect() : current.sourceRect;
            destination = { left: rect.left, top: rect.top, absorb: false };
        }

        await settle(current, destination);

        document.body.classList.remove('org-dragging');
        setCarrying(null);
        setIntoTarget(null);

        if (cancelled) return;

        try {
            if (target) await config.current.onFile(current.kind, current.id, target.id);
            else if (order) await config.current.onReorder(order.kind, order.ids);
        } finally {
            // Held until the store has answered, or the card would snap back to
            // where it was for the frame between the drop and the reload.
            clearPreview();
        }
    }, [clearPreview, setIntoTarget, settle]);

    const handlePointerDown = useCallback((event, kind, item) => {
        if (!enabled || event.button !== 0 || drag.current) return;
        // The overflow menu is a control, not a handle.
        if (event.target.closest('[data-action]')) return;

        // Anything a card renders through a portal (its overflow menu, a
        // tooltip) is a React descendant but not a physical one, so its events
        // arrive here while living somewhere else in the DOM entirely. The
        // `[data-action]` check above walks the DOM and cannot see them.
        //
        // Taking the gesture anyway would be worse than a stray drag: the
        // pointer capture set below retargets the whole interaction to the card,
        // so the click would land on the card (opening a session) and never on
        // the menu item that was actually pressed.
        if (!event.currentTarget.contains(event.target)) return;

        const node = event.currentTarget;

        // Capture keeps the gesture alive when the pointer leaves the window.
        // It is a bonus, not the mechanism: the listeners below are on the
        // window, because a card released over a *different* card would never
        // be heard by one bound to the card the drag started on, and because
        // reparenting the node during a reorder can drop the capture.
        try {
            node.setPointerCapture(event.pointerId);
        } catch {
            // Nothing to capture; the window listeners carry the gesture alone.
        }

        const onMove = (moveEvent) => {
            const current = drag.current;
            if (!current || moveEvent.pointerId !== current.pointerId) return;

            // The button came up somewhere we could not hear it: over the
            // window chrome, or outside the app. Put the card down rather than
            // leaving it stuck to the cursor.
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
            if (upEvent.pointerId !== drag.current?.pointerId) return;
            end(false);
        };
        const onCancel = () => end(true);

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onCancel, true);
        window.addEventListener('blur', onCancel);

        drag.current = {
            pointerId: event.pointerId,
            kind,
            id: item.id,
            node,
            startX: event.clientX,
            startY: event.clientY,
            pointer: { x: event.clientX, y: event.clientY },
            started: false,
            spring: null,
            lastReorder: 0,
            detach: () => {
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onUp, true);
                window.removeEventListener('pointercancel', onCancel, true);
                window.removeEventListener('blur', onCancel);
                try {
                    node.releasePointerCapture(event.pointerId);
                } catch {
                    // Already released with the gesture that ended it.
                }
            },
        };
    }, [begin, enabled, end]);

    // Escape puts the card back. Bound only while something is being carried, so
    // it cannot shadow the panel's own use of the key.
    useEffect(() => {
        if (!carrying) return;
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            end(true);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [carrying, end]);

    // A drag outliving the page it belongs to would leave a card stuck to the
    // cursor and the grabbing cursor on the whole window.
    useEffect(() => () => {
        const current = drag.current;
        if (!current) return;
        current.detach?.();
        if (current.spring) clearTimeout(current.spring.timer);
        if (current.raf) cancelAnimationFrame(current.raf);
        current.layer?.remove();
        document.body.classList.remove('org-dragging');
        drag.current = null;
    }, []);

    const cardProps = useCallback((kind, item) => ({
        'data-card-id': `${kind}:${item.id}`,
        onPointerDown: enabled ? (event) => handlePointerDown(event, kind, item) : undefined,
    }), [enabled, handlePointerDown]);

    return { carrying, into, preview, cardProps };
}
