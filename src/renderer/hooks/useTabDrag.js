import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion';
import {
    finishTabOpen,
    holdTab,
    slideTab,
    stopTabSlide,
    tabShift,
} from '../lib/tabMotion';

/**
 * Carrying a tab along the strip.
 *
 * Pointer events rather than the HTML5 drag API, for the reasons `useCardDrag`
 * gives at length: that API hands the browser a screenshot, animates nothing,
 * and reports coordinates you cannot use. A strip needs less than the Hosts
 * page does, though. There is no ghost and no drop target here. The tab itself
 * is the thing being moved, the tabs it passes slide into the place it left,
 * and what is on screen mid-drag is already the order the drop will commit.
 *
 * Three things are worked out on every frame, measured from the strip as it is
 * drawn rather than from the props it was drawn from:
 *
 *   - where the carried tab sits, which is wherever the pointer has it, kept
 *     inside the strip;
 *   - which slot that puts it in, which is one further along for every
 *     neighbour whose middle the carried tab's leading edge has reached;
 *   - which group it would land in, which is the outline its middle is inside,
 *     so long as the slot it is taking is next to a member of that group.
 *
 * A neighbour is passed on the leading edge rather than on the two middles
 * crossing because the middles start a whole tab apart, and a strip that will
 * not move anything until you have dragged that far feels stuck. On the edge it
 * is half a tab, which is what a browser asks for and what a tab laid halfway
 * over its neighbour looks like it is asking for. Undoing a swap costs the same
 * half tab back the other way, because the neighbour has moved to the far side
 * of the carried tab in the meantime, so a tab held right on the boundary sits
 * where it was put instead of flickering between two orders.
 *
 * The group has to be one the new slot touches, because aiming with an edge and
 * asking about a middle are different questions and at the ends of a run the
 * answers part company: a wide tab can be a slot past the last member while its
 * middle is still inside the outline. Filing it in the group from there would
 * leave a foreign tab in the middle of the run, and `segmentStrip` would draw
 * the group as two outlines wearing one name. So it is next to a member, or it
 * is loose.
 *
 * The order is published as state so the strip re-renders in it. Committing it
 * is the caller's business; until they do, the preview is what the user sees.
 *
 * The movement itself is GSAP's, from `lib/tabMotion`, which is also where the
 * durations and the curves live. This file works out what should move where;
 * that one puts it there. Everything here works in layout positions, which is a
 * tab's rect minus whatever `tabShift` says it is currently pushed by: measuring
 * the rect alone would mean measuring the animations too, and a strip that
 * rearranged itself from half-finished positions would wander.
 */

/** How far a press has to travel along the strip before it stops being a click. */
const START_THRESHOLD = 5;

/**
 * How far past a neighbour's middle the leading edge has to be before the tab
 * takes that slot. Small, and there only to keep the boundary away from the
 * width changes the move itself causes: a tab entering a group takes the
 * outline's own few pixels out of the row, and a swap that could be undone by
 * that much would sit there flickering.
 */
const SWAP_MARGIN = 6;

/** Tabs in the strip. A tab mid-close is a ghost of one, and holds no slot. */
const TABS = '[data-tab]:not([data-closing])';

