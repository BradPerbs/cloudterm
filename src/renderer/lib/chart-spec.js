/**
 * The ```chart fence: what the assistant may write in one, and what it means.
 *
 * A chart in a reply is a small JSON object rather than a picture, so the
 * transcript stays text, the numbers can be copied, and nothing is parsed as
 * HTML. This module is the whole of the reading: it takes the fence's body and
 * gives back either a normalised chart or a reason it is not one, in which case
 * the block is shown as the code it is. Kept free of React so the test can
 * load it on its own.
 *
 * The forms, each documented at its reader below:
 *
 *   bar, line, area   labels + series, or the one-series `data` shorthand.
 *                     `"stacked": true` stacks bars or areas; lines and areas
 *                     also take `limits` (threshold lines) and `events`.
 *   meter             how full each thing is against its own max.
 *   stats             a row of headline numbers, each with an optional trend.
 *   donut             shares of a whole, five slices and "Other" at most.
 *   treemap           sizes as nested boxes: where the space went.
 *   heatmap           a grid of values, rows by columns.
 *   uptime            a strip of status cells per thing: up, degraded, down.
 *   timeline          spans of time per row: runs, deploys, incidents.
 *
 * The words a chart prints that are not the model's own (a default series
 * name, a table's headings, "Other") come from `WORDS`, which the window
 * replaces with its own language's when it parses (see Chart.jsx). A reason a
 * spec was refused comes back as a code and its values as well as an English
 * sentence, so the window can say it in the reader's language too.
 */

export const CHART_TYPES = ['bar', 'line', 'area', 'meter', 'stats', 'donut', 'treemap', 'heatmap', 'uptime', 'timeline'];

/** Other names a model reaches for, read as the form they mean. */
const ALIASES = {
    'stacked-bar': ['bar', { stacked: true }],
    'stacked-area': ['area', { stacked: true }],
    column: ['bar'],
    pie: ['donut'],
    gantt: ['timeline'],
    status: ['uptime'],
    kpi: ['stats'],
    tiles: ['stats'],
};

/**
 * How many series a chart may carry. Eight is the length of the palette, whose
 * order is what keeps neighbours apart for colour-blind readers; a ninth would
 * be a colour nobody checked. Grouped bars stop sooner: in a 400px panel four
 * bars to a row is already as thin as a bar should get.
 */
export const MAX_SERIES = { bar: 4, line: 8, area: 8, meter: 1 };

/** Rows for a bar chart or meters, and points for a line. */
export const MAX_POINTS = { bar: 40, meter: 40, line: 2000, area: 2000 };

/** Where a meter turns to warning and to critical, in percent of its max. */
export const DEFAULT_THRESHOLDS = [80, 90];

/** Slices a donut shows before the rest are folded into "Other". */
export const DONUT_SLICES = 5;

/**
 * The chart's own words, in English. `{name}` marks are filled in where they
 * are used. The window passes a translated set of the same keys.
 */
export const WORDS = {
    value: 'Value',
    valueN: 'Value {n}',
    series: 'Series {n}',
    row: 'Row {n}',
    span: 'Span {n}',
    other: 'Other ({count})',
    total: 'Total',
    share: 'Share',
    max: 'Max',
    used: 'Used',
    note: 'Note',
    start: 'Start',
    end: 'End',
    duration: 'Duration',
    status: 'Status',
    running: 'running',
    seconds: '{n}s',
    minutes: '{n}m',
    hours: '{h}h {m}m',
    days: '{d}d {h}h',
};

/**
 * Why a spec is not a chart, by code. The sentence is for the person reading,
 * shown under the code block, so it names what was wrong rather than where the
 * parser was when it noticed. Field names and chart types are quoted as they
 * are written in the JSON, which reads the same in any language.
 */
export const MESSAGES = {
    json: 'The chart is not valid JSON.',
    object: 'A chart is a JSON object.',
    type: 'Unknown chart type "{type}". Use {types}.',
    labels: 'A chart with "series" needs "labels" as well.',
    needsSeries: 'A "{type}" chart needs "data", or "labels" with "series".',
    needsData: 'A "{type}" chart needs "data": a list.',
    needsGrid: 'A "heatmap" chart needs "x", "y" and "values", one row of values per y.',
    empty: 'The chart has no data.',
    noNumbers: 'The chart has no numbers in it.',
    nothingAboveZero: 'Every value in the chart is zero or missing.',
    tooMany: '"{field}" has {count}; a "{type}" chart takes at most {max}.',
    notNumber: '"{name}" has a value that is not a number.',
    negative: 'A "{type}" chart cannot show negative values; a "line" chart can.',
    meterMax: 'Every meter needs a "max" above zero, or "unit": "%".',
    noValue: '"{name}" has no value.',
    status: '"{value}" is not a status. Use up, degraded or down.',
    noStart: '"{name}" needs a "start" time.',
    badEnd: '"{name}" has an "end" that is not a time.',
    mixedTimes: 'A timeline uses times of day ("14:05") or full dates, not both.',
    endsFirst: '"{name}" ends before it starts.',
};

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

