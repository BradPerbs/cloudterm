const fs = require('fs');
const os = require('os');
const path = require('path');
const spawn = require('cross-spawn');
const { app } = require('electron');

const mcpHost = require('../mcp-host');
const engine = require('./openai-compatible');

/**
 * The Kimi Code provider.
 *
 * Two ways in, in this order, which is the arrangement the Grok provider
 * already uses.
 *
 * Kimi Code CLI is Moonshot's terminal agent. When it is on the machine this
 * drives it one headless run per turn: `kimi -p <prompt> --output-format
 * stream-json`, our own tools served over loopback by `mcp-host` and reached by
 * URL. The agent brings its own harness with it, which is the point of driving
 * an agent rather than a model.
 *
 * When it is not installed, a Moonshot key is enough. `openai-compatible.js`
 * runs the loop instead and talks to api.moonshot.ai, which speaks the same
 * shape as every other server that file was written for.
 *
 * Unlike the other agent cards, both of those paths need a key, and that is
 * worth explaining rather than leaving as a surprise. Kimi Code CLI takes all
 * of its configuration from one user-level directory, `KIMI_CODE_HOME`. There
 * is no flag for an MCP server, no flag for a tool denylist, and no
 * project-level config file: the CLI reads a project's `.kimi-code/mcp.json`
 * only once that folder has been trusted, and trusting one is a keypress in the
 * TUI that a headless run never gets to make. So the only way to hand this
 * agent our tools without editing the user's own `~/.kimi-code` is to point
 * `KIMI_CODE_HOME` at a directory of ours, and a directory of ours does not
 * have their login in it. `KIMI_MODEL_*` is how the key gets in, that being the
 * one channel Kimi Code documents as reading the environment rather than a
 * file, so nothing here writes a credential to disk.
 *
 * What the CLI still buys over the API path is its own agent loop: its context
 * compaction, its skills, its subagents. That is the same reason the other
 * agent cards exist.
 */

/** The name our tools are served under. As elsewhere: what they do, not whose. */
const SERVER_NAME = 'remote';

const API_URL = 'https://api.moonshot.ai/v1';

const LABEL = 'Moonshot';

/** How long one headless run may take before it is given up on. */
const RUN_TIMEOUT = 15 * 60 * 1000;

/**
 * Kimi Code's own tools, which act on this machine rather than on a server.
 *
 * Denied unless the app's local-tools switch is on, by the same reasoning the
 * Claude provider gives: this panel manages remote hosts, and a shell on the
 * user's own computer is a far larger surface than that needs.
 *
 * These are the names from Kimi Code's own tool reference, and they go into
 * `[[permission.rules]]` rather than onto the command line, because this CLI
 * has no denylist flag. A deny rule is the right instrument anyway: print mode
 * runs under the `auto` policy, where nothing is asked and only the static deny
 * rules still bite.
 *
 * If a release renames one the rule stops matching, so it is not the only thing
 * standing between a model and this machine: the run happens in an empty
 * directory of ours, and everything that reaches a server goes through the
 * approval gate in `mcp-host` regardless of what the agent thinks it may do.
 */
const LOCAL_TOOLS = [
    'Bash',
    'Read', 'Write', 'Edit', 'ReadMediaFile',
    'Glob', 'Grep',
    'WebSearch', 'FetchURL',
    'Agent', 'AgentSwarm', 'TodoList',
    'TaskList', 'TaskOutput', 'TaskStop',
    'CronCreate', 'CronList', 'CronDelete',
];

/**
 * Denied whatever the local-tools switch says.
 *
 * A question put to a channel with nobody reading it stops the turn dead, which
 * is exactly what happened to Codex before its approval mode was set. Our own
 * gate is the one that asks.
 */
const ALWAYS_DENIED = ['AskUserQuestion'];

/**
 * The levels Kimi Code names, low to high.
 *
 * Its `KIMI_MODEL_THINKING_EFFORT` takes `low, medium, high, xhigh, max` and
 * the app's scale runs `low` to `ultra`. The overlap is what can be passed
 * through; `ultra` is Codex's own top stop and is sent as `max`, which is what
 * rounding down to the nearest level this agent has means.
 */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function envValue(env, ...names) {
    for (const name of names) {
        if (env?.[name]) return env[name];
    }
    return '';
}

