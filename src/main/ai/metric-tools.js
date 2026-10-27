/**
 * The tools that put a live chart in the conversation.
 *
 * watch_metric runs a command, on a server or on this computer, and pulls a
 * number out of what it prints with a regular expression the assistant
 * writes for the occasion; the chart follows it in the chat after the turn is
 * over. read_metric is how the assistant sees the same numbers, and
 * stop_metric ends one. The work is in live-metrics.js; the conversation's
 * side of it (the events, the windows) comes in on `ctx.metrics`, built in
 * index.js.
 *
 * Built by tools.js with its helpers, so the approval and blocked-command
 * rules a watched command answers to are that file's, in one place.
 */

const liveMetrics = require('./live-metrics');

/** A moment as the assistant reads it: the clock time, which is what the chart shows. */
function clock(ms) {
    const at = new Date(ms);
    const pad = value => String(value).padStart(2, '0');
    return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** A watch as the assistant is told about it: the samples named by series rather than by position. */
function forAgent(view) {
    if (!view) return view;
    const { recent, startedAt, endedAt, endsAt, ...rest } = view;
    return {
        ...rest,
        startedAt: clock(startedAt),
        ...(endedAt ? { endedAt: clock(endedAt) } : {}),
        ...(endsAt ? { endsAt: clock(endsAt) } : {}),
        ...(recent ? {
            recent: recent.map(sample => ({
                at: clock(sample.t),
                ...Object.fromEntries(view.series.map((name, index) => [name, sample.v[index]])),
            })),
        } : {}),
    };
}

function build({ z, ok, fail, resolveSession, blocked }) {
    const api = ctx => (ctx?.metrics && typeof ctx.metrics.start === 'function' ? ctx.metrics : null);
    const UNAVAILABLE = 'Live charts are not available in this run: there is no conversation for the chart to appear in.';

    return [
        {
            name: 'watch_metric',
            title: 'Watch a metric live',
            readOnly: false,
            description:
                'Draw a live chart in the chat that keeps updating as a command produces numbers: ping times, load, '
                + 'requests per second, queue depth, anything a command prints. You give the command and a regular '
                + 'expression whose capture groups are the numbers; each match is a point on the chart. It keeps going '
                + 'after your turn ends, until its time is up, it has taken its samples, the command exits, its session '
                + 'closes, or the user or stop_metric stops it. A command that keeps printing (ping host, vmstat 1, '
                + 'tail -f log) is read line by line; for one that prints once and exits (cat /proc/loadavg, a curl '
                + 'timing) pass every: N to run it every N seconds. The result carries the first samples, or the lines '
                + 'that did not match, so check it: if nothing matched, stop it and start again with a better pattern. '
                + 'It runs out of sight on a channel of its own, never in the user\'s terminal. Use this, not a ```chart '
                + 'block, whenever the user wants to watch something as it happens.',
            shape: {
                command: z.string().min(1).describe('The command, exactly as it would be typed. For a stream, one that keeps printing: `ping 1.1.1.1` (on Windows `ping -t 1.1.1.1`), `vmstat 1`, `tail -f /var/log/nginx/access.log`.'),
                pattern: z.string().min(1).describe('A JavaScript regular expression matched against each line (or a poll\'s whole output). Each capture group is one series and must capture a number: `time[=<]([\\d.]+) ?ms` for ping. Named groups name their series: `(?<user>\\d+)\\s+(?<system>\\d+)`. No group means the whole match is the number. Make groups you do not want non-capturing: (?:...).'),
                series: z.array(z.string()).max(8).optional().describe('Names for the capture groups, in order, when they are not named groups.'),
                title: z.string().optional().describe('What the chart shows and where, e.g. "Ping to 1.1.1.1 from web1".'),
                unit: z.string().max(12).optional().describe('A suffix for the values: "ms", "%", "req/s", "MB".'),
                session: z.string().optional().describe('Session id of the server to run it on. Defaults to the session in front of the user.'),
                local: z.boolean().optional().describe('Run on the user\'s own computer instead of a server.'),
                cwd: z.string().optional().describe('With local: the folder to run in. Defaults to the home folder.'),
                every: z.number().min(1).max(3600).optional().describe('Run the command every N seconds and take one sample from each run. Leave out for a command that keeps printing.'),
                gap: z.string().optional().describe('A regular expression for a line that means a missed sample, drawn as a break in the line: `timed out|unreachable|100% packet loss` for ping.'),
                rate: z.boolean().optional().describe('The numbers are counters that only go up (bytes sent, requests served): chart the change per second instead.'),
                scale: z.number().optional().describe('Multiply every value by this: 0.001 for µs to ms, 0.000008 for bytes/s to Mbit/s.'),
                window: z.number().int().min(10).max(liveMetrics.MAX_WINDOW).optional().describe(`Points on the chart at once; older ones scroll off. Default ${liveMetrics.DEFAULT_WINDOW}.`),
                samples: z.number().int().min(1).max(liveMetrics.MAX_SAMPLES).optional().describe(`Stop after this many samples, as ping -c would. At most ${liveMetrics.MAX_SAMPLES}, which is also the default.`),
                durationMinutes: z.number().min(0.5).max(360).optional().describe('How long to keep watching before it stops by itself. Default 10, at most 360.'),
                limits: z.array(z.object({ value: z.number(), label: z.string().optional() })).max(4).optional().describe('Threshold lines across the chart, e.g. [{"value":100,"label":"SLO"}].'),
                min: z.number().optional().describe('Bottom of the value axis. Defaults to fitting the data.'),
                max: z.number().optional().describe('Top of the value axis. Defaults to fitting the data.'),
            },
            handler: async (input, ctx) => {
                const metrics = api(ctx);
                if (!metrics) return fail(UNAVAILABLE);

                // Checked here as well as at the approval gate, as for
                // run_command: every runtime reaches a command through this
                // handler, and one that forgot the gate would otherwise walk
                // past the list.
                const refused = blocked('watch_metric', input, ctx.settings);
                if (refused) return fail(refused);

                let target;
                if (input.local) {
                    if (ctx.settings?.allowLocalTools === false) {
                        return fail('Local tools are switched off in the assistant settings, so nothing can run on this computer. Watch it on a server session instead, or ask the user to switch them on.');
                    }
                    target = { local: true, cwd: input.cwd || '' };
                } else {
                    const resolved = resolveSession(input, ctx);
                    if (resolved.error) return fail(resolved.error);
                    if (!metrics.canExec(resolved.sessionId)) {
                        return fail('That session is not an SSH connection, so the command cannot run on a channel of its own. Use an SSH session, or local: true for this computer.');
                    }
                    target = {
                        sessionId: resolved.sessionId,
                        where: resolved.info.hostName || resolved.info.address || resolved.sessionId,
                    };
                }

                const started = await metrics.start({
                    command: input.command,
                    pattern: input.pattern,
                    series: input.series,
                    title: input.title,
                    unit: input.unit,
                    every: input.every,
                    gap: input.gap,
                    rate: input.rate,
                    scale: input.scale,
                    window: input.window,
                    samples: input.samples,
                    durationMs: input.durationMinutes ? input.durationMinutes * 60000 : undefined,
                    limits: input.limits,
                    min: input.min,
                    max: input.max,
                }, target);
                if (started.error) return fail(started.error);

                const view = forAgent(started.view);
                let note;
                if (view.status === 'running' && view.matched === 0) {
                    note = view.unmatched?.length
                        ? 'Running, but no line has matched the pattern yet. The lines it printed are under "unmatched": if the number is in them, stop this watch and start again with a pattern that catches it.'
                        : 'Running, but nothing has arrived yet. A slow command may simply not have printed; read_metric shows what has come in since.';
                } else if (view.status === 'running') {
                    note = 'The chart is live in the chat and keeps updating on its own. Use read_metric for the figures and stop_metric to end it.';
                } else {
                    note = `It has already ended: ${view.reason || view.status}`;
                }
                return ok({ ...view, note });
            },
        },

        {
            name: 'read_metric',
            title: 'Read a live metric',
            readOnly: true,
            description:
                'The figures behind a live chart started with watch_metric: its status, the last, min, average, max '
                + 'and p95 of each series, how many samples were missed, and the most recent samples. Without a '
                + 'watchId, lists the watches this conversation has.',
            shape: {
                watchId: z.string().optional().describe('The watch, from watch_metric. Omit to list them all.'),
                points: z.number().int().min(0).max(200).optional().describe('How many of the most recent samples to include. Default 20.'),
            },
            handler: async (input, ctx) => {
                const metrics = api(ctx);
                if (!metrics) return fail(UNAVAILABLE);
                if (!input.watchId) {
                    const all = metrics.list();
                    return ok(all.length ? { watches: all.map(forAgent) } : 'This conversation has no live charts running or recently ended.');
                }
                const view = metrics.read(input.watchId, { points: input.points ?? 20 });
                if (!view) return fail(`There is no watch "${input.watchId}". read_metric without a watchId lists them.`);
                return ok(forAgent(view));
            },
        },

        {
            name: 'stop_metric',
            title: 'Stop a live metric',
            // Ends a watch this conversation started, and nothing else: the
            // command it stops is one that was already approved to run.
            readOnly: true,
            description:
                'Stop a live chart started with watch_metric, and the command behind it. The chart stays in the chat '
                + 'with what it showed. Without a watchId, stops every one this conversation has running.',
            shape: {
                watchId: z.string().optional().describe('The watch to stop. Omit to stop all of this conversation\'s.'),
            },
            handler: async (input, ctx) => {
                const metrics = api(ctx);
                if (!metrics) return fail(UNAVAILABLE);
                if (input.watchId) {
                    const view = metrics.read(input.watchId, { points: 0 });
                    if (!view) return fail(`There is no watch "${input.watchId}".`);
                    if (!metrics.stop(input.watchId)) return ok({ ...forAgent(view), note: 'It had already ended.' });
                    return ok(forAgent(metrics.read(input.watchId, { points: 0 })));
                }
                const count = metrics.stopAll();
                return ok(count ? `Stopped ${count} watch${count === 1 ? '' : 'es'}.` : 'Nothing was running.');
            },
        },
    ];
}

module.exports = { build, forAgent, clock };
