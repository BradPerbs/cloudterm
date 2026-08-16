import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Whether the element the returned ref is on is narrower than a given width.
 *
 * A media query cannot answer this. The window is not what these panels are
 * laid out in: the sidebar takes a fixed slice off the left and the assistant
 * column an adjustable one (340px at its narrowest, 720 at its widest) off the
 * right, so a header can be squeezed to half its room on a wide display while
 * `lg:` cheerfully still calls it wide. Opening the assistant on the Hosts page
 * is exactly that case, and it is what used to push "New host" off the side of
 * the screen. The element measures itself instead, the way CARD_GRID works out
 * its column count from the width it actually has rather than the window's.
 *
 * Pass one width for one answer, or a list for one answer each:
 *
 *     const [ref, cramped] = useNarrow(520);
 *     const [ref, [tight, cramped]] = useNarrow([720, 520]);
 *
 * Booleans rather than the width itself, because the assistant's edge is
 * dragged: reporting the number would re-render the whole page on every frame
 * of the drag, where a threshold re-renders it once, as it crosses.
 */
export default function useNarrow(thresholds) {
    const list = Array.isArray(thresholds) ? thresholds : [thresholds];
    const ref = useRef(null);
    const [flags, setFlags] = useState(() => list.map(() => false));

    // The widths, as one value an effect can depend on, so a caller writing the
    // list inline does not resubscribe on every render.
    const key = list.join();

    useLayoutEffect(() => {
        const node = ref.current;
        if (!node || typeof ResizeObserver === 'undefined') return undefined;

        const limits = key.split(',').map(Number);

        const measure = (width) => {
            // Zero while the page sits behind a terminal tab. There is nothing
            // to say about a panel nobody can see, and answering "narrow" would
            // only make the row change shape as it is reached for again.
            if (width <= 0) return;

            setFlags((current) => {
                const next = limits.map(limit => width < limit);
                // Same answer as last time is not a render. Every window resize
                // and every frame of an assistant drag arrives here.
                return next.every((flag, index) => flag === current[index]) ? current : next;
            });
        };

        // Before the first paint, so a page that opens narrow is drawn narrow
        // rather than drawn wide and corrected a frame later.
        measure(node.clientWidth);

        const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
        observer.observe(node);
        return () => observer.disconnect();
    }, [key]);

    return [ref, Array.isArray(thresholds) ? flags : flags[0]];
}
