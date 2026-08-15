import { useLayoutEffect, useRef } from 'react';
import { finishEnter, playEnter } from '../lib/enterMotion';

/**
 * Play a thing in as it arrives.
 *
 * `lib/enterMotion` holds the movements and says why they are shaped as they
 * are. This is only the part that has to know about React: a layout effect, so
 * the opening frame is written before the browser paints and the element is
 * never seen at full strength first, and a cleanup that lands the entrance
 * rather than abandoning it partway.
 *
 * Mount only. An entrance belongs to the element arriving, so something that
 * should play one again wants a `key` and a rebuild, which is what React would
 * be doing to it anyway.
 *
 * Two shapes, because half the things that want one already hold a ref to
 * themselves for measuring or focus:
 *
 *     const ref = useEnter('dialog');            // give me a ref
 *     useEnterOn(menuRef, 'dialog');             // use the one I have
 *
 * A falsy `kind` plays nothing, which is how something rendered on a condition
 * inside a component that stays put asks for an entrance each time it appears:
 *
 *     useEnterOn(menuRef, open && 'dialog');
 *
 * Mounting and unmounting the element itself is the better answer where the
 * component is shaped for it, since then this is only ever asked once.
 */
export function useEnterOn(ref, kind, from) {
    // Read through a ref so a caller working the offset out inline, as the
    // tooltip does, does not restart the entrance on every render.
    const options = useRef(from);
    options.current = from;

    useLayoutEffect(() => {
        const tween = playEnter(ref.current, kind, options.current);
        return () => finishEnter(tween);
    }, [ref, kind]);
}

export default function useEnter(kind, from) {
    const ref = useRef(null);
    useEnterOn(ref, kind, from);
    return ref;
}
