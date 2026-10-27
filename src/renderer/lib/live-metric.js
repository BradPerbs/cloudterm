import { WORDS, fill } from './chart-spec.js';

/**
 * A live chart's arithmetic, kept free of React so the test can load it:
 * the clock labels along its foot, the merge of what arrived into what is
 * held, and the line chart a set of points makes. See LiveMetric.jsx.
 */

const pad = value => String(value).padStart(2, '0');

/** A sample's time as the axis shows it. */
export function clockLabel(ms) {
    const at = new Date(ms);
    return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/**
 * What arrived, added to what is held: anything already held (by its number)
 * is skipped, so a batch overlapping the snapshot is not drawn twice, and the
 * oldest fall off the front past the window. Returns `held` itself when
 * nothing new came, so a chart with nothing to add is not drawn again.
 */
export function mergePoints(held, incoming, window) {
    if (!incoming?.length) return held;
    const last = held.length ? held[held.length - 1].n : 0;
    const fresh = incoming.filter(point => !(point.n <= last));
    if (fresh.length === 0) return held;
    const merged = held.concat(fresh);
    return merged.length > window ? merged.slice(merged.length - window) : merged;
}

/**
 * The series' names: the ones the assistant gave, or its pattern's group
 * names, and the window's own words where there were none. A single unnamed
 * series is called after the chart, which is what it shows.
 */
export function seriesNames(spec, words = WORDS) {
    const given = Array.isArray(spec.series) && spec.series.length ? spec.series : [''];
    return given.map((name, index) => name || (given.length === 1
        ? (spec.title || words.value)
        : fill(words.valueN, { n: index + 1 })));
}

/**
 * The line chart for a set of points: one series per name, gaps as gaps.
 * Marked `live`, so the line does not draw itself in again with every
 * sample. `words` are the window's, as for a chart from a reply.
 */
export function chartOf(spec, points, { words = WORDS, subtitle = '' } = {}) {
    return {
        type: 'line',
        live: true,
        title: spec.title || spec.command || '',
        subtitle,
        unit: spec.unit || '',
        words,
        labels: points.map(point => clockLabel(point.t)),
        series: seriesNames(spec, words).map((name, index) => ({
            name,
            values: points.map(point => (Number.isFinite(point.v?.[index]) ? point.v[index] : null)),
        })),
        limits: Array.isArray(spec.limits) ? spec.limits : [],
        events: [],
        ...(Number.isFinite(spec.min) ? { min: spec.min } : {}),
        ...(Number.isFinite(spec.max) ? { max: spec.max } : {}),
    };
}

/**
 * Why a watch ended, as the catalog key for its code and the values to fill
 * it with. A message from somewhere else (the server, the shell) has no key,
 * and is shown as it came.
 */
export function endingKey({ code = '', vars = {}, reason = '' } = {}) {
    if (!code || code === 'error') return { key: '', vars: {}, text: reason };
    return { key: `assistant.metric.reason.${code}`, vars, text: reason };
}
