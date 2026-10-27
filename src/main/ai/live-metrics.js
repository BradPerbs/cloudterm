const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ssh = require('../ssh');
const exec = require('./exec');

/**
 * Live metrics: a command watched, numbers pulled out of what it prints, and
 * a chart in the conversation that follows them as they come.
 *
 * A ```chart block is a snapshot written once into a reply. This is the other
 * kind: the assistant names a command, a regular expression whose capture
 * groups are the numbers, and where to run it, and the chart keeps moving
 * after the turn that started it is over. The pattern is the assistant's on
 * purpose. Nothing here knows what ping, vmstat or a log line look like, so
 * anything that prints a number can be watched without this file learning
 * about it.
 *
 * Two ways to read a command:
 *
 *   stream   run once and read line by line, for a command that keeps
 *            printing (ping, vmstat 1, tail -f). Every line the pattern
 *            matches is a sample.
 *   poll     run every N seconds and read its whole output, for one that
 *            prints once and exits (cat /proc/loadavg, a curl timing). One
 *            sample per run.
 *
 * On a server it runs on its own exec channel, never the terminal the user is
 * typing in. A stream gets a pseudo-terminal there, which does two jobs: the
 * program writes a line at a time instead of holding output back in a pipe
 * buffer, and closing the channel hangs it up, so `ping` does not outlive the
 * chart. On this computer it runs in a shell of its own, out of sight, in the
 * folder asked for or the home folder.
 *
 * Every watch is bounded four ways: a time it stops by itself, a number of
 * samples, its session closing, and its conversation closing (or the app
 * quitting). Memory is bounded on top of that: a fixed number of samples is
 * kept however long it runs.
 *
 * The samples stay in this process. The window is sent them as they come, a
 * few times a second, on a channel of their own that is never written to the
 * conversation's log; the log gets one event when a watch starts and one when
 * it ends, carrying the last window of points, so a conversation read back
 * later still shows what was seen.
 */

/** How many watches may run at once, across the app. */
const MAX_WATCHES = 8;
/** Points on the chart: the rolling window. */
const DEFAULT_WINDOW = 120;
const MAX_WINDOW = 600;
/** Samples kept for read_metric and the percentiles, beyond the window. */
const KEEP = 1200;
/** Samples a watch takes before it stops by itself, whatever it was asked for. */
const MAX_SAMPLES = 20000;
/** How long a watch runs before it stops by itself. */
const DEFAULT_DURATION = 10 * 60 * 1000;
const MAX_DURATION = 6 * 60 * 60 * 1000;
const MIN_DURATION = 10 * 1000;
/** A poll's bounds, in seconds. */
const MIN_EVERY = 1;
const MAX_EVERY = 3600;
/** How often the window is sent what arrived. */
const PUSH_MS = 250;
/** How long starting a watch waits for its first sample before answering. */
const PROBE_MS = 5000;
/** A line longer than this is cut before the pattern sees it. */
const MAX_LINE = 4000;
/** What one local poll may print before the rest is dropped. */
const MAX_OUTPUT = 240000;
/** Series one chart can carry: the palette's length. */
const MAX_SERIES = 8;
/** Polls in a row that may fail before the watch gives up. */
const MAX_POLL_FAILURES = 5;
/** Unmatched lines kept, to show why nothing is being drawn. */
const UNMATCHED_KEPT = 5;
/** How long an ended watch is kept for a late read_metric. */
const KEPT_AFTER_END = 10 * 60 * 1000;

/**
 * Why a watch ended, by code. The code and its values go to the window, which
 * says it in the reader's language; the sentence is for the agent and for a
 * window that has no words of its own for the code. `error` is a message from
 * somewhere else (the server, the shell) and is shown as it came.
 */
const REASONS = {
    user: 'Stopped by the user.',
    agent: 'Stopped by the agent.',
    closed: 'The conversation was closed.',
    quit: 'Stopped when the app closed.',
    session: 'Its session closed.',
    time: 'Reached the end of its time.',
    samples: 'Reached its limit of {max} samples.',
    finished: 'The command finished.',
    exited: 'The command exited with {code}.',
    noMatch: 'The command ended without printing a line the pattern matched. It last printed: {output}',
    silent: 'The command ended without printing anything.',
    pollFailures: '{max} runs in a row failed. The last said: {error}',
    error: '{message}',
};

const watches = new Map();
let counter = 0;

