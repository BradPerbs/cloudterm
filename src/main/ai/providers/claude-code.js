const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalog = require('../tools');

/**
 * The Claude Code provider.
 *
 * Drives @anthropic-ai/claude-agent-sdk, which is the Claude Code harness as a
 * library. The CLI it spawns is the user's own install, found by `findClaude`
 * below, and on a machine already signed in to Claude Code it uses that login:
 * the common case here stores no credential of ours at all, which is the point
 * of leading with this provider rather than a raw API client.
 *
 * Nothing is bundled. The SDK ships the CLI as an optional platform package
 * carrying a 253MB binary, which the build excludes; see the `files` list in
 * package.json. That is the whole reason the installer is the size it is, and
 * a copy frozen at whatever version shipped is worse than the one the user
 * keeps updated anyway.
 *
 * Everything specific to that SDK lives in this file. The tool catalog, the
 * prompt and the orchestrator above it are written against a neutral shape, so
 * adding a second provider means writing a sibling of this file and nothing
 * else.
 *
 * The SDK is ESM and this process is CommonJS, so it is reached through a
 * dynamic import, resolved once and reused.
 */

/**
 * The name of our in-process MCP server, which the SDK prefixes onto every
 * tool: `run_command` reaches the model as `mcp__remote__run_command`.
 *
 * Deliberately says what the tools do rather than whose product they ship in.
 * A model reading `mcp__remote__read_file` knows the file is on the far end of
 * a session; a brand name in that slot tells it nothing and reads as noise.
 */
const SERVER_NAME = 'remote';

/**
 * The scale, low to high, for filtering what a model says it supports.
 *
 * Taken from the settings rather than written again here, so a level this
 * reports can always be saved: a runtime that grows a sixth one would
 * otherwise have it offered in the menu and silently refused by the store.
 */
const EFFORT_LEVELS = [...require('../settings').EFFORTS];

/** The first of these names the env has a value for, or ''. */
function envValue(env, ...names) {
    for (const name of names) {
        if (env?.[name]) return env[name];
    }
    return '';
}

/** Entries of a directory, or none if it is missing or unreadable. */
function readdir(readdirSync, directory) {
    try {
        return readdirSync(directory);
    } catch {
        return [];
    }
}

/** Segment by segment, so 2.1.221 sorts above 2.1.99 rather than below it. */
function compareVersions(left, right) {
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const difference = (left[i] || 0) - (right[i] || 0);
        if (difference) return difference;
    }
    return 0;
}

/**
 * The copies of Claude Code that editor extensions carry, newest first.
 *
 * These come before a standalone install for a reason worth writing down. The
 * extension is updated by the editor, and its directory names the version, so
 * which one is newest can be known without running anything. A standalone
 * install updates itself, and that can quietly stop: a half-finished update
 * leaves a zero-byte file where the new version should be and the old binary
 * still in place, so the machine goes on answering from a months-old model
 * list with nothing to show that anything is wrong.
 *
 * Nothing here reads the installer's own `versions` or staging directories.
 * Those are its business, and on a machine where an update has stalled the
 * newest thing in them is precisely the broken one.
 */
function extensionRoots({ readdirSync, paths, home }) {
    const editors = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf'];
    const found = [];

    for (const editor of editors) {
        const directory = paths.join(home, editor, 'extensions');
        for (const entry of readdir(readdirSync, directory)) {
            // The platform and architecture follow the version in the name.
            // They are not matched on: an editor only ever installs the build
            // for the machine it is on, and guessing at the spelling of that
            // suffix on a platform this has not seen would fail closed. The
            // trailing dash is optional for the same reason, so a build that
            // is not platform-specific still reads as one of these.
            const named = /^anthropic\.claude-code-(\d+(?:\.\d+)*)(?:-|$)/.exec(entry);
            if (!named) continue;

            // Two layouts, in the order the extension itself tries them: a
            // directory per platform and architecture, then a flat one. The
            // per-platform names carry a `-musl` suffix on the Linux builds
            // that need it, so they are read off the disk rather than spelled
            // out here, which would mean repeating the extension's own libc
            // detection to get them wrong somewhere.
            const resources = paths.join(directory, entry, 'resources');
            const targets = paths.join(resources, 'native-binaries');
            const roots = readdir(readdirSync, targets)
                .map(target => paths.join(targets, target));
            roots.push(paths.join(resources, 'native-binary'));

            found.push({ version: named[1].split('.').map(Number), roots });
        }
    }

    return found
        .sort((a, b) => compareVersions(b.version, a.version))
        .flatMap(entry => entry.roots);
}

