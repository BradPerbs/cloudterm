const zodModule = require('zod');
const store = require('../store');
const ssh = require('../ssh');
const sftp = require('../sftp');
const transcript = require('../transcript');
const exec = require('./exec');
const terminalRun = require('./terminal-run');

// zod 4 exports both a namespace and a `z` binding depending on how it is
// reached. Taking either keeps this working whichever the installed build is.
const z = zodModule.z || zodModule;

/**
 * What the assistant can actually do.
 *
 * These are written once, in a neutral shape, and adapted by each provider:
 * Claude Code wants them as an in-process MCP server, and whatever comes next
 * will want JSON Schema and a loop of its own. Neither of those concerns
 * belongs in a file about what a tool does, so neither is in here.
 *
 * Two rules shape the whole set.
 *
 * The assistant never sees a credential. It asks for a session or a host by
 * id, and the main process resolves that to a connection the user already
 * opened with their own keys. There is no tool that returns a password, and
 * no tool that takes one. A model that is asked to "log in to the database"
 * has to do it the way a person would, through a shell that is already
 * authenticated.
 *
 * Every tool declares whether it only reads. That single flag is what the
 * approval policy is built on, so a tool added later is refused by default
 * until someone decides which side of that line it is on.
 */

/** How much of a remote file one read may return. */
const MAX_FILE_BYTES = 120000;

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/**
 * Whether the user has pinned this conversation to an explicit set of servers.
 *
 * The other two scopes are not fences. Following the session in front is a
 * default for calls that name none, and "all hosts" is the absence of a limit.
 * Only a set the user ticked is enforced here.
 */
function fenced(ctx) {
    return ctx?.scope === 'targets';
}

/**
 * Whether one session is inside the fence.
 *
 * Two ways in: the session itself was ticked, or the host behind it was. The
 * second is what makes a pinned host mean the machine rather than one terminal
 * on it, and it is also what lets `connect_host` be useful: the session it
 * opens did not exist when the user was ticking boxes, and it has to be usable
 * the moment it does.
 */
function sessionInScope(ctx, sessionId) {
    if (!fenced(ctx)) return true;
    if (ctx.sessionIds.includes(sessionId)) return true;
    const info = transcript.info(sessionId);
    return Boolean(info?.hostId && ctx.hostIds.includes(info.hostId));
}

function hostInScope(ctx, hostId) {
    if (!fenced(ctx)) return true;
    if (ctx.hostIds.includes(hostId)) return true;
    // The host behind a pinned session, so a session opened from the Hosts page
    // does not leave its own host unnameable.
    return ctx.sessionIds.some(id => transcript.info(id)?.hostId === hostId);
}

/** What is inside the fence, named the way the tools take it. */
function scopeSummary(ctx) {
    const open = transcript.list().filter(session => sessionInScope(ctx, session.sessionId));
    const parts = open.map(session => `${session.sessionId} (${session.hostName || session.address})`);
    for (const hostId of ctx.hostIds) {
        if (open.some(session => session.hostId === hostId)) continue;
        parts.push(`host ${hostId} (not connected)`);
    }
    return parts.join(', ') || 'nothing that is currently open';
}

/** The refusal, written so the model's next move is a correct one. */
function outOfScope(ctx, what) {
    return `${what} is outside the set the user pinned this conversation to. `
        + `In scope: ${scopeSummary(ctx)}. `
        + 'Do not try to reach anything else; if the task needs it, say so and let the user widen the scope.';
}

/**
 * Which session a call is about.
 *
 * A tool may name one explicitly. When it does not, the session the panel is
 * pinned to is used, which is what makes "restart nginx" mean the obvious
 * thing while looking at a server. With neither, the error lists what is open
 * rather than just saying no: the model's next move should be to pick one, and
 * it needs the ids to do that.
 *
 * A pinned set is enforced here, which is the one place every tool that touches
 * a server passes through. Two servers ticked in the menu is a promise the app
 * keeps, not an instruction the model agrees to and then forgets six calls
 * later.
 */