/** `{name}` marks in a phrase, filled from `vars`. */
function fill(phrase, vars = {}) {
    return String(phrase).replace(/\{(\w+)\}/g, (whole, name) => (
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
    ));
}

/* ------------------------------------------------------------------ *
 * The pattern
 * ------------------------------------------------------------------ */

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** A line as the pattern sees it: no colour codes, no carriage returns, not endless. */
function cleanLine(line) {
    return String(line).replace(ANSI, '').replace(/\r/g, '').slice(0, MAX_LINE);
}

/** A number from what a group captured, or null. `1,284` and `1_284` read as 1284. */
function toNumber(raw) {
    if (raw === undefined || raw === null) return null;
    const value = Number.parseFloat(String(raw).replace(/[,_\s]/g, ''));
    return Number.isFinite(value) ? value : null;
}

/** Flags a pattern may carry. `g` and `y` keep state between lines, so they are left out. */
const FLAGS = new Set(['i', 'm', 's', 'u']);

/**
 * The agent's pattern, made ready: the regex, which of its groups are the
 * numbers, and what each series is called.
 *
 * Named groups name their series. Otherwise every numbered group is a series,
 * named from `series` when given. A pattern with no group at all is read as
 * one number, the whole match.
 *
 * `names` always has a name for every series, made up where none was given,
 * because that is what the agent reads its figures by. `labels` has '' where
 * one was made up, so the window can make up its own in the reader's language.
 */
function compile({ pattern, flags = '', series = [], gap = '', scale = 1, rate = false, title = '' } = {}) {
    const source = String(pattern ?? '');
    if (!source) return { error: 'A pattern is needed: a regular expression whose capture groups are the numbers.' };
    const flagText = [...new Set(String(flags || '').split(''))].filter(flag => FLAGS.has(flag)).join('');

    let regex;
    let probe;
    try {
        regex = new RegExp(source, flagText);
        // An empty alternative that always matches, so the shape of the
        // groups can be read without any output to read it from.
        probe = new RegExp(`(?:${source})|`, flagText).exec('');
    } catch (error) {
        return { error: `That pattern is not a valid regular expression: ${error.message}` };
    }

    const groupCount = probe.length - 1;
    const named = probe.groups ? Object.keys(probe.groups) : [];
    const given = Array.isArray(series) ? series.map(name => String(name ?? '').trim().slice(0, 60)) : [];

    let pick;
    let labels;
    if (named.length > 0) {
        pick = match => named.map(name => match.groups?.[name]);
        labels = named.map((name, index) => given[index] || name);
    } else if (groupCount === 0) {
        pick = match => [match[0]];
        labels = [given[0] || ''];
    } else {
        pick = match => Array.from({ length: groupCount }, (_, index) => match[index + 1]);
        labels = Array.from({ length: groupCount }, (_, index) => given[index] || '');
    }
    if (labels.length > MAX_SERIES) {
        return { error: `The pattern has ${labels.length} groups; a chart takes at most ${MAX_SERIES} series. Make the others non-capturing: (?:...).` };
    }
    const names = labels.map((label, index) => label || (labels.length === 1 ? (String(title || '').slice(0, 60) || 'Value') : `Value ${index + 1}`));

    let gapRegex = null;
    if (gap) {
        try {
            gapRegex = new RegExp(String(gap), flagText.includes('i') ? 'i' : '');
        } catch (error) {
            return { error: `The gap pattern is not a valid regular expression: ${error.message}` };
        }
    }

    const factor = Number(scale);
    return {
        regex,
        pick,
        names,
        labels,
        gap: gapRegex,
        scale: Number.isFinite(factor) && factor !== 0 ? factor : 1,
        rate: Boolean(rate),
    };
}

/**
 * The numbers in one piece of output, or what it was instead.
 *
 * `{ values }` for a match, `{ gap: true }` for a line the gap pattern
 * matched (ping's "Request timed out"), and null for anything else.
 */
function extract(compiled, text) {
    const match = compiled.regex.exec(text);
    if (match) {
        const values = compiled.pick(match).map((raw) => {
            const value = toNumber(raw);
            return value === null ? null : value * compiled.scale;
        });
        return { values };
    }
    if (compiled.gap && compiled.gap.test(text)) return { gap: true };
    return null;
}

/* ------------------------------------------------------------------ *
 * A watch's figures
 * ------------------------------------------------------------------ */