/**
 * Every place a Claude Code install puts its binary, best first.
 *
 * Editor extensions lead, newest version first, for the reason given above
 * them. Then PATH, because someone who has put the CLI somewhere of their own
 * has already said where it is. Then the installers' own locations, which is
 * what a packaged app actually needs: Electron inherits the PATH of whatever
 * launched it, and a desktop shortcut has a far shorter one than a shell does,
 * so the binary a terminal finds instantly is routinely invisible here.
 *
 * Real executables only. The SDK spawns what it is handed through
 * `child_process.spawn` with no shell, and Node refuses to start a `.cmd` or
 * `.bat` that way, so accepting an npm shim would mean resolving a path that
 * then fails to launch with nothing useful to say about why. If that ever
 * needs supporting, the SDK takes a `spawnClaudeCodeProcess` option and
 * `cross-spawn` is already a dependency.
 */
function claudeCandidates({
    platform = process.platform,
    env = process.env,
    home = os.homedir(),
    readdirSync = fs.readdirSync,
} = {}) {
    const windows = platform === 'win32';
    // Both halves named outright rather than leaning on the host's `path` and
    // `path.delimiter`, which are the same thing in production and are not
    // under test: the platform is an argument here, so the separators have to
    // follow it rather than the machine running the check.
    const paths = windows ? path.win32 : path.posix;
    const name = windows ? 'claude.exe' : 'claude';
    const pathEntries = String(envValue(env, 'PATH', 'Path', 'path'))
        .split(windows ? ';' : ':')
        .filter(Boolean);
    const roots = [
        ...extensionRoots({ readdirSync, paths, home }),
        ...pathEntries,
        paths.join(home, '.local', 'bin'),
    ];

    if (windows) {
        const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData');
        if (localAppData) roots.push(paths.join(localAppData, 'Programs', 'claude'));
    } else {
        roots.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
    }

    // What the installer that predated the native one used, still the only
    // copy on a machine that has not been through an update since.
    roots.push(paths.join(home, '.claude', 'local'));

    return [...new Set(roots.filter(Boolean).map(root => paths.join(root, name)))];
}

/**
 * The user's own Claude Code, or '' if this machine has none.
 *
 * Nothing is bundled. Codex and OpenCode have always run the CLI already on
 * the machine, under the login already on it, and this is the same bargain:
 * the app carries no copy of a runtime, ships no credential, and does not go
 * stale the week Claude Code updates.
 */
function findClaude(options = {}) {
    const platform = options.platform || process.platform;
    const accessSync = options.accessSync || fs.accessSync;
    const statSync = options.statSync || fs.statSync;
    const candidates = claudeCandidates({
        platform,
        env: options.env || process.env,
        home: options.home || os.homedir(),
        readdirSync: options.readdirSync || fs.readdirSync,
    });

    for (const candidate of candidates) {
        try {
            accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
            // An update that died part way through leaves a real file of zero
            // bytes behind, which passes every existence check and then will
            // not start. That is not a hypothetical: it is what a stalled
            // self-update looks like on disk, and the symptom without this is
            // an assistant that cannot say why it will not run.
            if (statSync(candidate).size > 0) return candidate;
        } catch {
            // Keep looking.
        }
    }
    return '';
}

/**
 * What the installed Claude Code says it can run, as the app needs it.
 *
 * The alternative was a list of models written here and kept in step by hand,
 * which is wrong twice over: it goes stale the week a model ships, and it
 * offers every effort level for every model when support is per model. The
 * runtime knows both, so it is asked.
 *
 * `effort` is three-valued, and read from what the row says rather than from
 * what it omits. A list of levels is those levels. `supportsEffort` with no
 * list is the whole scale. A row that mentions neither has no effort setting:
 * the runtime leaves both fields off for those (Haiku, at the time of
 * writing) rather than setting the flag false, so treating silence as "offer
 * everything" would draw a dial that does nothing.
 *
 * `resolved` is the wire id an alias stands for: the rows are named `opus[1m]`
 * and `sonnet`, and this is what lets a model id saved before any of this
 * existed be recognised as the row that covers it.
 */
