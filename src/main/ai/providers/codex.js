const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const mcpHost = require('../mcp-host');

/**
 * The Codex provider.
 *
 * Drives @openai/codex-sdk, which spawns the Codex CLI the same way the other
 * provider spawns Claude Code: the account, the plan and the login are the
 * user's own, already on this machine, and nothing of ours is stored for it.
 *
 * Two things are different enough from the Claude path to say out loud.
 *
 * The tools do not travel with the query. Codex reaches an MCP server by URL,
 * so `mcp-host` serves ours on loopback and this hands over the address and a
 * token. Same handlers, same approval card, same activity log.
 *
 * A turn is a call, not a stream you push into. `runStreamed` runs one turn to
 * completion and ends, where the Claude SDK keeps one iterator open for the
 * life of the conversation. So this holds the thread and starts a turn per
 * message, which is also why the model and the effort can be changed between
 * turns without anything being restarted.
 */

const SERVER_NAME = 'remote';

/** The levels the app can store, so nothing is offered that cannot be saved. */
const EFFORT_LEVELS = new Set(require('../settings').EFFORTS);

function envValue(env, ...names) {
    for (const name of names) {
        if (env?.[name]) return env[name];
    }
    return '';
}

/**
 * Where the Codex desktop app keeps its CLI.
 *
 * The folder under `bin` is content-addressed, so it changes with every update
 * and cannot be written down. The newest one wins, which is the same rule the
 * app itself follows.
 */
function codexAppRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData')
        || paths.join(home, 'AppData', 'Local');

    return [
        paths.join(localAppData, 'OpenAI', 'Codex', 'bin'),
        paths.join(home, '.codex', 'bin'),
        paths.join(home, 'Library', 'Application Support', 'OpenAI', 'Codex', 'bin'),
        paths.join(home, '.local', 'share', 'openai', 'codex', 'bin'),
    ];
}

/**
 * Every folder a standalone Codex CLI can land in.
 *
 * The desktop app is not the only way to get one. The official install script,
 * npm, Homebrew, Scoop and Chocolatey each put a `codex` somewhere else, and
 * until this existed a machine that installed it any of those ways was told
 * Codex was not on it at all.
 *
 * PATH leads, because someone who arranged their own PATH has already said
 * which copy they mean. The named folders are for the packaged app, whose PATH
 * is whatever the desktop session handed it and is often close to empty.
 */
function codexRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    const windows = platform === 'win32';
    const paths = windows ? path.win32 : path.posix;
    const roots = String(envValue(env, 'PATH', 'Path', 'path'))
        .split(windows ? ';' : ':')
        .filter(Boolean);

    // The app's own folders again, for a binary sitting directly in one rather
    // than in a hashed subfolder of it.
    roots.push(...codexAppRoots({ platform, env, home }));

    if (windows) {
        const appData = envValue(env, 'APPDATA', 'AppData');
        const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData');
        const chocolatey = envValue(env, 'ChocolateyInstall', 'CHOCOLATEYINSTALL');
        const scoop = envValue(env, 'SCOOP', 'Scoop') || paths.join(home, 'scoop');

        roots.push(
            appData && paths.join(appData, 'npm'),
            paths.join(scoop, 'shims'),
            localAppData && paths.join(localAppData, 'Programs', 'codex'),
            chocolatey && paths.join(chocolatey, 'bin')
        );
    } else {
        roots.push(
            paths.join(home, '.local', 'bin'),
            paths.join(home, 'bin'),
            paths.join(home, '.bun', 'bin'),
            paths.join(home, '.npm-global', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
            '/usr/bin'
        );
    }

    return [...new Set(roots.filter(Boolean))];
}

/**
 * The real executable behind an npm install on Windows.
 *
 * `npm i -g @openai/codex` leaves a `codex.cmd` shim, and a shim is not
 * something this can hand over: the SDK spawns the path with no shell, as does
 * `app-server` further down, and Node refuses to spawn a `.cmd` that way. The
 * binary the shim would have reached is in the platform package sitting beside
 * it, so this walks `node_modules/@openai/codex-*\/vendor/<triple>/bin` and
 * takes that. The triple is read rather than written down, since it differs by
 * architecture and by libc.
 */