export function useTabDrag({ containerRef, tabs, onReorder, enabled = true }) {
    /** The tab in hand, if any. */
    const [carrying, setCarrying] = useState(null);

    /** The order it is asking for, and the group it would land in. */
    const [preview, setPreview] = useState(null);

    // The pointer loop reads these rather than the render's closures, so it is
    // never a frame behind the strip it is rearranging.
    const drag = useRef(null);
    const carryingRef = useRef(null);
    const previewRef = useRef(null);
    const settling = useRef(false);
    const places = useRef(new Map());

    const config = useRef(null);
    config.current = { containerRef, onReorder };

    /**
     * One pass over the strip: note where every tab is, and when something is
     * being carried, slide the ones that are no longer where they were.
     *
     * First, Last, Invert, Play, as `useFlipOrder` does it for the Hosts page.
     * By the time a layout effect runs the browser has already put every tab in
     * its new place, so each one is offset back to where it was a moment ago and
     * animated to zero. React is not involved in the movement at all.
     *
     * "Where it was a moment ago" is the slot it held last pass plus however
     * far into a slide it already is, so interrupting one mid-flight picks up
     * from what is on screen instead of jumping back to start it again.
     *
     * Held in a ref so the gesture always runs the current pass rather than the
     * one belonging to the render that created it.
     */
    const pass = useRef(null);
    pass.current = (animate) => {
        const container = config.current.containerRef.current;
        if (!container) return;

        const base = container.getBoundingClientRect().left;
        const still = prefersReducedMotion();
        const next = new Map();
        const nodes = [...container.querySelectorAll(TABS)];

        // A tab carried in or out of a group is built again by React, and a tab
        // built again plays the animation for one being opened. That is called
        // off before anything is measured, and in a sweep of its own, for the
        // reasons `finishTabOpen` gives.
        if (animate) {
            for (const node of nodes) finishTabOpen(node);
        }

        for (const node of nodes) {
            const id = node.dataset.tab;
            const shift = tabShift(node);
            const left = node.getBoundingClientRect().left - shift - base;
            next.set(id, left);

            // The carried tab is placed by the pointer rather than from here.
            // It does need putting back where the pointer had it: the tab built
            // again above arrives with none of the offset it was being held at,
            // which went with the node it was set on. Done before the frame is
            // painted, so the tab does not blink back to its slot and out.
            if (id === carryingRef.current) {
                const held = drag.current;
                if (held?.wanted != null) holdTab(node, held.wanted - base - left);
                continue;
            }

            const before = places.current.get(id);

            // The tab that was being carried is put down by this branch. A
            // slide still in flight goes first, since it is the thing writing
            // the offset, and then the offset itself: left on, it is what the
            // tab would snap back to the moment a new slide ended.
            stopTabSlide(node);
            if (shift) holdTab(node, 0);

            if (!animate || still || before === undefined) continue;

            const delta = before + shift - left;
            // Sub-pixel drift from a reflow is not movement worth animating.
            if (Math.abs(delta) < 1) continue;

            slideTab(node, delta);
        }

        places.current = next;
    };

    /**
     * The strip as it has just been drawn. Tabs slide only while one is being
     * carried, or on the pass that puts it down: a tab opening or closing has
     * a tween of its own, and two of them over the same movement read as a
     * fault.
     */
    const rendered = preview ? preview.ids : tabs.map(tab => tab.id);
    const orderKey = `${rendered.join('|')}|${carrying || ''}|${preview?.groupId || ''}`;

    useLayoutEffect(() => {
        const animate = Boolean(carryingRef.current) || settling.current;
        settling.current = false;
        pass.current(animate);
    }, [orderKey]);

    /* ------------------------------------------------------------------ *
     * The gesture
     * ------------------------------------------------------------------ */

    const frame = useCallback(() => {
        const current = drag.current;
        if (!current?.started) return;
        current.raf = requestAnimationFrame(frame);

        const container = config.current.containerRef.current;
        if (!container) return;

        const bounds = container.getBoundingClientRect();
        const others = [];
        let carried = null;
        // How many of the others are in front of the carried tab as the strip
        // stands, which is the slot it is holding right now.
        let at = 0;

        for (const node of container.querySelectorAll(TABS)) {
            const rect = node.getBoundingClientRect();
            const left = rect.left - tabShift(node);
            if (node.dataset.tab === current.id) {
                carried = {
                    node,
                    left,
                    width: rect.width,
                    // The outline it is being drawn inside as things stand.
                    groupId: node.closest('[data-tab-group]')?.dataset.tabGroup || null,
                };
                continue;
            }
            others.push({
                id: node.dataset.tab,
                middle: left + rect.width / 2,
                groupId: node.closest('[data-tab-group]')?.dataset.tabGroup || null,
            });
            if (!carried) at += 1;
        }

        // The tab has gone out from under the gesture: its session dropped and
        // closed it. The release will find nothing of it left to commit.
        if (!carried) return;

        // Held where it was picked up, and no further out than the strip goes.
        // A tab dragged past the end would otherwise leave the row it belongs
        // to and be clipped by it.
        const wanted = Math.min(
            Math.max(current.pointer - current.grab, bounds.left),
            Math.max(bounds.right - carried.width, bounds.left),
        );
        // Kept, not just applied: a reparented tab arrives with no transform on
        // it, and the pass that reparents it puts this back before it is seen.
        current.wanted = wanted;
        holdTab(carried.node, wanted - carried.left);

        const middle = wanted + carried.width / 2;

        /**
         * The slot it is asking for, a step at a time from the one it holds.
         *
         * Only one of these two can be true to begin with: the tab would have
         * to be wider than the slot it is sitting in to be over both of its
         * neighbours' middles at once, and its slot is its width. Stepping is
         * exact, not an approximation, because passing a neighbour moves that
         * neighbour and nothing else: every tab still ahead is where it was
         * when the row was measured, so the next step can be read off the same
         * numbers.
         */
        const reachRight = wanted + carried.width - SWAP_MARGIN;
        const reachLeft = wanted + SWAP_MARGIN;

        if (at < others.length && others[at].middle < reachRight) {
            while (at < others.length && others[at].middle < reachRight) at += 1;
        } else {
            while (at > 0 && others[at - 1].middle > reachLeft) at -= 1;
        }

        const ids = others.map(other => other.id);
        ids.splice(at, 0, current.id);

        // Which outline the middle of the tab is inside, if any.
        let inside = null;
        for (const outline of container.querySelectorAll('[data-tab-group]')) {
            const rect = outline.getBoundingClientRect();
            if (middle >= rect.left && middle <= rect.right) {
                inside = outline.dataset.tabGroup;
                break;
            }
        }

        // And which group that means it lands in. Between two members of one
        // group it is in that group whatever the outline says, since there is
        // nowhere else that slot could be. Anywhere else it takes the outline
        // it is inside, but only when the slot puts it against a member of it:
        // see the note at the top about the ends of a run.
        const before = others[at - 1] || null;
        const after = others[at] || null;

        let groupId = null;
        if (before && after && before.groupId && before.groupId === after.groupId) {
            groupId = before.groupId;
        } else if (inside && (
            before?.groupId === inside
            || after?.groupId === inside
            // The group it is already the whole of. A run of one is next to
            // itself wherever it goes, and nudging a tab must not be a way to
            // empty the group it is in without meaning to.
            || (inside === carried.groupId && !others.some(other => other.groupId === inside))
        )) {
            groupId = inside;
        }

        const asked = previewRef.current;
        if (asked
            && asked.groupId === groupId
            && asked.ids.length === ids.length
            && asked.ids.every((id, slot) => id === ids[slot])) return;

        previewRef.current = { ids, groupId };
        setPreview(previewRef.current);
    }, []);

    const begin = useCallback(() => {
        const current = drag.current;
        current.started = true;
        carryingRef.current = current.id;

        // Measured now rather than left to the render: the last pass could have
        // been any number of window resizes ago, and a slide from a stale place
        // is every tab jumping as one of them is picked up.
        pass.current(false);

        document.body.classList.add('tab-dragging');
        setCarrying(current.id);
        current.raf = requestAnimationFrame(frame);
    }, [frame]);

    const end = useCallback((cancelled) => {
        const current = drag.current;
        if (!current) return;

        drag.current = null;
        current.detach();
        if (current.raf) cancelAnimationFrame(current.raf);

        // Never travelled far enough to be a drag, so it was a click and the
        // tab's own handler should still see it.
        if (!current.started) return;

        // A drag that ends over a tab would otherwise fire a click on it, and a
        // click on a tab switches to that session.
        const swallow = (event) => { event.stopPropagation(); event.preventDefault(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);

        const order = previewRef.current;
        previewRef.current = null;
        carryingRef.current = null;

        // The next pass is the one that puts the tab down: nothing is holding
        // it any more, so it slides from where it was let go of to the slot the
        // strip gives it. Committing and clearing the preview in the same tick
        // is what makes that one movement instead of two: React batches them,
        // so the order on screen never flicks back to what it was.
        settling.current = true;
        document.body.classList.remove('tab-dragging');

        if (!cancelled && order) {
            config.current.onReorder?.(order.ids, current.id, order.groupId);
        }
        setPreview(null);
        setCarrying(null);
    }, []);

    const handlePointerDown = useCallback((event, tabId) => {
        if (!enabled || event.button !== 0 || drag.current) return;

        // The close control is a button in its own right, and it sits where the
        // tab's icon is: pressing it must not pick the tab up.
        if (event.target.closest?.('.tab-close')) return;

        const node = event.currentTarget;

        // Listeners on the window rather than the tab: a tab reparents when it
        // moves in or out of a group, which drops anything bound to the node it
        // was picked up from, capture included.
        const onMove = (moveEvent) => {
            const current = drag.current;
            if (!current || moveEvent.pointerId !== current.pointerId) return;

            // The button came up somewhere we could not hear it, over the window
            // chrome or outside the app. Put the tab down rather than leaving it
            // stuck to the cursor.
            if (moveEvent.buttons === 0) {
                end(false);
                return;
            }

            current.pointer = moveEvent.clientX;
            if (current.started) return;
            if (Math.abs(moveEvent.clientX - current.startX) >= START_THRESHOLD) begin();
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
            id: tabId,
            startX: event.clientX,
            pointer: event.clientX,
            wanted: null,
            // Where along the tab it was taken hold of, so it stays under that
            // same point of the pointer however far it travels.
            grab: event.clientX - (node.getBoundingClientRect().left - tabShift(node)),
            started: false,
            detach: () => {
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onUp, true);
                window.removeEventListener('pointercancel', onCancel, true);
                window.removeEventListener('blur', onCancel);
            },
        };
    }, [begin, enabled, end]);

    // Escape puts the tab back where it came from. Bound only while one is
    // being carried, so it cannot shadow anything else the key does.
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

    // A drag outliving the strip it belongs to would leave the grabbing cursor
    // on the whole window and a loop running against a container that is gone.
    useEffect(() => () => {
        const current = drag.current;
        if (!current) return;
        current.detach();
        if (current.raf) cancelAnimationFrame(current.raf);
        document.body.classList.remove('tab-dragging');
        drag.current = null;
    }, []);

    const tabProps = useCallback((tabId) => ({
        'data-dragging': carrying === tabId ? 'true' : undefined,
        onPointerDown: enabled ? (event) => handlePointerDown(event, tabId) : undefined,
    }), [carrying, enabled, handlePointerDown]);

    return { carrying, preview, tabProps };
}