function describeModels(rows) {
    if (!Array.isArray(rows)) return [];

    return rows
        .filter(row => row && typeof row.value === 'string' && row.value)
        // The runtime's own "Default (recommended)" row is the same choice as
        // making no choice, which is already the first row of every one of
        // these menus. Two rows meaning "whatever it is set to" is one too
        // many, and the other one is ours to label.
        .filter(row => row.value !== 'default')
        .map(row => {
            const label = row.displayName || row.value;
            const levels = Array.isArray(row.supportedEffortLevels)
                ? row.supportedEffortLevels.filter(level => EFFORT_LEVELS.includes(level))
                : null;

            return {
                value: row.value,
                resolved: row.resolvedModel || row.value,
                label,
                // The name, minus what the composer chip has no room for: the
                // word "Claude", which the panel already implies, and the
                // qualifier in brackets, since "Opus (1M context)" sitting next
                // to an effort level turns that row into a sentence. The menu
                // still shows the full name.
                short: label.replace(/^Claude\s+/i, '').replace(/\s*\([^)]*\)\s*$/, ''),
                description: String(row.description || '').slice(0, 200),
                effort: levels || (row.supportsEffort === true ? null : []),
            };
        })
        .slice(0, 24);
}

/**
 * Claude Code's own tools, which operate on *this* machine rather than on any
 * server. Named so they can be taken away: the local-tools switch in the
 * settings is there for anyone who wants this panel to reach servers and
 * nothing else, and `canUseTool` still gates them when it is on.
 */
const LOCAL_TOOLS = [
    'Bash', 'BashOutput', 'KillShell',
    'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
    'Glob', 'Grep',
    'Task', 'TodoWrite', 'SlashCommand', 'ExitPlanMode',
];

/**
 * The tools that reach the web, kept apart from the list above on purpose.
 * Reading a page is not touching this machine, and an assistant that cannot
 * look anything up reads to the user as one with no internet, which is how the
 * old arrangement was reported. They are offered whichever way the switch is
 * set, and each call still stops at the approval card.
 */
const WEB_TOOLS = ['WebFetch', 'WebSearch'];

/**
 * The tool the model uses to put a question to the user.
 *
 * It runs nothing and reaches nothing. The whole of it is a question with two
 * to four answers, and the answer is collected by whoever is driving the
 * runtime: the SDK hands the call to `canUseTool`, and the answers ride back
 * on `updatedInput.answers`, keyed by the question text. A host that allows
 * the call without putting them there gets "The user did not answer the
 * questions" as the tool's result, which is what this panel did until now, and
 * a host that denies it gets a model that has learned it cannot ask.
 *
 * So it is neither a local tool nor a remote one. It is the one call whose
 * approval card *is* the tool: see `askQuestion` below.
 */
const QUESTION_TOOL = 'AskUserQuestion';

/**
 * Claude Code's own tools that may be used with the local-tools switch off.
 *
 * Asking the user something is not touching their machine, so it belongs here
 * next to reading a web page: someone who has pointed this panel at servers
 * and nothing else has not asked to be unable to answer a question.
 */
const OPEN_TOOLS = new Set([...WEB_TOOLS, QUESTION_TOOL]);

/**
 * The answers, as the runtime takes them back.
 *
 * Only the questions that were actually asked, matched on their exact text,
 * because that text is the key the runtime pairs an answer to a question by.
 * Anything else the card sends is dropped rather than passed through: the
 * input handed back to the model is not a place to let unchecked keys in.
 *
 * Returns null when nothing usable came back, which the caller turns into a
 * decline rather than an unanswered call.
 */
function questionAnswers(input, answers) {
    if (!answers || typeof answers !== 'object') return null;

    const asked = Array.isArray(input?.questions) ? input.questions : [];
    const kept = {};
    let count = 0;

    for (const question of asked) {
        const key = question?.question;
        if (typeof key !== 'string' || !(key in answers)) continue;
        const value = answers[key];
        if (typeof value !== 'string' || !value.trim()) continue;
        kept[key] = value;
        count += 1;
    }

    return count > 0 ? kept : null;
}

let sdkPromise = null;