/** `{name}` marks in a phrase, filled from `vars`. */
export function fill(phrase, vars = {}) {
    return String(phrase).replace(/\{(\w+)\}/g, (whole, name) => (
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
    ));
}

/** A value from the spec as a number, or null for a gap. */
function toValue(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const value = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : raw;
    return isNumber(value) ? value : NaN;
}

function text(raw, limit = 120) {
    if (raw === null || raw === undefined) return '';
    return String(raw).slice(0, limit);
}

/** A refusal: the code and its values for the window, and the sentence in English. */
function fail(code, vars = {}) {
    return { error: fill(MESSAGES[code], vars), code, vars };
}

/** Thrown from inside a reader that is several calls deep, and caught at its top. */
class Refusal extends Error {
    constructor(code, vars) {
        super(fill(MESSAGES[code], vars));
        this.code = code;
        this.vars = vars;
    }
}

/** The parts every chart shares, and the words and locale it is printed in. */
function common(spec, type, words, locale) {
    return {
        type,
        title: text(spec.title),
        subtitle: text(spec.subtitle, 200),
        unit: text(spec.unit, 12),
        words,
        locale,
    };
}

/**
 * The fence's body as a chart.
 *
 * Returns `{ chart }` or `{ error, code, vars }`. `words` and `locale` are the
 * window's language, for the names a chart makes up and the dates it prints;
 * left out, they are English.
 */
export function parseChart(source, { words = WORDS, locale = '' } = {}) {
    let spec;
    try {
        spec = JSON.parse(String(source || ''));
    } catch {
        return fail('json');
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        return fail('object');
    }

    let type = String(spec.type || 'bar').toLowerCase();
    if (ALIASES[type]) {
        const [real, extra] = ALIASES[type];
        type = real;
        spec = { ...spec, ...extra };
    }
    if (!CHART_TYPES.includes(type)) {
        return fail('type', { type: text(spec.type, 30), types: CHART_TYPES.join(', ') });
    }

    const own = { ...WORDS, ...words };
    switch (type) {
        case 'stats': return readStats(spec, own, locale);
        case 'donut': return readDonut(spec, own, locale);
        case 'treemap': return readTreemap(spec, own, locale);
        case 'heatmap': return readHeatmap(spec, own, locale);
        case 'uptime': return readUptime(spec, own, locale);
        case 'timeline': return readTimeline(spec, own, locale);
        default: return readSeries(spec, type, own, locale);
    }
}

/* ------------------------------------------------------------------ *
 * bar, line, area, meter
 * ------------------------------------------------------------------ */

function readSeries(spec, type, words, locale) {
    let labels;
    let series;
    let maxes = null;
    const stacked = Boolean(spec.stacked) && (type === 'bar' || type === 'area');

    if (Array.isArray(spec.data)) {
        // The one-series shorthand: rows of { label, value }.
        labels = spec.data.map((row, index) => text(row?.label ?? row?.name ?? index + 1));
        series = [{ name: text(spec.name || spec.title || words.value), values: spec.data.map(row => toValue(row?.value)) }];
        if (type === 'meter') {
            maxes = spec.data.map(row => toValue(row?.max ?? spec.max ?? (spec.unit === '%' ? 100 : null)));
        }
    } else if (Array.isArray(spec.series)) {
        if (!Array.isArray(spec.labels)) return fail('labels');
        labels = spec.labels.map(label => text(label));
        series = spec.series.map((entry, index) => {
            const values = Array.isArray(entry?.values) ? entry.values : [];
            // A series one short or one long is a slip, not a different chart:
            // it is fitted to the labels, the missing points left as gaps.
            const fitted = labels.map((_, at) => toValue(values[at]));
            return { name: text(entry?.name || fill(words.series, { n: index + 1 }), 60), values: fitted };
        });
        if (type === 'meter') {
            maxes = labels.map(() => toValue(spec.max ?? (spec.unit === '%' ? 100 : null)));
        }
    } else {
        return fail('needsSeries', { type });
    }

    if (labels.length === 0) return fail('empty');
    if (labels.length > MAX_POINTS[type]) {
        return fail('tooMany', { field: Array.isArray(spec.data) ? 'data' : 'labels', count: labels.length, type, max: MAX_POINTS[type] });
    }
    if (series.length === 0) return fail('empty');
    // Stacked bars are one bar a row however many series, so they may carry the
    // whole palette; grouped bars may not.
    const most = stacked ? 8 : MAX_SERIES[type];
    if (series.length > most) {
        return fail('tooMany', { field: 'series', count: series.length, type, max: most });
    }

    for (const entry of series) {
        if (entry.values.some(Number.isNaN)) return fail('notNumber', { name: entry.name });
    }
    if (!series.some(entry => entry.values.some(isNumber))) return fail('noNumbers');

    if (type === 'bar' || type === 'meter' || stacked) {
        if (series.some(entry => entry.values.some(value => isNumber(value) && value < 0))) {
            return fail('negative', { type });
        }
    }

    if (type === 'meter') {
        if (maxes.some(max => !isNumber(max) || max <= 0)) return fail('meterMax');
    }

    const chart = { ...common(spec, type, words, locale), labels, series };

    if (stacked) chart.stacked = true;
    if (maxes) chart.maxes = maxes;
    if (isNumber(toValue(spec.min))) chart.min = toValue(spec.min);
    if (isNumber(toValue(spec.max)) && type !== 'meter') chart.max = toValue(spec.max);

    if (type === 'meter') {
        const given = Array.isArray(spec.thresholds) ? spec.thresholds.map(toValue) : [];
        const warn = isNumber(given[0]) ? given[0] : DEFAULT_THRESHOLDS[0];
        const critical = isNumber(given[1]) ? given[1] : DEFAULT_THRESHOLDS[1];
        chart.thresholds = [Math.min(warn, critical), Math.max(warn, critical)];
    }

    if (type === 'line' || type === 'area') {
        chart.limits = readLimits(spec.limits);
        chart.events = readEvents(spec.events, labels);
    }

    return { chart };
}

