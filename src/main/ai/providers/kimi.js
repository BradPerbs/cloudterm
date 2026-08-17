const fs = require('fs');
const os = require('os');
const path = require('path');
const spawn = require('cross-spawn');
const { app } = require('electron');

const mcpHost = require('../mcp-host');

/**
 * The Kimi Code provider.
 *
 * Kimi Code CLI is Moonshot's terminal agent, and this drives the one installed
 * on the machine, one headless run per turn: `kimi -p <prompt> --output-format
 * stream-json`, our own tools served over loopback by `mcp-host` and reached by
 * URL. The agent brings its own harness with it, which is the point of driving
 * an agent rather than a model.
 *
 * It runs on the login the user already has, like every other agent card here,
 * and that takes some arranging. Kimi Code CLI takes all of its configuration
 * from one user-level directory, `KIMI_CODE_HOME`. There is no flag for an MCP
 * server, no flag for a tool denylist, and no project-level config file: the CLI
 * reads a project's `.kimi-code/mcp.json` only once that folder has been
 * trusted, and trusting one is a keypress in the TUI that a headless run never
 * gets to make. So our tools can only be handed over through a home directory,
 * and it cannot be the user's own: that is where their sessions and their login
 * live, and this app has no business writing there.
 *
 * `KIMI_CODE_HOME` therefore points at a directory of ours, and their login is
 * brought to it. Their `config.toml` is carried across at the top of every turn,
 * minus the few tables we set for ourselves, so a re-login or a rotated
 * credential is picked up without anything having to notice. Their
 * `credentials` directory is linked rather than copied: the tokens in there are
 * refreshed as they are used, and a second copy refreshing on its own would
 * eventually log them out of their own CLI. Their directory is only ever read.
 *
 * What that carrying across means is worth saying plainly rather than leaving
 * as a surprise: `config.toml` holds credentials, so a copy of it lives in this
 * app's data directory. Same machine, same user, same profile, and rewritten
 * from theirs every turn, so it cannot quietly become a second stale one.
 *
 * There is no key of ours anywhere in this, and no API fallback. An agent that
 * is not installed and signed in here is refused when it is switched on, which
 * is the same rule every other agent card follows.
 */

/** The name our tools are served under. As elsewhere: what they do, not whose. */
const SERVER_NAME = 'remote';

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

/**
 * Where the user's own Kimi Code setup lives.
 *
 * `~/.kimi-code` is the CLI's default, and `KIMI_CODE_HOME` wins if they have
 * set one, because that is the answer the CLI itself would give: this is asking
 * where their login is, not where we would like it to be.
 */
function userHome({ env = process.env, home = os.homedir() } = {}) {
    return envValue(env, 'KIMI_CODE_HOME') || path.join(home, '.kimi-code');
}

/**
 * Whether there is a login there to run on.
 *
 * The configuration file, and at least one credential beside it. Deliberately
 * not a parse: what a signed-in home looks like inside is a question for the CLI
 * that wrote it, and these two are the pair that is certainly absent before a
 * login and certainly present after one.
 */
function signedIn({
    source = userHome(),
    existsSync = fs.existsSync,
    readdirSync = fs.readdirSync,
} = {}) {
    if (!existsSync(path.join(source, 'config.toml'))) return false;
    return readdir(readdirSync, path.join(source, 'credentials'))
        .some(name => /\.json$/i.test(String(name)));
}

/** One `[[permission.rules]]` block. */
function rule(decision, pattern) {
    return `[[permission.rules]]\ndecision = "${decision}"\npattern = "${pattern}"\n`;
}

/**
 * One TOML document with some of its tables taken out.
 *
 * Line-based rather than parsed, because this is somebody else's file being
 * carried across rather than something to be understood: everything that is not
 * a table we write for ourselves goes through untouched, comments, spacing and
 * all. A table runs from its header to the next header at any depth, which is
 * what makes dropping one safe without knowing what is inside it.
 */