function loadSdk() {
    if (!sdkPromise) {
        sdkPromise = import('@anthropic-ai/claude-agent-sdk').catch((error) => {
            // Cleared so a later attempt can retry: the usual cause is a
            // half-finished install, which is fixable without a restart.
            sdkPromise = null;
            throw new Error(`The Claude Agent SDK could not be loaded: ${error.message}`);
        });
    }
    return sdkPromise;
}

/**
 * An async iterable the caller pushes into.
 *
 * The SDK takes the conversation as a stream of user messages rather than one
 * string, which is what keeps a single session alive across turns and what
 * makes `canUseTool` and `interrupt` work at all. This is the writable end of
 * that stream.
 */
function createInputStream() {
    const waiting = [];
    let pending = null;
    let done = false;

    return {
        push(text, images = []) {
            if (done) return;
            const message = {
                type: 'user',
                message: { role: 'user', content: userContent(text, images) },
                parent_tool_use_id: null,
                session_id: '',
            };
            if (pending) {
                const resolve = pending;
                pending = null;
                resolve({ value: message, done: false });
            } else {
                waiting.push(message);
            }
        },
        close() {
            if (done) return;
            done = true;
            if (pending) {
                const resolve = pending;
                pending = null;
                resolve({ value: undefined, done: true });
            }
        },
        async *[Symbol.asyncIterator]() {
            for (;;) {
                if (waiting.length > 0) {
                    yield waiting.shift();
                    continue;
                }
                if (done) return;
                const next = await new Promise((resolve) => { pending = resolve; });
                if (next.done) return;
                yield next.value;
            }
        },
    };
}

/**
 * One user turn as the API wants it: a plain string when there is only text,
 * otherwise the images as blocks with the text after them.
 *
 * Images first because that is the order the model reads best when the words
 * are about the picture, which in a chat they nearly always are. No text block
 * at all when there is no text: an empty one is refused by the API, and a
 * screenshot sent on its own is a perfectly good question.
 */
function userContent(text, images = []) {
    if (!images.length) return text;
    const blocks = images.map(image => ({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
    }));
    if (text) blocks.push({ type: 'text', text });
    return blocks;
}

/** Our catalog, as the in-process MCP server the SDK expects. */
function buildToolServer(sdk, toolContext, onEvent) {
    const tools = catalog.TOOLS.map(definition => sdk.tool(
        definition.name,
        definition.description,
        definition.shape,
        async (input) => {
            try {
                const result = await definition.handler(input || {}, toolContext());
                return {
                    content: [{ type: 'text', text: String(result.text ?? '') }],
                    isError: Boolean(result.isError),
                };
            } catch (error) {
                // Handed back as a tool error rather than thrown. A thrown
                // error ends the turn; a returned one lets the model read what
                // went wrong and try something else, which is nearly always
                // the better outcome.
                onEvent({ type: 'tool-failed', name: definition.name, message: error.message });
                return {
                    content: [{ type: 'text', text: `The ${definition.name} tool failed: ${error.message}` }],
                    isError: true,
                };
            }
        }
    ));

    return sdk.createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools });
}

/** `mcp__remote__run_command` back to `run_command`, or null if not ours. */
function localName(toolName) {
    const prefix = `mcp__${SERVER_NAME}__`;
    return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : null;
}

/**
 * Ask the installed Claude Code what it can run, without starting a chat.
 *
 * The list is part of the runtime's initialisation handshake, so the only way
 * to read it is to bring a session up. This does that and nothing else: no
 * tools, no prompt, no message ever pushed, and the process is torn down as
 * soon as the answer arrives. Nothing is sent to a model, so it costs a second
 * of startup and no tokens.
 *
 * Done this way rather than off the back of the first conversation because the
 * menus that need the list are open long before anyone sends a message, and a
 * model picker that fills itself in only after you have used it is not a model
 * picker.
 */
