/**
 * The ```chart fence: what reads as a chart, what falls back to code, the
 * limits each form keeps, and the arithmetic the drawing leans on.
 *
 * A reply arrives a few words at a time, so half a spec is the ordinary case
 * rather than the odd one: every prefix of a good spec is checked to come
 * back as a refusal and never as an exception. The words a chart makes up for
 * itself and the reasons it gives for refusing one are checked against every
 * catalog, since a key missing there prints as the key.
 *
 * Then the system prompt, whose examples are what the model copies from, so
 * each of them has to be a chart itself.
 *
 * The modules under test are ESM for the bundler, so they are imported
 * dynamically, as in the reducer's test. `electron` is stubbed for the
 * prompt, which reads the open sessions.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { pathToFileURL } = require('url');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-chart-'));
const electronStub = {
    app: { getPath: () => userData, getVersion: () => '1.0.0', on: () => {}, whenReady: () => new Promise(() => {}) },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

let passed = 0;
let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        failed += 1;
    }
};

const json = value => JSON.stringify(value);
const load = file => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', ...file.split('/'))).href);

/** `count` series of one value each, for the limit checks. */
const manySeries = count => Array.from({ length: count }, (_, index) => ({ name: `s${index}`, values: [index + 1] }));
/** `count` rows of the one-series shorthand. */
const manyRows = count => Array.from({ length: count }, (_, index) => ({ label: `r${index}`, value: index + 1 }));

