/**
 * The chart forms beyond lines, bars and meters: stat tiles, stacked bars,
 * donut, treemap, heatmap, uptime strip and timeline.
 *
 * Each takes `{ chart, width, onTip, figure }`: the normalised chart from
 * lib/chart-spec.js, the room it has, a function to show or clear the hover
 * tooltip (in the card's coordinates), and the card itself to measure the
 * pointer against. The card, its toolbar, the table view and the tooltip are
 * Chart.jsx's; these only draw.
 *
 * Same rules as the rest: flat colour, no glow, the surface showing through
 * as a 2px gap between touching marks, and text in ink rather than in the
 * colour of the mark beside it.
 */

import { useState } from 'react';
import { ArrowDownRight01Icon, ArrowUpRight01Icon } from 'hugeicons-react';
import {
    WORDS, formatDuration, formatShare, formatTime, formatValue, labelIndexes, runsOf, smoothPath, squarify,
    timeTicks, totals, uptimeShare,
} from '../../lib/chart-spec';
import { STATUS_COLOR, pointerIn, seriesColor, stagger, statusKey, tint } from '../../lib/chart-draw';
import { useT } from '../../i18n';

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

/** The chart's own words, with English under anything a caller left out. */
const wordsOf = chart => ({ ...WORDS, ...chart.words });

/* ------------------------------------------------------------------ *
 * Stat tiles
 * ------------------------------------------------------------------ */

/**
 * A trend line with no axes, drawn in a 100-by-28 box and stretched to fit;
 * the stroke keeps its width however far it is stretched.
 */
function Sparkline({ values, color = 'var(--chart-1)' }) {
    const numbers = values.filter(isNumber);
    if (numbers.length < 2) return null;
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    const span = high - low || 1;
    const count = values.length;
    const x = index => (index / (count - 1)) * 100;
    const y = value => 26 - ((value - low) / span) * 24;
    const runs = runsOf(values);
    return (
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="block w-full h-7 overflow-visible" aria-hidden="true">
            {runs.map(run => (run.length > 1 ? (
                <g key={run[0]}>
                    <path
                        d={`${smoothPath(run.map(at => [x(at), y(values[at])]))}L${x(run.at(-1))},28L${x(run[0])},28Z`}
                        fill={color} fillOpacity={0.08} className="chart-fade"
                    />
                    <path
                        d={smoothPath(run.map(at => [x(at), y(values[at])]))}
                        // Faded in rather than drawn: a dash measured with
                        // pathLength does not survive a non-scaling stroke.
                        fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round" strokeLinecap="round" className="chart-fade"
                    />
                </g>
            ) : null))}
        </svg>
    );
}

/** A change, signed by its arrow and kept neutral: up is not always good. */
function Change({ value }) {
    if (!isNumber(value)) return null;
    const Arrow = value >= 0 ? ArrowUpRight01Icon : ArrowDownRight01Icon;
    return (
        <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium tabular-nums text-gray-500 dark:text-gray-400">
            <Arrow size={10} strokeWidth={2.5} />
            {Math.abs(value) >= 100 ? Math.round(Math.abs(value)) : Math.abs(value).toFixed(1)}%
        </span>
    );
}

/** Splits "34 %" into the number and its unit, so the unit can sit smaller. */
function splitUnit(value, unit) {
    const full = formatValue(value, unit);
    if (!unit) return [full, ''];
    if (unit === '%') return [full.slice(0, -1), '%'];
    return [full.slice(0, full.length - unit.length - 1), unit];
}