function emptyStats(count) {
    return Array.from({ length: count }, () => ({ count: 0, sum: 0, min: null, max: null, last: null }));
}

/** The p95 of what is kept, per series. Worked out on demand: it needs a sort. */
function percentile(samples, index, share) {
    const values = samples.map(sample => sample.v[index]).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) return null;
    return values[Math.min(values.length - 1, Math.floor(share * values.length))];
}

/** One series' figures, rounded for a reader. */
function seriesStats(watch, index) {
    const own = watch.stats[index];
    const round = value => (value === null ? null : Math.round(value * 1000) / 1000);
    return {
        name: watch.names[index],
        last: round(own.last),
        min: round(own.min),
        avg: own.count ? round(own.sum / own.count) : null,
        max: round(own.max),
        p95: round(percentile(watch.samples, index, 0.95)),
        count: own.count,
    };
}

/** What a watch is now, for the agent. */
function view(watch, { points = 0 } = {}) {
    const now = Date.now();
    return {
        watchId: watch.id,
        title: watch.title,
        status: watch.status,
        reason: watch.reason || undefined,
        where: watch.where,
        command: watch.command,
        mode: watch.mode,
        every: watch.mode === 'poll' ? watch.every : undefined,
        unit: watch.unit || undefined,
        series: watch.names,
        startedAt: watch.startedAt,
        endedAt: watch.endedAt || undefined,
        endsAt: watch.status === 'running' ? watch.endsAt : undefined,
        runningFor: Math.round(((watch.endedAt || now) - watch.startedAt) / 1000),
        samples: watch.sampleCount,
        sampleLimit: watch.maxSamples,
        matched: watch.matched,
        gaps: watch.gaps,
        linesRead: watch.lines,
        stats: watch.names.map((_, index) => seriesStats(watch, index)),
        ...(watch.matched === 0 && watch.unmatched.length
            ? { unmatched: watch.unmatched.slice() }
            : {}),
        ...(watch.lastError ? { lastError: watch.lastError } : {}),
        ...(watch.exitCode !== undefined ? { exitCode: watch.exitCode } : {}),
        ...(points > 0 ? { recent: watch.samples.slice(-points).map(sample => ({ t: sample.t, v: sample.v })) } : {}),
    };
}

/** The figures the chart's footer shows, sent with every batch. */
function liveStats(watch) {
    return {
        samples: watch.sampleCount,
        matched: watch.matched,
        gaps: watch.gaps,
        series: watch.stats.map(own => ({
            last: own.last,
            min: own.min,
            max: own.max,
            avg: own.count ? own.sum / own.count : null,
        })),
    };
}

/** How a watch ended, for the window: the code and its values, and the sentence. */
function endingOf(watch) {
    return { status: watch.status, reason: watch.reason, code: watch.reasonCode, vars: watch.reasonVars };
}

/* ------------------------------------------------------------------ *
 * Taking samples
 * ------------------------------------------------------------------ */

function remember(watch, sample) {
    // Numbered, so a window that read the points so far and then hears a
    // batch that overlaps them can tell which it already has.
    sample.n = watch.sampleCount + 1;
    watch.samples.push(sample);
    if (watch.samples.length > KEEP) watch.samples.splice(0, watch.samples.length - KEEP);
    watch.pending.push(sample);
    watch.sampleCount += 1;
    if (sample.v.every(value => value === null)) watch.gaps += 1;
    sample.v.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const own = watch.stats[index];
        own.count += 1;
        own.sum += value;
        own.last = value;
        own.min = own.min === null ? value : Math.min(own.min, value);
        own.max = own.max === null ? value : Math.max(own.max, value);
    });
    for (const waiter of watch.waiters.splice(0)) waiter();
    if (watch.sampleCount >= watch.maxSamples) end(watch, 'done', 'samples', { max: watch.maxSamples });
}

/**
 * One reading in. A rate turns two readings of a counter into the change
 * per second between them; the first reading only sets the baseline, and a
 * counter that went backwards (a restart) is a gap rather than a negative
 * rate nobody saw.
 */