/** A directory's entries, or none, for a directory that may not be there. */
function readdir(readdirSync, directory) {
    try {
        return readdirSync(directory);
    } catch {
        return [];
    }
}

/** `1.2.10` above `1.2.9`, by number rather than by string. */
function compareVersions(left, right) {
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const difference = (left[i] || 0) - (right[i] || 0);
        if (difference) return difference;
    }
    return 0;
}

/**
 * Any copy an editor extension carries, newest first.
 *
 * The same sweep the Claude provider does, over the same four editors, because
 * a machine whose only agent came from the marketplace is a machine this app
 * would otherwise tell there is nothing installed.
 *
 * Worth knowing what this finds today: the current extension does not carry a
 * binary at all. Until 0.6.0 it drove a separately installed CLI over stdio,
 * and since then it runs the engine in-process through the Node SDK, so a
 * present-day install has nothing here to hand back. It is still swept because
 * the layout has already changed twice, the cost is one `readdir` per editor
 * against a directory that usually does not exist, and the alternative is
 * finding out from a bug report.
 */
function extensionRoots({ readdirSync, paths, home }) {
    const editors = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf'];
    const found = [];

    for (const editor of editors) {
        const directory = paths.join(home, editor, 'extensions');
        for (const entry of readdir(readdirSync, directory)) {
            // The platform and architecture follow the version in the name, and
            // are not matched on: an editor only installs the build for the
            // machine it is on, and guessing at that suffix would fail closed.
            const named = /^moonshot-ai\.kimi-code-(\d+(?:\.\d+)*)(?:-|$)/.exec(entry);
            if (!named) continue;

            const base = paths.join(directory, entry);
            const targets = paths.join(base, 'resources', 'native-binaries');
            const roots = readdir(readdirSync, targets)
                .map(target => paths.join(targets, target));

            // Every layout the packaging has used or plausibly would, left for
            // the existence check to decide between rather than guessed at.
            roots.push(
                paths.join(base, 'resources', 'native-binary'),
                paths.join(base, 'resources', 'bin'),
                paths.join(base, 'bin'),
                paths.join(base, 'dist', 'bin')
            );

            found.push({ version: named[1].split('.').map(Number), roots });
        }
    }

    return found
        .sort((a, b) => compareVersions(b.version, a.version))
        .flatMap(entry => entry.roots);
}

/**
 * Every folder a Kimi Code install can leave its binary in, best first.
 *
 * PATH leads, because somebody who arranged their own PATH has already said
 * which copy they mean, and the native installer prepends its own directory to
 * it. Everything after that is what a packaged app actually needs: Electron
 * inherits the PATH of whatever launched it, and a desktop shortcut has a far
 * shorter one than a shell does, so the binary a terminal finds instantly is
 * routinely invisible here.
 *
 * There are more ways to install this one than the other agents have, and all
 * of them land under the same name. The native script writes to
 * `$KIMI_INSTALL_DIR/bin` and defaults to `~/.kimi-code/bin`. The npm package
 * goes wherever the package manager puts a global binary, which is a different
 * folder for npm, pnpm, bun, yarn and volta. And the Python `kimi-cli` this
 * product grew out of is still on plenty of machines under the same command,
 * installed by uv or pipx into `~/.local/bin`, which on Windows is a real path
 * too and not only a Unix one.
 */
