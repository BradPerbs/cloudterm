const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const spawn = require('cross-spawn');
const { app } = require('electron');

const catalog = require('../tools');
const mcpHost = require('../mcp-host');

/**
 * The OpenCode provider.
 *
 * OpenCode exposes its agent as a loopback HTTP server. We start the user's
 * installed CLI, connect with the official SDK, and translate its SSE stream
 * into the same transcript events as Claude Code and Codex.
 *
 * Its own filesystem and shell tools are denied unless the app's local-tools
 * switch is on. The remote tools are served by `mcp-host`, whose handlers own
 * the approval policy, live SSH sessions, and activity log.
 */

const SERVER_NAME = 'remote';
const START_TIMEOUT = 20000;

let sdkPromise = null;

function loadSdk() {
    if (!sdkPromise) {
        sdkPromise = import('@opencode-ai/sdk').catch((error) => {
            sdkPromise = null;
            throw new Error(`The OpenCode SDK could not be loaded: ${error.message}`);
        });
    }
    return sdkPromise;
}

function envValue(env, ...names) {
    for (const name of names) {
        if (env?.[name]) return env[name];
    }
    return '';
}

/** Every native location supported by OpenCode's Windows installers. */
function openCodeCandidates({
    platform = process.platform,
    env = process.env,
    home = os.homedir(),
} = {}) {
    const windows = platform === 'win32';
    const paths = windows ? path.win32 : path;
    const names = windows ? ['opencode.exe', 'opencode.cmd', 'opencode.bat'] : ['opencode'];
    const pathEntries = String(envValue(env, 'PATH', 'Path', 'path'))
        .split(windows ? ';' : path.delimiter)
        .filter(Boolean);
    const roots = [...pathEntries];

    if (windows) {
        const appData = envValue(env, 'APPDATA', 'AppData');
        const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData');
        const chocolatey = envValue(env, 'ChocolateyInstall', 'CHOCOLATEYINSTALL');
        const scoop = envValue(env, 'SCOOP', 'Scoop') || paths.join(home, 'scoop');

        roots.push(
            paths.join(home, '.opencode', 'bin'),
            paths.join(scoop, 'shims'),
            appData && paths.join(appData, 'npm'),
            localAppData && paths.join(localAppData, 'opencode', 'bin'),
            localAppData && paths.join(localAppData, 'Programs', 'opencode', 'bin'),
            chocolatey && paths.join(chocolatey, 'bin')
        );
    } else {
        roots.push(
            paths.join(home, '.opencode', 'bin'),
            paths.join(home, '.local', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
            '/usr/bin'
        );
    }

    return [...new Set(roots.filter(Boolean).flatMap(root => names.map(name => paths.join(root, name))))];
}

/** Find the CLI even when a packaged Electron app has a minimal PATH. */
function findOpenCode(options = {}) {
    const platform = options.platform || process.platform;
    const accessSync = options.accessSync || fs.accessSync;
    const candidates = openCodeCandidates({
        platform,
        env: options.env || process.env,
        home: options.home || os.homedir(),
    });

    for (const candidate of candidates) {
        try {
            accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
            return candidate;
        } catch {
            // Keep looking.
        }
    }
    return '';
}

/** OpenCode model ids are always `provider/model`, with model allowed slashes. */
function parseModel(value) {
    const text = String(value || '');
    const split = text.indexOf('/');
    if (split <= 0 || split === text.length - 1) return undefined;
    return { providerID: text.slice(0, split), modelID: text.slice(split + 1) };
}

/**
 * The last matching OpenCode permission wins. Deny/ask everything first,
 * then allow only our MCP namespace: its real approval happens in mcp-host.
 */
function permissions(allowLocalTools) {
    return {
        '*': allowLocalTools ? 'ask' : 'deny',
        [`${SERVER_NAME}_*`]: 'allow',
    };
}

function serverConfig({ url, token, allowLocalTools = false, maxTurns = 40 } = {}) {
    const permission = permissions(allowLocalTools);
    return {
        share: 'disabled',
        autoupdate: false,
        instructions: [],
        plugin: [],
        permission,
        // Kept for OpenCode versions predating the unified permission field.
        tools: allowLocalTools ? undefined : {
            '*': false,
            [`${SERVER_NAME}_*`]: true,
        },
        agent: {
            cloudblast: {
                description: 'Operate the remote systems visible in CloudBlast SSH.',
                mode: 'primary',
                maxSteps: maxTurns,
                permission,
            },
        },
        ...(url ? {
            mcp: {
                [SERVER_NAME]: {
                    type: 'remote',
                    url,
                    headers: { Authorization: `Bearer ${token}` },
                    oauth: false,
                    timeout: 20000,
                },
            },
        } : {}),
    };
}

function reservePort() {
    return new Promise((resolve, reject) => {
        const socket = net.createServer();
        socket.unref();
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', () => {
            const port = socket.address().port;
            socket.close(error => (error ? reject(error) : resolve(port)));
        });
    });
}