async function listModels({ settings = {} } = {}) {
    // Before the SDK is loaded, so a machine without Claude Code pays neither
    // the import nor the spawn. An empty list is the right answer here rather
    // than a throw: the menus ask for this on their own, long before anyone
    // has chosen this provider, and a missing CLI is not an error until they do.
    const executable = findClaude();
    if (!executable) return null;

    const sdk = await loadSdk();

    const input = createInputStream();
    const abortController = new AbortController();

    const env = { ...process.env };
    if (settings.apiKey) env.ANTHROPIC_API_KEY = settings.apiKey;

    const stream = sdk.query({
        prompt: input,
        options: {
            pathToClaudeCodeExecutable: executable,
            allowedTools: [],
            permissionMode: 'default',
            abortController,
            env,
            cwd: app.getPath('userData'),
            settingSources: [],
        },
    });

    // The transport only advances while something is reading it, so the
    // handshake this is waiting for arrives on the back of this loop.
    const pump = (async () => {
        try {
            for await (const message of stream) {
                if (message?.type === 'system' && message.subtype === 'init') break;
            }
        } catch {
            // Torn down below, or never started. Either way the await says so.
        }
    })();

    try {
        return describeModels(await stream.supportedModels());
    } finally {
        input.close();
        abortController.abort();
        try {
            await stream.return?.();
        } catch {
            // Already gone.
        }
        await pump.catch(() => {});
    }
}

/**
 * Start a conversation.
 *
 *   settings         the resolved settings, as they are at this moment. Only
 *                    the ones the SDK takes as query options are read from
 *                    here, because those are fixed once the query is running
 *   getSettings      the current settings, read again on every tool call. The
 *                    approval policy has to be live: someone who tightens it
 *                    while a run is going has just told us something about the
 *                    next tool call, not about the next conversation
 *   systemPrompt     built fresh by the caller for this turn
 *   toolContext      a function returning the context tool handlers run with,
 *                    called per invocation so a tool always sees the session
 *                    that is in front of the user now, not when the
 *                    conversation started
 *   requestApproval  asks the user about one tool call, resolving
 *                    { approved, message }
 *   onEvent          where transcript events go
 *   resumeSessionId  a prior SDK session to continue, if there is one
 */