function resolveSession(input, ctx) {
    const requested = input?.session ? String(input.session) : '';
    const chosen = requested || ctx.boundSessionId || '';

    if (!chosen) {
        const open = transcript.list().filter(session => sessionInScope(ctx, session.sessionId));
        if (open.length === 0) {
            return fenced(ctx)
                ? { error: `Nothing in scope is open. In scope: ${scopeSummary(ctx)}.` }
                : { error: 'No sessions are open. Ask the user to connect to a host, or use connect_host.' };
        }
        return {
            error: 'This call needs a session id. Open sessions: '
                + open.map(s => `${s.sessionId} (${s.hostName || s.address})`).join(', '),
        };
    }

    if (!sessionInScope(ctx, chosen)) {
        return { error: outOfScope(ctx, `Session "${chosen}"`) };
    }

    const info = transcript.info(chosen);
    if (!info) {
        return { error: `There is no open session with the id "${chosen}". Call list_sessions for the current list.` };
    }
    return { sessionId: chosen, info };
}

function ok(payload) {
    return { text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) };
}

function fail(message) {
    return { text: message, isError: true };
}

/**
 * An SFTP call, with the two failure shapes reconciled.
 *
 * `withSftp` answers with its own `{ success, message }` when the subsystem
 * could not be opened at all, which is not a tool result and would otherwise
 * reach the model as an empty success: the worst possible reading of "the
 * connection is dead".
 */
async function viaSftp(sessionId, fn) {
    const result = await sftp.withSftp(sessionId, fn);
    if (result && typeof result.text === 'string') return result;
    return fail(result?.message || 'SFTP could not be opened on that session.');
}

/**
 * Whether a saved host has a shell behind it.
 *
 * A record stored as `desktop.only` does not: it is an RDP or VNC box, usually
 * a Windows one with no SSH server, and connecting to it opens a picture of a
 * screen rather than a session anything here can act on. Every tool in this
 * file works through a shell, so such a host is somewhere the assistant can
 * read about but not work on.
 */
function hasShell(host) {
    return !(host?.desktop?.enabled && host.desktop.only);
}

/** A saved host, with everything the assistant has no business seeing gone. */
function publicHost(host) {
    return {
        id: host.id,
        name: host.name,
        protocol: host.protocol || 'ssh',
        // Named as it is on an open session, and meaning the same thing: a
        // target with no shell is a target no command can be run on.
        canRunCommands: hasShell(host),
        address: host.protocol === 'serial'
            ? (host.serial?.path || '')
            : [host.host, host.port].filter(Boolean).join(':'),
        username: host.username || '',
        authMethod: host.authMethod || '',
        tags: host.tags || [],
        folderId: host.folderId || '',
        os: host.os || '',
        distro: host.distro || '',
        viaJumpHost: Boolean(host.jumpHostId),
        viaProxy: Boolean(host.proxyId),
        lastConnectedAt: host.lastConnectedAt || 0,
    };
}

/* ------------------------------------------------------------------ *
 * The catalog
 * ------------------------------------------------------------------ */

