/**
 * A chart from a ```chart fence in a reply, or a live one from watch_metric.
 *
 * Drawn as React elements and SVG, like everything else in the transcript:
 * the spec is model output, and it never goes near an HTML parser. What the
 * spec means is settled in lib/chart-spec.js; this file only draws it.
 *
 * The look is flat and quiet: a hairline card, gridlines that are barely
 * there, thin smooth lines over a faint wash, bars as a tinted list with the
 * label inside, and motion only on the way in. No glow, no shadow on a mark,
 * no gradient that is not carrying something. What flourish there is, the
 * data can survive: the curve cannot overshoot (see `smoothPath`), the wash
 * fades toward the baseline rather than claiming area, and the movement
 * (lib/chartMotion) is not played for anyone who asks for less motion.
 *
 * Colour is by role, from the `--chart-*` variables in input.css, which have
 * light and dark steps of their own rather than one set flipped, and start
 * from the app's own blue. Series n is always colour n, never cycled or
 * re-ranked. Text never wears a series colour: identity is the dot, line or
 * bar beside it.
 */

import { Component, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownRight01Icon, ArrowUpRight01Icon, ChartLineData02Icon, Copy01Icon, Table01Icon, Tick01Icon,
} from 'hugeicons-react';
import Tooltip from './Tooltip';
import {
    WORDS, extent, formatValue, headline, labelIndexes, meterState, niceScale, runsOf, smoothPath, tableOf, toCsv, totals,
} from '../../lib/chart-spec';
import { AXIS_TEXT, pointerIn, seriesColor, stagger, textWidth, tint } from '../../lib/chart-draw';
import { finishChart, playChart } from '../../lib/chartMotion';
import { Donut, Heatmap, StackedBars, Stats, Timeline, Treemap, Uptime } from './ChartForms';
import { localeTag, useLanguage, useT } from '../../i18n';

/** The line chart's height. Tall enough to read a trend, short enough for a panel. */
const LINE_HEIGHT = 168;

/** The forms drawn at a measured width, which wait for the first measurement. */
const MEASURED = new Set(['line', 'area', 'donut', 'treemap', 'heatmap', 'timeline']);

/**
 * The words a chart makes up for itself (a default series name, a table's
 * headings), in the window's language, for `parseChart` and `chartOf`. Made
 * again only when the language changes.
 */
export function useChartWords() {
    const language = useLanguage();
    const t = useT();
    return useMemo(() => ({
        words: Object.fromEntries(Object.keys(WORDS).map(key => [key, t(`assistant.chart.word.${key}`)])),
        locale: localeTag(),
    }), [language, t]);
}

function Legend({ chart }) {
    if (!chart.series || chart.series.length < 2 || chart.type === 'uptime') return null;
    return (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 mb-3 text-[11px] text-gray-600 dark:text-gray-400">
            {chart.series.map((entry, index) => (
                <span key={`${index}${entry.name}`} className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: seriesColor(index) }} />
                    <span className="truncate">{entry.name}</span>
                </span>
            ))}
        </div>
    );
}

/**
 * What the pointer is over: beside the pointer, kept inside the card, and
 * opening away from whichever edge is nearer.
 */
function DataTip({ tip, width, height }) {
    if (!tip) return null;
    const flip = tip.x > width / 2;
    const above = tip.y > height / 2;
    return (
        <div
            role="tooltip"
            className="pointer-events-none absolute z-10 min-w-[112px] max-w-[230px] px-2.5 py-1.5 rounded-md
                bg-white dark:bg-surface-control
                border border-black/[0.08] dark:border-white/[0.08]
                shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] text-[11px] leading-snug"
            style={{
                ...(above ? { bottom: Math.max(4, height - tip.y + 12) } : { top: Math.max(4, tip.y + 12) }),
                ...(flip ? { right: Math.max(4, width - tip.x + 12) } : { left: tip.x + 12 }),
            }}
        >
            <div className="mb-0.5 text-[10.5px] text-gray-500 dark:text-gray-400 break-words">
                {tip.label}
            </div>
            {tip.rows.map(row => (
                <div
                    key={row.key}
                    className={`flex items-center gap-2 py-px ${row.strong ? 'mt-0.5 pt-1 border-t border-black/[0.06] dark:border-white/[0.08]' : ''}`}
                >
                    {(row.color || row.index !== undefined) && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: row.color || seriesColor(row.index) }} />
                    )}
                    {row.name && <span className="text-gray-600 dark:text-gray-300 truncate">{row.name}</span>}
                    <span className="ml-auto pl-3 font-semibold text-gray-900 dark:text-white tabular-nums whitespace-nowrap">
                        {row.value}
                    </span>
                </div>
            ))}
            {tip.note && <div className="mt-1 text-[10.5px] text-gray-500 dark:text-gray-400">{tip.note}</div>}
        </div>
    );
}