async function start({
    settings,
    getSettings = () => settings,
    systemPrompt,
    toolContext,
    requestApproval,
    onEvent,
    resumeSessionId = '',
}) {
    const executable = findClaude();
    if (!executable) {
        throw new Error('Claude Code is not installed on this machine, or its CLI could not be found');
    }

    const sdk = await loadSdk();

    const input = createInputStream();
    const abortController = new AbortController();
    const server = buildToolServer(sdk, toolContext, onEvent);

    const env = { ...process.env };
    // Only ever set from our own store, and only when the user put one there.
    // Left alone otherwise so the SDK falls through to the Claude Code login
    // already on this machine.
    const key = settings.apiKey;
    if (key) env.ANTHROPIC_API_KEY = key;

    const options = {
        systemPrompt,
        mcpServers: { [SERVER_NAME]: server },
        // Nothing is pre-approved. Every call goes through canUseTool below,
        // which is what puts the approval policy in one place instead of
        // splitting it between a list here and a callback there.
        allowedTools: [],
        disallowedTools: settings.allowLocalTools ? [] : LOCAL_TOOLS,
        permissionMode: 'default',
        canUseTool: async (toolName, toolInput) => {
            const local = localName(toolName);
            const current = getSettings();

            // A question, answered rather than approved. The card collects the
            // answers and they go back on the input, which is the only way the
            // runtime has of hearing them. Declining is a real answer too: the
            // model is told nobody picked, which is what it needs to know.
            if (toolName === QUESTION_TOOL) {
                const verdict = await requestApproval({
                    toolName,
                    name: toolName,
                    input: toolInput,
                    local: false,
                    question: true,
                });

                const answers = verdict.approved
                    ? questionAnswers(toolInput, verdict.input?.answers)
                    : null;

                if (!answers) {
                    return {
                        behavior: 'deny',
                        message: verdict.message
                            || 'The user did not answer. Ask in the conversation instead, or carry on '
                                + 'without that answer.',
                    };
                }

                return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
            }

            if (!local) {
                if (!current.allowLocalTools && !OPEN_TOOLS.has(toolName)) {
                    return {
                        behavior: 'deny',
                        message: `${toolName} acts on the user's own computer, which this assistant is not set up to do. `
                            + 'Use the remote tools to work on the servers instead.',
                    };
                }
                const verdict = await requestApproval({ toolName, name: toolName, input: toolInput, local: true });
                return verdict.approved
                    ? { behavior: 'allow', updatedInput: toolInput }
                    : { behavior: 'deny', message: verdict.message || 'The user declined that.' };
            }

            // Refused outright, before the approval path rather than inside
            // it: there is no answer the user could give that would let this
            // run, so asking would only be a card whose buttons both mean no.
            const blocked = catalog.blockedReason(local, toolInput, current);
            if (blocked) {
                onEvent({ type: 'tool-blocked', name: local, rule: blocked });
                return { behavior: 'deny', message: catalog.blockedMessage(blocked) };
            }

            if (catalog.isAutoApproved(local, toolInput, current)) {
                return { behavior: 'allow', updatedInput: toolInput };
            }

            const verdict = await requestApproval({ toolName, name: local, input: toolInput, local: false });
            return verdict.approved
                ? { behavior: 'allow', updatedInput: verdict.input || toolInput }
                : { behavior: 'deny', message: verdict.message || 'The user declined that.' };
        },
        includePartialMessages: true,
        maxTurns: settings.maxTurns,
        abortController,
        env,
        // Our own directory, and none of the user's Claude Code project files.
        // A CLAUDE.md written for some repository has nothing to say about
        // operating servers, and silently importing their global settings
        // would mean this panel behaved differently on every machine.
        cwd: app.getPath('userData'),
        settingSources: [],
    };

    options.pathToClaudeCodeExecutable = executable;

    if (settings.model) options.model = settings.model;
    if (settings.effort) options.effort = settings.effort;
    if (resumeSessionId) options.resume = resumeSessionId;

    const stream = sdk.query({ prompt: input, options });

    // The two things only the running CLI can answer, asked once each.
    let askedForInit = false;

    // The pump runs for the life of the conversation, not for one turn: the
    // SDK yields every turn's messages on the same iterator.
    const pump = (async () => {
        try {
            for await (const message of stream) {
                translate(message, onEvent);

                // Asked once the session is up rather than at start, because
                // it is a control request and there is nothing to answer it
                // until the CLI has initialised. What comes back decides
                // whether this is a subscription, and therefore whether a
                // dollar figure means anything to this user at all.
                if (!askedForInit && message.type === 'system' && message.subtype === 'init') {
                    askedForInit = true;
                    stream.accountInfo()
                        .then(info => onEvent({
                            type: 'account',
                            subscriptionType: info?.subscriptionType || '',
                            apiProvider: info?.apiProvider || '',
                            apiKeySource: info?.apiKeySource || '',
                        }))
                        .catch(() => {
                            // An older CLI without the control request. The
                            // panel just falls back to showing nothing.
                        });

                    // The model list, from the same moment and for the same
                    // reason: it is a control request, so there is nothing to
                    // answer it until the CLI is up. What comes back replaces
                    // the built-in list everywhere it is offered.
                    stream.supportedModels()
                        .then(rows => onEvent({ type: 'models', models: describeModels(rows) }))
                        .catch(() => {
                            // Older CLI again. The built-in list stands.
                        });
                }
            }
        } catch (error) {
            if (!abortController.signal.aborted) {
                onEvent({ type: 'error', message: describeFailure(error) });
            }
        } finally {
            onEvent({ type: 'closed' });
        }
    })();

    return {
        send(text, images = []) {
            input.push(text, images);
        },
        /**
         * Change the model without restarting anything.
         *
         * The SDK takes both of these as live control requests, so a switch
         * from the composer applies to the next response in the same
         * conversation rather than the next conversation. Failures are
         * swallowed: the setting is already saved, and the worst case is that
         * it takes effect when this conversation is replaced.
         */
        async setModel(model) {
            try {
                await stream.setModel(model || undefined);
            } catch {
                // Older CLI, or the session has already ended.
            }
        },
        async setEffort(effort) {
            try {
                await stream.applyFlagSettings({ effortLevel: effort });
            } catch {
                // As above.
            }
        },
        async interrupt() {
            try {
                await stream.interrupt();
            } catch {
                // Nothing was running, or the process has already gone.
            }
        },
        async close() {
            input.close();
            abortController.abort();
            try {
                await stream.return?.();
            } catch {
                // Already finished.
            }
            await pump.catch(() => {});
        },
    };
}