function vendoredCodex(root, { readdirSync, statSync, paths, binary }) {
    const scope = paths.join(root, 'node_modules', '@openai');
    let packages = [];
    try {
        packages = readdirSync(scope, { withFileTypes: true });
    } catch {
        return '';
    }

    for (const entry of packages) {
        if (!entry.isDirectory() || !entry.name.startsWith('codex-')) continue;
        const vendor = paths.join(scope, entry.name, 'vendor');
        let triples = [];
        try {
            triples = readdirSync(vendor, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const triple of triples) {
            if (!triple.isDirectory()) continue;
            const candidate = paths.join(vendor, triple.name, 'bin', binary);
            try {
                statSync(candidate);
                return candidate;
            } catch {
                // Not this one.
            }
        }
    }
    return '';
}

/**
 * The Codex CLI, wherever this machine happens to keep it.
 *
 * The desktop app's copy is preferred when there is one: it updates itself, and
 * its sign-in is the one the desktop session is already using. Everything after
 * that is for the machines that never installed the app.
 */
function findCodex(options = {}) {
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const home = options.home || os.homedir();
    const readdirSync = options.readdirSync || fs.readdirSync;
    const statSync = options.statSync || fs.statSync;
    const accessSync = options.accessSync || fs.accessSync;
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const binary = platform === 'win32' ? 'codex.exe' : 'codex';

    const runnable = (candidate) => {
        try {
            accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    };

    let best = null;
    for (const root of codexAppRoots({ platform, env, home })) {
        let entries = [];
        try {
            entries = readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const candidate = paths.join(root, entry.name, binary);
            try {
                const stat = statSync(candidate);
                if (!best || stat.mtimeMs > best.at) best = { path: candidate, at: stat.mtimeMs };
            } catch {
                // Not this one.
            }
        }
    }
    if (best) return best.path;

    let shim = '';
    for (const root of codexRoots({ platform, env, home })) {
        const direct = paths.join(root, binary);
        if (runnable(direct)) return direct;

        if (platform === 'win32') {
            const vendored = vendoredCodex(root, { readdirSync, statSync, paths, binary });
            if (vendored) return vendored;

            // Last resort only, for the reason `vendoredCodex` gives. Better to
            // fail saying which file could not be started than to say Codex is
            // not here when it plainly is.
            if (!shim) {
                const cmd = paths.join(root, 'codex.cmd');
                if (runnable(cmd)) shim = cmd;
            }
        }
    }
    return shim;
}

let sdkPromise = null;
function loadSdk() {
    if (!sdkPromise) sdkPromise = import('@openai/codex-sdk');
    return sdkPromise;
}

/** The effort the app asked for, if it is one Codex has a name for. */
function effortFor(settings) {
    return EFFORT_LEVELS.has(settings.effort) ? settings.effort : undefined;
}

/**
 * Thread options, rebuilt per turn so a model or effort change lands on the
 * next answer rather than the next conversation.
 *
 * The sandbox follows the app's own switch: with local tools off, Codex's
 * built-in shell and file tools get a read-only view of this machine and no
 * network of their own. The servers are reached through our tools, which is
 * the point, and those are approved one at a time.
 */
function threadOptions(settings, mcp) {
    return {
        model: settings.model || undefined,
        modelReasoningEffort: effortFor(settings),
        workingDirectory: settings.workingDirectory || os.tmpdir(),
        skipGitRepoCheck: true,
        sandboxMode: settings.allowLocalTools ? 'workspace-write' : 'read-only',
        networkAccessEnabled: Boolean(settings.allowLocalTools),
        // Nothing is waved through on Codex's side. Everything that matters
        // here is a call into our own tools, and those stop at the approval
        // card before they touch a host.
        approvalPolicy: 'never',
        webSearchEnabled: false,
        mcp,
    };
}

async function start({
    settings,
    getSettings = () => settings,
    systemPrompt,
    toolContext,
    requestApproval,
    onEvent,
    resumeSessionId = '',
}) {
    const sdk = await loadSdk();

    const binary = findCodex();
    if (!binary) {
        throw new Error('The Codex CLI could not be found on this machine. Install the Codex app, '
            + 'or install the CLI and make sure its executable is on PATH.');
    }

    const { url, token } = await mcpHost.acquire({ toolContext, requestApproval, onEvent });

    const env = { ...process.env, CLOUDBLAST_MCP_TOKEN: token };
    if (settings.apiKey) env.OPENAI_API_KEY = settings.apiKey;

    const codex = new sdk.Codex({
        codexPathOverride: binary,
        env,
        config: {
            mcp_servers: {
                [SERVER_NAME]: {
                    url,
                    bearer_token_env_var: 'CLOUDBLAST_MCP_TOKEN',
                    // Codex asks its own caller before every MCP tool call,
                    // as an elicitation. Nothing can answer that here: the
                    // SDK exposes no hook for it, so it resolves itself with
                    // Cancel and the call is dropped before it is ever sent.
                    // Every remote tool failed as "the tool call was
                    // cancelled" until this was found.
                    //
                    // `approve` is not a loosening. It moves the question to
                    // where it belongs: the handler in `mcp-host` asks the
                    // user through the panel's own approval card, under this
                    // app's policy, before anything touches a server. Codex
                    // asking as well would be a second dialog for the same
                    // call, on a channel with nobody on the other end.
                    default_tools_approval_mode: 'approve',
                },
            },
        },
    });

    // The system prompt is not a thread option, so it leads the first turn.
    // Codex carries it forward with the rest of the thread from there.
    let preamble = systemPrompt;

    let thread = resumeSessionId
        ? codex.resumeThread(resumeSessionId, threadOptions(settings, undefined))
        : codex.startThread(threadOptions(settings, undefined));
    let announced = Boolean(resumeSessionId);
    let running = null;
    let abort = null;

    /** One turn, from the text going in to the transcript coming out. */
    async function turn(text) {
        const current = getSettings();
        abort = new AbortController();

        const body = preamble ? `${preamble}\n\n---\n\n${text}` : text;
        preamble = '';

        const { events } = await thread.runStreamed(body, { signal: abort.signal });

        for await (const event of events) {
            translate(event, onEvent);

            if (event.type === 'thread.started' && !announced) {
                announced = true;
                onEvent({ type: 'session', sessionId: thread.id || '', model: current.model || '' });
            }
        }
    }

    return {
        send(text) {
            running = (running || Promise.resolve())
                .then(() => turn(text))
                .catch((error) => {
                    if (!abort?.signal.aborted) onEvent({ type: 'error', message: describeFailure(error) });
                })
                .finally(() => {
                    abort = null;
                    onEvent({ type: 'result', costUsd: 0, subtype: 'success' });
                });
        },
        /**
         * Both of these take effect on the next turn rather than the current
         * one: they are properties of the thread, and Codex fixes them when a
         * turn starts. The thread itself is kept, so nothing is lost.
         */
        async setModel() {
            thread = codex.resumeThread(thread.id, threadOptions(getSettings(), undefined));
        },
        async setEffort() {
            thread = codex.resumeThread(thread.id, threadOptions(getSettings(), undefined));
        },
        async interrupt() {
            abort?.abort();
        },
        async close() {
            abort?.abort();
            await running?.catch(() => {});
            await mcpHost.release();
        },
    };
}

/** One Codex event, as the transcript events the panel already draws. */
function translate(event, onEvent) {
    switch (event.type) {
        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
            const item = event.item;
            if (!item) return;

            if (item.type === 'agent_message') {
                // Only once it is finished: Codex sends the whole text each
                // time it grows, where the panel appends what it is given.
                if (event.type === 'item.completed') {
                    onEvent({ type: 'assistant-text', text: item.text || '' });
                }
                return;
            }

            if (item.type === 'reasoning') {
                if (event.type === 'item.completed' && item.text) {
                    onEvent({ type: 'thinking-delta', text: item.text });
                }
                return;
            }

            if (item.type === 'mcp_tool_call') {
                onEvent({
                    type: event.type === 'item.completed' ? 'tool-result' : 'tool-call',
                    id: item.id,
                    name: String(item.tool || '').replace(/^remote__/, ''),
                    input: item.arguments || {},
                    text: typeof item.result === 'string' ? item.result : '',
                    isError: item.status === 'failed',
                    local: false,
                });
                return;
            }

            // Codex's own tools, which act on this machine rather than on a
            // server. Reported so the transcript is honest about them, marked
            // local so the panel says whose computer they touched.
            if (item.type === 'command_execution') {
                onEvent({
                    type: event.type === 'item.completed' ? 'tool-result' : 'tool-call',
                    id: item.id,
                    name: 'run_command',
                    input: { command: item.command || '' },
                    text: item.aggregated_output || '',
                    isError: item.status === 'failed',
                    local: true,
                });
                return;
            }

            if (item.type === 'error' && item.message) {
                onEvent({ type: 'error', message: item.message });
            }
            return;
        }

        case 'turn.failed':
            onEvent({ type: 'error', message: event.error?.message || 'The turn failed' });
            return;

        case 'error':
            onEvent({ type: 'error', message: event.message || 'Codex reported an error' });
            return;

        default:
    }
}

/** What went wrong, in words that say what to do about it. */
function describeFailure(error) {
    const message = error?.message || String(error);
    if (/not logged in|unauthor|401/i.test(message)) {
        return 'Codex is not signed in on this machine. Sign in with the Codex app, or run "codex login" '
            + 'in a terminal, then try again.';
    }
    // Windows refuses to spawn a .cmd without a shell, which is the shim an npm
    // install leaves behind when its platform package is missing alongside it.
    if (/EINVAL/i.test(message)) {
        return 'The Codex CLI on this machine is a script shim that cannot be started directly. '
            + 'Reinstall Codex, or put a real codex executable on PATH.';
    }
    if (/ENOENT|not found/i.test(message)) {
        return 'The Codex CLI could not be started. Check that Codex is installed and on PATH.';
    }
    return message;
}

/**
 * What this Codex can run, and how hard each of them will think.
 *
 * Not in the SDK, which takes `model` as a free string and says nothing about
 * what it accepts. It is in the app server: `codex app-server` speaks
 * line-delimited JSON-RPC on stdio, and `model/list` is the request the
 * desktop app's own picker is built on. So this brings one up, asks, and
 * shuts it down.
 *
 * Worth the spawn for what comes back, which is better than a list of names:
 * every model reports the reasoning efforts it actually supports, and they
 * differ (the 5.6 line has `ultra`, the 5.4 line stops at `xhigh`). That is
 * what lets the dial offer a model's real scale instead of a guess.
 */
async function listModels() {
    const binary = findCodex();
    if (!binary) return null;

    return new Promise((resolve) => {
        let child = null;
        let settled = false;

        const finish = (rows) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { child?.kill(); } catch { /* already gone */ }
            resolve(rows);
        };

        // It is a local process answering from a cache, not a network call.
        // If it has not spoken by now something is wrong with the install, and
        // the menus have a row that works without it.
        const timer = setTimeout(() => finish(null), 20000);

        try {
            child = spawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
        } catch {
            finish(null);
            return;
        }

        child.on('error', () => finish(null));
        child.on('exit', () => finish(null));

        const send = (payload) => {
            try { child.stdin.write(`${JSON.stringify(payload)}\n`); } catch { finish(null); }
        };

        let buffer = '';
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString('utf8');

            let index = buffer.indexOf('\n');
            while (index >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf('\n');
                if (!line) continue;

                let message;
                try { message = JSON.parse(line); } catch { continue; }

                if (message.id === 1) {
                    send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { includeHidden: false } });
                } else if (message.id === 2) {
                    finish(describeModels(message.result?.data));
                }
            }
        });

        send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { clientInfo: { name: 'cloudblast', title: 'CloudTerm', version: '1.0.0' } },
        });
    });
}

/** One `model/list` row, as the app's menus need it. */
function describeModels(rows) {
    if (!Array.isArray(rows)) return null;

    const models = rows
        .filter(row => row && typeof row.id === 'string' && row.id && !row.hidden)
        .map(row => ({
            value: row.id,
            resolved: row.model || row.id,
            label: row.displayName || row.id,
            short: row.displayName || row.id,
            description: String(row.description || '').slice(0, 200),
            // Codex names its own default, so the menu has something better to
            // show than a row saying "whatever Codex is set to": the model
            // that phrase actually refers to.
            preferred: Boolean(row.isDefault),
            effort: (row.supportedReasoningEfforts || [])
                .map(entry => entry?.reasoningEffort)
                .filter(level => EFFORT_LEVELS.has(level)),
        }))
        .slice(0, 24);

    return models.length ? models : null;
}

/** Whether the CLI is on this machine. See the note on claude-code's. */
function detect() {
    return { ok: Boolean(findCodex()), reason: 'notFound' };
}

module.exports = { start, listModels, detect, findCodex, codexAppRoots, codexRoots, SERVER_NAME };