function withoutTables(text, names) {
    const drop = new Set(names);
    let dropping = false;

    return String(text || '')
        .split(/\r?\n/)
        .filter((line) => {
            const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line);
            if (header) dropping = drop.has(header[1].split('.')[0].replace(/"/g, '').trim());
            return !dropping;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

/**
 * Point our home at the login the user already has.
 *
 * A link rather than a copy. What is in there is refreshed as it is used, and a
 * copy would be refreshed on its own and leave the original behind: with a
 * provider that rotates its refresh tokens, that logs the user out of their own
 * CLI, which is the one thing this arrangement must not do. A junction on
 * Windows, which needs no elevation, and an ordinary directory symlink
 * everywhere else.
 *
 * Throws when it cannot be done, and that is deliberate: running on a copy is
 * the failure mode worth refusing rather than falling back to.
 */
function borrowLogin({ home, source, platform = process.platform }) {
    const store = path.join(source, 'credentials');
    const target = path.join(home, 'credentials');
    const settled = (value) => path.resolve(String(value || '')).replace(/[\\/]+$/, '');

    try {
        const found = fs.lstatSync(target);
        if (found.isSymbolicLink() && settled(fs.readlinkSync(target)) === settled(store)) {
            return target;
        }
        // Anything else standing there is from an older arrangement of this
        // directory, which was ours to begin with. Removed rather than merged:
        // what it holds is a stale duplicate of the real thing.
        fs.rmSync(target, { recursive: true, force: true });
    } catch {
        // Nothing there, which is the usual case.
    }

    fs.symlinkSync(store, target, platform === 'win32' ? 'junction' : 'dir');

    // Copied rather than linked: it is one line naming this installation, the
    // CLI writes it once, and some versions tie a credential to it.
    try {
        fs.copyFileSync(path.join(source, 'device_id'), path.join(home, 'device_id'));
    } catch {
        // Not every version writes one, and it is not needed to run.
    }

    return target;
}

/**
 * The configuration for one run, written fresh at the top of every turn.
 *
 * `base` is the user's own `config.toml`, read a moment earlier, and it leads:
 * their providers, their models, their services and the credential their login
 * put there are what these runs go out on. Only the few tables this app decides
 * are taken out of it and written again below, since a TOML file with two
 * answers to one question lets the CLI pick either.
 *
 * Rewritten every turn rather than once per query, because it now carries two
 * things that move under it: their file, which changes when they sign in again
 * or a credential rotates, and the effort dial, which is expected to take
 * effect on the next answer rather than the next conversation.
 *
 * `mcp.json` is the user-level one for this home. The project-level spelling
 * would be the tidier place for it and is not usable: Kimi Code connects a
 * project's MCP servers only once that folder has been trusted, and being asked
 * to trust it is a keypress in a TUI that a headless run never draws.
 */
function writeConfig({ home, base = '', url, current, effort = '' }) {
    const denied = [
        ...ALWAYS_DENIED,
        ...(current.allowLocalTools ? [] : LOCAL_TOOLS),
    ];

    // Theirs goes only where ours would contradict it. `thinking` is taken out
    // only when there is a level to put in its place: with nothing to say, what
    // they set for themselves is the better answer.
    const carried = withoutTables(base, ['loop_control', 'permission', ...(effort ? ['thinking'] : [])]);

    const toml = [
        carried,
        '',
        '# Written by CloudBlast, and only for the runs CloudBlast starts.',
        '# Above this line is your own Kimi Code configuration, carried across so',
        '# these runs use the login you already have. Edits below here are lost.',
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
        // Only ever a level the model in play said it takes: see `start`. A dial
        // set to something the model does not have is a run that fails on an
        // argument rather than a run that thinks slightly less hard.
        ...(effort ? ['[thinking]', 'enabled = true', `effort = "${effort}"`, ''] : []),
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

/** A TOML scalar or array of strings, as far as this file needs to read one. */
function readValue(raw) {
    const text = String(raw || '').trim();
    if (/^\[.*\]$/.test(text)) {
        return text.slice(1, -1)
            .split(',')
            .map(part => part.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
    }
    return text.replace(/^["']|["']$/g, '');
}

/**
 * The models the user's own configuration defines.
 *
 * Read from their file rather than asked of an API, which is the only honest
 * source now that these runs go out on their login: what that account can reach
 * is what the CLI wrote down for itself when it signed in, and asking anything
 * else would need a credential of ours to ask with.
 *
 * The one their `default_model` names is marked preferred, so the menu offers it
 * under its own name rather than a row reading "use the default". An effort
 * scale is offered only where a model declares one, narrowed to the levels this
 * app has names for: a dial with stops the model does not have is a dial that
 * turns a working conversation into a failed argument.
 */
function modelsFrom(text) {
    const found = new Map();
    let section = '';
    let alias = '';
    let fallback = '';

    for (const line of String(text || '').split(/\r?\n/)) {
        const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line);
        if (header) {
            section = header[1];
            const model = /^models\.(.+)$/.exec(section);
            alias = model ? model[1].replace(/^["']|["']$/g, '') : '';
            if (alias && !found.has(alias)) found.set(alias, {});
            continue;
        }

        const pair = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/.exec(line);
        if (!pair) continue;
        if (alias) found.get(alias)[pair[1]] = readValue(pair[2]);
        else if (!section && pair[1] === 'default_model') fallback = readValue(pair[2]);
    }

    const rows = [...found].map(([value, fields]) => ({
        value,
        // What the alias stands for, so a model saved as the wire id still finds
        // its row. Falls back to the alias, which is what the CLI takes anyway.
        resolved: typeof fields.model === 'string' && fields.model ? fields.model : value,
        label: fields.display_name || value,
        short: fields.display_name || value.split('/').pop(),
        description: typeof fields.model === 'string' ? fields.model : '',
        effort: Array.isArray(fields.support_efforts)
            ? fields.support_efforts.filter(level => EFFORTS.has(level))
            : [],
        preferred: value === fallback,
    }));

    return rows.length > 0 ? rows : null;
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

/**
 * The arguments for one headless run.
 *
 * `-m` names an alias out of the configuration carried across from the user's
 * own home, which is where those aliases are defined. Nothing pinned means no
 * flag at all, and the CLI falls back to the `default_model` in that same file,
 * which is the choice they made for themselves.
 *
 * Resuming is by id, and there is no way to choose one up front: the id is
 * whatever the first run reported.
 */
function runArguments({ sessionId, prompt, model = '' }) {
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (model) args.push('-m', model);
    if (sessionId) args.push('--session', sessionId);
    return args;
}

/**
 * The environment for one run.
 *
 * One variable, and it is the whole arrangement: everything else this agent
 * needs is in the home it points at. The `KIMI_MODEL_*` family used to be here,
 * carrying a key and a base URL so the CLI would synthesise a provider in
 * memory. There is no key any more, and the provider is the user's own.
 */
function environment({ home }) {
    return { ...process.env, KIMI_CODE_HOME: home };
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
 * The user's own configuration, as text, or nothing if it cannot be read.
 *
 * Read again at the top of every turn rather than held: it is a small file, and
 * holding it is how a conversation carries on with a credential that was
 * rotated out from under it half an hour ago.
 */
function readUserConfig(source) {
    try {
        return fs.readFileSync(path.join(source, 'config.toml'), 'utf8');
    } catch {
        return '';
    }
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

    const binary = findKimi();
    if (!binary) {
        throw new Error('Kimi Code is not installed on this machine, or its CLI could not be found');
    }

    const source = userHome();
    if (!signedIn({ source })) {
        throw new Error('Kimi Code is installed but not signed in. Run "kimi" in a terminal and '
            + 'sign in there, then try again. CloudBlast runs on that login and stores no key of '
            + 'its own.');
    }

    const { home, workspace } = directories();
    const { tokenUrl } = await mcpHost.acquire({ toolContext, requestApproval, onEvent });

    try {
        // Once per query. What it points at is a directory, not a copy, so it
        // stays right for as long as their login does.
        borrowLogin({ home, source });
    } catch (error) {
        await mcpHost.release();
        throw new Error('The Kimi Code login on this machine could not be reached from the '
            + `directory these runs use: ${error.message}`);
    }

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

        // Their file, read again, and our tables written over it. Both of the
        // settings baked in here move without a query being restarted: the
        // effort from the composer's dial, and their own configuration when
        // they sign in again in another window.
        const base = readUserConfig(source);
        const rows = modelsFrom(base) || [];
        const model = current.model || '';
        // Only a level the model in play actually declares. The menu narrows
        // the dial to that already, but nothing pinned means the menu had no
        // model to narrow against, and the agent's own default may be a model
        // that takes no effort at all.
        const wanted = effortFor(current);
        const row = rows.find(item => item.value === model) || rows.find(item => item.preferred);
        const effort = wanted && row?.effort?.includes(wanted) ? wanted : '';

        try {
            writeConfig({ home, base, url: tokenUrl, current, effort });
        } catch (error) {
            throw new Error(`The Kimi Code configuration could not be written: ${error.message}`);
        }

        const env = environment({ home });
        const translator = createTranslator(onEvent);
        const prompt = preamble ? `${preamble}\n\n---\n\n${text}` : text;
        preamble = '';
        stopped = false;

        let outcome = await runTurn({
            binary,
            args: runArguments({ sessionId, prompt, model }),
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
                args: runArguments({ sessionId: '', prompt, model }),
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
 * What this machine's Kimi Code can run.
 *
 * Its own configuration is the answer, and the only one available: these runs go
 * out on the user's login, so what the account reaches is what the CLI wrote
 * down for itself when it signed in, and there is no credential of ours to ask
 * an API with. No CLI, or no login, means no list rather than a guess.
 */
async function listModels() {
    if (!findKimi()) return null;

    const source = userHome();
    if (!signedIn({ source })) return null;

    return modelsFrom(readUserConfig(source));
}

/** A failure, in words that say what to do about it. */
function describeFailure(message) {
    const text = String(message || 'Unknown error');

    if (/KIMI_MODEL|missing.*api.?key|no.*credential|provider.*credential/i.test(text)) {
        return 'Kimi Code was started without a usable login. Run "kimi" in a terminal and sign in '
            + `there, then try again. (${text})`;
    }
    if (/unauthor|401|403|invalid.*api.?key/i.test(text)) {
        return 'Moonshot rejected that login. Run "kimi" in a terminal and sign in again, then '
            + 'try again here.';
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

/**
 * Whether this agent could run here.
 *
 * Two things rather than one, because the CLI being installed is not the whole
 * of it: these runs go out on the user's own login, and a Kimi Code that has
 * never been signed in has a home directory with no credential in it. Both are
 * checked before the tick takes, so the answer arrives while the person is
 * looking at the setting rather than in the middle of their first question.
 */
function detect() {
    if (!findKimi()) return { ok: false, reason: 'notFound' };
    return { ok: signedIn(), reason: 'notSignedIn' };
}

module.exports = {
    start,
    listModels,
    detect,
    findKimi,
    kimiRoots,
    userHome,
    signedIn,
    createTranslator,
    runArguments,
    environment,
    writeConfig,
    withoutTables,
    modelsFrom,
    stripServer,
    effortFor,
    describeFailure,
    LOCAL_TOOLS,
    ALWAYS_DENIED,
    SERVER_NAME,
    _test: { runTurn, stopProcess, directories, borrowLogin, readUserConfig },
};
