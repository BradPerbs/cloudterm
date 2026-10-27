import { gsap } from 'gsap';
import { cubicBezier, seconds } from './motion';

/**
 * A chart arriving: lines draw themselves left to right, the washes under
 * them fade up a beat later, bars grow out of their baseline and tiles rise
 * into place, each row a little after the one above it.
 *
 * The forms only say what moves, with a class on each mark (`chart-draw`,
 * `chart-fade`, `chart-grow`, `chart-appear`, see lib/chart-draw) and a row's
 * place in the order as `--chart-order`. Played from here as one timeline per
 * chart, so the whole entrance can be landed at once when the chart goes away
 * mid-movement, and so a reader who asked for less motion gets the finished
 * chart straight away (`seconds` is nothing for them).
 *
 * Mount only, like every entrance in the app (see lib/enterMotion). A live
 * chart is drawn again with every sample and must not replay any of this, so
 * its line carries no class to begin with.
 */

/** The line's curve: slow off the mark and slow into the end, as a pen would. */
const DRAW = cubicBezier(0.65, 0, 0.35, 1);

/** The app's house curve, for things that settle into place. */
const SOFT = cubicBezier(0.16, 1, 0.3, 1);

/** CSS's own `ease-out`, for the washes. */
const EASE_OUT = cubicBezier(0, 0, 0.58, 1);

/** How far apart rows start. */
const STAGGER_MS = 45;

/** How long the washes wait, so the line is visibly on its way first. */
const FADE_DELAY_MS = 350;

/** When a marked row starts, from its place in the order. */
function delayOf(node) {
    const order = Number(node.style.getPropertyValue('--chart-order')) || 0;
    return seconds(order * STAGGER_MS);
}

/**
 * Play a chart in. `root` is the plot; anything marked inside it moves.
 * Returns the timeline, or null when there was nothing to play.
 */
export function playChart(root) {
    if (!root) return null;
    const marked = root.querySelectorAll('.chart-draw, .chart-fade, .chart-grow, .chart-appear');
    if (marked.length === 0) return null;

    const timeline = gsap.timeline();
    for (const node of marked) {
        const list = node.classList;
        if (list.contains('chart-draw')) {
            // Each line is given pathLength="1", so one dash the length of
            // the whole path, pushed off by its own length, is the line not
            // yet drawn.
            timeline.fromTo(
                node,
                { strokeDasharray: 1, strokeDashoffset: 1 },
                {
                    strokeDasharray: 1,
                    strokeDashoffset: 0,
                    duration: seconds(1000),
                    ease: DRAW,
                    clearProps: 'strokeDasharray,strokeDashoffset',
                },
                0,
            );
        } else if (list.contains('chart-fade')) {
            timeline.fromTo(
                node,
                { opacity: 0 },
                { opacity: 1, duration: seconds(800), ease: EASE_OUT, clearProps: 'opacity' },
                seconds(FADE_DELAY_MS),
            );
        } else if (list.contains('chart-grow')) {
            // From the left edge, where a bar's value starts.
            timeline.fromTo(
                node,
                { scaleX: 0, transformOrigin: 'left center' },
                {
                    scaleX: 1,
                    duration: seconds(750),
                    ease: SOFT,
                    clearProps: 'transform,transformOrigin',
                },
                delayOf(node),
            );
        } else {
            timeline.fromTo(
                node,
                { opacity: 0, y: 3 },
                { opacity: 1, y: 0, duration: seconds(500), ease: SOFT, clearProps: 'opacity,transform' },
                delayOf(node),
            );
        }
    }
    return timeline;
}

/**
 * Land a chart's entrance at once, for a chart taken away mid-movement or
 * mounted twice by StrictMode: killed partway, its marks would keep whatever
 * frame they had reached, a line half drawn or a bar at a third of its width.
 */
export function finishChart(timeline) {
    if (!timeline) return;
    timeline.progress(1);
    timeline.kill();
}