async function main() {
    const spec = await load('lib/chart-spec.js');
    const { parseChart, niceScale, formatValue, labelIndexes, meterState, toCsv, extent, MESSAGES, WORDS, CHART_TYPES } = spec;

    console.log('\nchart spec: reading');

    check('the bar shorthand reads as one series', () => {
        const { chart, error } = parseChart(json({
            type: 'bar', title: 'Disk use', unit: '%',
            data: [{ label: '/', value: 42 }, { label: '/var', value: 87 }],
        }));
        assert.strictEqual(error, undefined);
        assert.strictEqual(chart.type, 'bar');
        assert.deepStrictEqual(chart.labels, ['/', '/var']);
        assert.strictEqual(chart.series.length, 1);
        assert.deepStrictEqual(chart.series[0].values, [42, 87]);
        assert.strictEqual(chart.unit, '%');
        assert.strictEqual(chart.title, 'Disk use');
    });

    check('a line with series is fitted to its labels, gaps kept as null', () => {
        const { chart } = parseChart(json({
            type: 'line', labels: ['a', 'b', 'c'],
            series: [{ name: 'web1', values: [1, 2] }, { name: 'web2', values: [3, null, 5, 9] }],
        }));
        assert.deepStrictEqual(chart.series[0].values, [1, 2, null]);
        assert.deepStrictEqual(chart.series[1].values, [3, null, 5]);
    });

    check('numbers written as strings are read, thousands commas and all', () => {
        const { chart } = parseChart(json({ type: 'bar', data: [{ label: 'x', value: '1,284' }] }));
        assert.deepStrictEqual(chart.series[0].values, [1284]);
    });

    check('type defaults to bar, and is read in any case', () => {
        assert.strictEqual(parseChart(json({ data: [{ label: 'x', value: 1 }] })).chart.type, 'bar');
        assert.strictEqual(parseChart(json({ type: 'LINE', labels: ['a'], series: [{ values: [1] }] })).chart.type, 'line');
    });

    check('the names models reach for are read as the form they mean', () => {
        assert.strictEqual(parseChart(json({ type: 'pie', data: [{ label: 'x', value: 1 }] })).chart.type, 'donut');
        assert.strictEqual(parseChart(json({ type: 'gantt', data: [{ label: 'x', start: '01:00', end: '02:00' }] })).chart.type, 'timeline');
        assert.strictEqual(parseChart(json({ type: 'kpi', data: [{ label: 'x', value: 1 }] })).chart.type, 'stats');
        assert.strictEqual(parseChart(json({ type: 'status', data: [{ label: 'x', status: 'up' }] })).chart.type, 'uptime');
        const stacked = parseChart(json({ type: 'stacked-area', labels: ['a', 'b'], series: [{ values: [1, 2] }, { values: [3, 4] }] })).chart;
        assert.strictEqual(stacked.type, 'area');
        assert.strictEqual(stacked.stacked, true);
        assert.strictEqual(parseChart(json({ type: 'stacked-bar', labels: ['a'], series: [{ values: [1] }, { values: [2] }] })).chart.stacked, true);
    });

    check('long titles and labels are cut rather than allowed to push the card wide', () => {
        const { chart } = parseChart(json({ type: 'bar', title: 'x'.repeat(500), unit: 'y'.repeat(50), data: [{ label: 'z'.repeat(500), value: 1 }] }));
        assert.strictEqual(chart.title.length, 120);
        assert.strictEqual(chart.unit.length, 12);
        assert.strictEqual(chart.labels[0].length, 120);
    });

    console.log('\nchart spec: what is not a chart');

    check('half a JSON object is a refusal with a code, not an exception', () => {
        const parsed = parseChart('{"type":"bar","data":[{"label":"/","va');
        assert.strictEqual(parsed.chart, undefined);
        assert.strictEqual(parsed.code, 'json');
        assert.match(parsed.error, /not valid JSON/);
    });

    check('every prefix of a streaming spec is refused quietly until the last brace', () => {
        const whole = json({
            type: 'line', title: 'Load', labels: ['10:00', '10:05', '10:10'],
            series: [{ name: 'web1', values: [0.4, 0.6, null] }],
            limits: [{ value: 1, label: 'Alert' }], events: [{ at: '10:05', label: 'Deploy' }],
        });
        for (let end = 0; end < whole.length; end += 1) {
            const parsed = parseChart(whole.slice(0, end));
            assert.strictEqual(parsed.chart, undefined, `prefix ${end} drew a chart`);
            assert.ok(parsed.code, `prefix ${end} gave no code`);
        }
        assert.ok(parseChart(whole).chart);
    });

    check('anything but an object is refused', () => {
        for (const source of ['[1,2]', 'null', '"bar"', '42', 'true', '', undefined, null]) {
            const parsed = parseChart(source);
            assert.strictEqual(parsed.chart, undefined, String(source));
            assert.ok(['json', 'object'].includes(parsed.code), `${source}: ${parsed.code}`);
        }
    });

    check('an unknown type is named in the refusal', () => {
        const parsed = parseChart(json({ type: 'radar', data: [{ label: 'x', value: 1 }] }));
        assert.strictEqual(parsed.code, 'type');
        assert.strictEqual(parsed.vars.type, 'radar');
        assert.match(parsed.error, /"radar"/);
        assert.match(parsed.error, new RegExp(CHART_TYPES.join(', ')));
    });

    check('a word where a number belongs is refused', () => {
        assert.match(parseChart(json({ type: 'bar', data: [{ label: 'x', value: 'lots' }] })).error, /not a number/);
        assert.strictEqual(parseChart(json({ type: 'line', labels: ['a'], series: [{ name: 'cpu', values: [{}] }] })).vars.name, 'cpu');
    });

    check('a chart of nothing but gaps is refused', () => {
        assert.strictEqual(parseChart(json({ type: 'line', labels: ['a'], series: [{ name: 's', values: [null] }] })).code, 'noNumbers');
        assert.strictEqual(parseChart(json({ type: 'bar', data: [] })).code, 'empty');
    });

    check('series without labels, and a chart with neither, are refused', () => {
        assert.strictEqual(parseChart(json({ type: 'line', series: [{ values: [1] }] })).code, 'labels');
        assert.strictEqual(parseChart(json({ type: 'line', title: 'x' })).code, 'needsSeries');
    });

    check('negative bars, meters, donuts, treemaps and stacks are refused, with lines suggested', () => {
        assert.match(parseChart(json({ type: 'bar', data: [{ label: 'x', value: -1 }] })).error, /line/);
        assert.strictEqual(parseChart(json({ type: 'meter', unit: '%', data: [{ label: 'x', value: -1 }] })).code, 'negative');
        assert.strictEqual(parseChart(json({ type: 'donut', data: [{ label: 'x', value: -1 }] })).code, 'negative');
        assert.strictEqual(parseChart(json({ type: 'treemap', data: [{ label: 'x', value: -1 }] })).code, 'negative');
        assert.strictEqual(parseChart(json({ type: 'area', stacked: true, labels: ['a'], series: [{ values: [1] }, { values: [-2] }] })).code, 'negative');
        assert.ok(parseChart(json({ type: 'line', labels: ['a', 'b'], series: [{ values: [-3, 4] }] })).chart, 'a line can go below zero');
    });

    check('a refusal carries the English sentence its code and values make', () => {
        const parsed = parseChart(json({ type: 'bar', labels: ['a'], series: manySeries(5) }));
        assert.strictEqual(parsed.code, 'tooMany');
        assert.deepStrictEqual(parsed.vars, { field: 'series', count: 5, type: 'bar', max: 4 });
        assert.strictEqual(parsed.error, spec.fill(MESSAGES.tooMany, parsed.vars));
    });

    console.log('\nchart spec: limits');

    check('bars take forty rows and no more', () => {
        assert.ok(parseChart(json({ type: 'bar', data: manyRows(40) })).chart);
        const over = parseChart(json({ type: 'bar', data: manyRows(41) }));
        assert.strictEqual(over.code, 'tooMany');
        assert.strictEqual(over.vars.max, 40);
    });

    check('grouped bars stop at four series, stacked bars at the eight colours', () => {
        assert.ok(parseChart(json({ type: 'bar', labels: ['a'], series: manySeries(4) })).chart);
        assert.match(parseChart(json({ type: 'bar', labels: ['a'], series: manySeries(5) })).error, /at most 4/);
        assert.ok(parseChart(json({ type: 'bar', stacked: true, labels: ['a'], series: manySeries(8) })).chart);
        assert.match(parseChart(json({ type: 'bar', stacked: true, labels: ['a'], series: manySeries(9) })).error, /at most 8/);
    });

    check('a ninth line or area series is refused rather than given an unchecked colour', () => {
        assert.ok(parseChart(json({ type: 'line', labels: ['a'], series: manySeries(8) })).chart);
        assert.match(parseChart(json({ type: 'line', labels: ['a'], series: manySeries(9) })).error, /at most 8/);
        assert.match(parseChart(json({ type: 'area', stacked: true, labels: ['a'], series: manySeries(9) })).error, /at most 8/);
    });

    check('lines take two thousand points', () => {
        const labels = Array.from({ length: 2000 }, (_, index) => String(index));
        assert.ok(parseChart(json({ type: 'line', labels, series: [{ values: labels.map(Number) }] })).chart);
        const over = parseChart(json({ type: 'line', labels: [...labels, 'x'], series: [{ values: [1] }] }));
        assert.strictEqual(over.vars.max, 2000);
    });

    check('meters take one value per row', () => {
        assert.strictEqual(parseChart(json({ type: 'meter', unit: '%', labels: ['a'], series: manySeries(2) })).code, 'tooMany');
    });

    check('stat tiles stop at eight', () => {
        assert.ok(parseChart(json({ type: 'stats', data: manyRows(8) })).chart);
        assert.strictEqual(parseChart(json({ type: 'stats', data: manyRows(9) })).vars.max, 8);
    });

    check('a heatmap takes sixty columns and thirty-one rows', () => {
        const grid = (columns, rows) => ({
            type: 'heatmap',
            x: Array.from({ length: columns }, (_, index) => String(index)),
            y: Array.from({ length: rows }, (_, index) => `r${index}`),
            values: Array.from({ length: rows }, () => Array.from({ length: columns }, () => 1)),
        });
        assert.ok(parseChart(json(grid(60, 31))).chart);
        assert.strictEqual(parseChart(json(grid(61, 2))).vars.field, 'x');
        assert.strictEqual(parseChart(json(grid(2, 32))).vars.field, 'y');
    });

    check('uptime takes a hundred and twenty cells and twelve rows', () => {
        const labels = Array.from({ length: 120 }, (_, index) => String(index));
        const row = name => ({ name, values: labels.map(() => 'up') });
        assert.ok(parseChart(json({ type: 'uptime', labels, series: [row('a')] })).chart);
        assert.strictEqual(parseChart(json({ type: 'uptime', labels: [...labels, 'x'], series: [row('a')] })).vars.max, 120);
        assert.strictEqual(parseChart(json({ type: 'uptime', labels, series: Array.from({ length: 13 }, (_, index) => row(`h${index}`)) })).vars.max, 12);
    });

    check('a timeline takes forty spans', () => {
        const spans = count => Array.from({ length: count }, (_, index) => ({ label: `j${index}`, start: '01:00', end: '01:10' }));
        assert.ok(parseChart(json({ type: 'timeline', data: spans(40) })).chart);
        assert.strictEqual(parseChart(json({ type: 'timeline', data: spans(41) })).vars.max, 40);
    });

    check('a nested treemap takes eight groups and eighty boxes in all', () => {
        const group = (index, children) => ({ label: `g${index}`, children: Array.from({ length: children }, (_, at) => ({ label: `c${at}`, value: at + 1 })) });
        assert.ok(parseChart(json({ type: 'treemap', data: Array.from({ length: 8 }, (_, index) => group(index, 10)) })).chart);
        assert.strictEqual(parseChart(json({ type: 'treemap', data: Array.from({ length: 9 }, (_, index) => group(index, 2)) })).vars.max, 8);
        assert.strictEqual(parseChart(json({ type: 'treemap', data: Array.from({ length: 81 }, (_, index) => ({ label: `b${index}`, value: 1 })) })).vars.max, 80);
    });

    console.log('\nchart spec: every form');

    check('meters take a max per row, or 100 for percent, and thresholds in order', () => {
        const rows = parseChart(json({ type: 'meter', unit: 'GB', data: [{ label: '/var', value: 43, max: 50 }] })).chart;
        assert.deepStrictEqual(rows.maxes, [50]);
        const percent = parseChart(json({ type: 'meter', unit: '%', data: [{ label: '/', value: 91 }] })).chart;
        assert.deepStrictEqual(percent.maxes, [100]);
        assert.deepStrictEqual(percent.thresholds, [80, 90]);
        const swapped = parseChart(json({ type: 'meter', unit: '%', thresholds: [95, 70], data: [{ label: '/', value: 1 }] })).chart;
        assert.deepStrictEqual(swapped.thresholds, [70, 95]);
    });

    check('a meter with no max is refused', () => {
        assert.strictEqual(parseChart(json({ type: 'meter', unit: 'GB', data: [{ label: '/var', value: 43 }] })).code, 'meterMax');
    });

    check('meter state follows the thresholds', () => {
        assert.strictEqual(meterState(40, 50), 'warning');
        assert.strictEqual(meterState(46, 50), 'critical');
        assert.strictEqual(meterState(10, 50), 'normal');
        assert.strictEqual(meterState(30, 50, [50, 70]), 'warning');
    });

    check('stacked bars refuse a negative part', () => {
        const parsed = parseChart(json({ type: 'bar', stacked: true, labels: ['a'], series: [{ values: [3] }, { values: [-1] }] }));
        assert.strictEqual(parsed.code, 'negative');
    });

    check('stack totals add every series, gaps as zero', () => {
        assert.deepStrictEqual(spec.totals([{ values: [1, null, 3] }, { values: [2, 5, null] }], 3), [3, 5, 3]);
    });

    check('limits and events are read; an event at no label is dropped', () => {
        const { chart } = parseChart(json({
            type: 'line', labels: ['10:00', '10:05', '10:10'], series: [{ values: [1, 2, 3] }],
            limits: [{ value: 2.5, label: 'Alert' }, 4, { value: 'x' }],
            events: [{ at: '10:05', label: 'Deploy' }, { at: 2, label: 'Reboot' }, { at: '11:00', label: 'Nowhere' }],
        }));
        assert.deepStrictEqual(chart.limits, [{ value: 2.5, label: 'Alert' }, { value: 4, label: '' }]);
        assert.deepStrictEqual(chart.events, [{ index: 1, label: 'Deploy' }, { index: 2, label: 'Reboot' }]);
    });

    check('limits belong to lines and areas, four at most', () => {
        const bars = parseChart(json({ type: 'bar', limits: [1], data: [{ label: 'a', value: 1 }] })).chart;
        assert.strictEqual(bars.limits, undefined);
        const areas = parseChart(json({ type: 'area', limits: [1, 2, 3, 4, 5], labels: ['a'], series: [{ values: [1] }] })).chart;
        assert.strictEqual(areas.limits.length, 4, 'four at most');
    });

    check('stat tiles take numbers, words, trends and notes', () => {
        const { chart } = parseChart(json({ type: 'stats', data: [
            { label: 'CPU', value: 34, unit: '%', trend: [20, 31, null, 34], change: 4.2 },
            { label: 'Uptime', value: '14d 3h', note: 'since reboot' },
        ] }));
        assert.strictEqual(chart.tiles[0].value, 34);
        assert.deepStrictEqual(chart.tiles[0].trend, [20, 31, null, 34]);
        assert.strictEqual(chart.tiles[0].change, 4.2);
        assert.strictEqual(chart.tiles[1].value, null);
        assert.strictEqual(chart.tiles[1].shown, '14d 3h');
        assert.strictEqual(parseChart(json({ type: 'stats', data: [{ label: 'x' }] })).code, 'noValue');
        assert.strictEqual(parseChart(json({ type: 'stats', data: [{ label: 'x', value: 1, trend: [1, 'a'] }] })).code, 'notNumber');
    });

    check('a donut sorts its slices and folds the tail into Other', () => {
        const data = [3, 9, 1, 7, 5, 2, 4, 8].map((value, index) => ({ label: `s${index}`, value }));
        const { chart } = parseChart(json({ type: 'donut', data }));
        assert.strictEqual(chart.slices.length, 6);
        assert.deepStrictEqual(chart.slices.slice(0, 5).map(slice => slice.value), [9, 8, 7, 5, 4]);
        assert.strictEqual(chart.slices[5].other, true);
        assert.strictEqual(chart.slices[5].value, 6);
        assert.strictEqual(chart.slices[5].label, 'Other (3)');
        assert.strictEqual(chart.total, 39);
    });

    check('six slices are shown as six, not five and an Other of one; zeros are left out', () => {
        const data = [1, 2, 3, 4, 5, 6].map(value => ({ label: `v${value}`, value }));
        assert.ok(!parseChart(json({ type: 'donut', data })).chart.slices.some(slice => slice.other));
        assert.strictEqual(parseChart(json({ type: 'donut', data: [{ label: 'a', value: 0 }] })).code, 'nothingAboveZero');
    });

    check('a treemap group is the size of its children together', () => {
        const { chart } = parseChart(json({ type: 'treemap', data: [
            { label: '/var/log', value: 31 },
            { label: '/var/lib', children: [{ label: 'docker', value: 12 }, { label: 'mysql', value: 20 }] },
        ] }));
        assert.strictEqual(chart.nodes[0].label, '/var/lib');
        assert.strictEqual(chart.nodes[0].value, 32);
        assert.deepStrictEqual(chart.nodes[0].children.map(child => child.label), ['mysql', 'docker']);
        assert.strictEqual(chart.total, 63);
        assert.strictEqual(chart.nested, true);
    });

    check('squarify fills the box exactly, with no overlaps and fair areas', () => {
        const items = [60, 30, 20, 10, 6, 4].map(value => ({ value }));
        const boxes = spec.squarify(items, 0, 0, 300, 200);
        const total = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
        assert.ok(Math.abs(total - 60000) < 0.5, `area ${total}`);
        boxes.forEach((box, index) => {
            const share = (box.width * box.height) / 60000;
            assert.ok(Math.abs(share - items[index].value / 130) < 1e-6, `box ${index} share ${share}`);
            assert.ok(box.x >= -1e-9 && box.y >= -1e-9 && box.x + box.width <= 300 + 1e-6 && box.y + box.height <= 200 + 1e-6);
        });
        for (let a = 0; a < boxes.length; a += 1) {
            for (let b = a + 1; b < boxes.length; b += 1) {
                const overlapX = Math.min(boxes[a].x + boxes[a].width, boxes[b].x + boxes[b].width) - Math.max(boxes[a].x, boxes[b].x);
                const overlapY = Math.min(boxes[a].y + boxes[a].height, boxes[b].y + boxes[b].height) - Math.max(boxes[a].y, boxes[b].y);
                assert.ok(overlapX <= 1e-6 || overlapY <= 1e-6, `boxes ${a} and ${b} overlap`);
            }
        }
    });

    check('a heatmap is fitted to its axes, gaps kept', () => {
        const { chart } = parseChart(json({ type: 'heatmap', x: ['a', 'b', 'c'], y: ['r1', 'r2'], values: [[1, 2], [3, 4, 5, 6]] }));
        assert.deepStrictEqual(chart.values, [[1, 2, null], [3, 4, 5]]);
        assert.strictEqual(parseChart(json({ type: 'heatmap', x: ['a'], y: ['b'] })).code, 'needsGrid');
    });

    check('uptime reads status words, and refuses ones it does not know', () => {
        const { chart } = parseChart(json({ type: 'uptime', labels: ['1', '2', '3', '4'], series: [{ name: 'web1', values: ['ok', 'Degraded', 'down', null] }] }));
        assert.deepStrictEqual(chart.series[0].values, ['up', 'degraded', 'down', null]);
        const refused = parseChart(json({ type: 'uptime', data: [{ label: '1', status: 'sideways' }] }));
        assert.strictEqual(refused.code, 'status');
        assert.match(refused.error, /"sideways" is not a status/);
    });

    check('uptime counts degraded as up and skips the unknown', () => {
        assert.strictEqual(spec.uptimeShare(['up', 'degraded', 'down', null]), (2 / 3) * 100);
        assert.strictEqual(spec.uptimeShare([null, null]), null);
    });

    check('a timeline reads times of day, past midnight, and open spans', () => {
        const { chart } = parseChart(json({ type: 'timeline', data: [
            { label: 'backup', start: '23:30', end: '00:15', status: 'done' },
            { label: 'sync', start: '23:50' },
        ] }));
        assert.strictEqual(chart.clock, true);
        const [backup, sync] = chart.spans;
        assert.strictEqual(backup.end - backup.start, 45 * 60000);
        assert.strictEqual(backup.status, 'ok');
        assert.strictEqual(sync.open, true);
        assert.strictEqual(sync.status, 'running');
        assert.strictEqual(sync.end, backup.end);
    });

    check('a timeline will not mix times of day with dates, or end before it starts', () => {
        assert.strictEqual(parseChart(json({ type: 'timeline', data: [{ label: 'a', start: '01:00', end: '2026-10-04T02:00:00Z' }] })).code, 'mixedTimes');
        assert.strictEqual(parseChart(json({ type: 'timeline', data: [{ label: 'a', start: '2026-10-04T03:00:00Z', end: '2026-10-04T02:00:00Z' }] })).code, 'endsFirst');
        assert.strictEqual(parseChart(json({ type: 'timeline', data: [{ label: 'a' }] })).code, 'noStart');
        assert.strictEqual(parseChart(json({ type: 'timeline', data: [{ label: 'a', start: '01:00', end: 'later' }] })).code, 'badEnd');
    });

    console.log('\nchart spec: arithmetic');

    check('the value axis starts at zero and ends on a round number', () => {
        const scale = niceScale(3, 87);
        assert.strictEqual(scale.min, 0);
        assert.strictEqual(scale.max, 100);
        assert.deepStrictEqual(scale.ticks, [0, 25, 50, 75, 100]);
    });

    check('small steps do not drift into float noise', () => {
        const { ticks } = niceScale(0, 0.3);
        assert.ok(ticks.every(tick => String(tick).length <= 4), ticks.join(' '));
    });

    check('a given min is kept, and a flat series still gets a scale', () => {
        assert.strictEqual(niceScale(7.1, 7.3, { min: 7 }).min, 7);
        const flat = niceScale(5, 5);
        assert.ok(flat.max > flat.min);
    });

    check('negative values pull the axis below zero', () => {
        const scale = niceScale(-12, 30);
        assert.ok(scale.min <= -12 && scale.ticks.includes(0));
    });

    check('values are written compactly, with the unit after', () => {
        assert.strictEqual(formatValue(1284), '1,284');
        assert.strictEqual(formatValue(12873.4567), '12.9K');
        assert.strictEqual(formatValue(4200000, 'B'), '4.2M B');
        assert.strictEqual(formatValue(42, '%'), '42%');
        assert.strictEqual(formatValue(0.456, 'ms'), '0.456 ms');
        assert.strictEqual(formatValue(null), '–');
    });

    check('the foot keeps its first and last label and thins the rest evenly', () => {
        const shown = labelIndexes(60, 5);
        assert.strictEqual(shown[0], 0);
        assert.strictEqual(shown[shown.length - 1], 59);
        assert.ok(shown.length <= 5);
        assert.deepStrictEqual(labelIndexes(3, 10), [0, 1, 2]);
        for (const [count, slots] of [[24, 17], [24, 9], [60, 7], [100, 13]]) {
            const picked = labelIndexes(count, slots);
            const gaps = picked.slice(1).map((index, at) => index - picked[at]);
            const step = gaps[0];
            assert.ok(gaps.slice(0, -1).every(gap => gap === step), `${count}/${slots}: ${picked}`);
            assert.ok(gaps[gaps.length - 1] >= step * 0.6, `${count}/${slots}: last gap ${gaps[gaps.length - 1]}`);
            assert.ok(picked.length <= slots + 1, `${count}/${slots}: ${picked.length} labels`);
        }
    });

    check('the smooth curve never leaves the range of its data', () => {
        const points = [[0, 100], [10, 100], [20, 10], [30, 100], [40, 100], [50, 60]];
        const drawn = spec.smoothPath(points);
        const ys = [...drawn.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(match => Number(match[2]));
        assert.ok(ys.every(value => value >= 10 - 0.01 && value <= 100 + 0.01), `control points out of range: ${ys}`);
        assert.ok(drawn.startsWith('M0.0,100.0C'), drawn);
    });

    check('short runs draw as a point or a straight line', () => {
        assert.strictEqual(spec.smoothPath([[1, 2]]), 'M1.0,2.0');
        assert.strictEqual(spec.smoothPath([[1, 2], [3, 4]]), 'M1.0,2.0L3.0,4.0');
        assert.strictEqual(spec.smoothPath([]), '');
    });

    check('runs split a series at its gaps', () => {
        assert.deepStrictEqual(spec.runsOf([1, 2, null, 4, null, null, 7, 8]), [[0, 1], [3], [6, 7]]);
    });

    check('a one-series line leads with its last value and the change since its first', () => {
        const { chart } = parseChart(json({ type: 'line', labels: ['a', 'b', 'c', 'd'], series: [{ name: 's', values: [null, 50, 60, 75] }] }));
        const lead = spec.headline(chart);
        assert.strictEqual(lead.value, 75);
        assert.strictEqual(lead.since, 'b');
        assert.strictEqual(lead.change, 50);
    });

    check('no headline for several series, or for bars', () => {
        const many = parseChart(json({ type: 'line', labels: ['a'], series: [{ values: [1] }, { values: [2] }] })).chart;
        const bars = parseChart(json({ type: 'bar', data: [{ label: 'a', value: 1 }] })).chart;
        assert.strictEqual(spec.headline(many), null);
        assert.strictEqual(spec.headline(bars), null);
    });

    check('extent skips gaps', () => {
        assert.deepStrictEqual(extent([{ values: [null, 4, 2] }, { values: [9, null] }]), [2, 9]);
    });

    check('time ticks land on round steps, and durations read as people say them', () => {
        const from = Date.UTC(2026, 9, 4, 1, 7);
        const { step, ticks } = spec.timeTicks(from, from + 3 * 3600000, 4);
        assert.strictEqual(step, 3600000);
        assert.ok(ticks.every(tick => tick % step === 0), ticks.join(' '));
        assert.strictEqual(spec.formatTime(Date.UTC(1970, 0, 1, 14, 5), { clock: true }), '14:05');
        assert.strictEqual(spec.formatDuration(45000), '45s');
        assert.strictEqual(spec.formatDuration(12 * 60000), '12m');
        assert.strictEqual(spec.formatDuration(65 * 60000), '1h 05m');
        assert.strictEqual(spec.formatDuration(51 * 3600000), '2d 3h');
    });

    console.log('\nchart spec: the table and the copy button');

    check('CSV quotes what needs it', () => {
        const { chart } = parseChart(json({ type: 'bar', title: 'x', data: [{ label: 'a,b', value: 1 }] }));
        assert.strictEqual(toCsv(chart), 'label,x\n"a,b",1');
    });

    check('every form has a table and a CSV', () => {
        const forms = [
            { type: 'bar', data: [{ label: 'a', value: 1 }] },
            { type: 'line', labels: ['a', 'b'], series: [{ name: 'x', values: [1, 2] }] },
            { type: 'area', labels: ['a'], series: [{ name: 'x', values: [1] }] },
            { type: 'meter', unit: '%', data: [{ label: '/', value: 50 }] },
            { type: 'stats', data: [{ label: 'CPU', value: 34, unit: '%' }] },
            { type: 'donut', data: [{ label: 'a', value: 3 }, { label: 'b', value: 1 }] },
            { type: 'treemap', data: [{ label: 'g', children: [{ label: 'c', value: 2 }] }] },
            { type: 'heatmap', x: ['a'], y: ['b'], values: [[1]] },
            { type: 'uptime', data: [{ label: 'd1', status: 'up' }] },
            { type: 'timeline', data: [{ label: 'job', start: '01:00', end: '01:30' }] },
            { type: 'bar', stacked: true, labels: ['a'], series: [{ name: 'x', values: [1] }, { name: 'y', values: [2] }] },
        ];
        assert.deepStrictEqual([...new Set(forms.map(form => form.type))].sort(), [...CHART_TYPES].sort(), 'every type is covered');
        for (const form of forms) {
            const { chart, error } = parseChart(json(form));
            assert.strictEqual(error, undefined, `${form.type}: ${error}`);
            const table = spec.tableOf(chart);
            assert.ok(table.rows.length > 0 && table.rows.every(row => row.length === table.header.length), form.type);
            assert.ok(toCsv(chart).split('\n').length === table.rows.length + 1, form.type);
        }
        assert.strictEqual(toCsv(parseChart(json(forms[5])).chart), 'label,Value,Share\na,3,75\nb,1,25');
        assert.strictEqual(toCsv(parseChart(json(forms[10])).chart), 'label,x,y,Total\na,1,2,3');
    });

    console.log('\nchart spec: in the reader\'s language');

    check('the names a chart makes up come from the words it is given', () => {
        const words = { ...WORDS, value: 'Valor', series: 'Série {n}', other: 'Outros ({count})', share: 'Parte', total: 'Total', duration: 'Duração', minutes: '{n} min' };
        const bar = parseChart(json({ type: 'bar', data: [{ label: 'a', value: 1 }] }), { words }).chart;
        assert.strictEqual(bar.series[0].name, 'Valor');
        const line = parseChart(json({ type: 'line', labels: ['a'], series: [{ values: [1] }, { values: [2] }] }), { words }).chart;
        assert.deepStrictEqual(line.series.map(entry => entry.name), ['Série 1', 'Série 2']);
        const donut = parseChart(json({ type: 'donut', data: manyRows(8) }), { words }).chart;
        assert.strictEqual(donut.slices.at(-1).label, 'Outros (3)');
        assert.strictEqual(spec.tableOf(donut).header[2], 'Parte');
        const timeline = parseChart(json({ type: 'timeline', data: [{ label: 'j', start: '01:00', end: '01:12' }] }), { words }).chart;
        assert.strictEqual(spec.tableOf(timeline).rows[0][3].text, '12 min');
    });

    check('a day is written in the reader\'s language when one is given', () => {
        const at = new Date(2026, 9, 4, 12, 0).getTime();
        assert.strictEqual(spec.formatTime(at, { step: 86400000 }), 'Oct 4');
        const russian = spec.formatTime(at, { step: 86400000, locale: 'ru' });
        assert.ok(/4/.test(russian) && russian !== 'Oct 4', russian);
        assert.strictEqual(spec.formatTime(at, { step: 86400000, locale: 'not a locale!' }), 'Oct 4');
    });

    // Every word a chart prints and every reason it gives for refusing one,
    // in every catalog: a key missing there would print as the key.
    const locales = {};
    for (const language of ['en', 'pt', 'ru', 'vi', 'zh']) {
        locales[language] = (await load(`i18n/locales/${language}.js`)).default;
    }
    const draw = await load('lib/chart-draw.js');
    const needed = [
        ...Object.keys(WORDS).map(key => `assistant.chart.word.${key}`),
        ...Object.keys(MESSAGES).map(code => `assistant.chart.error.${code}`),
        ...CHART_TYPES.map(type => `assistant.chart.kind.${type}`),
        'assistant.chart.kind.stackedBar', 'assistant.chart.kind.stackedArea',
        ...Object.keys(draw.STATUS_COLOR).map(draw.statusKey),
        'assistant.chart.notDrawn', 'assistant.chart.drawing', 'assistant.chart.copyCsv', 'assistant.chart.copied',
        'assistant.chart.viewChart', 'assistant.chart.viewTable', 'assistant.chart.tableHint', 'assistant.chart.seriesOf',
        'assistant.chart.since', 'assistant.chart.high', 'assistant.chart.critical', 'assistant.chart.uptime',
        'assistant.chart.noData', 'assistant.chart.downCount_other',
    ];

    check('every catalog has every word and reason a chart can print', () => {
        for (const [language, catalog] of Object.entries(locales)) {
            const missing = needed.filter(key => typeof catalog[key] !== 'string');
            assert.deepStrictEqual(missing, [], `${language} is missing ${missing.join(', ')}`);
        }
    });

    check('each translation keeps the marks its English fills in', () => {
        const marks = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        for (const key of needed) {
            for (const [language, catalog] of Object.entries(locales)) {
                if (language === 'en') continue;
                assert.deepStrictEqual(marks(catalog[key]), marks(locales.en[key]), `${language} ${key}`);
            }
        }
    });

    console.log('\nthe system prompt');

    const prompt = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'prompt'));

    check('the fixed text teaches the fence, so it is cached with the rest', () => {
        assert.ok(prompt.BASE.includes('## Charts'));
        assert.ok(prompt.BASE.includes('fenced block whose language is `chart`'));
        assert.ok(/Plot only values you actually received from a tool/.test(prompt.BASE));
    });

    const examples = prompt.BASE.match(/\{"type":"[^\r\n]+?\}(?=\r?\n|$)/g) || [];

    check('every example in the prompt is itself a chart', () => {
        assert.ok(examples.length >= 9, `found ${examples.length} examples`);
        for (const example of examples) {
            const { error } = parseChart(example);
            assert.strictEqual(error, undefined, `${example}: ${error}`);
        }
    });

    check('the prompt shows every form there is, and no other', () => {
        const shown = examples.map(example => JSON.parse(example).type);
        for (const type of CHART_TYPES.filter(form => form !== 'area')) assert.ok(shown.includes(type), type);
        assert.ok(shown.every(type => CHART_TYPES.includes(type)), shown.join(', '));
        assert.ok(/- line or area/.test(prompt.BASE));
    });

    console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