function kimiRoots({
    platform = process.platform,
    env = process.env,
    home = os.homedir(),
    readdirSync = fs.readdirSync,
} = {}) {
    const windows = platform === 'win32';
    // Both halves named outright rather than leaning on the host's `path`,
    // which is the same thing in production and is not under test: the platform
    // is an argument here, so the separators have to follow it rather than the
    // machine running the check.
    const paths = windows ? path.win32 : path.posix;
    const roots = String(envValue(env, 'PATH', 'Path', 'path'))
        .split(windows ? ';' : ':')
        .filter(Boolean);

    // The native installer, at whichever directory it was pointed at.
    const installed = envValue(env, 'KIMI_INSTALL_DIR');
    if (installed) roots.push(paths.join(installed, 'bin'));
    roots.push(paths.join(home, '.kimi-code', 'bin'));

    // uv and pipx, which is where the Python CLI still lands. On both
    // platforms: this is not a Unix-only path.
    roots.push(paths.join(home, '.local', 'bin'));

    // The package managers, each of which has its own answer and its own
    // variable for overriding it.
    const prefix = envValue(env, 'npm_config_prefix', 'NPM_CONFIG_PREFIX');
    const pnpm = envValue(env, 'PNPM_HOME');
    const bun = envValue(env, 'BUN_INSTALL') || paths.join(home, '.bun');
    const volta = envValue(env, 'VOLTA_HOME') || paths.join(home, '.volta');

    if (pnpm) roots.push(pnpm);
    roots.push(paths.join(bun, 'bin'), paths.join(volta, 'bin'));

    if (windows) {
        const appData = envValue(env, 'APPDATA', 'AppData');
        const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData');
        const chocolatey = envValue(env, 'ChocolateyInstall', 'CHOCOLATEYINSTALL');
        const scoop = envValue(env, 'SCOOP', 'Scoop') || paths.join(home, 'scoop');
        const programFiles = envValue(env, 'ProgramFiles', 'PROGRAMFILES');
        const programFilesX86 = envValue(env, 'ProgramFiles(x86)', 'PROGRAMFILES(X86)');

        roots.push(
            prefix,
            appData && paths.join(appData, 'npm'),
            localAppData && paths.join(localAppData, 'Programs', 'kimi-code'),
            localAppData && paths.join(localAppData, 'Programs', 'kimi-code', 'bin'),
            localAppData && paths.join(localAppData, 'kimi-code', 'bin'),
            paths.join(scoop, 'shims'),
            chocolatey && paths.join(chocolatey, 'bin'),
            programFiles && paths.join(programFiles, 'kimi-code', 'bin'),
            programFilesX86 && paths.join(programFilesX86, 'kimi-code', 'bin')
        );
    } else {
        const brew = envValue(env, 'HOMEBREW_PREFIX');

        roots.push(
            prefix && paths.join(prefix, 'bin'),
            paths.join(home, 'bin'),
            paths.join(home, '.npm-global', 'bin'),
            paths.join(home, '.yarn', 'bin'),
            paths.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin'),
            brew && paths.join(brew, 'bin'),
            '/opt/homebrew/bin',
            '/home/linuxbrew/.linuxbrew/bin',
            '/usr/local/bin',
            '/usr/bin',
            // What `sudo env KIMI_INSTALL_DIR=/opt/kimi-code` leaves behind, and
            // the shape a package maintainer would reach for.
            '/opt/kimi-code/bin'
        );
    }

    // Last, because an editor's copy is a side effect of installing something
    // else, and anything above is a Kimi Code the user went and installed.
    roots.push(...extensionRoots({ readdirSync, paths, home }));

    return [...new Set(roots.filter(Boolean))];
}

/**
 * The `kimi` on this machine, or '' if there is none.
 *
 * Shims are accepted where the Claude provider refuses them, because this
 * spawns through `cross-spawn`, which starts a `.cmd` the way a shell would.
 * The npm package installs one, so refusing it would mean telling a user with a
 * working `kimi` that they have not got one.
 */
function findKimi(options = {}) {
    const platform = options.platform || process.platform;
    const accessSync = options.accessSync || fs.accessSync;
    const statSync = options.statSync || fs.statSync;
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const names = platform === 'win32'
        ? ['kimi.exe', 'kimi.cmd', 'kimi.bat', 'kimi']
        : ['kimi'];

    for (const root of kimiRoots({
        platform,
        env: options.env || process.env,
        home: options.home || os.homedir(),
        readdirSync: options.readdirSync || fs.readdirSync,
    })) {
        for (const name of names) {
            const candidate = paths.join(root, name);
            try {
                accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                // An update that died part way through leaves a real file of
                // zero bytes behind, which passes every existence check and then
                // will not start. This one updates itself by default, so that is
                // not a hypothetical, and the symptom without this check is an
                // assistant that cannot say why it will not run.
                if (statSync(candidate).size > 0) return candidate;
            } catch {
                // Keep looking.
            }
        }
    }
    return '';
}