/**
 * Threshold lines across a line chart: `[{ "value": 90, "label": "Alert" }]`.
 * A bare number is a line with no label.
 */
export function readLimits(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 4).map((entry) => {
        const value = toValue(typeof entry === 'object' && entry ? entry.value : entry);
        return isNumber(value) ? { value, label: text(entry?.label, 40) } : null;
    }).filter(Boolean);
}

/**
 * Moments marked along a line chart: `[{ "at": "10:35", "label": "Deploy" }]`.
 * `at` is one of the labels, or the index of one. One that matches neither is
 * dropped rather than guessed at.
 */
function readEvents(raw, labels) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 12).map((entry) => {
        const at = entry?.at;
        let index = labels.indexOf(text(at));
        if (index < 0 && Number.isInteger(at) && at >= 0 && at < labels.length) index = at;
        return index >= 0 ? { index, label: text(entry?.label, 40) } : null;
    }).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * stats
 * ------------------------------------------------------------------ */

/**
 * Headline numbers, a tile each:
 *   { "type": "stats", "data": [{ "label": "CPU", "value": 34, "unit": "%",
 *     "trend": [20, 31, 28, 34], "note": "8 cores" }] }
 * A value that is not a number (an uptime of "14d 3h") is shown as written.
 */
function readStats(spec, words, locale) {
    if (!Array.isArray(spec.data) || spec.data.length === 0) return fail('needsData', { type: 'stats' });
    if (spec.data.length > 8) return fail('tooMany', { field: 'data', count: spec.data.length, type: 'stats', max: 8 });
    const tiles = [];
    for (const [index, row] of spec.data.entries()) {
        const raw = row?.value;
        const label = text(row?.label ?? fill(words.valueN, { n: index + 1 }), 40);
        const value = typeof raw === 'number' || (typeof raw === 'string' && /^-?[\d,.]+$/.test(raw.trim())) ? toValue(raw) : null;
        const shown = value === null ? text(raw, 24) : '';
        if (Number.isNaN(value)) return fail('notNumber', { name: label });
        if (value === null && !shown) return fail('noValue', { name: label });
        const trend = Array.isArray(row?.trend) ? row.trend.slice(-120).map(toValue) : [];
        if (trend.some(Number.isNaN)) return fail('notNumber', { name: `${label}: trend` });
        const change = toValue(row?.change);
        tiles.push({
            label,
            value,
            shown,
            unit: text(row?.unit ?? spec.unit, 12),
            note: text(row?.note, 60),
            trend,
            change: isNumber(change) ? change : null,
        });
    }
    return { chart: { ...common(spec, 'stats', words, locale), tiles } };
}

/* ------------------------------------------------------------------ *
 * donut
 * ------------------------------------------------------------------ */

/**
 * Shares of one whole:
 *   { "type": "donut", "data": [{ "label": "logs", "value": 31 }, ...] }
 * Largest first. Past five slices the rest become one "Other", because a
 * sixth wedge is a sliver no one can read or tell apart by colour.
 */
function readDonut(spec, words, locale) {
    if (!Array.isArray(spec.data) || spec.data.length === 0) return fail('needsData', { type: 'donut' });
    const slices = [];
    for (const row of spec.data) {
        const value = toValue(row?.value);
        if (Number.isNaN(value)) return fail('notNumber', { name: text(row?.label) });
        if (isNumber(value) && value < 0) return fail('negative', { type: 'donut' });
        if (isNumber(value) && value > 0) slices.push({ label: text(row?.label, 60), value });
    }
    if (slices.length === 0) return fail('nothingAboveZero');
    slices.sort((a, b) => b.value - a.value);
    if (slices.length > DONUT_SLICES + 1) {
        const rest = slices.splice(DONUT_SLICES);
        slices.push({
            label: fill(words.other, { count: rest.length }),
            value: rest.reduce((sum, slice) => sum + slice.value, 0),
            other: true,
        });
    }
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return { chart: { ...common(spec, 'donut', words, locale), slices, total, center: text(spec.center ?? words.total, 24) } };
}

/* ------------------------------------------------------------------ *
 * treemap
 * ------------------------------------------------------------------ */