/** Spawn one private OpenCode server and wait until it publishes its URL. */
async function launchServer(binary, config, directory) {
    const port = await reservePort();
    return new Promise((resolve, reject) => {
        let child;
        let timer;
        let settled = false;
        let output = '';

        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) {
                closeProcess(child);
                reject(error);
            } else {
                resolve(value);
            }
        };

        timer = setTimeout(() => {
            finish(new Error(`OpenCode did not start within ${START_TIMEOUT / 1000} seconds`));
        }, START_TIMEOUT);

        try {
            child = spawn(binary, ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
                cwd: directory,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
                },
            });
        } catch (error) {
            finish(error);
            return;
        }

        const read = (chunk) => {
            output = `${output}${chunk.toString('utf8')}`.slice(-16000);
            const match = output.match(/opencode server listening[^\n]*on\s+(https?:\/\/[^\s]+)/i);
            if (match) finish(null, { child, url: match[1] });
        };

        child.stdout.on('data', read);
        child.stderr.on('data', read);
        child.once('error', error => finish(error));
        child.once('exit', (code) => {
            if (!settled) {
                const detail = output.trim() ? `: ${output.trim().slice(-1000)}` : '';
                finish(new Error(`OpenCode exited before it was ready (code ${code})${detail}`));
            }
        });
    });
}

function dataOf(response) {
    return response && Object.prototype.hasOwnProperty.call(response, 'data')
        ? response.data
        : response;
}

function closeProcess(child, {
    platform = process.platform,
    spawnSyncFn = spawnSync,
} = {}) {
    if (!child || child.exitCode != null || child.signalCode != null) return;

    // A .cmd npm shim owns the actual OpenCode process beneath cmd.exe.
    // Killing only the shim leaves the server listening after CloudBlast
    // closes, so Windows gets the same whole-tree shutdown OpenCode's SDK uses.
    if (platform === 'win32' && child.pid) {
        const result = spawnSyncFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
        });
        if (!result.error && result.status === 0) return;
    }
    try { child.kill(); } catch { /* already gone */ }
}