/** One SDK message, as one or more transcript events. */
function translate(message, onEvent) {
    switch (message.type) {
        case 'system':
            if (message.subtype === 'init') {
                onEvent({ type: 'session', sessionId: message.session_id, model: message.model });
            }
            break;

        case 'stream_event': {
            const event = message.event;
            if (event?.type === 'content_block_delta') {
                if (event.delta?.type === 'text_delta') {
                    onEvent({ type: 'text-delta', text: event.delta.text });
                } else if (event.delta?.type === 'thinking_delta') {
                    onEvent({ type: 'thinking-delta', text: event.delta.thinking });
                }
            } else if (event?.type === 'content_block_start' && event.content_block?.type === 'thinking') {
                onEvent({ type: 'thinking-start' });
            }
            break;
        }

        case 'assistant': {
            const blocks = message.message?.content || [];
            const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('');
            if (text.trim()) onEvent({ type: 'assistant-text', text });
            for (const block of blocks) {
                if (block.type !== 'tool_use') continue;
                onEvent({
                    type: 'tool-call',
                    id: block.id,
                    name: localName(block.name) || block.name,
                    rawName: block.name,
                    // A question runs on nobody's machine, so it is not local
                    // in the sense the row means by it: the warning that comes
                    // with that word would be about a menu of two labels.
                    local: !localName(block.name) && block.name !== QUESTION_TOOL,
                    question: block.name === QUESTION_TOOL,
                    input: block.input,
                });
            }
            break;
        }

        case 'user': {
            const blocks = message.message?.content;
            if (!Array.isArray(blocks)) break;
            for (const block of blocks) {
                if (block.type !== 'tool_result') continue;
                onEvent({
                    type: 'tool-result',
                    id: block.tool_use_id,
                    isError: Boolean(block.is_error),
                    text: flattenResult(block.content),
                });
            }
            break;
        }

        // What a subscription actually spends: a share of the plan's window,
        // not dollars. Arrives unprompted whenever the figure moves.
        case 'rate_limit_event':
            onEvent({
                type: 'rate-limit',
                status: message.rate_limit_info?.status || '',
                window: message.rate_limit_info?.rateLimitType || '',
                utilization: message.rate_limit_info?.utilization ?? null,
                resetsAt: message.rate_limit_info?.resetsAt || 0,
            });
            break;

        case 'result':
            onEvent({
                type: 'result',
                subtype: message.subtype,
                isError: message.subtype !== 'success',
                text: message.result || '',
                costUsd: message.total_cost_usd || 0,
                usage: message.usage || null,
                turns: message.num_turns || 0,
                sessionId: message.session_id,
            });
            break;

        default:
            break;
    }
}

/** Tool results arrive as a string or as content blocks; the UI wants text. */
function flattenResult(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map(block => (block?.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n');
}

/**
 * Turn a failure into something worth showing.
 *
 * Authentication is the one worth naming: on a machine with no Claude Code
 * login and no key, everything else about the panel looks broken, and the fix
 * is one command the user can run.
 */
function describeFailure(error) {
    const text = String(error?.message || error || 'Unknown error');
    if (/auth|credential|api[_ -]?key|unauthor|log ?in|sign ?in/i.test(text)) {
        return 'Claude could not authenticate. Sign in with Claude Code (run "claude" in a terminal, then /login), '
            + 'or add an API key in the assistant settings.';
    }
    if (/ENOENT|not found|spawn/i.test(text)) {
        return 'The Claude Code CLI could not be started. Install Claude Code and check that "claude" runs '
            + `in a terminal, then try again. (${text})`;
    }
    return text;
}

/**
 * Whether this agent is on this machine, for the tick that switches it on.
 *
 * The same lookup `start` does, run before anything is switched on rather than
 * on the first message. Switching an agent on and finding out days later, in
 * the middle of a question, that it was never installed is the failure this
 * exists to stop: the tick either takes or says why, in the moment the person
 * is looking at the setting.
 *
 * No spawn and no network, only the fs walk `findClaude` already does, so this
 * is a few milliseconds and does not need a timeout.
 */
function detect() {
    return { ok: Boolean(findClaude()), reason: 'notFound' };
}

module.exports = {
    start,
    listModels,
    detect,
    findClaude,
    claudeCandidates,
    userContent,
    LOCAL_TOOLS,
    WEB_TOOLS,
    QUESTION_TOOL,
    questionAnswers,
    SERVER_NAME,
    // The SDK takes image blocks in a user turn, which is the whole of what
    // "attach a screenshot" needs. Codex takes them as files instead (see its
    // provider); the agents driven through a text prompt have no slot at all,
    // and the composer only offers the button where main says it works.
    supportsImages: true,
};
