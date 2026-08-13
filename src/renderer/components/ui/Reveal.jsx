import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

/**
 * A block that opens and closes rather than appearing and vanishing.
 *
 * For settings that belong to a choice made above them: pick the local model
 * and its server address is suddenly there, pick something else and it is
 * suddenly not. Rendered conditionally that is a jump, and the rows underneath
 * jump with it, which reads as the page having been rebuilt rather than as one
 * row arriving.
 *
 * The height is tweened to `auto`, which GSAP measures rather than guesses, so
 * this does not need to be told how tall its contents are and goes on working
 * when they change. The contents come in a beat behind the box, which is what
 * makes it read as something opening rather than something being stretched.
 *
 * Closing is the reason for the `mounted` state. React would take the children
 * away the moment `open` goes false, leaving nothing to animate, so they are
 * held until the exit tween has finished with them.
 */

/** Longer on the way in than on the way out: arriving is the part worth seeing. */
const OPEN = 0.34;
const CLOSE = 0.2;

const stillPreferred = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export default function Reveal({ open, className = '', children }) {
    const [mounted, setMounted] = useState(open);
    const box = useRef(null);
    const inner = useRef(null);
    // What it was doing last time, so only a change animates. A page opened
    // with the row already showing should not play it in: nothing moved, the
    // user simply arrived at a setting that was already on.
    const wasOpen = useRef(open);

    if (open && !mounted) setMounted(true);

    useLayoutEffect(() => {
        const node = box.current;
        const content = inner.current;
        if (!node || !content) return undefined;
        if (wasOpen.current === open) return undefined;

        wasOpen.current = open;
        gsap.killTweensOf([node, content]);

        if (stillPreferred()) {
            if (!open) setMounted(false);
            return undefined;
        }

        if (open) {
            gsap.fromTo(
                node,
                { height: 0, opacity: 0, overflow: 'hidden' },
                {
                    height: 'auto',
                    opacity: 1,
                    duration: OPEN,
                    ease: 'power3.out',
                    // Handed back to the stylesheet once it is open, so the row
                    // grows with its own contents afterwards rather than being
                    // pinned to the height it happened to have here.
                    clearProps: 'height,overflow,opacity',
                }
            );
            gsap.fromTo(
                content,
                { y: -10 },
                { y: 0, duration: OPEN, delay: 0.04, ease: 'power3.out', clearProps: 'transform' }
            );
        } else {
            gsap.to(node, {
                height: 0,
                opacity: 0,
                overflow: 'hidden',
                duration: CLOSE,
                ease: 'power2.in',
                onComplete: () => setMounted(false),
            });
        }

        return () => gsap.killTweensOf([node, content]);
    }, [open, mounted]);

    if (!mounted) return null;

    return (
        <div ref={box} className={className}>
            <div ref={inner}>{children}</div>
        </div>
    );
}