function take(watch, found, at = Date.now()) {
    if (found.gap) {
        remember(watch, { t: at, v: watch.names.map(() => null) });
        return;
    }
    // The pattern caught something: from here on, the lines it skips are
    // the ordinary noise around the numbers, not a sign that it is wrong.
    watch.matched += 1;
    let values = found.values;
    if (watch.compiled.rate) {
        const before = watch.previous;
        watch.previous = { t: at, v: values };
        if (!before) return;
        const seconds = (at - before.t) / 1000;
        values = values.map((value, index) => {
            const prior = before.v[index];
            if (!Number.isFinite(value) || !Number.isFinite(prior) || seconds <= 0 || value < prior) return null;
            return (value - prior) / seconds;
        });
    }
    remember(watch, { t: at, v: values });
}

/** A line read from a stream. */
function line(watch, raw) {
    if (watch.status !== 'running') return;
    const text = cleanLine(raw);
    if (!text.trim()) return;
    watch.lines += 1;
    const found = extract(watch.compiled, text);
    if (found) {
        take(watch, found);
        return;
    }
    watch.unmatched.push(text.slice(0, 300));
    if (watch.unmatched.length > UNMATCHED_KEPT) watch.unmatched.shift();
}

/** A chunk of a stream, cut into lines; what follows the last break waits for the rest. */
function chunk(watch, data) {
    // What was already in the pipe when it was stopped still arrives. The
    // chart has ended; it is not added to.
    if (watch.status !== 'running') return;
    watch.partial += data.toString('utf8');
    const parts = watch.partial.split(/\r\n|\n|\r/);
    watch.partial = parts.pop() || '';
    if (watch.partial.length > MAX_LINE * 4) watch.partial = watch.partial.slice(-MAX_LINE);
    for (const part of parts) line(watch, part);
}

/** One poll's whole output: stdout first, then stderr, which is where some tools print. */
function pollOutput(watch, stdout, stderr) {
    const out = cleanLine(String(stdout || '').slice(-MAX_LINE * 4));
    const err = cleanLine(String(stderr || '').slice(-MAX_LINE * 4));
    watch.lines += 1;
    const found = extract(watch.compiled, String(stdout || '').replace(ANSI, '').replace(/\r/g, ''))
        || (stderr ? extract(watch.compiled, String(stderr).replace(ANSI, '').replace(/\r/g, '')) : null);
    if (found) {
        take(watch, found);
        return;
    }
    const shown = (out || err).trim().split('\n').slice(-3).join(' | ');
    if (shown) {
        watch.unmatched.push(shown.slice(0, 300));
        if (watch.unmatched.length > UNMATCHED_KEPT) watch.unmatched.shift();
    }
    // A poll that printed nothing usable is a missed sample: the chart shows
    // the hole, where a skipped tick would just look like a slower clock.
    remember(watch, { t: Date.now(), v: watch.names.map(() => null) });
}

/* ------------------------------------------------------------------ *
 * Running the command on this computer
 * ------------------------------------------------------------------ */

/**
 * The folder a local command runs in: the one asked for, or the home folder.
 * Checked before anything starts, so a typo is an answer rather than a shell
 * failing to start somewhere nobody meant.
 */
function localFolder(cwd) {
    const asked = String(cwd || '').trim();
    const folder = asked ? path.resolve(asked.replace(/^~(?=$|[\\/])/, os.homedir())) : os.homedir();
    try {
        if (fs.statSync(folder).isDirectory()) return { folder };
    } catch {
        // Falls through to the answer below.
    }
    return { error: `There is no folder at ${folder} on this computer.` };
}

let stdbufFound = null;
/** Whether `stdbuf` is here to make a piped program write a line at a time. */
function hasStdbuf() {
    if (stdbufFound !== null) return stdbufFound;
    if (process.platform === 'win32') return (stdbufFound = false);
    try {
        stdbufFound = spawnSync('stdbuf', ['--version'], { stdio: 'ignore', timeout: 3000 }).status === 0;
    } catch {
        stdbufFound = false;
    }
    return stdbufFound;
}

/**
 * The shell a local command runs in. On Windows the command is quoted whole
 * and passed as it is, the way Node's own `shell` option does it: cmd strips
 * the outer pair under /s and reads the rest untouched, where Node's quoting
 * would hand it every inner quote as \". Elsewhere the shell leads a process
 * group of its own, so stopping it stops what it started too.
 */
function localShell(command, { lineBuffered = false } = {}) {
    if (process.platform === 'win32') {
        return {
            file: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', `"${command}"`],
            options: { windowsHide: true, windowsVerbatimArguments: true },
        };
    }
    // A program writing into a pipe holds its output back in blocks; stdbuf
    // asks it to write a line at a time, where it is there.
    return lineBuffered && hasStdbuf()
        ? { file: 'stdbuf', args: ['-oL', '-eL', '/bin/sh', '-c', command], options: { detached: true } }
        : { file: '/bin/sh', args: ['-c', command], options: { detached: true } };
}

