/**
 * What every chart form draws with: colours by role, the axis type, and the
 * small measurements that lay a chart out before it is drawn. The colours
 * themselves live in input.css as `--chart-*`, stepped for light and dark.
 *
 * The movement on the way in is marked by class (`chart-draw`, `chart-fade`,
 * `chart-grow`, `chart-appear`) and played by lib/chartMotion.
 */

/** Series n is always colour n: never cycled, never re-ranked. */
export const seriesColor = index => `var(--chart-${index + 1})`;

/** A colour at some strength over whatever is under it. */
export const tint = (color, percent) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** Status colours, kept apart from the series ones and never used for a series. */
export const STATUS_COLOR = {
    up: 'var(--chart-up)',
    ok: 'var(--chart-1)',
    degraded: 'var(--chart-warning)',
    warning: 'var(--chart-warning)',
    down: 'var(--chart-critical)',
    failed: 'var(--chart-critical)',
    running: 'var(--chart-1)',
};

/** The catalog key that names each status, beside its colour. */
export const statusKey = status => `assistant.chart.status.${status}`;

/** Axis text: muted, small, figures that line up. */
export const AXIS_TEXT = 'fill-gray-400 dark:fill-gray-500 text-[10px] tabular-nums';

/** The width a label takes, near enough, for laying out axes before drawing. */
export const textWidth = (body, size = 10) => String(body).length * size * 0.62;

/** Where a pointer event is, relative to an element: the card, usually. */
export function pointerIn(event, element) {
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/**
 * Rows come in one after another rather than all at once. This only marks a
 * row's place in the order; lib/chartMotion reads it and does the waiting.
 * Past the twelfth they start together, so a long list is not still arriving
 * after the rest of the chart has settled.
 */
export const stagger = index => ({ '--chart-order': Math.min(index, 12) });