const TOOLS = [
    {
        name: 'list_hosts',
        title: 'List saved hosts',
        readOnly: true,
        description:
            'List the hosts saved in this SSH client, with their names, addresses, tags and folders. '
            + 'Use this to find the id of a host before connecting to it, or to answer questions about '
            + 'what infrastructure the user has. A host with canRunCommands false is a remote desktop '
            + 'with no shell behind it: it is part of their estate and you can talk about it, but you '
            + 'cannot connect to it or run anything on it. Never returns passwords or keys.',
        shape: {
            query: z.string().optional().describe('Filter by name, address, or tag. Omit to list everything.'),
            limit: z.number().int().min(1).max(500).optional().describe('Maximum hosts to return. Defaults to 200.'),
        },
        handler: async (input, ctx) => {
            const hosts = await store.getHosts();
            const folders = await store.getFolders();
            const folderName = new Map(folders.map(folder => [folder.id, folder.name]));

            // A pinned conversation sees the hosts it was pinned to and no
            // others. Returning the whole estate would be a list of machines
            // that every other tool then refuses, which reads as a bug rather
            // than as a boundary.
            const reachable = hosts.filter(host => hostInScope(ctx, host.id));

            const needle = String(input.query || '').trim().toLowerCase();
            const matched = reachable.filter((host) => {
                if (!needle) return true;
                const haystack = [
                    host.name, host.host, host.username,
                    ...(host.tags || []),
                    folderName.get(host.folderId) || '',
                ].join(' ').toLowerCase();
                return haystack.includes(needle);
            });

            const limit = input.limit || 200;
            return ok({
                total: matched.length,
                returned: Math.min(matched.length, limit),
                scoped: fenced(ctx) || undefined,
                note: fenced(ctx)
                    ? 'Only the hosts the user pinned this conversation to are listed.'
                    : undefined,
                hosts: matched.slice(0, limit).map(host => ({
                    ...publicHost(host),
                    folder: folderName.get(host.folderId) || '',
                })),
            });
        },
    },

    {
        name: 'list_sessions',
        title: 'List open sessions',
        readOnly: true,
        description:
            'List the terminal sessions currently open in the app. Each has a session id, which every '
            + 'other tool uses to say which server to act on. The session marked "current" is the one '
            + 'the user is looking at.',
        shape: {},
        handler: async (input, ctx) => {
            const open = transcript.list().filter(session => sessionInScope(ctx, session.sessionId));
            return ok({
                count: open.length,
                current: ctx.boundSessionId || null,
                scoped: fenced(ctx) || undefined,
                note: fenced(ctx)
                    ? 'Only the sessions the user pinned this conversation to are listed. '
                        + 'Other terminals may be open; they are not yours to use.'
                    : undefined,
                sessions: open.map(session => ({
                    ...session,
                    current: session.sessionId === ctx.boundSessionId,
                    canRunCommands: Boolean(ssh.sessions.get(session.sessionId)?.client),
                })),
            });
        },
    },

    {
        name: 'read_terminal',
        title: 'Read terminal output',
        readOnly: true,
        description:
            'Read what a session recently printed on screen, as plain text with the colour codes '
            + 'stripped. This is the fastest way to understand what the user is looking at, what they '
            + 'just ran, and what error they are asking about. Read this before asking them to paste '
            + 'anything.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            lines: z.number().int().min(1).max(2000).optional().describe('How many trailing lines to return.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            const result = transcript.read(resolved.sessionId, {
                lines: input.lines || ctx.settings.transcriptLines,
            });
            if (!result.available) return fail('That session has no output recorded yet.');
            if (!result.text.trim()) return ok('The session has produced no output yet.');

            return ok(
                `Terminal output for ${resolved.info.hostName || resolved.info.address}`
                + `${result.truncated ? ' (trimmed to the most recent output)' : ''}:\n\n${result.text}`
            );
        },
    },

    {
        name: 'run_command',
        title: 'Run a command',
        readOnly: false,
        description:
            'Run a shell command on a session\'s server. By default it is typed into the terminal the '
            + 'user is watching, so they see it happen and the output stays in their scrollback, and it '
            + 'returns what appeared on screen. It is not interactive: a command that stops to ask '
            + 'something will sit there until the timeout, so pass flags like -y, and use send_input to '
            + 'answer a prompt that is already waiting. Prefer one command per call so failures are '
            + 'attributable. Set background: true only when the output is for you rather than for them, '
            + 'such as a quick probe you are about to act on; that runs on a separate channel, returns a '
            + 'real exit code, and they see nothing.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            command: z.string().min(1).describe('The command to run, exactly as it would be typed.'),
            background: z.boolean().optional().describe('Run out of sight on a separate channel instead of in the user\'s terminal. Returns an exit code. Defaults to the user\'s own setting.'),
            cwd: z.string().optional().describe('Directory to run in. Background calls each start a fresh shell, so a cd in one does not carry to the next.'),
            timeoutSeconds: z.number().int().min(1).max(600).optional().describe('How long to allow before giving up on it. Defaults to 60.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            const timeout = (input.timeoutSeconds || 60) * 1000;
            const background = input.background === undefined
                ? ctx.settings.commandMode === 'background'
                : input.background;

            if (!background) {
                const result = await terminalRun.run(resolved.sessionId, input.command, {
                    timeout,
                    sessionAction: ctx.sessionAction,
                });
                if (!result.success) return fail(result.message);

                // No exit code on this path: a PTY does not carry one. Saying
                // so is better than leaving the model to infer success from
                // output that happens to look calm.
                const parts = [result.output || '(no output)'];
                if (!result.completed) parts.push(result.note);
                else parts.push('(the shell returned to a prompt; a PTY carries no exit code, '
                    + 'so judge the result from the output)');

                return ok(parts.filter(Boolean).join('\n\n'));
            }

            const result = await exec.run(resolved.sessionId, input.command, {
                timeout,
                cwd: input.cwd || '',
            });

            if (!result.success) {
                return fail(result.message + (result.stdout ? `\n\nOutput before it stopped:\n${result.stdout}` : ''));
            }

            const parts = [`exit code: ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ''}`];
            if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
            if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
            if (!result.stdout && !result.stderr) parts.push('(no output)');
            if (result.truncated) parts.push('(output was trimmed to its most recent portion)');

            // A non-zero exit is reported as a normal result rather than an
            // error. It is information, and very often the answer: flagging it
            // as a tool failure invites a retry of something that worked.
            return ok(parts.join('\n\n'));
        },
    },

    {
        name: 'send_input',
        title: 'Type into the terminal',
        readOnly: false,
        description:
            'Type text into the terminal the user is watching, as if they had typed it, then return '
            + 'whatever appeared on screen afterwards. Use this only when run_command will not do: '
            + 'answering a prompt that is already waiting, driving an interactive program, or when the '
            + 'user should see the command land in their own shell. This does go into their shell '
            + 'history and does disturb anything half-typed at the prompt.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            text: z.string().describe('The text to type.'),
            submit: z.boolean().optional().describe('Press Enter after the text. Defaults to true.'),
            waitMs: z.number().int().min(0).max(30000).optional().describe('How long to wait before reading the screen back. Defaults to 1500.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            const session = ssh.sessions.get(resolved.sessionId);
            const mark = transcript.cursor(resolved.sessionId);
            const payload = input.text + (input.submit === false ? '' : '\n');

            // SSH writes to the shell stream directly. Other transports are
            // reached through the renderer, which owns their input path.
            if (session?.stream?.writable) {
                session.stream.write(payload);
            } else {
                const delivered = await ctx.sessionAction({
                    action: 'input',
                    sessionId: resolved.sessionId,
                    data: payload,
                });
                if (!delivered?.success) {
                    return fail(delivered?.message || 'That session could not accept input.');
                }
            }

            const wait = input.waitMs === undefined ? 1500 : input.waitMs;
            if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));

            const after = transcript.read(resolved.sessionId, { since: mark, lines: ctx.settings.transcriptLines });
            return ok(
                `Sent. What appeared on screen after it:\n\n${after.text || '(nothing yet)'}`
                + '\n\nIf that looks incomplete, the command may still be running. Read the terminal again rather than sending it twice.'
            );
        },
    },

    {
        name: 'list_directory',
        title: 'List a directory',
        readOnly: true,
        description:
            'List a directory on a session\'s server over SFTP, with sizes, permissions and modified '
            + 'times. Use this instead of running ls when you want structured results.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            path: z.string().describe('Absolute path to list. Use "." for the login directory.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            const target = input.path === '.' || !input.path
                ? (await sftp.home(resolved.sessionId))?.path || '.'
                : input.path;

            const result = await sftp.list(resolved.sessionId, target);
            if (!result.success) return fail(result.message || 'That directory could not be listed.');

            return ok({
                path: target,
                entries: (result.files || []).map(entry => ({
                    name: entry.name,
                    type: entry.isDirectory ? 'directory' : entry.isSymlink ? 'symlink' : 'file',
                    size: entry.size,
                    permissions: entry.permissions || entry.mode,
                    modifiedAt: entry.modifiedAt || entry.mtime,
                })),
            });
        },
    },

    {
        name: 'read_file',
        title: 'Read a remote file',
        readOnly: true,
        description:
            'Read a text file from a session\'s server over SFTP. Use this for config files and logs '
            + 'rather than running cat, because it returns the file cleanly and tells you when it was '
            + 'trimmed. Reads with the same access the user already has on that server.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            path: z.string().describe('Absolute path to the file.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            return viaSftp(resolved.sessionId, (handle, resolve) => {
                handle.stat(input.path, (statError, attrs) => {
                    if (statError) {
                        resolve(fail(`Could not read ${input.path}: ${statError.message}`));
                        return;
                    }
                    if (attrs.size > MAX_FILE_BYTES * 8) {
                        resolve(fail(
                            `${input.path} is ${Math.round(attrs.size / 1024)} KB, which is too large to read whole. `
                            + 'Use run_command with tail, head or grep to get the part you need.'
                        ));
                        return;
                    }
                    handle.readFile(input.path, (readError, data) => {
                        if (readError) {
                            resolve(fail(`Could not read ${input.path}: ${readError.message}`));
                            return;
                        }
                        const text = data.toString('utf8');
                        const trimmed = text.length > MAX_FILE_BYTES;
                        resolve(ok(
                            `${input.path}${trimmed ? ' (first part only)' : ''}:\n\n`
                            + (trimmed ? text.slice(0, MAX_FILE_BYTES) : text)
                        ));
                    });
                });
            });
        },
    },

    {
        name: 'write_file',
        title: 'Write a remote file',
        readOnly: false,
        description:
            'Write a text file on a session\'s server over SFTP, replacing it if it exists. Read the '
            + 'file first so you are not discarding something you have not seen, and say in your reply '
            + 'what you changed. For a config file that matters, copy it to a .bak first with '
            + 'run_command.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            path: z.string().describe('Absolute path to write.'),
            content: z.string().describe('The complete new contents of the file.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            return viaSftp(resolved.sessionId, (handle, resolve) => {
                handle.writeFile(input.path, input.content, { encoding: 'utf8' }, (error) => {
                    if (error) {
                        resolve(fail(`Could not write ${input.path}: ${error.message}`));
                        return;
                    }
                    resolve(ok(`Wrote ${Buffer.byteLength(input.content)} bytes to ${input.path}.`));
                });
            });
        },
    },

    {
        name: 'connect_host',
        title: 'Connect to a host',
        readOnly: false,
        description:
            'Open a new terminal session to a saved host, in a new tab in the app. Returns the new '
            + 'session id once it is connected, which you can then use with the other tools. Use '
            + 'list_hosts first to find the host id. Connecting uses the credentials the user already '
            + 'saved; you never see or supply them.',
        shape: {
            hostId: z.string().describe('The id of a saved host, from list_hosts.'),
        },
        handler: async (input, ctx) => {
            const hosts = await store.getHosts();
            const host = hosts.find(entry => entry.id === input.hostId);
            if (!host) return fail(`There is no saved host with the id "${input.hostId}". Call list_hosts for the current list.`);

            // Both checks come before the connection rather than after: a
            // session opened out of scope, or into a desktop nothing can be run
            // on, has already put a tab on the user's screen by the time the
            // next tool call refuses it.
            if (!hostInScope(ctx, host.id)) {
                return fail(outOfScope(ctx, `The host "${host.name || host.id}"`));
            }

            if (!hasShell(host)) {
                return fail(
                    `"${host.name || host.id}" is a remote desktop with no shell behind it, so there is `
                    + 'nothing here that can act on it. Connecting would open a screen the user has to '
                    + 'drive themselves. Tell them that rather than trying another way in.'
                );
            }

            const result = await ctx.sessionAction({ action: 'connect', hostId: host.id, hostName: host.name });
            if (!result?.success) {
                return fail(result?.message || `Could not connect to ${host.name}.`);
            }
            return ok({
                connected: true,
                sessionId: result.sessionId,
                host: publicHost(host),
                note: 'Use this session id with the other tools.',
            });
        },
    },

    {
        name: 'disconnect_session',
        title: 'Disconnect a session',
        readOnly: false,
        description:
            'Close an open terminal session. Only do this when the user has asked for it: a session '
            + 'may be holding work they have not finished.',
        shape: {
            session: z.string().describe('Session id to close.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            const result = await ctx.sessionAction({ action: 'disconnect', sessionId: resolved.sessionId });
            if (!result?.success) return fail(result?.message || 'That session could not be closed.');
            return ok(`Closed the session on ${resolved.info.hostName || resolved.info.address}.`);
        },
    },
];

const BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]));

/**
 * Whether a call can go ahead without asking, under the current policy.
 *
 * A tool the catalog does not know is never auto-approved. That is the case
 * that matters: it is what happens when a tool is added and this function is
 * not revisited, and the safe answer is to ask.
 */
function isAutoApproved(toolName, input, settings) {
    if (settings.approval === 'never') return true;
    if (settings.approval === 'always') return false;

    const tool = BY_NAME.get(toolName);
    if (!tool) return false;
    if (tool.readOnly) return true;

    // A command whose leading words are on the safe list is a read wearing a
    // shell's clothing, and making someone approve `ls` teaches them to
    // approve without looking.
    if (toolName === 'run_command') {
        const command = String(input?.command || '').trim().toLowerCase();
        // Anything chained or redirected is judged as a whole rather than by
        // its first word, because `ls; rm -rf /` starts with `ls`.
        if (/[;&|><`$(]/.test(command)) return false;
        return settings.autoApproveCommands.some(prefix => (
            command === prefix || command.startsWith(`${prefix} `)
        ));
    }

    return false;
}

module.exports = {
    TOOLS,
    BY_NAME,
    isAutoApproved,
    resolveSession,
    sessionInScope,
    hostInScope,
    publicHost,
};