/**
 * Sizes as boxes, one level of nesting at most:
 *   { "type": "treemap", "unit": "GB", "data": [
 *     { "label": "/var/log", "value": 31 },
 *     { "label": "/var/lib", "children": [{ "label": "docker", "value": 12 }, ...] } ] }
 * A parent with children is as big as they are together.
 */
function readTreemap(spec, words, locale) {
    if (!Array.isArray(spec.data) || spec.data.length === 0) return fail('needsData', { type: 'treemap' });
    let leaves = 0;
    const read = (row) => {
        const label = text(row?.label ?? row?.name, 60);
        if (Array.isArray(row?.children) && row.children.length) {
            const children = [];
            for (const child of row.children) {
                const value = toValue(child?.value);
                if (Number.isNaN(value)) throw new Refusal('notNumber', { name: text(child?.label) });
                if (isNumber(value) && value < 0) throw new Refusal('negative', { type: 'treemap' });
                if (isNumber(value) && value > 0) { children.push({ label: text(child?.label ?? child?.name, 60), value }); leaves += 1; }
            }
            children.sort((a, b) => b.value - a.value);
            const value = children.reduce((sum, child) => sum + child.value, 0);
            return value > 0 ? { label, value, children } : null;
        }
        const value = toValue(row?.value);
        if (Number.isNaN(value)) throw new Refusal('notNumber', { name: label });
        if (isNumber(value) && value < 0) throw new Refusal('negative', { type: 'treemap' });
        if (!isNumber(value) || value <= 0) return null;
        leaves += 1;
        return { label, value, children: null };
    };
    let nodes;
    try {
        nodes = spec.data.map(read).filter(Boolean);
    } catch (error) {
        if (error instanceof Refusal) return fail(error.code, error.vars);
        throw error;
    }
    if (nodes.length === 0) return fail('nothingAboveZero');
    if (nodes.length > 8 && nodes.some(node => node.children)) {
        return fail('tooMany', { field: 'data', count: nodes.length, type: 'treemap', max: 8 });
    }
    if (leaves > 80) return fail('tooMany', { field: 'data', count: leaves, type: 'treemap', max: 80 });
    nodes.sort((a, b) => b.value - a.value);
    const total = nodes.reduce((sum, node) => sum + node.value, 0);
    return { chart: { ...common(spec, 'treemap', words, locale), nodes, total, nested: nodes.some(node => node.children) } };
}

/**
 * Boxes for values in a rectangle, as square as they can be made.
 *
 * Squarified layout (Bruls, Huizing, van Wijk): lay boxes along the shorter
 * side one at a time while doing so keeps the row's worst aspect ratio from
 * getting worse, then start a new row in what is left. `items` must be sorted
 * largest first. Returns rectangles in the same order.
 */
