import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
    MIN_PANE_FRACTION,
    MIN_PANE_PX,
    PANE_INSET,
    boxStyle,
    measureLayout,
    movePair,
} from '../../lib/panes';

/** Arrow keys nudge a divider by this much of the split. */
const KEY_STEP = 0.02;

/**
 * Keep the rendered order of panes fixed for as long as they exist.
 *
 * The panes are drawn from a flat list, so React only ever appends or removes:
 * a terminal is never moved to a different position among its siblings, and so
 * never has its DOM (and with it its WebGL context and its scrollback) torn out
 * and reinserted when the surrounding layout changes.
 */
function useStableOrder(ids) {
    const orderRef = useRef([]);

    const live = new Set(ids);
    const kept = orderRef.current.filter(id => live.has(id));
    const seen = new Set(kept);
    const order = [...kept, ...ids.filter(id => !seen.has(id))];

    orderRef.current = order;
    return order;
}

/**
 * The handle between two panes. Drags in pixels, commits in shares, and refuses
 * to leave either neighbour narrower than a terminal is worth reading at.
 */
function PaneDivider({ divider, rootRef, onResize, onEqualize }) {
    const dragRef = useRef(null);
    const [dragging, setDragging] = useState(false);

    const horizontal = divider.direction === 'row';

    /** Pixels the children of this split have to share, as things stand. */
    const measure = useCallback(() => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return 0;
        const size = horizontal ? rect.width : rect.height;
        return divider.availableFrac * size + divider.availablePx;
    }, [divider.availableFrac, divider.availablePx, horizontal, rootRef]);

    const floorFor = useCallback((available) => (
        available > 0
            ? Math.max(MIN_PANE_FRACTION, MIN_PANE_PX / available)
            : MIN_PANE_FRACTION
    ), []);

    const handlePointerDown = useCallback((event) => {
        if (event.button !== 0) return;

        const available = measure();
        if (available <= 0) return;

        // The shares as they were when the drag began. Every move is applied to
        // these, so a slow drag lands in the same place as a fast one.
        dragRef.current = {
            available,
            sizes: divider.sizes,
            origin: horizontal ? event.clientX : event.clientY,
        };

        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();

        // The cursor has to survive leaving the 8px handle, and nothing under
        // the pointer should start selecting text while a drag is live.
        document.body.classList.add(horizontal ? 'pane-resizing-x' : 'pane-resizing-y');
    }, [divider.sizes, horizontal, measure]);

    const handlePointerMove = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag) return;

        const position = horizontal ? event.clientX : event.clientY;
        const delta = (position - drag.origin) / drag.available;

        onResize(divider.splitId, movePair(drag.sizes, divider.index, delta, floorFor(drag.available)));
    }, [divider.index, divider.splitId, floorFor, horizontal, onResize]);

    const endDrag = useCallback((event) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        document.body.classList.remove('pane-resizing-x', 'pane-resizing-y');
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // The capture is already gone; nothing left to release.
        }
    }, []);

    const handleKeyDown = useCallback((event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onEqualize(divider.splitId);
            return;
        }

        const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;

        event.preventDefault();
        const available = measure();
        const step = event.key === forward ? KEY_STEP : -KEY_STEP;
        onResize(divider.splitId, movePair(divider.sizes, divider.index, step, floorFor(available)));
    }, [divider.index, divider.sizes, divider.splitId, floorFor, horizontal, measure, onEqualize, onResize]);

    return (
        <div
            role="separator"
            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            aria-label={horizontal ? 'Resize panes horizontally' : 'Resize panes vertically'}
            tabIndex={0}
            data-dragging={dragging ? 'true' : 'false'}
            className={`pane-divider absolute z-20 ${horizontal ? 'pane-divider-x' : 'pane-divider-y'}`}
            // Left to inherit unless this handle is the one being hidden. An
            // explicit `visible` would override the hidden state of the tab
            // this belongs to, and draw it over whatever tab is in front.
            style={{ ...boxStyle(divider.box), visibility: divider.hidden ? 'hidden' : undefined }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onDoubleClick={() => onEqualize(divider.splitId)}
            onKeyDown={handleKeyDown}
        >
            <span className="pane-grip" aria-hidden="true" />
        </div>
    );
}

/**
 * Draws one tab's pane tree.
 *
 * Everything is absolutely positioned from `measureLayout`, which is what keeps
 * the terminals mounted through a restructure. `renderPane` supplies the
 * contents of a leaf; this component owns the geometry, the dividers, and the
 * frame drawn around a pane.
 */
function SplitLayout({
    layout,
    focusedPaneId,
    zoomedPaneId,
    renderPane,
    onResizeSplit,
    onEqualizeSplit,
}) {
    const rootRef = useRef(null);

    const { panes, dividers } = useMemo(
        () => measureLayout(layout, { zoomedPaneId }),
        [layout, zoomedPaneId]
    );

    const split = panes.length > 1;
    const order = useStableOrder(panes.map(pane => pane.id));
    const byId = useMemo(
        () => Object.fromEntries(panes.map(pane => [pane.id, pane])),
        [panes]
    );

    return (
        <div
            ref={rootRef}
            className="pane-surface absolute"
            style={{ inset: split ? PANE_INSET : 0 }}
        >
            {order.map((id) => {
                const pane = byId[id];
                if (!pane) return null;

                const focused = pane.id === focusedPaneId;

                return (
                    <div
                        key={id}
                        data-pane-id={id}
                        className={`pane-box absolute ${split ? 'rounded-xl overflow-hidden' : ''}`}
                        style={{
                            ...boxStyle(pane.box),
                            // Only ever set to hide a pane another one is
                            // zoomed over. Saying `visible` here would override
                            // the hidden state this tab inherits when it is not
                            // the tab in front, and the terminals would show
                            // through whatever is.
                            visibility: pane.hidden ? 'hidden' : undefined,
                            // The focused pane sits above its neighbours so its
                            // frame is never half-covered by theirs.
                            zIndex: pane.zoomed ? 30 : focused ? 10 : 1,
                        }}
                    >
                        {renderPane(pane.node, { focused, zoomed: pane.zoomed, split })}

                        {/* Drawn over the terminal, so the frame reads as part
                            of the pane rather than as something behind it. */}
                        {split && (
                            <span
                                aria-hidden="true"
                                className={`pane-ring pointer-events-none absolute inset-0 rounded-xl z-30 ${
                                    focused ? 'pane-ring-active' : ''
                                }`}
                            />
                        )}
                    </div>
                );
            })}

            {dividers.map(divider => (
                <PaneDivider
                    key={divider.key}
                    divider={divider}
                    rootRef={rootRef}
                    onResize={onResizeSplit}
                    onEqualize={onEqualizeSplit}
                />
            ))}
        </div>
    );
}

export default memo(SplitLayout);
