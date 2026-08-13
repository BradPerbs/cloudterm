const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const spawn = require('cross-spawn');
const { app } = require('electron');

const mcpHost = require('../mcp-host');
const engine = require('./openai-compatible');

/**
 * The Grok provider.
 *
 * Two ways in, in this order.
 *
 * Grok Build is xAI's terminal agent, installed by the user and signed in to
 * their own account. When it is on the machine this drives it the way the Codex
 * provider drives Codex: one headless run per turn, `--output-format
 * streaming-json` on stdout, our own tools served over loopback by `mcp-host`
 * and reached by URL. The agent brings its own harness with it, which is the
 * point of driving an agent rather than a model.
 *
 * When it is not installed, an xAI API key is enough. `openai-compatible.js`
 * runs the loop instead and talks to api.x.ai, which speaks the same shape as
 * every other server that file was written for. It is the lesser of the two,
 * because the loop is ours rather than xAI's, but it is the difference between
 * a card that works and a card that says "install this first".
 *
 * Which of the two is in use is announced as an `account` event, so the panel
 * and the settings page can say so rather than leaving the user to infer it
 * from the shape of the answers.
 */

/** The name our tools are served under. As elsewhere: what they do, not whose. */
const SERVER_NAME = 'remote';

const API_URL = 'https://api.x.ai/v1';

const LABEL = 'xAI';

/** How long one headless run may take before it is given up on. */
const RUN_TIMEOUT = 15 * 60 * 1000;

/**
 * Grok Build's own tools, which act on this machine rather than on a server.
 *
 * Denied unless the app's local-tools switch is on, by the same reasoning the
 * Claude provider gives: this panel manages remote hosts, and a shell on the
 * user's own computer is a far larger surface than that needs.
 *
 * The names are the ones the CLI's own permission rules use (`Read`, `Grep`,
 * `Bash(git *)`), which are shared with the rest of this generation of agents.
 * If a release renames them the denylist stops matching, so it is not the only
 * thing standing between a model and this machine: the run happens in an empty
 * directory of ours, and everything that reaches a server goes through the
 * approval gate in `mcp-host` regardless of what the agent thinks it may do.
 */
const LOCAL_TOOLS = [
    'Bash', 'BashOutput', 'KillShell',
    'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
    'Glob', 'Grep',
    'WebFetch', 'WebSearch',
    'Task', 'TodoWrite',
];

/**
 * The levels Grok Build names, low to high.
 *
 * Its scale runs `none, minimal, low, medium, high, xhigh, max`, and the app's
 * runs `low` to `ultra`. The overlap is what can be passed through; `ultra` is
 * Codex's own top stop and is sent as `max`, which is what rounding down to the
 * nearest level this agent has means.
 */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function envValue(env, ...names) {
    for (const name of names) {
        if (env?.[name]) return env[name];
    }
    return '';
}

/**
 * Every folder a Grok Build install can leave its binary in.
 *
 * PATH first, because somebody who arranged their own PATH has already said
 * which copy they mean. Then the installer's locations, which is what a
 * packaged app actually needs: Electron inherits the PATH of whatever launched
 * it, and a desktop shortcut has a far shorter one than a shell does.
 */
function grokRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    const windows = platform === 'win32';
    const paths = windows ? path.win32 : path.posix;
    const roots = String(envValue(env, 'PATH', 'Path', 'path'))
        .split(windows ? ';' : ':')
        .filter(Boolean);

    // What the install script writes, on every platform it runs on.
    roots.push(paths.join(home, '.grok', 'bin'));

    if (windows) {
        const appData = envValue(env, 'APPDATA', 'AppData');
        const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData');
        const chocolatey = envValue(env, 'ChocolateyInstall', 'CHOCOLATEYINSTALL');
        const scoop = envValue(env, 'SCOOP', 'Scoop') || paths.join(home, 'scoop');

        roots.push(
            localAppData && paths.join(localAppData, 'Programs', 'grok'),
            localAppData && paths.join(localAppData, 'grok', 'bin'),
            appData && paths.join(appData, 'npm'),
            paths.join(scoop, 'shims'),
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
 * The `grok` on this machine, or '' if there is none.
 *
 * Shims are accepted here where the Codex provider refuses them, because this
 * spawns through `cross-spawn`, which starts a `.cmd` the way a shell would.
 * The npm package installs one, so refusing it would mean telling a user with
 * a working `grok` that they have not got one.
 */
function findGrok(options = {}) {
    const platform = options.platform || process.platform;
    const accessSync = options.accessSync || fs.accessSync;
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const names = platform === 'win32'
        ? ['grok.exe', 'grok.cmd', 'grok.bat']
        : ['grok'];

    for (const root of grokRoots({
        platform,
        env: options.env || process.env,
        home: options.home || os.homedir(),
    })) {
        for (const name of names) {
            const candidate = paths.join(root, name);
            try {
                accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                return candidate;
            } catch {
                // Keep looking.
            }
        }
    }
    return '';
}

/**
 * A directory of our own for the agent to run in.
 *
 * Not the user's project, and not their home. A terminal agent reads the
 * directory it is started in, and this one has no business in either: the work
 * is on the servers, reached through tools, and an empty folder is the honest
 * description of what it has local access to.
 */
function workspace() {
    const directory = path.join(app.getPath('userData'), 'grok-build');
    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch {
        // Already there, or a home directory that cannot be written to, in
        // which case the spawn below reports it properly.
    }
    return directory;
}

/**
 * Point the agent at our tools, in the directory it is about to run in.
 *
 * The address carries the token in its path rather than in a header, which is
 * what `mcp-host` grew a second way in for: a config file is the only channel
 * here, and an address is the one thing every MCP client can be given.
 *
 * Written in both spellings on purpose. Grok Build reads its own TOML, and
 * takes the `.mcp.json` that this generation of agents share; which of the two
 * a given release prefers is not worth pinning a provider's behaviour to, and
 * the one it ignores costs a few hundred bytes in a folder we own.
 */
function writeMcpConfig(directory, url) {
    const json = JSON.stringify({
        mcpServers: {
            [SERVER_NAME]: { type: 'http', url },
        },
    }, null, 2);

    const toml = `[mcp_servers.${SERVER_NAME}]\ntype = "http"\nurl = "${url}"\n`;

    fs.mkdirSync(path.join(directory, '.grok'), { recursive: true });
    fs.writeFileSync(path.join(directory, '.grok', 'config.toml'), toml, 'utf8');
    fs.writeFileSync(path.join(directory, '.mcp.json'), json, 'utf8');
}

/** `remote__run_command` or `mcp__remote__read_file` back to the bare name. */
function stripServer(name) {
    const text = String(name || '');
    const match = new RegExp(`^(?:mcp__)?${SERVER_NAME}(?:__|_|\\.)`).exec(text);
    return match ? text.slice(match[0].length) : text;
}

/** The first of these keys the event actually carries a string under. */
function firstString(event, ...keys) {
    for (const key of keys) {
        const value = event?.[key];
        if (typeof value === 'string' && value) return value;
        // ACP-shaped content: a list of blocks, of which the text ones matter.
        if (Array.isArray(value)) {
            const text = value
                .map(entry => entry?.text || entry?.content?.text || '')
                .filter(Boolean)
                .join('');
            if (text) return text;
        }
    }
    return '';
}

/**
 * One streaming-json line, as the transcript events the panel already draws.
 *
 * The event names are the documented ones: `text`, `thought`, `tool_call`,
 * `tool_call_update`, `usage`, `plan`, `available_commands`, `error` and
 * `end`, which is always last. The fields inside them are read leniently,
 * through `firstString` above, because the same event carries `text` in one
 * release and `content` in the next and a transcript that renders nothing is a
 * worse failure than one that renders a field it did not expect.
 */
function createTranslator(onEvent) {
    let text = '';
    let cost = 0;
    let usage = null;
    let sawError = false;
    const announced = new Set();

    /**
     * Any text so far, as a finished block.
     *
     * Called before a tool call rather than after it, because the panel treats
     * the finished block as authoritative and clears whatever streamed: a call
     * announced first would leave the text sitting underneath it.
     */
    const flush = () => {
        if (text.trim()) onEvent({ type: 'assistant-text', text });
        text = '';
    };

    return {
        get failed() {
            return sawError;
        },
        event(payload) {
            switch (payload?.type) {
                case 'text': {
                    const delta = firstString(payload, 'text', 'content', 'delta', 'message');
                    if (!delta) return;
                    text += delta;
                    onEvent({ type: 'text-delta', text: delta });
                    return;
                }

                case 'thought': {
                    const delta = firstString(payload, 'text', 'content', 'delta', 'thought');
                    if (delta) onEvent({ type: 'thinking-delta', text: delta });
                    return;
                }

                case 'tool_call':
                case 'tool_call_update': {
                    const id = firstString(payload, 'toolCallId', 'tool_call_id', 'id', 'callId')
                        || `tool-${announced.size}`;
                    const raw = firstString(payload, 'toolName', 'tool_name', 'tool', 'name', 'title');
                    const name = stripServer(raw);
                    const status = String(payload.status || '').toLowerCase();
                    const input = payload.rawInput || payload.raw_input || payload.input
                        || payload.arguments || {};

                    if (!announced.has(id)) {
                        announced.add(id);
                        flush();
                        onEvent({
                            type: 'tool-call',
                            id,
                            name: name || 'tool',
                            rawName: raw,
                            // Ours arrive prefixed with the server name. Anything
                            // else is one of the agent's own, acting on this
                            // machine, and the panel says so.
                            local: name === raw,
                            input,
                        });
                    }

                    if (['completed', 'failed', 'error', 'cancelled', 'canceled'].includes(status)) {
                        onEvent({
                            type: 'tool-result',
                            id,
                            text: firstString(payload, 'content', 'rawOutput', 'raw_output', 'output', 'result', 'error'),
                            isError: status !== 'completed',
                        });
                    }
                    return;
                }

                case 'usage':
                    usage = payload.usage || payload;
                    cost += Number(payload.costUsd ?? payload.cost_usd ?? payload.cost ?? 0) || 0;
                    return;

                case 'error':
                    sawError = true;
                    flush();
                    onEvent({
                        type: 'error',
                        message: describeFailure(
                            firstString(payload, 'message', 'error', 'text') || 'Grok Build reported an error'
                        ),
                    });
                    return;

                // A plan and the slash commands the session offers are about
                // the agent's own interface rather than about this
                // conversation, and the panel has nowhere to put either.
                default:
            }
        },
        finish(subtype = 'success') {
            flush();
            onEvent({
                type: 'result',
                subtype: sawError ? 'error' : subtype,
                isError: sawError || subtype !== 'success',
                costUsd: cost,
                usage,
            });
            cost = 0;
            usage = null;
            sawError = false;
        },
    };
}

/** The effort to pass on, or nothing when the app's level has no name here. */
function effortFor(current) {
    if (EFFORTS.has(current.effort)) return current.effort;
    // The one level above this agent's scale, rounded down rather than dropped.
    return current.effort === 'ultra' ? 'max' : '';
}

/** The arguments for one headless run. */
function runArguments({ current, sessionId, resume, directory, prompt }) {
    const args = [
        '-p', prompt,
        '--output-format', 'streaming-json',
        '--cwd', directory,
        // Our own gate is the one that asks. Grok Build putting a second
        // question on a channel with nobody reading it would stop every tool
        // call dead, which is exactly what happened to Codex before its
        // approval mode was set.
        '--always-approve',
        '--max-turns', String(current.maxTurns || 40),
        // A background update check in the middle of somebody's turn is a
        // download this app did not ask for and cannot report.
        '--no-auto-update',
        resume ? '--resume' : '--session-id', sessionId,
    ];

    if (current.model) args.push('--model', current.model);

    const effort = effortFor(current);
    if (effort) args.push('--effort', effort);

    if (!current.allowLocalTools) args.push('--disallowed-tools', LOCAL_TOOLS.join(','));

    return args;
}

/**
 * One turn: a process, its stdout read as it arrives, and an exit code.
 *
 * A run per turn rather than a long-lived process is the Codex arrangement,
 * and for the same reason: the CLI's headless mode answers one prompt and
 * ends. The session id is what carries the conversation, and Grok Build keeps
 * it in `~/.grok/sessions`, so this survives the app being closed in a way the
 * in-process providers cannot.
 */
function runTurn({ binary, args, directory, env, translator, onStart = () => {} }) {
    return new Promise((resolve) => {
        let child;
        let stderr = '';
        let buffer = '';
        let settled = false;

        const finish = (outcome) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(outcome);
        };

        const timer = setTimeout(() => {
            try { child?.kill(); } catch { /* already gone */ }
            finish({ ok: false, message: 'Grok Build did not finish that turn in time.' });
        }, RUN_TIMEOUT);

        try {
            child = spawn(binary, args, {
                cwd: directory,
                env,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            finish({ ok: false, message: describeFailure(error.message) });
            return;
        }

        onStart(child);

        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let index = buffer.indexOf('\n');
            while (index >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf('\n');
                if (!line) continue;
                try {
                    translator.event(JSON.parse(line));
                } catch {
                    // Not a JSON line. A banner, a warning, or a release that
                    // writes something else on this stream; none of it is worth
                    // ending a turn over.
                }
            }
        });

        // Kept rather than shown. It is where the CLI puts the reason it could
        // not start, which is the one thing worth repeating when a run fails
        // without ever having said anything on the wire.
        child.stderr.on('data', (chunk) => {
            stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
        });

        child.once('error', error => finish({ ok: false, message: describeFailure(error.message) }));
        child.once('close', (code) => {
            if (code === 0) {
                finish({ ok: true });
                return;
            }
            finish({
                ok: false,
                code,
                stderr,
                message: describeFailure(stderr.trim() || `Grok Build exited with code ${code}`),
            });
        });
    });
}

/**
 * Stop a run, taking the tree with it.
 *
 * On Windows the path found may be a `.cmd` shim, and killing the shim leaves
 * the agent it launched running under `cmd.exe`: a command still going on a
 * server after the user pressed stop, and a process that outlives the app.
 * This is the same whole-tree shutdown the OpenCode provider does, for the
 * same reason.
 */
function stopProcess(child, { platform = process.platform, spawnSyncFn = null } = {}) {
    if (!child || child.exitCode != null || child.signalCode != null) return;

    if (platform === 'win32' && child.pid) {
        const runner = spawnSyncFn || require('child_process').spawnSync;
        const result = runner('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        if (!result.error && result.status === 0) return;
    }
    try { child.kill(); } catch { /* already gone */ }
}

/** The API path, for a machine with a key and no CLI. */
async function apiSession(options) {
    options.onEvent({
        type: 'account',
        subscriptionType: '',
        apiProvider: 'xAI API',
        apiKeySource: 'CloudBlast',
    });

    return engine.start({
        ...options,
        label: LABEL,
        prefix: 'grok',
        endpoint: current => ({ baseUrl: API_URL, apiKey: current.apiKey || '', label: LABEL }),
        // xAI names its agent model, and it is the one this card is about.
        // Anything else the account can reach is in the menu once the key has
        // been read for the model list.
        model: current => current.model || 'grok-build-0.1',
    });
}

async function start(options) {
    const {
        settings,
        getSettings = () => settings,
        systemPrompt,
        toolContext,
        requestApproval,
        onEvent,
        resumeSessionId = '',
    } = options;

    const binary = findGrok();
    if (!binary) {
        if (settings.apiKey) return apiSession(options);
        throw new Error('Grok Build is not installed on this machine, and no xAI key is stored. '
            + 'Install the Grok Build CLI and sign in, or add a key from console.x.ai in the '
            + 'assistant settings.');
    }

    const directory = workspace();
    const { tokenUrl } = await mcpHost.acquire({ toolContext, requestApproval, onEvent });

    try {
        writeMcpConfig(directory, tokenUrl);
    } catch (error) {
        await mcpHost.release();
        throw new Error(`The Grok Build configuration could not be written: ${error.message}`);
    }

    // Only from our own store, and only when the user put one there. Left
    // alone otherwise so the CLI uses the login already on this machine.
    const environment = (current) => {
        const env = { ...process.env };
        if (current.apiKey) env.XAI_API_KEY = current.apiKey;
        return env;
    };

    // A session id we choose, so the conversation can be resumed by the same
    // id after the app has been closed and reopened. A UUID because that is
    // what the CLI's own sessions are named.
    const sessionId = resumeSessionId || crypto.randomUUID();
    let resume = Boolean(resumeSessionId);

    onEvent({ type: 'session', sessionId, model: settings.model || '' });

    // Only when there is something to say. A stored key means the turns are
    // metered rather than coming out of a plan, and that is worth reporting;
    // the ordinary case, where the CLI is signed in to an account this app
    // cannot see, is better left unsaid than guessed at.
    if (settings.apiKey) {
        onEvent({ type: 'account', subscriptionType: '', apiProvider: '', apiKeySource: 'CloudBlast' });
    }

    // The system prompt is not a flag on a headless run, so it leads the first
    // turn. Grok Build carries it forward with the rest of the session.
    let preamble = systemPrompt;
    let running = Promise.resolve();
    let closed = false;
    let stopped = false;
    let child = null;

    const hold = (started) => {
        child = started;
        // Stopped between the decision to spawn and the process existing.
        if (stopped) stopProcess(child);
    };

    async function turn(text) {
        const current = getSettings();
        const env = environment(current);
        const translator = createTranslator(onEvent);
        const prompt = preamble ? `${preamble}\n\n---\n\n${text}` : text;
        preamble = '';
        stopped = false;

        let outcome = await runTurn({
            binary,
            args: runArguments({ current, sessionId, resume, directory, prompt }),
            directory,
            env,
            translator,
            onStart: hold,
        });

        // A stored id that this machine no longer has a session for. The
        // conversation carries on as a new session under the same id rather
        // than failing, which is what the transcript in front of the user
        // already implies has happened.
        const missing = /session|not found|unknown|no such/i.test(outcome.stderr || outcome.message || '');
        if (!outcome.ok && !stopped && resume && missing) {
            resume = false;
            outcome = await runTurn({
                binary,
                args: runArguments({ current, sessionId, resume: false, directory, prompt }),
                directory,
                env,
                translator,
                onStart: hold,
            });
        }

        child = null;

        if (outcome.ok) {
            resume = true;
            translator.finish();
            return;
        }

        // A run the user stopped is not a run that failed. The session still
        // exists either way, so the next message resumes it rather than
        // starting again from nothing.
        if (stopped) {
            resume = true;
            return;
        }

        if (closed) return;
        if (!translator.failed) onEvent({ type: 'error', message: outcome.message });
        translator.finish('error');
    }

    return {
        send(text) {
            running = running.then(() => turn(text)).catch((error) => {
                if (!closed) onEvent({ type: 'error', message: describeFailure(error.message) });
            });
        },
        // Both are flags on the next run, so there is nothing to push at
        // anything that is already going.
        async setModel() {},
        async setEffort() {},
        async interrupt() {
            stopped = true;
            stopProcess(child);
        },
        async close() {
            closed = true;
            stopped = true;
            stopProcess(child);
            await running.catch(() => {});
            await mcpHost.release();
        },
    };
}

/**
 * What the account can run.
 *
 * Read from the API, which is the only one of the two paths that can be asked
 * without starting an agent, and only when there is a key to ask with. With no
 * key the answer is nothing at all rather than a list written here: the CLI is
 * signed in to an account whose entitlements this app cannot see, and the menu
 * already has a row that is true either way, which is to use whatever Grok
 * Build is set to.
 */
async function listModels({ settings: current = {} } = {}) {
    if (!current.apiKey) return null;

    const rows = await engine.listModels({
        baseUrl: API_URL,
        apiKey: current.apiKey,
        label: LABEL,
    });
    if (!rows?.length) return null;

    // The dial is offered only when the CLI is the thing that will run, since
    // that is the path with an effort flag. Against the API the request would
    // carry a reasoning field the model may not take, and a dial that turns a
    // working conversation into a 400 is worse than no dial.
    const effort = findGrok() ? [...EFFORTS] : [];
    return rows.map(row => ({ ...row, effort }));
}

/** A failure, in words that say what to do about it. */
function describeFailure(message) {
    const text = String(message || 'Unknown error');

    if (/not logged in|unauthor|401|sign ?in|log ?in|invalid.*api.?key/i.test(text)) {
        return 'Grok Build is not signed in on this machine. Run "grok" in a terminal and sign in, '
            + 'or add an xAI API key in the assistant settings.';
    }
    if (/ENOENT|not found|spawn/i.test(text)) {
        return 'The Grok Build CLI could not be started. Check that "grok" runs in a terminal, '
            + `then try again. (${text})`;
    }
    if (/unexpected argument|unknown (flag|option)|unrecognized/i.test(text)) {
        return 'This version of Grok Build did not understand how CloudBlast started it. '
            + `Update the CLI and try again. (${text})`;
    }
    if (/rate limit|429|quota/i.test(text)) {
        return 'xAI is rate limiting this account. Wait a moment, then try again.';
    }
    return text;
}

module.exports = {
    start,
    listModels,
    findGrok,
    grokRoots,
    createTranslator,
    runArguments,
    writeMcpConfig,
    stripServer,
    effortFor,
    describeFailure,
    LOCAL_TOOLS,
    SERVER_NAME,
    API_URL,
    _test: { runTurn, stopProcess, workspace },
};