/**
 * Stop a local process and everything it started. On Windows that takes
 * taskkill, run without waiting for it: it takes a few hundred milliseconds,
 * and this is the main process, where waiting is a frozen window.
 */
function killTree(child) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    try {
        if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => {
                try { child.kill(); } catch { /* gone */ }
            });
        } else {
            try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        }
    } catch {
        // Already gone.
    }
}

/** One local run, for a poll: its output and exit code, or why it did not finish. */
function runLocal(command, { cwd, timeout }) {
    return new Promise((resolve) => {
        const shell = localShell(command);
        let child;
        try {
            child = spawn(shell.file, shell.args, { ...shell.options, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            resolve({ success: false, message: error.message });
            return;
        }
        let out = '';
        let err = '';
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => {
            killTree(child);
            settle({ success: false, message: `The command was still running after ${Math.round(timeout / 1000)}s and was stopped` });
        }, timeout);
        child.stdout.on('data', (data) => { if (out.length < MAX_OUTPUT) out += data.toString('utf8'); });
        child.stderr.on('data', (data) => { if (err.length < MAX_OUTPUT) err += data.toString('utf8'); });
        child.on('error', error => settle({ success: false, message: error.message }));
        child.on('close', code => settle({ success: true, exitCode: typeof code === 'number' ? code : null, stdout: out, stderr: err }));
    });
}

/** A stream on this computer. */
function streamLocal(watch, folder) {
    const shell = localShell(watch.command, { lineBuffered: true });
    let child;
    try {
        child = spawn(shell.file, shell.args, { ...shell.options, cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
        end(watch, 'failed', 'error', { message: error.message });
        return;
    }
    watch.halt = () => killTree(child);
    child.stdout.on('data', data => chunk(watch, data));
    child.stderr.on('data', data => chunk(watch, data));
    child.on('error', error => end(watch, 'failed', 'error', { message: error.message }));
    child.on('close', (code) => {
        if (typeof code === 'number') watch.exitCode = code;
        if (watch.partial) line(watch, watch.partial);
        watch.partial = '';
        finished(watch);
    });
}

/* ------------------------------------------------------------------ *
 * Running the command on a server
 * ------------------------------------------------------------------ */

/** A stream on a server: its own exec channel, with a pseudo-terminal. */
function streamRemote(watch, sessionId) {
    const session = ssh.sessions.get(sessionId);
    if (!session?.client) {
        end(watch, 'failed', 'error', { message: 'That session is not an SSH connection, so nothing can run on a channel of its own.' });
        return;
    }
    session.client.exec(watch.command, { pty: { term: 'dumb', cols: 400, rows: 50 } }, (error, channel) => {
        if (error) {
            end(watch, 'failed', 'error', { message: error.message });
            return;
        }
        if (watch.status !== 'running') {
            try { channel.close(); } catch { /* gone */ }
            return;
        }
        watch.halt = () => {
            // Interrupt first, as a person would with Ctrl+C; closing the
            // channel then hangs up whatever is left on the terminal.
            try { channel.signal('INT'); } catch { /* not every server takes signals */ }
            try { channel.close(); } catch { /* gone */ }
        };
        channel.on('data', data => chunk(watch, data));
        channel.stderr?.on('data', data => chunk(watch, data));
        channel.on('exit', (code) => {
            if (typeof code === 'number') watch.exitCode = code;
        });
        channel.on('close', () => {
            if (watch.partial) line(watch, watch.partial);
            watch.partial = '';
            finished(watch);
        });
        channel.on('error', channelError => end(watch, 'failed', 'error', { message: channelError.message }));
    });
}

/** A poll: run, read, wait out the rest of the interval, again. */
function poll(watch, run) {
    let failures = 0;
    let timer = null;
    const tick = async () => {
        if (watch.status !== 'running') return;
        const started = Date.now();
        const timeout = Math.max(5000, Math.min(watch.every * 1000, 60000));
        let result;
        try {
            result = await run(timeout);
        } catch (error) {
            result = { success: false, message: error.message };
        }
        if (watch.status !== 'running') return;
        if (result.success) {
            failures = 0;
            watch.lastError = '';
            if (typeof result.exitCode === 'number') watch.exitCode = result.exitCode;
            pollOutput(watch, result.stdout, result.stderr);
        } else {
            failures += 1;
            watch.lastError = String(result.message || 'The command failed').slice(0, 300);
            remember(watch, { t: Date.now(), v: watch.names.map(() => null) });
            if (watch.status === 'running' && failures >= MAX_POLL_FAILURES) {
                end(watch, 'failed', 'pollFailures', { max: MAX_POLL_FAILURES, error: watch.lastError });
                return;
            }
        }
        if (watch.status !== 'running') return;
        const wait = Math.max(200, watch.every * 1000 - (Date.now() - started));
        timer = setTimeout(tick, wait);
    };
    watch.halt = () => clearTimeout(timer);
    tick();
}

/* ------------------------------------------------------------------ *
 * A watch's life
 * ------------------------------------------------------------------ */

function flush(watch) {
    if (watch.pending.length === 0 && !watch.dirty) return;
    // Never more than the chart holds: a fast stream between two pushes would
    // otherwise send the window points it is about to drop off the front.
    const points = watch.pending.splice(0).slice(-watch.window);
    watch.dirty = false;
    watch.hooks.onSamples?.(watch, {
        points,
        stats: liveStats(watch),
        unmatched: watch.matched === 0 ? watch.unmatched.slice(-1)[0] || '' : '',
        lastError: watch.lastError || '',
    });
}

/** The command ended by itself: a `ping -c 30` that is done, or one that failed. */
function finished(watch) {
    if (watch.status !== 'running') return;
    if (watch.sampleCount === 0) {
        const said = watch.unmatched.slice(-2).join(' | ');
        if (said) end(watch, 'failed', 'noMatch', { output: said });
        else end(watch, 'failed', 'silent');
        return;
    }
    if (watch.exitCode) end(watch, 'done', 'exited', { code: watch.exitCode });
    else end(watch, 'done', 'finished');
}

/** Stop a watch, once, and tell everyone who is waiting on it. */
function end(watch, status, code, vars = {}) {
    if (watch.status !== 'running') return;
    watch.status = status;
    watch.reasonCode = REASONS[code] ? code : 'error';
    watch.reasonVars = vars;
    watch.reason = fill(REASONS[watch.reasonCode], vars).slice(0, 500);
    watch.endedAt = Date.now();
    clearTimeout(watch.deadline);
    clearInterval(watch.pusher);
    try { watch.halt?.(); } catch { /* gone */ }
    watch.dirty = true;
    flush(watch);
    for (const waiter of watch.waiters.splice(0)) waiter();
    watch.hooks.onEnd?.(watch, {
        ...endingOf(watch),
        points: watch.samples.slice(-watch.window),
        stats: liveStats(watch),
        summary: view(watch),
    });
    // Kept a while so a late read_metric still has the figures; the
    // conversation's log has the chart from here on.
    const forget = setTimeout(() => {
        if (watches.get(watch.id) === watch) watches.delete(watch.id);
    }, KEPT_AFTER_END);
    forget.unref?.();
}

/** A number from the spec, inside bounds, or the fallback when there is none. */
function bounded(raw, fallback, low, high) {
    const value = Number(raw);
    if (raw === undefined || raw === null || !Number.isFinite(value)) return fallback;
    return Math.max(low, Math.min(high, value));
}

/**
 * Start watching.
 *
 * `target` is `{ sessionId, where }` for a server or `{ local: true, cwd }`
 * for this computer. `hooks` are how the samples leave: `onStart(watch)`,
 * `onSamples(watch, batch)` and `onEnd(watch, final)`.
 *
 * Resolves once the first sample is in, the command has ended, or a few
 * seconds have passed, with the watch as it stands: the agent learns from
 * the answer to its own call whether the pattern caught anything.
 */
async function start(spec, target, hooks = {}) {
    const running = [...watches.values()].filter(watch => watch.status === 'running');
    if (running.length >= MAX_WATCHES) {
        return {
            error: `${MAX_WATCHES} watches are already running. Stop one with stop_metric first: `
                + running.map(watch => `${watch.id} (${watch.title})`).join(', '),
        };
    }

    const command = String(spec.command || '').trim();
    if (!command) return { error: 'A command is needed.' };
    const compiled = compile(spec);
    if (compiled.error) return { error: compiled.error };

    let folder = '';
    if (target.local) {
        const resolved = localFolder(target.cwd);
        if (resolved.error) return { error: resolved.error };
        folder = resolved.folder;
    } else if (!canExec(target.sessionId)) {
        return { error: 'That session is not an SSH connection, so the command cannot run on a channel of its own.' };
    }

    const every = spec.every === undefined || spec.every === null || Number(spec.every) === 0
        ? 0
        : bounded(spec.every, MIN_EVERY, MIN_EVERY, MAX_EVERY);
    const duration = bounded(spec.durationMs, DEFAULT_DURATION, MIN_DURATION, MAX_DURATION);
    const now = Date.now();

    counter += 1;
    const watch = {
        id: `watch-${now.toString(36)}-${counter}`,
        conversationId: spec.conversationId || '',
        sessionId: target.local ? '' : target.sessionId,
        local: Boolean(target.local),
        title: String(spec.title || command).slice(0, 120),
        unit: String(spec.unit || '').slice(0, 12),
        command,
        where: target.local ? 'this computer' : (target.where || target.sessionId || ''),
        mode: every ? 'poll' : 'stream',
        every,
        window: Math.round(bounded(spec.window, DEFAULT_WINDOW, 10, MAX_WINDOW)),
        maxSamples: Math.round(bounded(spec.samples, MAX_SAMPLES, 1, MAX_SAMPLES)),
        names: compiled.names,
        labels: compiled.labels,
        compiled,
        // How the chart is drawn, which the window needs and the watch does not.
        chart: {
            limits: Array.isArray(spec.limits)
                ? spec.limits.filter(entry => Number.isFinite(Number(entry?.value))).slice(0, 4)
                    .map(entry => ({ value: Number(entry.value), label: String(entry.label || '').slice(0, 40) }))
                : [],
            ...(spec.min !== null && spec.min !== undefined && Number.isFinite(Number(spec.min)) ? { min: Number(spec.min) } : {}),
            ...(spec.max !== null && spec.max !== undefined && Number.isFinite(Number(spec.max)) ? { max: Number(spec.max) } : {}),
        },
        status: 'running',
        reason: '',
        reasonCode: '',
        reasonVars: {},
        startedAt: now,
        endsAt: now + duration,
        endedAt: 0,
        samples: [],
        pending: [],
        stats: emptyStats(compiled.names.length),
        sampleCount: 0,
        matched: 0,
        gaps: 0,
        lines: 0,
        unmatched: [],
        partial: '',
        previous: null,
        lastError: '',
        exitCode: undefined,
        waiters: [],
        dirty: false,
        hooks,
        halt: null,
    };
    watches.set(watch.id, watch);

    hooks.onStart?.(watch);
    watch.deadline = setTimeout(() => end(watch, 'done', 'time'), duration);
    watch.pusher = setInterval(() => flush(watch), PUSH_MS);

    if (watch.mode === 'poll') {
        poll(watch, target.local
            ? timeout => runLocal(command, { cwd: folder, timeout })
            : timeout => exec.run(target.sessionId, command, { timeout }));
    } else if (target.local) {
        streamLocal(watch, folder);
    } else {
        streamRemote(watch, target.sessionId);
    }

    // The first answer: wait for a sample (two readings for a rate, which
    // needs a baseline first), the end, or the probe's time, whichever is
    // sooner.
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, spec.probeMs ?? PROBE_MS);
        const check = () => {
            if (watch.sampleCount > 0 || watch.status !== 'running') {
                clearTimeout(timer);
                resolve();
                return;
            }
            watch.waiters.push(check);
        };
        check();
    });
    return { watch, view: view(watch, { points: 5 }) };
}