/** The tooltip's rows for one label: every series, named once there is more than one. */
function rowsAt(chart, index) {
    const many = chart.series.length > 1;
    const rows = chart.series.map((entry, at) => ({
        key: at,
        index: many ? at : undefined,
        name: many ? entry.name : '',
        value: formatValue(entry.values[index], chart.unit),
    }));
    if (chart.stacked && many) {
        rows.push({
            key: 'total',
            name: chart.words?.total || WORDS.total,
            value: formatValue(totals(chart.series, chart.labels.length)[index], chart.unit),
            strong: true,
        });
    }
    return rows;
}

/**
 * One series of bars, as a list: each row a tinted bar with its label laid
 * inside it and the value at the right edge, so the longest label never has
 * to fight the longest bar for the same room.
 */
function BarList({ chart, onTip, figure }) {
    const [, high] = extent(chart.series);
    // No axis to round to, so the longest bar fills the row. Percentages are
    // the exception, read against the whole.
    const max = chart.max || (chart.unit === '%' && high <= 100 ? 100 : high) || 1;
    const color = seriesColor(0);

    return (
        <div className="space-y-1.5">
            {chart.labels.map((label, index) => {
                const value = chart.series[0].values[index];
                const share = Number.isFinite(value) ? Math.min(1, value / max) : 0;
                return (
                    <div
                        key={`${index}${label}`}
                        className="chart-bar-row flex items-center gap-3"
                        onMouseMove={event => onTip({ ...pointerIn(event, figure.current), label, rows: rowsAt(chart, index) })}
                        onMouseLeave={() => onTip(null)}
                    >
                        <div className="relative flex-1 min-w-0 h-7 flex items-center">
                            <div
                                className="chart-bar chart-grow absolute inset-y-0 left-0 rounded-md"
                                style={{
                                    width: `${share * 100}%`,
                                    minWidth: value > 0 ? 4 : 0,
                                    background: tint(color, 22),
                                    ...stagger(index),
                                }}
                            />
                            <span className="relative px-2.5 text-[12px] truncate text-gray-800 dark:text-gray-100">
                                {label}
                            </span>
                        </div>
                        <span className="shrink-0 min-w-[44px] text-right text-[12px] font-medium tabular-nums text-gray-900 dark:text-white">
                            {formatValue(value, chart.unit)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Several series per label: the label, then one slim pill per series on a
 * faint track, each with its own value.
 */
function GroupedBars({ chart, onTip, figure }) {
    const [, high] = extent(chart.series);
    const max = chart.max || (chart.unit === '%' && high <= 100 ? 100 : high) || 1;

    return (
        <div className="space-y-3">
            {chart.labels.map((label, index) => (
                <div
                    key={`${index}${label}`}
                    onMouseMove={event => onTip({ ...pointerIn(event, figure.current), label, rows: rowsAt(chart, index) })}
                    onMouseLeave={() => onTip(null)}
                >
                    <div className="mb-1 text-[12px] text-gray-800 dark:text-gray-200 truncate">{label}</div>
                    <div className="space-y-1">
                        {chart.series.map((entry, at) => {
                            const value = entry.values[index];
                            const share = Number.isFinite(value) ? Math.min(1, value / max) : 0;
                            return (
                                <div key={at} className="flex items-center gap-3">
                                    <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[color:var(--chart-track)]">
                                        <div
                                            className="chart-grow h-full rounded-full"
                                            style={{
                                                width: `${share * 100}%`,
                                                minWidth: value > 0 ? 6 : 0,
                                                background: seriesColor(at),
                                                ...stagger(index * chart.series.length + at),
                                            }}
                                        />
                                    </div>
                                    <span className="shrink-0 min-w-[44px] text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
                                        {formatValue(value, chart.unit)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** A meter's colour for its state. Warning and critical are status colours, never series ones. */
const METER_COLOR = {
    normal: 'var(--chart-1)',
    warning: 'var(--chart-warning)',
    critical: 'var(--chart-critical)',
};

/**
 * One row per thing that fills up: a mount, a pool, a quota.
 *
 * The state is a word in a badge as well as the fill's colour, because amber
 * and red on a thin bar are not something to make anyone tell apart by hue.
 */
function Meters({ chart }) {
    const t = useT();
    return (
        <div className="space-y-3.5">
            {chart.labels.map((label, index) => {
                const value = chart.series[0].values[index];
                const max = chart.maxes[index];
                const known = Number.isFinite(value);
                const percent = known ? (value / max) * 100 : 0;
                const state = known ? meterState(value, max, chart.thresholds) : 'normal';
                const color = METER_COLOR[state];
                return (
                    <div key={`${index}${label}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="min-w-0 truncate text-[12px] text-gray-800 dark:text-gray-200">{label}</span>
                            {state !== 'normal' && (
                                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-400">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                                    {t(state === 'critical' ? 'assistant.chart.critical' : 'assistant.chart.high')}
                                </span>
                            )}
                            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                {chart.unit === '%'
                                    ? null
                                    : <>{formatValue(value, chart.unit)} / {formatValue(max, chart.unit)}</>}
                            </span>
                            <span className="shrink-0 min-w-[36px] text-right text-[12px] font-semibold tabular-nums text-gray-900 dark:text-white">
                                {known ? `${Math.round(percent)}%` : '–'}
                            </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden bg-[color:var(--chart-track)]">
                            <div
                                className="chart-grow h-full rounded-full"
                                style={{
                                    width: `${Math.min(100, percent)}%`,
                                    background: color,
                                    ...stagger(index),
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** A point, ringed in the card's own surface so it stays legible where lines cross. */
function Dot({ cx, cy, index }) {
    return <circle cx={cx} cy={cy} r={4} fill={seriesColor(index)} stroke="var(--chart-surface)" strokeWidth={2} />;
}

/**
 * Lines over time, or anything else with an order to it.
 *
 * One value axis, always: two measures on different scales are two charts.
 * A single series, and every area chart, gets a wash that fades to nothing
 * at the foot; several lines without one stay readable where they cross.
 * Stacked, each series is a flat band on top of the ones before it.
 *
 * Threshold lines (`limits`) are dashed across the plot, labelled at the
 * right; events are dashed down it, labelled along the top. Both are context
 * for the data rather than data, so both stay in muted ink.
 */
function LineChart({ chart, width, onTip, tip }) {
    const gradient = useId().replace(/:/g, '');
    const count = chart.labels.length;
    const stacked = Boolean(chart.stacked);
    // A live chart is drawn again with every sample, and a line that drew
    // itself in each time a gap moved would never sit still.
    const draw = chart.live ? undefined : 'chart-draw';
    const fade = chart.live ? undefined : 'chart-fade';

    // What is plotted: the values, or for a stack each band's running top.
    const plotted = useMemo(() => {
        if (!stacked) return chart.series.map(entry => entry.values);
        const running = new Array(count).fill(0);
        return chart.series.map(entry => entry.values.map((value, index) => {
            running[index] += Number.isFinite(value) ? value : 0;
            return running[index];
        }));
    }, [chart, count, stacked]);

    const limits = chart.limits || [];
    const events = chart.events || [];
    const [low, high] = extent([...plotted.map(values => ({ values })), { values: limits.map(limit => limit.value) }]);
    const scale = niceScale(low, high, { count: 3, min: chart.min, max: chart.max });
    const tickLabels = scale.ticks.map(tick => formatValue(tick, chart.unit));
    const washed = !stacked && (chart.type === 'area' || chart.series.length === 1);

    const left = Math.ceil(Math.max(...tickLabels.map(label => textWidth(label)))) + 10;
    const right = 8;
    const top = events.length ? 24 : 10;
    const bottom = 22;
    const plotWidth = Math.max(40, width - left - right);
    const plotHeight = LINE_HEIGHT - top - bottom;

    const x = index => left + (count === 1 ? plotWidth / 2 : (index * plotWidth) / (count - 1));
    const y = value => top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;
    const foot = top + plotHeight;
    const base = y(Math.max(scale.min, Math.min(0, scale.max)));

    const longest = Math.max(...chart.labels.map(label => textWidth(label)));
    const shownLabels = labelIndexes(count, plotWidth / (longest + 18));
    const hovered = tip?.index;

    // An event label is printed only where it does not run into the last one;
    // the rest are still marked, and named in the tooltip.
    const eventLabels = new Set();
    let lastEdge = -Infinity;
    events.forEach((event, index) => {
        const at = x(event.index);
        const half = textWidth(event.label) / 2 + 6;
        if (event.label && at - half > lastEdge) { eventLabels.add(index); lastEdge = at + half; }
    });

    const move = (event) => {
        const svg = event.currentTarget.ownerSVGElement || event.currentTarget;
        const { x: pointer, y: pointerY } = pointerIn(event, svg);
        const index = count === 1 ? 0 : Math.round(((pointer - left) / plotWidth) * (count - 1));
        const at = Math.max(0, Math.min(count - 1, index));
        const here = events.filter(item => item.index === at && item.label).map(item => item.label);
        onTip({
            x: x(at), y: pointerY, index: at, line: true, label: chart.labels[at],
            rows: rowsAt(chart, at), note: here.join(' · '),
        });
    };

    const line = (values, run) => smoothPath(run.map(at => [x(at), y(values[at])]));

    return (
        <svg width={width} height={LINE_HEIGHT} className="block overflow-visible select-none">
            <defs>
                {chart.series.map((_, index) => (
                    <linearGradient key={index} id={`${gradient}-${index}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={seriesColor(index)} stopOpacity={chart.series.length > 1 ? 0.1 : 0.18} />
                        <stop offset="100%" stopColor={seriesColor(index)} stopOpacity={0} />
                    </linearGradient>
                ))}
            </defs>

            {scale.ticks.map((tick, index) => (
                <g key={tick}>
                    <line
                        x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)}
                        stroke="var(--chart-grid)" strokeWidth={1} shapeRendering="crispEdges"
                    />
                    <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className={AXIS_TEXT}>
                        {tickLabels[index]}
                    </text>
                </g>
            ))}

            {shownLabels.map(index => (
                <text
                    key={index}
                    x={x(index)}
                    y={LINE_HEIGHT - 4}
                    textAnchor={count === 1 ? 'middle' : index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
                    className={AXIS_TEXT}
                >
                    {chart.labels[index]}
                </text>
            ))}

            {events.map((event, index) => {
                const at = x(event.index);
                const anchor = at - left < 40 ? 'start' : left + plotWidth - at < 40 ? 'end' : 'middle';
                return (
                    <g key={`ev${index}`}>
                        <line
                            x1={at} x2={at} y1={top - 6} y2={foot}
                            stroke="var(--chart-mark)" strokeWidth={1} strokeDasharray="2 3" shapeRendering="crispEdges"
                        />
                        <circle cx={at} cy={top - 6} r={2.5} fill="var(--chart-mark)" />
                        {eventLabels.has(index) && (
                            <text x={at} y={top - 13} textAnchor={anchor} className="fill-gray-500 dark:fill-gray-400 text-[10px]">
                                {event.label}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* A stack's bands: each from the top of the one below to its own. */}
            {stacked && plotted.map((values, index) => {
                const below = index ? plotted[index - 1] : null;
                const all = Array.from({ length: count }, (_, at) => at);
                const upper = line(values, all);
                const lower = below
                    ? smoothPath([...all].reverse().map(at => [x(at), y(below[at])]), { move: false })
                    : `L${x(count - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}`;
                return (
                    <path
                        key={`b${index}`}
                        d={`${upper}${lower}Z`}
                        fill={seriesColor(index)}
                        fillOpacity={0.22}
                        className={fade}
                    />
                );
            })}

            {washed && chart.series.map((entry, index) => runsOf(entry.values).map((run) => {
                if (run.length < 2) return null;
                const d = `${line(entry.values, run)}L${x(run[run.length - 1]).toFixed(1)},${foot}L${x(run[0]).toFixed(1)},${foot}Z`;
                return <path key={`a${index}-${run[0]}`} d={d} fill={`url(#${gradient}-${index})`} className={fade} />;
            }))}

            {plotted.map((values, index) => runsOf(stacked ? values : chart.series[index].values).map(run => (
                <path
                    key={`l${index}-${run[0]}`}
                    d={line(values, run)}
                    pathLength={1}
                    fill="none"
                    stroke={seriesColor(index)}
                    strokeWidth={stacked ? 1.5 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className={draw}
                />
            )))}

            {limits.map((limit, index) => {
                const at = y(limit.value);
                const label = `${limit.label ? `${limit.label} ` : ''}${formatValue(limit.value, chart.unit)}`;
                return (
                    <g key={`lim${index}`}>
                        <line
                            x1={left} x2={left + plotWidth} y1={at} y2={at}
                            stroke="var(--chart-mark)" strokeWidth={1} strokeDasharray="4 4" shapeRendering="crispEdges"
                        />
                        <text
                            x={left + plotWidth} y={at - 4} textAnchor="end"
                            stroke="var(--chart-surface)" strokeWidth={3} paintOrder="stroke"
                            className="fill-gray-500 dark:fill-gray-400 text-[10px] tabular-nums"
                        >
                            {label}
                        </text>
                    </g>
                );
            })}

            {/* A point with no neighbours draws no line, so it gets a dot. */}
            {!stacked && chart.series.map((entry, index) => runsOf(entry.values).map(run => (
                run.length === 1 && hovered !== run[0]
                    ? <Dot key={`s${index}-${run[0]}`} cx={x(run[0])} cy={y(entry.values[run[0]])} index={index} />
                    : null
            )))}

            {/* Where the line ends now, marked while nothing is hovered. One
                series only: several lines ending close together would pile
                their dots into a knot. */}
            {!Number.isInteger(hovered) && chart.series.length === 1 && chart.series.map((entry, index) => {
                const runs = runsOf(entry.values);
                const end = runs.length ? runs[runs.length - 1].at(-1) : -1;
                return end === count - 1 && runs[runs.length - 1].length > 1
                    ? <g key={`e${index}`} className={fade}><Dot cx={x(end)} cy={y(entry.values[end])} index={index} /></g>
                    : null;
            })}

            {Number.isInteger(hovered) && (
                <g>
                    <line
                        x1={x(hovered)} x2={x(hovered)} y1={top} y2={foot}
                        stroke="var(--chart-cursor)" strokeWidth={1} shapeRendering="crispEdges"
                    />
                    {plotted.map((values, index) => (Number.isFinite(chart.series[index].values[hovered])
                        ? <Dot key={`h${index}`} cx={x(hovered)} cy={y(values[hovered])} index={index} />
                        : null))}
                </g>
            )}

            {/* The hit area: the whole plot, wider than any line in it. */}
            <rect
                x={left - 6} y={0} width={plotWidth + 14} height={LINE_HEIGHT}
                fill="transparent"
                onMouseMove={move}
                onMouseLeave={() => onTip(null)}
            />
        </svg>
    );
}

/** The latest value of a one-series line, large, with how far it moved over the window. */
function Headline({ chart }) {
    const t = useT();
    const lead = headline(chart);
    if (!lead) return null;
    const up = lead.change > 0;
    const Arrow = up ? ArrowUpRight01Icon : ArrowDownRight01Icon;
    return (
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1 -mt-0.5 mb-3">
            <span className="text-[24px] leading-none font-semibold tracking-[-0.02em] text-gray-900 dark:text-white">
                {formatValue(lead.value, chart.unit)}
            </span>
            {lead.change !== null && Math.abs(lead.change) >= 0.05 && (
                // Neutral on purpose: whether up is good depends on what is
                // measured, and the chart does not know.
                <span className="inline-flex items-center gap-0.5 self-center px-1.5 py-0.5 rounded-full
                    text-[10.5px] font-semibold tabular-nums
                    bg-gray-900/[0.05] dark:bg-white/[0.08] text-gray-700 dark:text-gray-200">
                    <Arrow size={11} strokeWidth={2.5} />
                    {Math.abs(lead.change) >= 100 ? Math.round(Math.abs(lead.change)) : Math.abs(lead.change).toFixed(1)}%
                </span>
            )}
            {lead.change !== null && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {t('assistant.chart.since', { label: lead.since })}
                </span>
            )}
        </div>
    );
}

/** The same numbers as a table: for the reader colour does not serve, and for exact values. */
function DataTable({ chart }) {
    const { header, rows } = useMemo(() => tableOf(chart), [chart]);
    return (
        <div className="overflow-x-auto max-h-[320px] overflow-y-auto -mx-1">
            <table className="w-full border-collapse text-[11.5px] leading-snug">
                <thead>
                    <tr>
                        {header.map((cell, index) => (
                            <th
                                key={index}
                                scope="col"
                                className={`px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500
                                    ${index ? 'text-right' : 'text-left'}`}
                            >
                                {cell}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(([label, ...cells], row) => (
                        <tr key={row} className="border-t border-black/[0.05] dark:border-white/[0.06]">
                            <th scope="row" className="px-2 py-1.5 text-left font-normal text-gray-700 dark:text-gray-300 break-words">
                                {label.text}
                            </th>
                            {cells.map((cell, index) => (
                                <td key={index} className="px-2 py-1.5 text-right tabular-nums text-gray-900 dark:text-white whitespace-nowrap">
                                    {cell.text}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * The plot drawing itself in (see lib/chartMotion). Played again only when
 * `stage` moves: the plot coming back from the table view, or arriving once
 * the first measurement lets a measured form draw. A hover, a resize or a
 * live chart's next sample draws the same plot again and plays nothing.
 */
function useDrawIn(ref, stage) {
    useLayoutEffect(() => {
        const timeline = playChart(ref.current);
        return () => finishChart(timeline);
    }, [ref, stage]);
}

/** The plot's width, followed as the panel is resized. */
function useWidth(ref, active) {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        setWidth(element.clientWidth);
        const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, active]);
    return width;
}

/** The form a chart is drawn in. */
function Form(props) {
    const { chart } = props;
    switch (chart.type) {
        case 'bar':
            if (chart.stacked && chart.series.length > 1) return <StackedBars {...props} />;
            return chart.series.length > 1 ? <GroupedBars {...props} /> : <BarList {...props} />;
        case 'meter': return <Meters chart={chart} />;
        case 'line':
        case 'area': return <LineChart {...props} />;
        case 'stats': return <Stats chart={chart} />;
        case 'donut': return <Donut {...props} />;
        case 'treemap': return <Treemap {...props} />;
        case 'heatmap': return <Heatmap {...props} />;
        case 'uptime': return <Uptime {...props} />;
        case 'timeline': return <Timeline {...props} />;
        default: return null;
    }
}

/** The catalog key naming each form, for what a screen reader says in its place. */
function kindKey(chart) {
    if (chart.stacked && chart.type === 'bar') return 'assistant.chart.kind.stackedBar';
    if (chart.stacked && chart.type === 'area') return 'assistant.chart.kind.stackedArea';
    return `assistant.chart.kind.${chart.type}`;
}

/** A sentence a screen reader can say in place of the picture; the table view has the numbers. */
function describe(chart, t) {
    const parts = [`${t(kindKey(chart))}${chart.title ? `: ${chart.title}` : ''}.`];
    if (chart.series?.length > 1) {
        parts.push(t('assistant.chart.seriesOf', { names: chart.series.map(entry => entry.name).join(', ') }));
    }
    parts.push(t('assistant.chart.tableHint'));
    return parts.join(' ');
}

/** One of the card's icon controls: bare until hovered, labelled by the app's own tooltip. */
function ToolButton({ label, active = false, onClick, children }) {
    return (
        <Tooltip label={label} placement="top">
            <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={onClick}
                className={`w-6 h-6 flex items-center justify-center rounded-md outline-none transition-colors
                    focus-visible:ring-1 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                    ${active
                        ? 'text-gray-900 dark:text-white bg-gray-900/[0.06] dark:bg-white/[0.08]'
                        : 'text-gray-400 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.05]'}`}
            >
                {children}
            </button>
        </Tooltip>
    );
}

/** How long "Copied" holds before the button goes back to copying. */
const COPIED_MS = 1400;

/**
 * Copy, chart and table, in one row at the card's corner. Copy is quiet until
 * the card is hovered; the view pair stays, since it says which view this is.
 */
function Toolbar({ csv, table, onView }) {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const timer = useRef(0);
    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(csv);
        } catch {
            try { await window.api?.clipboard?.writeText?.(csv); } catch { return; }
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    };

    return (
        <div className="flex items-center gap-0.5 -mt-1 -mr-1.5 shrink-0">
            <div className={`transition-opacity ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                <ToolButton label={t(copied ? 'assistant.chart.copied' : 'assistant.chart.copyCsv')} onClick={copy}>
                    {copied ? <Tick01Icon size={13} strokeWidth={2} /> : <Copy01Icon size={13} strokeWidth={1.8} />}
                </ToolButton>
            </div>
            <ToolButton label={t('assistant.chart.viewChart')} active={!table} onClick={() => onView(false)}>
                <ChartLineData02Icon size={13} strokeWidth={1.8} />
            </ToolButton>
            <ToolButton label={t('assistant.chart.viewTable')} active={table} onClick={() => onView(true)}>
                <Table01Icon size={13} strokeWidth={1.8} />
            </ToolButton>
        </div>
    );
}

/**
 * `badge` sits beside the title and `footer` under the plot: a live chart's
 * state and its stop button, and its running figures. A chart from a fence
 * has neither.
 */
function Chart({ chart, badge = null, footer = null }) {
    const t = useT();
    const [table, setTable] = useState(false);
    const [tip, setTip] = useState(null);
    const figure = useRef(null);
    const body = useRef(null);
    const width = useWidth(body, table);
    const csv = useMemo(() => toCsv(chart), [chart]);
    const showTip = useCallback(next => setTip(next), []);
    const waiting = MEASURED.has(chart.type) && width === 0;
    useDrawIn(body, table ? 'table' : waiting ? 'waiting' : 'drawn');

    // The line chart works in its own coordinates; the tooltip lives in the
    // card's. The plot's offset inside the card joins the two.
    let placed = tip;
    if (tip?.line && body.current && figure.current) {
        const plot = body.current.getBoundingClientRect();
        const card = figure.current.getBoundingClientRect();
        placed = { ...tip, x: tip.x + plot.left - card.left, y: tip.y + plot.top - card.top };
    }

    return (
        // The frame is the one the reply's code blocks and tables wear, so a
        // chart reads as part of the reply rather than a widget dropped in it.
        <figure
            ref={figure}
            className="chart-root group relative [&:not(:first-child)]:mt-2 px-4 pt-3.5 pb-3.5 rounded-lg
                border border-gray-200 dark:border-surface-control
                bg-white dark:bg-surface-base"
        >
            <figcaption className="flex items-start gap-2 mb-3">
                <div className="min-w-0 flex-1">
                    {chart.title && (
                        <div className="text-[13px] font-semibold leading-snug tracking-[-0.01em] text-gray-900 dark:text-white break-words">
                            {chart.title}
                        </div>
                    )}
                    {chart.subtitle && (
                        <div className="mt-0.5 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400 break-words">
                            {chart.subtitle}
                        </div>
                    )}
                </div>
                {badge}
                <Toolbar csv={csv} table={table} onView={(next) => { setTable(next); setTip(null); }} />
            </figcaption>

            {table ? <DataTable chart={chart} /> : (
                <>
                    <Headline chart={chart} />
                    <Legend chart={chart} />
                    <div ref={body} role="img" aria-label={describe(chart, t)}>
                        {waiting
                            ? <div style={{ height: LINE_HEIGHT }} />
                            : <Form chart={chart} width={width} onTip={showTip} tip={tip} figure={figure} />}
                    </div>
                </>
            )}

            {footer}

            <DataTip
                tip={table ? null : placed}
                width={figure.current?.clientWidth || 0}
                height={figure.current?.clientHeight || 0}
            />
        </figure>
    );
}

/**
 * Where a chart will be, while the reply that holds it is still arriving.
 *
 * Half a JSON object is not a chart, and the half-written spec flickering
 * past as code before it snaps into a picture is worse than a card that
 * shimmers until it is ready.
 */
export function ChartPending() {
    const t = useT();
    return (
        <div
            role="img"
            className="chart-shimmer [&:not(:first-child)]:mt-2 h-28 rounded-lg flex items-end gap-1.5 px-4 pb-4
                border border-gray-200 dark:border-surface-control"
            aria-label={t('assistant.chart.drawing')}
        >
            {[38, 62, 48, 80, 56, 70, 44].map((height, index) => (
                <div key={index} className="flex-1 rounded-sm bg-gray-900/[0.05] dark:bg-white/[0.05]" style={{ height: `${height}%` }} />
            ))}
        </div>
    );
}

/**
 * A chart that throws while drawing, shown as `fallback` instead.
 *
 * The spec is read and checked before anything is drawn, so this should never
 * be needed. It is here because the spec is model output and a reply is not
 * something to lose over one: without it, a form tripping over a shape nobody
 * thought of would take the whole transcript down with it. Tries again when
 * `source` changes, which is a new spec rather than the same one failing
 * twice.
 */
export class ChartBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, source: props.source };
    }

    static getDerivedStateFromProps(props, state) {
        return props.source === state.source ? null : { error: null, source: props.source };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error) {
        console.error('A chart could not be drawn:', error);
    }

    render() {
        return this.state.error ? this.props.fallback : this.props.children;
    }
}

export default memo(Chart);