/** Turn one OpenCode SSE event into panel events, with transition deduping. */
function createTranslator(sessionId, onEvent) {
    const textFinished = new Set();
    const toolStates = new Map();
    const completedMessages = new Set();
    let turnOpen = false;
    let turnCost = 0;

    const belongs = (value) => value === sessionId;
    const toolName = raw => String(raw || '').replace(new RegExp(`^${SERVER_NAME}_`), '');

    const finishTurn = (subtype = 'success', isError = false) => {
        if (!turnOpen) return;
        turnOpen = false;
        onEvent({ type: 'result', subtype, isError, costUsd: turnCost });
        turnCost = 0;
    };

    const failTurn = (error) => {
        onEvent({ type: 'error', message: describeFailure(error) });
        turnOpen = false;
        turnCost = 0;
    };

    return {
        beginTurn() {
            turnOpen = true;
            turnCost = 0;
        },
        fail(error) {
            failTurn(error);
        },
        finish: finishTurn,
        async event(event, answerPermission) {
            const properties = event?.properties || {};

            if (event?.type === 'message.part.updated') {
                const part = properties.part;
                if (!part || !belongs(part.sessionID)) return;

                if (part.type === 'text') {
                    if (properties.delta) onEvent({ type: 'text-delta', text: properties.delta });
                    if (part.time?.end && !part.synthetic && !part.ignored && !textFinished.has(part.id)) {
                        textFinished.add(part.id);
                        onEvent({ type: 'assistant-text', text: part.text || '' });
                    }
                    return;
                }

                if (part.type === 'reasoning') {
                    if (properties.delta) onEvent({ type: 'thinking-delta', text: properties.delta });
                    return;
                }

                if (part.type !== 'tool') return;
                const state = part.state || {};
                const previous = toolStates.get(part.callID);
                const local = !String(part.tool || '').startsWith(`${SERVER_NAME}_`);

                if (!['running', 'completed', 'error'].includes(previous)
                    && ['running', 'completed', 'error'].includes(state.status)) {
                    onEvent({
                        type: 'tool-call',
                        id: part.callID,
                        name: toolName(part.tool),
                        rawName: part.tool,
                        local,
                        input: state.input || {},
                    });
                }

                if (!['completed', 'error'].includes(previous)
                    && ['completed', 'error'].includes(state.status)) {
                    onEvent({
                        type: 'tool-result',
                        id: part.callID,
                        text: state.status === 'error' ? (state.error || '') : (state.output || ''),
                        isError: state.status === 'error',
                    });
                }
                toolStates.set(part.callID, state.status);
                return;
            }

            if (event?.type === 'message.updated') {
                const info = properties.info;
                if (!info || !belongs(info.sessionID) || info.role !== 'assistant' || !info.time?.completed) return;
                if (!completedMessages.has(info.id)) {
                    completedMessages.add(info.id);
                    turnCost += Number(info.cost) || 0;
                }
                if (info.error) {
                    onEvent({ type: 'error', message: describeFailure(info.error) });
                }
                return;
            }

            if (event?.type === 'permission.updated' && belongs(properties.sessionID)) {
                await answerPermission(properties);
                return;
            }

            if (event?.type === 'session.error' && (!properties.sessionID || belongs(properties.sessionID))) {
                failTurn(properties.error);
                return;
            }

            if ((event?.type === 'session.idle' && belongs(properties.sessionID))
                || (event?.type === 'session.status'
                    && belongs(properties.sessionID)
                    && properties.status?.type === 'idle')) {
                finishTurn();
            }
        },
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
    const binary = findOpenCode();
    if (!binary) {
        throw new Error('OpenCode is not installed on this machine, or its CLI could not be found');
    }

    const directory = app.getPath('userData');
    const { url: mcpUrl, token } = await mcpHost.acquire({ toolContext, requestApproval, onEvent });
    let server;

    try {
        server = await launchServer(binary, serverConfig({
            url: mcpUrl,
            token,
            allowLocalTools: settings.allowLocalTools,
            maxTurns: settings.maxTurns,
        }), directory);
    } catch (error) {
        await mcpHost.release();
        throw error;
    }

    let sdk;
    let client;
    let session;
    try {
        sdk = await loadSdk();
        client = sdk.createOpencodeClient({
            baseUrl: server.url,
            directory,
            throwOnError: true,
        });

        if (resumeSessionId) {
            try {
                session = dataOf(await client.session.get({ path: { id: resumeSessionId } }));
            } catch {
                // A stale id should start a usable conversation, not brick it.
            }
        }
        if (!session) {
            session = dataOf(await client.session.create({
                body: { title: 'CloudBlast SSH' },
            }));
        }
    } catch (error) {
        closeProcess(server.child);
        await mcpHost.release();
        throw error;
    }
    if (!session?.id) {
        closeProcess(server.child);
        await mcpHost.release();
        throw new Error('OpenCode started but did not create a session');
    }

    onEvent({ type: 'session', sessionId: session.id, model: settings.model || '' });
    const translator = createTranslator(session.id, onEvent);
    const abortEvents = new AbortController();

    const answerPermission = async (permission) => {
        const current = getSettings();
        const remote = String(permission.type || '').startsWith(`${SERVER_NAME}_`);
        let approved = remote;
        if (!remote && current.allowLocalTools) {
            const verdict = await requestApproval({
                toolName: permission.type || permission.title || 'tool',
                name: permission.type || 'tool',
                input: {
                    ...(permission.metadata || {}),
                    ...(permission.pattern ? { pattern: permission.pattern } : {}),
                },
                local: true,
            });
            approved = verdict.approved;
        }
        try {
            await client.postSessionIdPermissionsPermissionId({
                path: { id: session.id, permissionID: permission.id },
                body: { response: approved ? 'once' : 'reject' },
            });
        } catch (error) {
            if (!abortEvents.signal.aborted) onEvent({ type: 'error', message: describeFailure(error) });
        }
    };

    let events;
    try {
        events = await client.event.subscribe({ signal: abortEvents.signal });
    } catch (error) {
        abortEvents.abort();
        closeProcess(server.child);
        await mcpHost.release();
        throw error;
    }
    const pump = (async () => {
        try {
            for await (const event of events.stream) {
                await translator.event(event, answerPermission);
            }
        } catch (error) {
            if (!abortEvents.signal.aborted) translator.fail(error);
        }
    })();

    let running = Promise.resolve();
    let closed = false;

    const turn = async (text) => {
        translator.beginTurn();
        const current = getSettings();
        const model = parseModel(current.model);
        try {
            await client.session.prompt({
                path: { id: session.id },
                body: {
                    agent: 'cloudblast',
                    system: systemPrompt,
                    ...(model ? { model } : {}),
                    parts: [{ type: 'text', text }],
                },
            });
        } catch (error) {
            if (!closed) translator.fail(error);
        }
    };

    return {
        send(text) {
            running = running.then(() => turn(text));
        },
        // Both are read from settings when the next prompt starts.
        async setModel() {},
        async setEffort() {},
        async interrupt() {
            translator.finish();
            try {
                await client.session.abort({ path: { id: session.id } });
            } catch {
                // Already idle or the server has gone away.
            }
        },
        async close() {
            closed = true;
            abortEvents.abort();
            try { await client.session.abort({ path: { id: session.id } }); } catch { /* idle */ }
            await running.catch(() => {});
            closeProcess(server.child);
            await pump.catch(() => {});
            await mcpHost.release();
        },
    };
}

/** Ask a short-lived local server for the providers/models OpenCode can use. */
async function listModels() {
    const binary = findOpenCode();
    if (!binary) return null;

    const directory = app.getPath('userData');
    const server = await launchServer(binary, serverConfig(), directory);
    try {
        const sdk = await loadSdk();
        const client = sdk.createOpencodeClient({
            baseUrl: server.url,
            directory,
            throwOnError: true,
        });
        const response = dataOf(await client.config.providers());
        const rows = [];

        for (const provider of response?.providers || []) {
            for (const model of Object.values(provider.models || {})) {
                if (!model?.id || model.status === 'deprecated') continue;
                const value = `${provider.id}/${model.id}`;
                rows.push({
                    value,
                    resolved: value,
                    label: model.name ? `${model.name} · ${provider.name}` : value,
                    short: model.name || model.id,
                    description: `${provider.name}${model.capabilities?.reasoning ? ' · reasoning' : ''}`,
                    preferred: false,
                    // OpenCode variants are model-specific, but the stable SDK
                    // does not publish them yet. Hiding the effort control is
                    // more honest than offering variants a model may not have.
                    effort: [],
                });
            }
        }

        rows.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.label.localeCompare(b.label));
        return rows.slice(0, 100);
    } finally {
        closeProcess(server.child);
    }
}

function describeFailure(error) {
    const message = error?.data?.message || error?.message || String(error || 'Unknown error');
    if (/auth|credential|api[_ -]?key|unauthor|401|provider.*not found/i.test(message)) {
        return 'OpenCode could not authenticate with the selected model provider. Run "opencode auth login" '
            + 'in a terminal, then try again.';
    }
    if (/ENOENT|not found|spawn/i.test(message)) {
        return 'The OpenCode CLI could not be started. Install OpenCode and make sure its executable is available.';
    }
    return message;
}

/** Whether the CLI is on this machine. See the note on claude-code's. */
function detect() {
    return { ok: Boolean(findOpenCode()), reason: 'notFound' };
}

module.exports = {
    start,
    listModels,
    detect,
    findOpenCode,
    openCodeCandidates,
    parseModel,
    permissions,
    serverConfig,
    createTranslator,
    SERVER_NAME,
    _test: { launchServer, closeProcess },
};