/** Stop one watch. Answers whether there was one running to stop. */
function stop(watchId, code = 'agent') {
    const watch = watches.get(watchId);
    if (!watch || watch.status !== 'running') return false;
    end(watch, 'stopped', code);
    return true;
}

/** Stop every watch, or every one a conversation started. */
function stopAll({ conversationId = '', code = 'agent' } = {}) {
    let count = 0;
    for (const watch of [...watches.values()]) {
        if (conversationId && watch.conversationId !== conversationId) continue;
        if (stop(watch.id, code)) count += 1;
    }
    return count;
}

/**
 * Stop the watches on one session, because it closed. Its channels go with
 * it anyway; this says why, rather than leaving a stream to report that its
 * command "finished".
 */
function stopSession(sessionId) {
    let count = 0;
    for (const watch of [...watches.values()]) {
        if (!watch.local && watch.sessionId === sessionId && stop(watch.id, 'session')) count += 1;
    }
    return count;
}

/** A watch as the agent reads it, with its last `points` samples. */
function read(watchId, { points = 20 } = {}) {
    const watch = watches.get(watchId);
    return watch ? view(watch, { points: Math.max(0, Math.min(200, points)) }) : null;
}

/** The watches one conversation has, newest first. */
function list(conversationId = '') {
    return [...watches.values()]
        .filter(watch => !conversationId || watch.conversationId === conversationId)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(watch => view(watch));
}

