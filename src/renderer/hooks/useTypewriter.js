import { useEffect, useRef, useState } from 'react';

/**
 * Reveal a growing string a letter at a time.
 *
 * The model does not stream one letter at a time. It streams tokens, and the
 * transport hands them over in whatever sized lumps the network happened to
 * deliver, so a reply printed exactly as it arrives lands in jerks: a word, a
 * pause, six words at once, a pause. The text is arriving smoothly enough; it
 * is the painting of it that is lumpy.
 *
 * So the arriving text is a target and this is a cursor chasing it. The chase
 * is proportional rather than a fixed letters-per-second: each frame spends a
 * share of whatever it is behind, which means a big lump is caught quickly and
 * a trickle is spread out into an even crawl, without ever choosing a speed
 * that a fast reply then has to visibly wait for.
 *
 * It only ever moves forwards through the same string. Anything else, which is
 * a new turn, a reset, or the finished block arriving to replace the draft,
 * is not a thing to type out and appears whole.
 */

/** How much of the backlog to spend per frame: a fifth of it, so a 100 letter
 *  lump is most of the way in about five frames. */
const CATCH_UP = 5;

/** ... but never less than this, or the last few letters crawl in one by one
 *  at an ever slower rate, which is the tail every naive easing function has. */
const MIN_STEP = 2;

export default function useTypewriter(text = '') {
    const [shown, setShown] = useState('');

    // The animation runs off refs and writes state once per frame. Reading the
    // rendered value inside the loop instead would make every frame a new
    // effect, and the loop would be rebuilt as fast as it runs.
    const shownRef = useRef('');
    const targetRef = useRef('');
    const frameRef = useRef(0);

    useEffect(() => {
        targetRef.current = text;

        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        // Not a continuation of what is on screen, so there is nothing to type.
        if (still || !text.startsWith(shownRef.current)) {
            shownRef.current = text;
            setShown(text);
            return;
        }

        // Already chasing, and the loop reads the target from the ref, so the
        // new text is picked up by the frame that is already scheduled.
        if (frameRef.current || shownRef.current.length === text.length) return;

        const step = () => {
            const target = targetRef.current;
            const behind = target.length - shownRef.current.length;
            if (behind <= 0) {
                frameRef.current = 0;
                return;
            }
            const jump = Math.max(MIN_STEP, Math.ceil(behind / CATCH_UP));
            shownRef.current = target.slice(0, shownRef.current.length + jump);
            setShown(shownRef.current);
            frameRef.current = requestAnimationFrame(step);
        };

        frameRef.current = requestAnimationFrame(step);
    }, [text]);

    // Cleared as well as cancelled: a hook that is torn down and set up again,
    // which is what a dev-mode strict remount does, would otherwise see a live
    // frame id, decline to start a second loop, and never move again.
    useEffect(() => () => {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
    }, []);

    return shown;
}