export function squarify(items, x, y, width, height) {
    const total = items.reduce((sum, item) => sum + item.value, 0);
    if (!(total > 0) || width <= 0 || height <= 0) return items.map(() => ({ x, y, width: 0, height: 0 }));
    const scale = (width * height) / total;
    const areas = items.map(item => item.value * scale);
    const out = new Array(items.length);

    const worst = (row, side) => {
        const sum = row.reduce((a, b) => a + b, 0);
        const max = Math.max(...row);
        const min = Math.min(...row);
        return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    };

    let index = 0;
    let box = { x, y, width, height };
    while (index < areas.length) {
        const side = Math.min(box.width, box.height);
        const row = [areas[index]];
        let next = index + 1;
        while (next < areas.length && worst([...row, areas[next]], side) <= worst(row, side)) {
            row.push(areas[next]);
            next += 1;
        }
        const sum = row.reduce((a, b) => a + b, 0);
        if (box.width >= box.height) {
            // A column down the left of what is left.
            const columnWidth = sum / box.height;
            let top = box.y;
            row.forEach((area, at) => {
                const cell = area / columnWidth;
                out[index + at] = { x: box.x, y: top, width: columnWidth, height: cell };
                top += cell;
            });
            box = { x: box.x + columnWidth, y: box.y, width: box.width - columnWidth, height: box.height };
        } else {
            // A row across the top.
            const rowHeight = sum / box.width;
            let left = box.x;
            row.forEach((area, at) => {
                const cell = area / rowHeight;
                out[index + at] = { x: left, y: box.y, width: cell, height: rowHeight };
                left += cell;
            });
            box = { x: box.x, y: box.y + rowHeight, width: box.width, height: box.height - rowHeight };
        }
        index = next;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * heatmap
 * ------------------------------------------------------------------ */

/**
 * A grid, rows by columns:
 *   { "type": "heatmap", "x": ["00", "01", ...], "y": ["Mon", "Tue", ...],
 *     "values": [[3, 0, 1, ...], ...] }
 * One row of `values` per `y`, one value per `x`; gaps are null.
 */
function readHeatmap(spec, words, locale) {
    if (!Array.isArray(spec.x) || !Array.isArray(spec.y) || !Array.isArray(spec.values)) return fail('needsGrid');
    const x = spec.x.map(label => text(label, 30));
    const y = spec.y.map(label => text(label, 30));
    if (x.length === 0 || y.length === 0) return fail('empty');
    if (x.length > 60) return fail('tooMany', { field: 'x', count: x.length, type: 'heatmap', max: 60 });
    if (y.length > 31) return fail('tooMany', { field: 'y', count: y.length, type: 'heatmap', max: 31 });
    const values = y.map((_, row) => x.map((__, column) => toValue(spec.values[row]?.[column])));
    if (values.some(row => row.some(Number.isNaN))) return fail('notNumber', { name: 'values' });
    if (!values.some(row => row.some(isNumber))) return fail('noNumbers');
    return { chart: { ...common(spec, 'heatmap', words, locale), x, y, values } };
}

/* ------------------------------------------------------------------ *
 * uptime
 * ------------------------------------------------------------------ */

const STATUS_WORDS = {
    up: 'up', ok: 'up', online: 'up', healthy: 'up', pass: 'up', true: 'up', 1: 'up',
    degraded: 'degraded', warn: 'degraded', warning: 'degraded', slow: 'degraded', partial: 'degraded',
    down: 'down', fail: 'down', failed: 'down', error: 'down', offline: 'down', false: 'down', 0: 'down',
};

/** A status word as up, degraded or down; null for not known. */
export function readStatus(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    return STATUS_WORDS[String(raw).trim().toLowerCase()] ?? undefined;
}

/**
 * A strip of status cells per row, the way status pages draw it:
 *   { "type": "uptime", "labels": ["Oct 1", ...],
 *     "series": [{ "name": "web1", "values": ["up", "up", "down", ...] }] }
 * or `data: [{ "label": "Oct 1", "status": "up" }]` for a single row.
 */
function readUptime(spec, words, locale) {
    let labels;
    let rows;
    if (Array.isArray(spec.data)) {
        labels = spec.data.map((cell, index) => text(cell?.label ?? index + 1, 40));
        rows = [{ name: text(spec.name || spec.title || ''), raw: spec.data.map(cell => cell?.status ?? cell?.value) }];
    } else if (Array.isArray(spec.series) && Array.isArray(spec.labels)) {
        labels = spec.labels.map(label => text(label, 40));
        rows = spec.series.map((entry, index) => ({ name: text(entry?.name || fill(words.row, { n: index + 1 }), 40), raw: entry?.values || [] }));
    } else {
        return fail('needsSeries', { type: 'uptime' });
    }
    if (labels.length === 0) return fail('empty');
    if (labels.length > 120) {
        return fail('tooMany', { field: Array.isArray(spec.data) ? 'data' : 'labels', count: labels.length, type: 'uptime', max: 120 });
    }
    if (rows.length > 12) return fail('tooMany', { field: 'series', count: rows.length, type: 'uptime', max: 12 });
    const series = [];
    for (const row of rows) {
        const values = labels.map((_, at) => readStatus(row.raw[at]));
        const bad = values.findIndex(value => value === undefined);
        if (bad >= 0) return fail('status', { value: text(row.raw[bad], 20) });
        series.push({ name: row.name, values });
    }
    if (!series.some(row => row.values.some(Boolean))) return fail('empty');
    return { chart: { ...common(spec, 'uptime', words, locale), labels, series } };
}

/** The share of known cells that were up (degraded counts as up, as on status pages). */
export function uptimeShare(values) {
    const known = values.filter(Boolean);
    if (!known.length) return null;
    return (known.filter(value => value !== 'down').length / known.length) * 100;
}

/* ------------------------------------------------------------------ *
 * timeline
 * ------------------------------------------------------------------ */

const DAY = 86400000;

/**
 * A time as milliseconds. ISO dates and epoch seconds or milliseconds are
 * moments; a bare "14:05" is a time of day, measured from midnight. The two
 * do not mix in one chart.
 */
function readTime(raw) {
    if (isNumber(raw)) return { ms: raw < 1e11 ? raw * 1000 : raw, clock: false };
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const clock = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (clock) {
        return { ms: ((Number(clock[1]) * 60 + Number(clock[2])) * 60 + Number(clock[3] || 0)) * 1000, clock: true };
    }
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? { ms, clock: false } : NaN;
}

const SPAN_STATUS = { ok: 'ok', done: 'ok', success: 'ok', passed: 'ok', failed: 'failed', fail: 'failed', error: 'failed', running: 'running', active: 'running', warn: 'warning', warning: 'warning', slow: 'warning' };

/**
 * Spans of time, one row each:
 *   { "type": "timeline", "data": [{ "label": "backup", "start": "01:00",
 *     "end": "01:42", "status": "ok" }, ...] }
 * A span with no end is still running, and runs to the latest time in the chart.
 */
function readTimeline(spec, words, locale) {
    if (!Array.isArray(spec.data) || spec.data.length === 0) return fail('needsData', { type: 'timeline' });
    if (spec.data.length > 40) return fail('tooMany', { field: 'data', count: spec.data.length, type: 'timeline', max: 40 });
    const spans = [];
    let clock = null;
    for (const [index, row] of spec.data.entries()) {
        const label = text(row?.label ?? row?.name ?? fill(words.span, { n: index + 1 }), 60);
        const start = readTime(row?.start);
        const end = row?.end === undefined || row?.end === null || row?.end === '' ? null : readTime(row?.end);
        if (!start || Number.isNaN(start)) return fail('noStart', { name: label });
        if (Number.isNaN(end)) return fail('badEnd', { name: label });
        for (const time of [start, end]) {
            if (!time) continue;
            if (clock === null) clock = time.clock;
            else if (clock !== time.clock) return fail('mixedTimes');
        }
        let finish = end?.ms ?? null;
        // A time of day that ends before it starts ran past midnight.
        if (finish !== null && clock && finish < start.ms) finish += DAY;
        if (finish !== null && finish < start.ms) return fail('endsFirst', { name: label });
        const status = SPAN_STATUS[String(row?.status || '').toLowerCase()] || (finish === null ? 'running' : '');
        spans.push({ label, start: start.ms, end: finish, status, group: text(row?.group, 40) });
    }
    const latest = Math.max(...spans.map(span => span.end ?? span.start));
    for (const span of spans) {
        if (span.end === null) { span.end = Math.max(latest, span.start); span.open = true; }
    }
    return { chart: { ...common(spec, 'timeline', words, locale), spans, clock: Boolean(clock) } };
}

const TIME_STEPS = [
    1000, 5000, 15000, 30000,
    60000, 300000, 600000, 900000, 1800000,
    3600000, 7200000, 10800000, 21600000, 43200000,
    DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY,
];

/** Round ticks across a span of time: every 15 minutes, every 6 hours, every day. */
export function timeTicks(from, to, count = 5) {
    const span = Math.max(1, to - from);
    const step = TIME_STEPS.find(candidate => span / candidate <= count) || TIME_STEPS[TIME_STEPS.length - 1];
    // Days are counted from local midnight; anything shorter from the epoch,
    // which for these steps lands on the same round marks.
    const offset = step >= DAY ? new Date(from).getTimezoneOffset() * 60000 : 0;
    const ticks = [];
    for (let tick = Math.ceil((from - offset) / step) * step + offset; tick <= to; tick += step) ticks.push(tick);
    return { step, ticks };
}

const pad = number => String(number).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day as the reader's language writes it: "Oct 4", "4 окт.", "10月4日". */
function dayOf(date, locale) {
    if (!locale) return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
    try {
        return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
    } catch {
        return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
    }
}

/**
 * A time for an axis or a tooltip. A time of day is read in its own terms
 * (from midnight, no time zone); a full date in the viewer's local time.
 */
export function formatTime(ms, { clock = false, step = 0, full = false, locale = '' } = {}) {
    const date = new Date(ms);
    const get = clock
        ? { h: date.getUTCHours(), m: date.getUTCMinutes(), s: date.getUTCSeconds() }
        : { h: date.getHours(), m: date.getMinutes(), s: date.getSeconds() };
    const time = `${pad(get.h)}:${pad(get.m)}${step && step < 60000 ? `:${pad(get.s)}` : ''}`;
    if (clock) return time;
    if (step >= DAY) return dayOf(date, locale);
    return full ? `${dayOf(date, locale)}, ${time}` : time;
}

/** How long, as a person says it: 45s, 12m, 1h 05m, 2d 3h. */
export function formatDuration(ms, words = WORDS) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return fill(words.seconds, { n: seconds });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return fill(words.minutes, { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return fill(words.hours, { h: hours, m: pad(minutes % 60) });
    return fill(words.days, { d: Math.floor(hours / 24), h: hours % 24 });
}

/* ------------------------------------------------------------------ *
 * Shared arithmetic
 * ------------------------------------------------------------------ */

/** 1, 2, 2.5 or 5 times a power of ten: the steps an axis reads easily in. */
function niceStep(rough) {
    if (!(rough > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(rough));
    const fraction = rough / power;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
    return nice * power;
}

/**
 * A value axis: round ends, and the ticks between them.
 *
 * The scale starts at zero whenever every value is at or above it, because a
 * bar or a line that starts anywhere else overstates every change it shows. A
 * chart that wants otherwise says `min`.
 */
export function niceScale(low, high, { count = 4, min, max } = {}) {
    let bottom = isNumber(min) ? min : Math.min(0, low);
    let top = isNumber(max) ? max : high;
    if (!(top > bottom)) top = bottom + (Math.abs(bottom) || 1);

    const step = niceStep((top - bottom) / count);
    if (!isNumber(min)) bottom = Math.floor(bottom / step) * step;
    if (!isNumber(max)) top = Math.ceil(top / step - 1e-9) * step;

    const ticks = [];
    // Counted rather than added, so 0.1 + 0.2 never puts a tick at 0.30000000000000004.
    const first = Math.ceil(bottom / step - 1e-9);
    const last = Math.floor(top / step + 1e-9);
    for (let index = first; index <= last; index += 1) {
        ticks.push(Number((index * step).toPrecision(12)));
    }
    return { min: bottom, max: top, ticks };
}

/** The smallest and largest number across every series, gaps skipped. */
export function extent(series) {
    let low = Infinity;
    let high = -Infinity;
    for (const entry of series) {
        for (const value of entry.values) {
            if (!isNumber(value)) continue;
            if (value < low) low = value;
            if (value > high) high = value;
        }
    }
    return low <= high ? [low, high] : [0, 0];
}

/** Each label's total across the series, for stacks. */
export function totals(series, count) {
    return Array.from({ length: count }, (_, index) => series.reduce((sum, entry) => sum + (isNumber(entry.values[index]) ? entry.values[index] : 0), 0));
}

/**
 * A number as it is read aloud: 1,284 and 12.9K, never 12873.4567.
 *
 * Four digits stay whole, because 1,284 is easier to read than 1.3K and
 * loses nothing. The unit follows after a space, except for a percent sign,
 * which sits against the number as it does in prose.
 */
export function formatValue(value, unit = '') {
    if (!isNumber(value)) return '–';
    const abs = Math.abs(value);
    let shown = value;
    let suffix = '';
    if (abs >= 1e12) { shown = value / 1e12; suffix = 'T'; }
    else if (abs >= 1e9) { shown = value / 1e9; suffix = 'B'; }
    else if (abs >= 1e6) { shown = value / 1e6; suffix = 'M'; }
    else if (abs >= 1e4) { shown = value / 1e3; suffix = 'K'; }

    const size = Math.abs(shown);
    const digits = size === 0 ? 0 : size < 1 ? 3 : size < 10 ? 2 : size < 100 ? 1 : 0;
    const body = shown.toLocaleString('en-US', { maximumFractionDigits: suffix ? Math.min(digits, 1) : digits });
    if (!unit) return `${body}${suffix}`;
    return unit === '%' ? `${body}${suffix}%` : `${body}${suffix} ${unit}`;
}

/** A share of a whole, as a percentage worth printing. */
export function formatShare(part, whole) {
    if (!(whole > 0)) return '–';
    const percent = (part / whole) * 100;
    return `${percent < 1 && percent > 0 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** Which labels along a line chart's foot get printed, for a given room. */
export function labelIndexes(count, slots) {
    if (count <= 0) return [];
    if (count === 1) return [0];
    const room = Math.max(2, Math.floor(slots));
    if (count <= room) return Array.from({ length: count }, (_, index) => index);
    // One even step, so the labels fall on a rhythm (every third sample, say)
    // rather than spreading by rounding into pairs with gaps between them.
    const step = Math.ceil((count - 1) / (room - 1));
    const indexes = [];
    for (let index = 0; index < count; index += step) indexes.push(index);
    // The last point is always labelled. If the step left one just short of
    // it, that one goes, rather than the two printing over each other.
    const last = count - 1;
    if (indexes[indexes.length - 1] !== last) {
        if (last - indexes[indexes.length - 1] < step * 0.6 && indexes.length > 1) indexes.pop();
        indexes.push(last);
    }
    return indexes;
}

/**
 * A smooth path through points, which never swings above or below its data.
 *
 * Monotone cubic: each point's tangent is the harmonic mean of the slopes on
 * either side, and flat where the line turns. A plain spline through a dip
 * draws a trough below zero that was never measured; this one cannot, which
 * is the difference between a curve that looks good and one that lies.
 * `points` is one unbroken run of [x, y].
 */
export function smoothPath(points, { move = true } = {}) {
    const count = points.length;
    if (count === 0) return '';
    const at = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
    const start = `${move ? 'M' : 'L'}${at(points[0])}`;
    if (count === 1) return start;
    if (count === 2) return `${start}L${at(points[1])}`;

    const widths = [];
    const slopes = [];
    for (let index = 0; index < count - 1; index += 1) {
        const width = points[index + 1][0] - points[index][0];
        widths.push(width);
        slopes.push(width === 0 ? 0 : (points[index + 1][1] - points[index][1]) / width);
    }

    const tangents = [slopes[0]];
    for (let index = 1; index < count - 1; index += 1) {
        const before = slopes[index - 1];
        const after = slopes[index];
        if (before * after <= 0) {
            tangents.push(0);
        } else {
            const left = widths[index - 1];
            const right = widths[index];
            tangents.push((3 * (left + right)) / ((2 * right + left) / before + (right + 2 * left) / after));
        }
    }
    tangents.push(slopes[count - 2]);

    let path = start;
    for (let index = 0; index < count - 1; index += 1) {
        const [x0, y0] = points[index];
        const [x1, y1] = points[index + 1];
        const third = widths[index] / 3;
        path += `C${at([x0 + third, y0 + tangents[index] * third])} ${at([x1 - third, y1 - tangents[index + 1] * third])} ${at([x1, y1])}`;
    }
    return path;
}

/** The runs of a series between its gaps, as lists of indexes. */
export function runsOf(values) {
    const runs = [];
    let run = [];
    values.forEach((value, index) => {
        if (isNumber(value)) run.push(index);
        else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    return runs;
}

/**
 * The number a one-series line chart leads with: where it ended, and how far
 * that is from where it started. Null for anything else, where no one value
 * is the story.
 */
export function headline(chart) {
    if ((chart.type !== 'line' && chart.type !== 'area') || chart.series.length !== 1) return null;
    const values = chart.series[0].values;
    let first = -1;
    let last = -1;
    values.forEach((value, index) => {
        if (!isNumber(value)) return;
        if (first < 0) first = index;
        last = index;
    });
    if (last < 0) return null;
    const from = values[first];
    const to = values[last];
    const change = first !== last && from !== 0 ? ((to - from) / Math.abs(from)) * 100 : null;
    return { value: to, label: chart.labels[last], change, since: chart.labels[first] };
}

/** A meter's state, from how full it is. */
export function meterState(value, max, thresholds = DEFAULT_THRESHOLDS) {
    const percent = (value / max) * 100;
    if (percent >= thresholds[1]) return 'critical';
    if (percent >= thresholds[0]) return 'warning';
    return 'normal';
}

/* ------------------------------------------------------------------ *
 * The numbers as a table, for the table view and the copy button
 * ------------------------------------------------------------------ */

const cell = (raw, shown) => ({ raw: raw ?? '', text: shown ?? (raw === null || raw === undefined ? '–' : String(raw)) });

/**
 * Every chart as rows and columns. Each cell carries the raw value, for CSV,
 * and the text the table view prints. The headings are the chart's own words.
 */
export function tableOf(chart) {
    const unit = chart.unit;
    const words = { ...WORDS, ...chart.words };
    const number = value => cell(value, formatValue(value, unit));

    switch (chart.type) {
        case 'meter':
            return {
                header: ['', words.value, words.max, words.used],
                rows: chart.labels.map((label, index) => {
                    const value = chart.series[0].values[index];
                    return [cell(label), number(value), number(chart.maxes[index]), cell(isNumber(value) ? Math.round((value / chart.maxes[index]) * 1000) / 10 : null, formatShare(value, chart.maxes[index]))];
                }),
            };
        case 'stats':
            return {
                header: ['', words.value, words.note],
                rows: chart.tiles.map(tile => [cell(tile.label), tile.value === null ? cell(tile.shown) : cell(tile.value, formatValue(tile.value, tile.unit)), cell(tile.note)]),
            };
        case 'donut':
            return {
                header: ['', words.value, words.share],
                rows: chart.slices.map(slice => [cell(slice.label), number(slice.value), cell(Math.round((slice.value / chart.total) * 1000) / 10, formatShare(slice.value, chart.total))]),
            };
        case 'treemap': {
            const rows = [];
            for (const node of chart.nodes) {
                if (node.children) {
                    for (const child of node.children) rows.push([cell(`${node.label} / ${child.label}`), number(child.value), cell(Math.round((child.value / chart.total) * 1000) / 10, formatShare(child.value, chart.total))]);
                } else {
                    rows.push([cell(node.label), number(node.value), cell(Math.round((node.value / chart.total) * 1000) / 10, formatShare(node.value, chart.total))]);
                }
            }
            return { header: ['', words.value, words.share], rows };
        }
        case 'heatmap':
            return { header: ['', ...chart.x], rows: chart.y.map((label, row) => [cell(label), ...chart.values[row].map(number)]) };
        case 'uptime':
            return {
                header: ['', ...chart.series.map(row => row.name || words.status)],
                rows: chart.labels.map((label, index) => [cell(label), ...chart.series.map(row => cell(row.values[index] ?? ''))]),
            };
        case 'timeline': {
            const step = chart.clock ? 0 : 60000;
            const at = ms => formatTime(ms, { clock: chart.clock, step, full: true, locale: chart.locale });
            return {
                header: ['', words.start, words.end, words.duration, words.status],
                rows: chart.spans.map(span => [
                    cell(span.label),
                    cell(new Date(span.start).toISOString(), at(span.start)),
                    cell(span.open ? '' : new Date(span.end).toISOString(), span.open ? words.running : at(span.end)),
                    cell(Math.round((span.end - span.start) / 1000), formatDuration(span.end - span.start, words)),
                    cell(span.status),
                ]),
            };
        }
        default: {
            const header = ['', ...chart.series.map(entry => entry.name)];
            const sums = chart.stacked ? totals(chart.series, chart.labels.length) : null;
            if (sums) header.push(words.total);
            return {
                header,
                rows: chart.labels.map((label, index) => [
                    cell(label),
                    ...chart.series.map(entry => number(entry.values[index])),
                    ...(sums ? [number(sums[index])] : []),
                ]),
            };
        }
    }
}

function csvCell(value) {
    const body = String(value ?? '');
    return /[",\n]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
}

/** The chart's numbers as CSV, which is what the copy button takes. */
export function toCsv(chart) {
    const { header, rows } = tableOf(chart);
    const head = header.map((name, index) => (index === 0 ? 'label' : name));
    return [head, ...rows.map(row => row.map(entry => entry.raw))].map(row => row.map(csvCell).join(',')).join('\n');
}