/** What a window needs to pick up a chart it was not watching: the window of points so far. */
function snapshot(watchId) {
    const watch = watches.get(String(watchId || ''));
    if (!watch) return { found: false };
    return {
        found: true,
        ...endingOf(watch),
        window: watch.window,
        points: watch.samples.slice(-watch.window),
        stats: liveStats(watch),
        unmatched: watch.matched === 0 ? watch.unmatched.slice(-1)[0] || '' : '',
        lastError: watch.lastError || '',
        endsAt: watch.endsAt,
    };
}

/** The conversation a watch belongs to, or '' for none. */
function ownerOf(watchId) {
    return watches.get(watchId)?.conversationId || '';
}

/** Whether a session can run a command on a channel of its own: an SSH one can. */
function canExec(sessionId) {
    return Boolean(sessionId && ssh.sessions.get(sessionId)?.client);
}

/** What the window draws the chart from, given once when the watch starts. */
function specOf(watch) {
    return {
        title: watch.title,
        unit: watch.unit,
        series: watch.labels,
        where: watch.where,
        local: watch.local,
        command: watch.command,
        mode: watch.mode,
        every: watch.every || 0,
        window: watch.window,
        startedAt: watch.startedAt,
        endsAt: watch.endsAt,
        ...watch.chart,
    };
}

