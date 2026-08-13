import { gsap } from 'gsap';

/**
 * What every piece of GSAP work in the app is built on: the curves, the
 * question of whether to move at all, and the one bit of global configuration.
 *
 * The movements themselves live beside the thing they move. `tabMotion` has the
 * tab strip, `panelMotion` the columns down either side of the window.
 */

// A target that has gone while a tween was queued is ordinary here: a tab can
// be closed mid-slide, a panel unmounted mid-reveal. Not worth a console line
// each time.
gsap.config({ nullTargetWarn: false });

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a function GSAP will take for `ease`.
 *
 * Solved here rather than approximated with one of GSAP's named curves, or
 * reached for from CustomEase: `expo.out` and the rest are near the ones this
 * app was drawn with but not the same, and every animation here was tuned
 * against the exact curve its stylesheet rule named.
 *
 * Newton-Raphson to invert x(t), which converges in two or three steps over
 * curves this tame, and bisection behind it for the flat stretches where the
 * derivative is no help.
 */
export function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;

    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    const atX = (t) => ((ax * t + bx) * t + cx) * t;
    const atY = (t) => ((ay * t + by) * t + cy) * t;
    const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

    return (progress) => {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;

        let t = progress;
        for (let step = 0; step < 8; step += 1) {
            const error = atX(t) - progress;
            if (Math.abs(error) < 1e-6) return atY(t);
            const slope = slopeX(t);
            if (Math.abs(slope) < 1e-6) break;
            t -= error / slope;
        }

        // Newton wandered off, so bracket it instead. Started from the guess
        // rather than the midpoint, which is already close on these curves.
        let low = 0;
        let high = 1;
        t = progress;
        for (let step = 0; step < 24; step += 1) {
            const error = atX(t) - progress;
            if (Math.abs(error) < 1e-6) break;
            if (error > 0) high = t; else low = t;
            t = (low + high) / 2;
        }
        return atY(t);
    };
}

export const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * A duration, in the seconds GSAP counts in, or nothing at all when the user
 * has asked for stillness. A tween of no length still runs and still reports
 * back, so whatever was waiting on the end of the movement is not left hanging.
 */
export const seconds = (ms) => (prefersReducedMotion() ? 0 : ms / 1000);