/**
 * The two directories this provider owns.
 *
 * `home` is what `KIMI_CODE_HOME` is set to for every run: the config, the MCP
 * declaration and the sessions all land there rather than in the user's own
 * `~/.kimi-code`, which is left exactly as they set it up.
 *
 * `workspace` is where the agent is started. Not the user's project, and not
 * their home. A terminal agent reads the directory it is started in, and this
 * one has no business in either: the work is on the servers, reached through
 * tools, and an empty folder is the honest description of what it has local
 * access to. It sits beside the data directory rather than inside it, so a
 * session's own files and the folder the agent can see are never the same tree.
 */
function directories() {
    const root = app.getPath('userData');
    const home = path.join(root, 'kimi-code');
    const workspace = path.join(root, 'kimi-code-workspace');

    for (const directory of [home, workspace]) {
        try {
            fs.mkdirSync(directory, { recursive: true });
        } catch {
            // Already there, or a home directory that cannot be written to, in
            // which case the spawn below reports it properly.
        }
    }

    return { home, workspace };
}

/** One `[[permission.rules]]` block. */
function rule(decision, pattern) {
    return `[[permission.rules]]\ndecision = "${decision}"\npattern = "${pattern}"\n`;
}

/**
 * The configuration for one run, written fresh every time a query starts.
 *
 * Rewritten rather than merged because nothing else writes here: this directory
 * exists so that pointing `KIMI_CODE_HOME` at it cannot disturb the install the
 * user made themselves. Both settings baked in below are in the app's
 * `RESTART_ON` list, so a query is already started again when either moves.
 *
 * `mcp.json` is the user-level one for this home. The project-level spelling
 * would be the tidier place for it and is not usable: Kimi Code connects a
 * project's MCP servers only once that folder has been trusted, and being asked
 * to trust it is a keypress in a TUI that a headless run never draws.
 */
function writeConfig({ home, url, current }) {
    const denied = [
        ...ALWAYS_DENIED,
        ...(current.allowLocalTools ? [] : LOCAL_TOOLS),
    ];

    const toml = [
        '# Written by CloudBlast, and only for the runs CloudBlast starts.',
        '# This is not the Kimi Code configuration at ~/.kimi-code, which is',
        '# left alone: KIMI_CODE_HOME points here instead. Edits will be lost.',
        '',
        '[loop_control]',
        // The same ceiling every other agent here is given, and it does the same
        // job: a model that has decided to read one more file forever stops on
        // its own rather than when somebody notices.
        `max_steps_per_turn = ${Math.max(1, Number(current.maxTurns) || 40)}`,
        '',
        // Ours are allowed outright. The approval gate they pass is the one in
        // `mcp-host`, and a second question from the agent would only be asked
        // where nobody can answer it.
        rule('allow', `mcp__${SERVER_NAME}__*`),
        ...denied.map(name => rule('deny', name)),
    ].join('\n');

    const json = JSON.stringify({
        mcpServers: {
            // A URL and no `transport` is how this CLI spells an HTTP server.
            // The address carries the token in its path rather than in a header,
            // which is what `mcp-host` grew a second way in for: a config file
            // is the only channel here.
            [SERVER_NAME]: { url },
        },
    }, null, 2);

    // A background update in the middle of somebody's turn is a download this
    // app did not ask for and cannot report. There is no flag for it, and this
    // is our copy of the file, so it is switched off here.
    const tui = '[upgrade]\nauto_install = false\n';

    fs.writeFileSync(path.join(home, 'config.toml'), toml, 'utf8');
    fs.writeFileSync(path.join(home, 'mcp.json'), json, 'utf8');
    fs.writeFileSync(path.join(home, 'tui.toml'), tui, 'utf8');
}

/** `mcp__remote__run_command` or `remote__read_file` back to the bare name. */
function stripServer(name) {
    const text = String(name || '');
    const match = new RegExp(`^(?:mcp__)?${SERVER_NAME}(?:__|_|\\.)`).exec(text);
    return match ? text.slice(match[0].length) : text;
}

/** A tool call's arguments, which arrive as a JSON string. */
function readArguments(raw) {
    if (raw && typeof raw === 'object') return raw;
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        // A call the stream never finished writing. The panel can still draw
        // the name, and the text is worth more than an empty object.
        return { arguments: text };
    }
}