/**
 * Live charts, for one conversation: what its tools reach through
 * `ctx.metrics`.
 *
 * A watch's start and end are events in the conversation's log, so the chart
 * is in the transcript where the call made it and is still there when the
 * conversation is read back. The samples in between are not: they go to the
 * windows on `ai-metric`, a few times a second, and a window that opens the
 * conversation mid-watch asks for the points so far (`snapshot`). The end
 * event carries the last window of points, which is what a conversation read
 * back later draws.
 *
 * `owner` looks the conversation up rather than holding it, so a watch that
 * outlives its conversation writes nowhere. `emit` records an event in a
 * conversation's log and `notify` pushes to the windows, both index.js's own.
 */
function forConversation({ conversationId, owner, emit, notify }) {
    const owned = watchId => ownerOf(watchId) === conversationId;
    const hooks = {
        onStart: (watch) => {
            const conversation = owner();
            if (conversation) emit(conversation, { type: 'metric-started', watchId: watch.id, spec: specOf(watch) });
        },
        onSamples: (watch, batch) => notify('ai-metric', { conversationId, watchId: watch.id, ...batch }),
        onEnd: (watch, final) => {
            notify('ai-metric', {
                conversationId,
                watchId: watch.id,
                points: [],
                stats: final.stats,
                ended: endingOf(watch),
            });
            const conversation = owner();
            if (!conversation) return;
            emit(conversation, {
                type: 'metric-ended',
                watchId: watch.id,
                status: final.status,
                reason: final.reason,
                code: final.code,
                vars: final.vars,
                points: final.points,
                stats: final.stats,
            });
        },
    };
    return {
        canExec,
        start: (spec, target) => start({ ...spec, conversationId }, target, hooks),
        stop: watchId => owned(watchId) && stop(watchId, 'agent'),
        stopAll: () => stopAll({ conversationId, code: 'agent' }),
        read: (watchId, options) => (owned(watchId) ? read(watchId, options) : null),
        list: () => list(conversationId),
    };
}

// A session that closes takes its watches with it, said as that.
ssh.onDestroy(stopSession);

module.exports = {
    start,
    stop,
    stopAll,
    stopSession,
    read,
    list,
    snapshot,
    ownerOf,
    canExec,
    forConversation,
    compile,
    extract,
    cleanLine,
    REASONS,
    MAX_WATCHES,
    MAX_WINDOW,
    DEFAULT_WINDOW,
    MAX_SAMPLES,
    MAX_DURATION,
    DEFAULT_DURATION,
};