export function Stats({ chart }) {
    return (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))' }}>
            {chart.tiles.map((tile, index) => {
                const [number, unit] = tile.value === null ? [tile.shown, ''] : splitUnit(tile.value, tile.unit);
                return (
                    <div
                        key={`${index}${tile.label}`}
                        className="chart-appear min-w-0 px-3 pt-2.5 pb-2 rounded-lg bg-gray-900/[0.025] dark:bg-white/[0.035]"
                        style={stagger(index)}
                    >
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{tile.label}</div>
                        <div className="mt-1 flex items-baseline gap-1.5 min-w-0">
                            <span className="text-[20px] leading-none font-semibold tracking-[-0.02em] text-gray-900 dark:text-white truncate">
                                {number}
                            </span>
                            {unit && <span className="text-[12px] text-gray-500 dark:text-gray-400 shrink-0">{unit}</span>}
                            <span className="ml-auto shrink-0"><Change value={tile.change} /></span>
                        </div>
                        {tile.note && <div className="mt-1 text-[10.5px] text-gray-400 dark:text-gray-500 truncate">{tile.note}</div>}
                        {tile.trend.length > 1 && <div className="mt-2"><Sparkline values={tile.trend} /></div>}
                    </div>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Stacked bars
 * ------------------------------------------------------------------ */

/**
 * One bar per label, cut into its parts. The surface shows through a 2px gap
 * between parts, and the total sits at the end of the bar.
 */
export function StackedBars({ chart, onTip, figure }) {
    const sums = totals(chart.series, chart.labels.length);
    const max = chart.max || Math.max(...sums) || 1;

    const tip = (event, index) => onTip({
        ...pointerIn(event, figure.current),
        label: chart.labels[index],
        rows: [
            ...chart.series.map((entry, at) => ({ key: at, index: at, name: entry.name, value: formatValue(entry.values[index], chart.unit) })),
            { key: 'total', name: wordsOf(chart).total, value: formatValue(sums[index], chart.unit), strong: true },
        ],
    });

    return (
        <div className="space-y-2">
            {chart.labels.map((label, index) => (
                <div
                    key={`${index}${label}`}
                    className="flex items-center gap-3 group/row"
                    onMouseMove={event => tip(event, index)}
                    onMouseLeave={() => onTip(null)}
                >
                    <div className="w-[28%] max-w-[140px] shrink-0 truncate text-right text-[11.5px] text-gray-600 dark:text-gray-400">{label}</div>
                    <div className="flex-1 min-w-0">
                        <div
                            className="chart-grow flex h-3.5 gap-[2px] rounded-[4px] overflow-hidden"
                            style={{ width: `${(sums[index] / max) * 100}%`, ...stagger(index) }}
                        >
                            {chart.series.map((entry, at) => {
                                const value = entry.values[index];
                                if (!isNumber(value) || value <= 0) return null;
                                return (
                                    <div
                                        key={at}
                                        className="h-full transition-opacity group-hover/row:opacity-90"
                                        style={{ flexGrow: value, flexBasis: 0, background: seriesColor(at), minWidth: 2 }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                    <span className="shrink-0 min-w-[44px] text-right text-[12px] font-medium tabular-nums text-gray-900 dark:text-white">
                        {formatValue(sums[index], chart.unit)}
                    </span>
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Donut
 * ------------------------------------------------------------------ */

/** A ring segment from angle a0 to a1 (radians, clockwise from twelve o'clock). */
function ringPath(cx, cy, inner, outer, a0, a1) {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
        // A whole ring is two halves: an arc cannot start and end on one point.
        return `${ringPath(cx, cy, inner, outer, 0, Math.PI)}${ringPath(cx, cy, inner, outer, Math.PI, Math.PI * 2)}`;
    }
    const point = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${point(outer, a0)}A${outer},${outer} 0 ${large} 1 ${point(outer, a1)}`
        + `L${point(inner, a1)}A${inner},${inner} 0 ${large} 0 ${point(inner, a0)}Z`;
}

const sliceColor = (slice, index) => (slice.other ? 'var(--chart-other)' : seriesColor(index));

export function Donut({ chart, width, onTip, figure }) {
    const [active, setActive] = useState(-1);
    const wide = width >= 320;
    const size = Math.round(Math.max(120, Math.min(wide ? width * 0.4 : width * 0.6, 168)));
    const outer = size / 2;
    const inner = outer * 0.7;

    let angle = 0;
    const arcs = chart.slices.map((slice) => {
        const sweep = (slice.value / chart.total) * Math.PI * 2;
        const arc = { a0: angle, a1: angle + sweep };
        angle += sweep;
        return arc;
    });

    const show = (event, index) => {
        setActive(index);
        const slice = chart.slices[index];
        onTip({
            ...pointerIn(event, figure.current),
            label: slice.label,
            rows: [{ key: 0, color: sliceColor(slice, index), name: formatShare(slice.value, chart.total), value: formatValue(slice.value, chart.unit) }],
        });
    };
    const hide = () => { setActive(-1); onTip(null); };

    return (
        <div className={`flex ${wide ? 'flex-row items-center gap-6' : 'flex-col items-center gap-4'}`}>
            <div className="relative shrink-0" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="chart-appear block">
                    {chart.slices.map((slice, index) => (
                        <path
                            key={`${index}${slice.label}`}
                            d={ringPath(outer, outer, inner, outer - 1, arcs[index].a0, arcs[index].a1)}
                            fill={sliceColor(slice, index)}
                            stroke="var(--chart-surface)"
                            strokeWidth={2}
                            strokeLinejoin="round"
                            className="transition-opacity duration-150"
                            opacity={active < 0 || active === index ? 1 : 0.35}
                            onMouseMove={event => show(event, index)}
                            onMouseLeave={hide}
                        />
                    ))}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[18px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-gray-900 dark:text-white">
                        {active >= 0 ? formatShare(chart.slices[active].value, chart.total) : formatValue(chart.total, chart.unit)}
                    </span>
                    <span className="mt-1 max-w-[70%] truncate text-[10.5px] text-gray-500 dark:text-gray-400">
                        {active >= 0 ? chart.slices[active].label : chart.center}
                    </span>
                </div>
            </div>
            <div className="flex-1 min-w-0 w-full max-w-[360px] space-y-1">
                {chart.slices.map((slice, index) => (
                    <div
                        key={`${index}${slice.label}`}
                        className={`flex items-center gap-2 px-1.5 py-1 rounded-md text-[12px] transition-colors
                            ${active === index ? 'bg-gray-900/[0.04] dark:bg-white/[0.05]' : ''}`}
                        onMouseEnter={() => setActive(index)}
                        onMouseLeave={() => setActive(-1)}
                    >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sliceColor(slice, index) }} />
                        <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">{slice.label}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-gray-400 dark:text-gray-500">{formatValue(slice.value, chart.unit)}</span>
                        <span className="shrink-0 w-10 text-right tabular-nums font-medium text-gray-900 dark:text-white">
                            {formatShare(slice.value, chart.total)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Treemap
 * ------------------------------------------------------------------ */

/** Room a box needs before its label, and then its value, are printed in it. */
const fitsLabel = (box) => box.width > 44 && box.height > 20;
const fitsValue = (box) => box.width > 56 && box.height > 38;

/** Group label strip at the top of a nested group, when the group is big enough to spare it. */
const HEADER = 18;

export function Treemap({ chart, width, onTip, figure }) {
    const [active, setActive] = useState(null);
    const height = Math.round(Math.max(180, Math.min(width * 0.56, 300)));
    const groups = squarify(chart.nodes, 0, 0, width, height);
    const largest = Math.max(...chart.nodes.flatMap(node => (node.children ? node.children.map(child => child.value) : [node.value])));

    const boxes = [];
    const headers = [];
    chart.nodes.forEach((node, index) => {
        const area = groups[index];
        if (!node.children) {
            // Flat: one hue, deeper for bigger, so size reads twice.
            const strength = 18 + 40 * Math.sqrt(node.value / largest);
            boxes.push({ key: `${index}`, label: node.label, path: node.label, value: node.value, area, color: tint('var(--chart-1)', strength), swatch: 'var(--chart-1)' });
            return;
        }
        const color = seriesColor(index);
        const header = area.height > 56 && area.width > 64;
        if (header) headers.push({ key: `h${index}`, label: node.label, value: node.value, area });
        const inside = squarify(node.children, area.x, area.y + (header ? HEADER : 0), area.width, area.height - (header ? HEADER : 0));
        node.children.forEach((child, at) => {
            const strength = 22 + 36 * Math.sqrt(child.value / node.value);
            boxes.push({ key: `${index}-${at}`, label: child.label, path: `${node.label} / ${child.label}`, value: child.value, area: inside[at], color: tint(color, strength), swatch: color });
        });
    });

    const show = (event, box) => {
        setActive(box.key);
        onTip({
            ...pointerIn(event, figure.current),
            label: box.path,
            rows: [{ key: 0, color: box.swatch, name: formatShare(box.value, chart.total), value: formatValue(box.value, chart.unit) }],
        });
    };

    return (
        <div className="chart-appear relative" style={{ height }} onMouseLeave={() => { setActive(null); onTip(null); }}>
            {headers.map(header => (
                <div
                    key={header.key}
                    className="absolute flex items-center gap-1.5 px-1.5 text-[10.5px] font-medium text-gray-600 dark:text-gray-400 overflow-hidden"
                    style={{ left: header.area.x, top: header.area.y, width: header.area.width, height: HEADER }}
                >
                    <span className="truncate">{header.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-gray-400 dark:text-gray-500">{formatValue(header.value, chart.unit)}</span>
                </div>
            ))}
            {boxes.map((box) => {
                const { x, y, width: w, height: h } = box.area;
                return (
                    <div
                        key={box.key}
                        className="absolute p-px"
                        style={{ left: x, top: y, width: w, height: h }}
                        onMouseMove={event => show(event, box)}
                    >
                        <div
                            className="h-full rounded-[4px] overflow-hidden px-2 py-1.5 transition-[filter] duration-150"
                            style={{ background: box.color, filter: active === box.key ? 'brightness(1.12)' : undefined }}
                        >
                            {fitsLabel(box.area) && (
                                <div className="text-[11.5px] leading-tight truncate text-gray-900 dark:text-white">{box.label}</div>
                            )}
                            {fitsValue(box.area) && (
                                <div className="mt-0.5 text-[10.5px] leading-tight tabular-nums truncate text-gray-700 dark:text-gray-300">
                                    {formatValue(box.value, chart.unit)}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Heatmap
 * ------------------------------------------------------------------ */

/** Steps in the legend. The cells themselves are continuous. */
const LEGEND_STEPS = [0, 0.25, 0.5, 0.75, 1];

/** One hue, faint to full, for a value's place between the least and the most. */
const heat = share => tint('var(--chart-1)', Math.round(8 + 92 * share));

export function Heatmap({ chart, width, onTip, figure }) {
    const numbers = chart.values.flat().filter(isNumber);
    const low = Math.min(0, ...numbers);
    const high = Math.max(...numbers);
    const span = high - low || 1;
    // Room for the longest row label and the gap after it.
    const labelWidth = Math.min(96, Math.max(36, ...chart.y.map(label => label.length * 6.6 + 14)));
    const cellWidth = (width - labelWidth) / chart.x.length;
    const shownX = new Set(labelIndexes(chart.x.length, (width - labelWidth) / Math.max(22, Math.max(...chart.x.map(label => label.length * 6.2 + 8)))));
    const gap = cellWidth < 10 ? 1 : 2;

    return (
        <div onMouseLeave={() => onTip(null)}>
            <div
                className="chart-appear grid"
                style={{ gridTemplateColumns: `${labelWidth}px repeat(${chart.x.length}, minmax(0, 1fr))`, gap }}
            >
                {chart.y.map((label, row) => [
                    <div key={`y${row}`} className="pr-2 text-right text-[10.5px] leading-[16px] text-gray-500 dark:text-gray-400 truncate">{label}</div>,
                    ...chart.values[row].map((value, column) => (
                        <div
                            key={`${row}-${column}`}
                            className="h-4 rounded-[3px] transition-[outline] hover:outline hover:outline-1 hover:outline-gray-900/40 dark:hover:outline-white/50"
                            style={{ background: isNumber(value) ? heat((value - low) / span) : 'var(--chart-track)' }}
                            onMouseMove={event => onTip({
                                ...pointerIn(event, figure.current),
                                label: `${label} · ${chart.x[column]}`,
                                rows: [{ key: 0, value: formatValue(value, chart.unit) }],
                            })}
                        />
                    )),
                ])}
                <div />
                {chart.x.map((label, column) => (
                    <div key={`x${column}`} className="relative h-4">
                        {shownX.has(column) && (
                            <span className="absolute left-1/2 top-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                                {label}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                <span>{formatValue(low, chart.unit)}</span>
                {LEGEND_STEPS.map(step => <span key={step} className="w-3 h-2.5 rounded-[2px]" style={{ background: heat(step) }} />)}
                <span>{formatValue(high, chart.unit)}</span>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Uptime strip
 * ------------------------------------------------------------------ */

export function Uptime({ chart, onTip, figure }) {
    const t = useT();
    const count = chart.labels.length;
    const gap = count > 60 ? 1 : 2;
    return (
        <div className="space-y-3.5" onMouseLeave={() => onTip(null)}>
            {chart.series.map((row, index) => {
                const share = uptimeShare(row.values);
                const down = row.values.filter(value => value === 'down').length;
                return (
                    <div key={`${index}${row.name}`}>
                        <div className="flex items-baseline gap-2 mb-1.5">
                            {row.name && <span className="min-w-0 truncate text-[12px] text-gray-800 dark:text-gray-200">{row.name}</span>}
                            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                {down > 0 && <>{t('assistant.chart.downCount', { count: down })} · </>}
                                <span className="font-medium text-gray-900 dark:text-white">
                                    {share === null ? '–' : `${share >= 99.95 || share === 0 ? Math.round(share) : share.toFixed(share >= 99 ? 2 : 1)}%`}
                                </span>
                                {' '}{t('assistant.chart.uptime')}
                            </span>
                        </div>
                        <div className="chart-appear flex h-6" style={{ gap, ...stagger(index) }}>
                            {row.values.map((status, at) => (
                                <div
                                    key={at}
                                    className="flex-1 min-w-0 rounded-[2px] transition-opacity hover:opacity-70"
                                    style={{ background: status ? STATUS_COLOR[status] : 'var(--chart-track)' }}
                                    onMouseMove={event => onTip({
                                        ...pointerIn(event, figure.current),
                                        label: row.name ? `${row.name} · ${chart.labels[at]}` : chart.labels[at],
                                        rows: [{
                                            key: 0,
                                            color: status ? STATUS_COLOR[status] : 'var(--chart-track)',
                                            value: status ? t(statusKey(status)) : t('assistant.chart.noData'),
                                        }],
                                    })}
                                />
                            ))}
                        </div>
                        {index === chart.series.length - 1 && (
                            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                                <span>{chart.labels[0]}</span>
                                <span>{chart.labels[count - 1]}</span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

const SPAN_COLOR = { '': 'var(--chart-1)', ok: 'var(--chart-1)', running: 'var(--chart-1)', failed: 'var(--chart-critical)', warning: 'var(--chart-warning)' };

export function Timeline({ chart, width, onTip, figure }) {
    const t = useT();
    const words = wordsOf(chart);
    const from = Math.min(...chart.spans.map(span => span.start));
    const to = Math.max(from + 60000, ...chart.spans.map(span => span.end));
    const labelWidth = Math.min(150, Math.max(56, width * 0.28));
    const track = Math.max(60, width - labelWidth - 12);
    const { step, ticks } = timeTicks(from, to, Math.max(2, Math.floor(track / 72)));
    const x = ms => ((ms - from) / (to - from)) * 100;
    const fullStep = chart.clock ? 0 : 60000;
    const at = ms => formatTime(ms, { clock: chart.clock, step: fullStep, full: true, locale: chart.locale });

    // Rows in order, with a heading wherever the group changes.
    const rows = [];
    let group = null;
    chart.spans.forEach((span, index) => {
        if (span.group && span.group !== group) rows.push({ heading: span.group, key: `g${index}` });
        group = span.group || group;
        rows.push({ span, index, key: `s${index}` });
    });

    return (
        <div onMouseLeave={() => onTip(null)}>
            <div className="relative">
                {/* Gridlines under the bars, one per tick. */}
                <div className="absolute inset-y-0 pointer-events-none" style={{ left: labelWidth + 12, right: 0 }}>
                    {ticks.map(tick => (
                        <div key={tick} className="absolute inset-y-0 w-px bg-[color:var(--chart-grid)]" style={{ left: `${x(tick)}%` }} />
                    ))}
                </div>
                <div className="relative space-y-1">
                    {rows.map((row) => {
                        if (row.heading) {
                            return (
                                <div key={row.key} className="pt-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                    {row.heading}
                                </div>
                            );
                        }
                        const { span, index } = row;
                        const left = x(span.start);
                        const size = Math.max(x(span.end) - left, 0);
                        const duration = formatDuration(span.end - span.start, words);
                        const inside = (size / 100) * track > duration.length * 6.5 + 14;
                        const color = SPAN_COLOR[span.status] || SPAN_COLOR[''];
                        return (
                            <div key={row.key} className="flex items-center gap-3 h-6">
                                <div className="shrink-0 truncate text-right text-[11.5px] text-gray-600 dark:text-gray-400" style={{ width: labelWidth }}>
                                    {span.label}
                                </div>
                                <div className="relative flex-1 h-full">
                                    <div
                                        className={`chart-grow absolute top-1 bottom-1 flex items-center rounded-[4px] ${span.open ? 'chart-running' : ''}`}
                                        style={{ left: `${left}%`, width: `${size}%`, minWidth: 3, background: color, ...stagger(index) }}
                                        onMouseMove={event => onTip({
                                            ...pointerIn(event, figure.current),
                                            label: span.label,
                                            rows: [
                                                { key: 's', name: words.start, value: at(span.start) },
                                                { key: 'e', name: words.end, value: span.open ? words.running : at(span.end) },
                                                { key: 'd', name: words.duration, value: duration },
                                                ...(span.status ? [{ key: 'st', color, name: words.status, value: t(statusKey(span.status)) }] : []),
                                            ],
                                        })}
                                    >
                                        {inside && <span className="px-1.5 text-[10.5px] font-medium tabular-nums text-white whitespace-nowrap">{duration}</span>}
                                    </div>
                                    {!inside && (
                                        <span
                                            className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10.5px] tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap"
                                            style={left + size > 78 ? { right: `${100 - left}%`, paddingRight: 6, paddingLeft: 0 } : { left: `calc(${left + size}% + 3px)` }}
                                        >
                                            {duration}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="relative h-4 mt-1.5" style={{ marginLeft: labelWidth + 12 }}>
                {ticks.map((tick, index) => (
                    <span
                        key={tick}
                        className="absolute top-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-500 whitespace-nowrap"
                        style={{
                            left: `${x(tick)}%`,
                            transform: x(tick) < 4 ? 'none' : x(tick) > 96 || (index === ticks.length - 1 && x(tick) > 90) ? 'translateX(-100%)' : 'translateX(-50%)',
                        }}
                    >
                        {formatTime(tick, { clock: chart.clock, step, locale: chart.locale })}
                    </span>
                ))}
            </div>
        </div>
    );
}