/**
 * One stream-json line, as the transcript events the panel already draws.
 *
 * The format is not a bespoke event stream: each line is a chat message.
 * `{ role: 'assistant' }` carries whatever text was buffered and any
 * `tool_calls` made with it, `{ role: 'tool' }` answers one of them by id, and
 * `{ role: 'meta' }` is the CLI talking about itself, of which only the resume
 * hint matters here because it is where the session id is published.
 *
 * Two consequences the panel sees. Nothing arrives as a delta, because this
 * writer buffers the assistant text and flushes it whole before each tool
 * result, so the transcript lands in blocks rather than typing itself out. And
 * thinking is not written to this stream at all, so there is none to show.
 */
function createTranslator(onEvent) {
    let sawError = false;
    let sessionId = '';
    const announced = new Set();

    return {
        get failed() {
            return sawError;
        },
        get sessionId() {
            return sessionId;
        },
        event(payload) {
            switch (payload?.role) {
                case 'assistant': {
                    // Before the tool calls, as every other provider here does:
                    // the panel treats the finished block as authoritative and
                    // clears whatever streamed, so a call announced first would
                    // have the text land underneath it.
                    const text = typeof payload.content === 'string' ? payload.content : '';
                    if (text.trim()) onEvent({ type: 'assistant-text', text });

                    for (const call of payload.tool_calls || []) {
                        const id = String(call?.id || `tool-${announced.size}`);
                        if (announced.has(id)) continue;
                        announced.add(id);

                        const raw = String(call?.function?.name || 'tool');
                        const name = stripServer(raw);
                        onEvent({
                            type: 'tool-call',
                            id,
                            name,
                            rawName: raw,
                            // Ours arrive prefixed with the server name. Anything
                            // else is one of the agent's own, acting on this
                            // machine, and the panel says so.
                            local: name === raw,
                            input: readArguments(call?.function?.arguments),
                        });
                    }
                    return;
                }

                case 'tool': {
                    const id = String(payload.tool_call_id || '');
                    if (!id) return;
                    onEvent({
                        type: 'tool-result',
                        id,
                        text: typeof payload.content === 'string' ? payload.content : '',
                        // This stream does not mark a failed call, and guessing
                        // from the text would put a red result on any command
                        // that merely printed the word "error".
                        isError: false,
                    });
                    return;
                }

                case 'meta':
                    // Written once, at the end of a run that got that far. It is
                    // the only place the session id is published, and the id is
                    // what lets the next turn carry on the same conversation.
                    if (payload.type === 'session.resume_hint' && payload.session_id) {
                        sessionId = String(payload.session_id);
                    }
                    return;

                // The version banner and the retry notices are about the CLI
                // rather than about this conversation, and the panel has nowhere
                // to put either.
                default:
            }
        },
        fail(message) {
            sawError = true;
            onEvent({ type: 'error', message: describeFailure(message) });
        },
        finish(subtype = 'success') {
            onEvent({
                type: 'result',
                subtype: sawError ? 'error' : subtype,
                isError: sawError || subtype !== 'success',
                // Neither is on this stream. Reporting a confident zero would be
                // worse than the panel showing nothing.
                costUsd: 0,
                usage: null,
            });
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
function runArguments({ sessionId, prompt }) {
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    // Resuming is by id, and there is no way to choose one up front: the id is
    // whatever the first run reported. So the model and the effort travel in the
    // environment rather than here, where `-m` would name an alias this home has
    // no definition for.
    if (sessionId) args.push('--session', sessionId);
    return args;
}

/**
 * The environment for one run.
 *
 * `KIMI_MODEL_*` is the whole of the model configuration. Kimi Code reads
 * provider credentials from its config file and not from the environment, with
 * this family as the documented exception: setting `KIMI_MODEL_NAME` has it
 * synthesise a provider in memory for that launch. That is what keeps the key
 * out of a file on disk, and it is also why a model has to be named here rather
 * than inherited: this home has no `default_model` for the CLI to fall back on.
 */
function environment({ home, current, model }) {
    const env = {
        ...process.env,
        KIMI_CODE_HOME: home,
        KIMI_MODEL_NAME: model,
        KIMI_MODEL_API_KEY: current.apiKey || '',
        KIMI_MODEL_BASE_URL: API_URL,
    };

    const effort = effortFor(current);
    if (effort) env.KIMI_MODEL_THINKING_EFFORT = effort;

    return env;
}

/**
 * One turn: a process, its stdout read as it arrives, and an exit code.
 *
 * A run per turn rather than a long-lived process is the Codex and Grok
 * arrangement, and for the same reason: the CLI's headless mode answers one
 * prompt and ends. The session id is what carries the conversation, and Kimi
 * Code keeps its sessions under the data directory, so this survives the app
 * being closed in a way the in-process providers cannot.
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
            finish({ ok: false, message: 'Kimi Code did not finish that turn in time.' });
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

        // Kept rather than shown. This CLI puts its thinking, its tool progress
        // and the reason it could not start on stderr, and the last of those is
        // the one thing worth repeating when a run fails without ever having
        // said anything on stdout.
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
                message: describeFailure(stderr.trim() || `Kimi Code exited with code ${code}`),
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

/**
 * Which model to ask for when the user has not pinned one.
 *
 * There is nothing to inherit on either path. The API path is refused without a
 * model id, and the CLI path is running against a synthesised provider that has
 * no default of its own, so a name is always required. The account is asked
 * what it can reach and the answer decides, cached against the key it was read
 * with so a different key asks again.
 *
 * The `kimi-` family is preferred over whatever happens to be listed first,
 * because the same account also reaches the older `moonshot-v1-*` chat models
 * and this card is not about those.
 */
let known = { key: '', model: '' };

function preferred(rows) {
    return (rows.find(row => /^kimi-/i.test(row.value)) || rows[0]).value;
}

async function resolveModel(current) {
    if (current.model) return current.model;
    if (known.key === current.apiKey && known.model) return known.model;

    const rows = await engine.listModels({
        baseUrl: API_URL,
        apiKey: current.apiKey,
        label: LABEL,
    });
    if (!rows?.length) {
        throw new Error(`${LABEL} listed no models for this key. Check the key in the assistant settings.`);
    }

    known = { key: current.apiKey, model: preferred(rows) };
    return known.model;
}

/** The API path, for a machine with a key and no CLI. */
async function apiSession(options) {
    options.onEvent({
        type: 'account',
        subscriptionType: '',
        apiProvider: 'Moonshot API',
        apiKeySource: 'CloudBlast',
    });

    return engine.start({
        ...options,
        label: LABEL,
        prefix: 'kimi',
        endpoint: current => ({ baseUrl: API_URL, apiKey: current.apiKey || '', label: LABEL }),
        model: resolveModel,
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

    if (!settings.apiKey) {
        throw new Error('Kimi Code has no key to run with. Add a Moonshot API key from '
            + 'platform.moonshot.ai in the assistant settings. CloudBlast runs the CLI against a '
            + 'configuration of its own, so the login in your own ~/.kimi-code is not read.');
    }

    const binary = findKimi();
    if (!binary) return apiSession(options);

    const { home, workspace } = directories();
    const { tokenUrl } = await mcpHost.acquire({ toolContext, requestApproval, onEvent });

    try {
        writeConfig({ home, url: tokenUrl, current: settings });
    } catch (error) {
        await mcpHost.release();
        throw new Error(`The Kimi Code configuration could not be written: ${error.message}`);
    }

    // A stored key means the turns are metered rather than coming out of a
    // plan, and this path always has one, so it is always worth saying.
    onEvent({
        type: 'account',
        subscriptionType: '',
        apiProvider: 'Moonshot API',
        apiKeySource: 'CloudBlast',
    });

    // Whatever the last run reported, or what a restored conversation came back
    // with. Empty means the next run starts a session and tells us its id.
    let sessionId = resumeSessionId;
    if (sessionId) onEvent({ type: 'session', sessionId, model: settings.model || '' });

    // The system prompt is not a flag on a headless run, so it leads the first
    // turn. Kimi Code carries it forward with the rest of the session.
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
        const model = await resolveModel(current);
        const env = environment({ home, current, model });
        const translator = createTranslator(onEvent);
        const prompt = preamble ? `${preamble}\n\n---\n\n${text}` : text;
        preamble = '';
        stopped = false;

        let outcome = await runTurn({
            binary,
            args: runArguments({ sessionId, prompt }),
            directory: workspace,
            env,
            translator,
            onStart: hold,
        });

        // A stored id that this machine no longer has a session for. The
        // conversation carries on as a new session rather than failing, which is
        // what the transcript in front of the user already implies has happened.
        const missing = /session|not found|unknown|no such/i.test(outcome.stderr || outcome.message || '');
        if (!outcome.ok && !stopped && sessionId && missing) {
            sessionId = '';
            outcome = await runTurn({
                binary,
                args: runArguments({ sessionId: '', prompt }),
                directory: workspace,
                env,
                translator,
                onStart: hold,
            });
        }

        child = null;

        // Published at the end of a run that got that far, including one that
        // then failed, so it is read before the outcome is judged. Announcing it
        // is what lets a parked conversation be picked up after a restart.
        //
        // A run killed before it wrote that line leaves nothing to resume, and
        // there is no id to fall back on: this CLI names a session itself and
        // only says which afterwards. So stopping the very first message starts
        // the next one as a fresh session. What is lost is the agent's memory of
        // a turn the user cancelled; the transcript is the app's, and the next
        // message carries its context along as it always does.
        if (translator.sessionId && translator.sessionId !== sessionId) {
            sessionId = translator.sessionId;
            onEvent({ type: 'session', sessionId, model: current.model || '' });
        }

        if (outcome.ok) {
            translator.finish();
            return;
        }

        // A run the user stopped is not a run that failed. The session still
        // exists either way, so the next message resumes it rather than starting
        // again from nothing.
        if (stopped) return;

        if (closed) return;
        translator.fail(outcome.message);
        translator.finish('error');
    }

    return {
        send(text) {
            running = running.then(() => turn(text)).catch((error) => {
                if (!closed) onEvent({ type: 'error', message: describeFailure(error.message) });
            });
        },
        // Both travel in the environment of the next run, so there is nothing to
        // push at anything that is already going.
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
 * Read from the API, which both paths are pointed at: the CLI runs against a
 * provider synthesised from the same key and the same base URL, so one list is
 * the true answer for either. With no key there is nothing to ask with, and
 * nothing is guessed.
 *
 * The first `kimi-` row is marked preferred rather than leaving the menu to
 * offer a "use the default" row. There is no default to inherit here, and that
 * row would be describing a decision nobody made; marking one says the true
 * thing instead, which is what `resolveModel` above actually does.
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
    // that is the path with somewhere to put it. Against the API the request
    // would carry a reasoning field the model may not take, and a dial that
    // turns a working conversation into a 400 is worse than no dial.
    const effort = findKimi() ? [...EFFORTS] : [];
    const best = preferred(rows);
    return rows.map(row => ({ ...row, effort, preferred: row.value === best }));
}

/** A failure, in words that say what to do about it. */
function describeFailure(message) {
    const text = String(message || 'Unknown error');

    if (/KIMI_MODEL|missing.*api.?key|no.*credential|provider.*credential/i.test(text)) {
        return 'Kimi Code was started without a usable key. Check the Moonshot API key in the '
            + `assistant settings. (${text})`;
    }
    if (/unauthor|401|403|invalid.*api.?key/i.test(text)) {
        return 'Moonshot rejected that key. Check it in the assistant settings, or make a new one '
            + 'at platform.moonshot.ai.';
    }
    if (/git ?bash|KIMI_SHELL_PATH|bash\.exe/i.test(text)) {
        return 'Kimi Code could not find the shell it runs commands through. It uses Git Bash on '
            + 'Windows, so install Git for Windows, or set KIMI_SHELL_PATH to your bash.exe.';
    }
    if (/ENOENT|not found|spawn/i.test(text)) {
        return 'The Kimi Code CLI could not be started. Check that "kimi" runs in a terminal, '
            + `then try again. (${text})`;
    }
    if (/unknown option|unknown command|unexpected argument|unrecognized/i.test(text)) {
        return 'This version of Kimi Code did not understand how CloudBlast started it. '
            + `Update the CLI and try again. (${text})`;
    }
    if (/rate limit|429|quota/i.test(text)) {
        return 'Moonshot is rate limiting this account. Wait a moment, then try again.';
    }
    return text;
}

module.exports = {
    start,
    listModels,
    findKimi,
    kimiRoots,
    createTranslator,
    runArguments,
    environment,
    writeConfig,
    stripServer,
    effortFor,
    describeFailure,
    LOCAL_TOOLS,
    ALWAYS_DENIED,
    SERVER_NAME,
    API_URL,
    _test: { runTurn, stopProcess, directories, preferred, forget: () => { known = { key: '', model: '' }; } },
};
