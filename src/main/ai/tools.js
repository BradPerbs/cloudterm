const zodModule = require('zod');
const store = require('../store');
const ssh = require('../ssh');
const sftp = require('../sftp');
const transcript = require('../transcript');
const exec = require('./exec');
const terminalRun = require('./terminal-run');
const fileText = require('./file-text');
const snippetConfig = require('../snippet-config');

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
 * A stretch of a file read by line, with a header saying which lines these
 * are and how long the file is, so the next read can start where this one
 * stopped. Asking past the end says so rather than coming back empty.
 */
function describeSlice(file, slice) {
    if (slice.past) {
        return slice.lines !== undefined
            ? `${file} has ${slice.lines} line${slice.lines === 1 ? '' : 's'}, so there is nothing from line ${slice.from}.`
            : `Line ${slice.from} of ${file} is further in than a read by line goes `
                + `(${Math.round(fileText.MAX_SCAN_BYTES / 1048576)} MB). Use run_command with tail or sed -n to reach it.`;
    }

    const notes = [];
    if (slice.trimmed) notes.push(`cut to what one read returns; carry on from line ${slice.to + 1}`);
    else if (slice.scanLimit) notes.push(`stopped ${Math.round(fileText.MAX_SCAN_BYTES / 1048576)} MB in; carry on from line ${slice.to + 1}`);

    const of = slice.lines !== undefined ? ` of ${slice.lines}` : '';
    return `${file}, lines ${slice.from}-${slice.to}${of}${notes.length ? ` (${notes.join('; ')})` : ''}:\n\n${slice.content}`;
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

/** The kinds `snippet-config` stores, in the order its editor offers them. */
const SNIPPET_KINDS = ['command', 'package', 'spec'];

/** A snippet as a list shows it: what it is, not its text. */
function publicSnippet(snippet) {
    return {
        id: snippet.id,
        name: snippet.name,
        kind: snippet.kind,
        description: snippet.description || '',
        tags: snippet.tags || [],
        // Empty means every host.
        hostIds: snippet.hostIds || [],
        steps: snippet.kind === 'package' ? (snippet.steps || []).length : undefined,
        length: snippet.kind === 'package' ? undefined : String(snippet.command || '').length,
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

            // Checked here as well as at the approval gate. The gate is what
            // keeps a pointless card off the screen; this is what makes the
            // rule true, because every provider reaches a server through this
            // function and one that forgot the gate would otherwise walk past
            // the list entirely.
            const blocked = blockedReason('run_command', input, ctx.settings);
            if (blocked) return fail(blockedMessage(blocked));

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

            // Typing reaches the same shell that run_command does, so it
            // answers to the same list. Without this the block would be one
            // tool call wide.
            const blocked = blockedReason('send_input', input, ctx.settings);
            if (blocked) return fail(blockedMessage(blocked));

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
            + 'trimmed. Give offset and limit to read a stretch of it by line rather than the whole '
            + 'thing, which is what you want for a long file or a big log: offset is the first line, '
            + 'counting from 1. Reads with the same access the user already has on that server.',
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            path: z.string().describe('Absolute path to the file.'),
            offset: z.number().int().min(1).optional()
                .describe('The first line to return, counting from 1. Omit for the start of the file.'),
            limit: z.number().int().min(1).max(5000).optional()
                .describe('How many lines to return. Omit for the rest of the file.'),
        },
        handler: async (input, ctx) => {
            const resolved = resolveSession(input, ctx);
            if (resolved.error) return fail(resolved.error);

            const byLine = Boolean(input.offset || input.limit);
            const stretch = { offset: input.offset, limit: input.limit };

            return viaSftp(resolved.sessionId, (handle, resolve) => {
                handle.stat(input.path, (statError, attrs) => {
                    if (statError) {
                        resolve(fail(`Could not read ${input.path}: ${statError.message}`));
                        return;
                    }

                    if (attrs.size > MAX_FILE_BYTES * 8) {
                        if (!byLine) {
                            resolve(fail(
                                `${input.path} is ${Math.round(attrs.size / 1024)} KB, which is too large to read whole. `
                                + 'Give offset and limit to read a stretch of it by line, or use run_command with '
                                + 'tail or grep to get the part you need.'
                            ));
                            return;
                        }
                        // Too big to bring over whole, so it is read as a
                        // stream and the read stops once the stretch is in.
                        let stream;
                        try {
                            stream = handle.createReadStream(input.path);
                        } catch (error) {
                            resolve(fail(`Could not read ${input.path}: ${error.message}`));
                            return;
                        }
                        fileText.streamLines(stream, stretch).then(
                            slice => resolve(ok(describeSlice(input.path, slice))),
                            error => resolve(fail(`Could not read ${input.path}: ${error.message}`))
                        );
                        return;
                    }

                    handle.readFile(input.path, (readError, data) => {
                        if (readError) {
                            resolve(fail(`Could not read ${input.path}: ${readError.message}`));
                            return;
                        }
                        const text = data.toString('utf8');
                        if (byLine) {
                            resolve(ok(describeSlice(input.path, fileText.sliceLines(text, stretch))));
                            return;
                        }
                        const trimmed = text.length > MAX_FILE_BYTES;
                        resolve(ok(
                            `${input.path}${trimmed ? ' (first part only; give offset and limit to read further)' : ''}:\n\n`
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
        name: 'edit_file',
        title: 'Edit a remote file',
        readOnly: false,
        description:
            'Replace one passage of a text file on a session\'s server over SFTP, leaving the rest as it '
            + 'is. Prefer this to write_file for a change to a file that exists: it is smaller to review '
            + 'and cannot discard lines you did not see. `old` must match the file exactly, whitespace '
            + 'included, and exactly once unless `all` is set. Line endings need not match: the file '
            + 'keeps its own. Read the file first.',
        // The tool-call event carries `path`, `old` and `new` as they are, so
        // a card or a row can draw the change as a diff.
        shape: {
            session: z.string().optional().describe('Session id. Defaults to the session in front of the user.'),
            path: z.string().describe('Absolute path of the file.'),
            old: z.string().min(1).describe('The exact text to replace.'),
            new: z.string().describe('What it becomes. Empty to delete the passage.'),
            all: z.boolean().optional().describe('Replace every occurrence rather than requiring exactly one.'),
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
                            `${input.path} is ${Math.round(attrs.size / 1024)} KB, which is too large to edit in `
                            + 'place. Use run_command with sed.'
                        ));
                        return;
                    }

                    handle.readFile(input.path, (readError, data) => {
                        if (readError) {
                            resolve(fail(`Could not read ${input.path}: ${readError.message}`));
                            return;
                        }

                        // Written back as UTF-8, so a file that is not UTF-8
                        // would come back with bytes changed that nobody
                        // asked to change. Refused rather than mangled.
                        const text = data.toString('utf8');
                        if (fileText.looksBinary(data) || !Buffer.from(text, 'utf8').equals(data)) {
                            resolve(fail(
                                `${input.path} is not UTF-8 text, so editing it here would change bytes outside `
                                + 'the passage. Use run_command with sed instead.'
                            ));
                            return;
                        }

                        const applied = fileText.applyEdit(text, input.old, input.new, { all: Boolean(input.all) });
                        if (applied.error) {
                            resolve(fail(`${input.path} was not changed. ${applied.error}`));
                            return;
                        }

                        handle.writeFile(input.path, applied.content, { encoding: 'utf8' }, (writeError) => {
                            if (writeError) {
                                resolve(fail(`Could not write ${input.path}: ${writeError.message}`));
                                return;
                            }
                            resolve(ok(
                                `Replaced ${applied.replaced} occurrence${applied.replaced === 1 ? '' : 's'} `
                                + `in ${input.path}.`
                            ));
                        });
                    });
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

    {
        name: 'ask_user',
        title: 'Ask the user a question',
        readOnly: true,
        // The card this puts up is the question itself, so it never needs an
        // approval card in front of it. See `isAutoApproved`.
        asksUser: true,
        description:
            'Put a question to the user, with a short list of answers to pick from, and wait for the '
            + 'answer. Use it when the next step depends on something only they can decide or know: which '
            + 'of two hosts, whether to go ahead a particular way, a value that is not on the server. Not '
            + 'for approval of a tool call, which the app asks for on its own. Keep the question to one or '
            + 'two sentences and the options to two to four; the user can always type something else. '
            + 'Never use it to ask for a password, a key or a token.',
        shape: {
            question: z.string().min(1).max(500).describe('The question, one or two sentences.'),
            options: z.array(z.string().min(1).max(120)).max(6).optional()
                .describe('Answers to offer, in the order to show them. Omit for a free-text answer.'),
        },
        handler: async (input, ctx) => {
            if (typeof ctx.askUser !== 'function') return fail('There is no one to ask here.');
            const options = (input.options || [])
                .map(option => String(option).trim())
                .filter(Boolean)
                .slice(0, 6);
            const reply = await ctx.askUser({
                question: input.question,
                options,
                // Present only when the call came over the tool server, whose
                // clients stop waiting after seconds rather than minutes. The
                // question outlives that: see `requestQuestion`.
                signal: ctx.signal,
            });
            // Not an error: the question is still on screen and the answer
            // will come as the user's next message. The text says what to do.
            if (reply.parked) return ok(reply.message);
            if (!reply.answered) return fail(reply.message || 'The user did not answer.');
            return ok({ answer: reply.answer, chosen: reply.chosen || undefined });
        },
    },

    /* -------------------------------------------------------------- *
     * The snippet library
     *
     * A spec reached the model only when the user remembered to attach it,
     * so a runbook written for exactly this job sat unread. These let the
     * model find it, and keep a command or a procedure that worked.
     * -------------------------------------------------------------- */

    {
        name: 'list_snippets',
        title: 'List snippets',
        readOnly: true,
        description:
            'List the user\'s snippets: saved commands, packages of commands run as one series, and '
            + 'specs. A spec is a document the user wrote for you, such as a runbook, a checklist or house '
            + 'rules. Check for one before starting a task the user may have written a procedure for. '
            + 'Returns names and ids; use read_snippet for the text.',
        shape: {
            query: z.string().optional().describe('Filter by name, description or tag. Omit to list everything.'),
            kind: z.enum(SNIPPET_KINDS).optional().describe('Only this kind.'),
            limit: z.number().int().min(1).max(500).optional().describe('Maximum snippets to return. Defaults to 200.'),
        },
        handler: async (input) => {
            const needle = String(input.query || '').trim().toLowerCase();
            const found = store.getSnippets()
                .filter(snippet => !input.kind || snippet.kind === input.kind)
                .filter(snippet => !needle || [snippet.name, snippet.description, ...(snippet.tags || [])]
                    .join(' ').toLowerCase().includes(needle));
            const limit = input.limit || 200;
            return ok({
                total: found.length,
                returned: Math.min(found.length, limit),
                snippets: found.slice(0, limit).map(publicSnippet),
            });
        },
    },

    {
        name: 'read_snippet',
        title: 'Read a snippet',
        readOnly: true,
        description:
            'Read one snippet by id: the command text, the steps of a package, or the whole text of a '
            + 'spec. A spec is the user\'s own instructions; follow it. A command is something the user '
            + 'keeps, not something that has run. {{name}} in a command is a field the user fills in when '
            + 'they use it from the terminal; replace it yourself before running one.',
        shape: {
            id: z.string().describe('The snippet id, from list_snippets.'),
        },
        handler: async (input) => {
            const library = store.getSnippets();
            const snippet = library.find(entry => entry.id === input.id);
            if (!snippet) {
                return fail(`There is no snippet with the id "${input.id}". Call list_snippets for the current list.`);
            }

            // A package is read as what it sends, with any step whose
            // snippet has since gone named rather than silently dropped.
            const composed = snippet.kind === 'package' ? snippetConfig.composeSnippet(snippet, library) : null;
            const text = composed ? composed.text : snippet.command;
            const fields = snippet.kind === 'spec' ? [] : snippetConfig.placeholdersIn(text);

            return ok({
                ...publicSnippet(snippet),
                text,
                steps: composed
                    ? composed.steps.map(step => ({ name: step.name || undefined, command: step.command }))
                    : undefined,
                chain: snippet.kind === 'package' ? snippet.chain : undefined,
                missingSteps: composed?.missing?.length ? composed.missing : undefined,
                fields: fields.length ? fields : undefined,
                runImmediately: snippet.runImmediately || undefined,
            });
        },
    },

    {
        name: 'save_snippet',
        title: 'Save a snippet',
        readOnly: false,
        description:
            'Create or update one of the user\'s snippets: a command worth keeping, a package of commands '
            + 'run as one series, or a spec, which is a document such as a runbook or a procedure you '
            + 'worked out. Commands and packages are what the user sends from the Snippets button of a '
            + 'terminal; {{name}} in the text becomes a field they fill in first. Give an id to update one; '
            + 'omit it to create. Save a procedure as a spec once it has worked, so it can be found next '
            + 'time. Never put a password, a key or a token in a snippet: the library is synced and backed up.',
        shape: {
            id: z.string().optional().describe('The id of the snippet to update. Omit to create a new one.'),
            name: z.string().min(1).max(snippetConfig.MAX_NAME_LENGTH).optional()
                .describe('The name. Required when creating.'),
            kind: z.enum(SNIPPET_KINDS).optional()
                .describe('"command" for shell text, "package" for a series of steps, "spec" for a document. '
                    + 'Defaults to command when creating, or package when steps are given.'),
            text: z.string().optional().describe('The command text, or the document for a spec.'),
            steps: z.array(z.object({
                ref: z.string().optional().describe('The id of a command snippet to run as this step.'),
                command: z.string().optional().describe('Or the command for this step, written here.'),
            })).min(1).max(snippetConfig.MAX_STEPS).optional()
                .describe('For a package: its steps in order, replacing the current ones.'),
            chain: z.boolean().optional()
                .describe('For a package: stop at the first step that fails (joined with &&) rather than run every step.'),
            runImmediately: z.boolean().optional()
                .describe('Press Enter for the user as soon as they pick it, rather than leave it at the prompt.'),
            description: z.string().max(snippetConfig.MAX_NAME_LENGTH * 4).optional()
                .describe('One line on what it is for.'),
            tags: z.array(z.string()).optional().describe('Tags, replacing the current set.'),
            hostIds: z.array(z.string()).optional()
                .describe('Ids of the saved hosts it applies to. Empty or omitted means every host.'),
        },
        handler: async (input, ctx) => {
            const library = store.getSnippets();
            const existing = input.id ? library.find(entry => entry.id === input.id) : null;
            if (input.id && !existing) {
                return fail(`There is no snippet with the id "${input.id}". Omit the id to create a new one.`);
            }

            const kind = input.kind || existing?.kind || (input.steps ? 'package' : 'command');
            if (kind === 'package' && input.text !== undefined) {
                return fail('A package is its steps: give them as steps, each a ref to a command snippet or a command.');
            }
            if (kind !== 'package' && (input.steps !== undefined || input.chain !== undefined)) {
                return fail('steps and chain are for a package. Give kind "package", or the command as text.');
            }
            if ((input.steps || []).some(step => step.ref && step.command)) {
                return fail('Each step is either a ref to a snippet or a command, not both.');
            }
            // A step that runs another snippet must run a command that exists:
            // anything else would be a step that silently sends nothing.
            const unknown = (input.steps || []).find(step => step.ref
                && library.find(entry => entry.id === step.ref)?.kind !== 'command');
            if (unknown) return fail(`There is no command snippet with the id "${unknown.ref}" to use as a step.`);

            const record = snippetConfig.normalizeSnippet({
                ...(existing || {}),
                ...(input.name !== undefined ? { name: input.name } : {}),
                kind,
                ...(input.text !== undefined ? { command: input.text } : {}),
                ...(input.steps !== undefined ? { steps: input.steps } : {}),
                ...(input.chain !== undefined ? { chain: input.chain } : {}),
                ...(input.runImmediately !== undefined ? { runImmediately: input.runImmediately } : {}),
                ...(input.description !== undefined ? { description: input.description } : {}),
                ...(input.tags !== undefined ? { tags: input.tags } : {}),
                ...(input.hostIds !== undefined ? { hostIds: input.hostIds } : {}),
            });
            const problem = snippetConfig.validateSnippet(record);
            if (problem) return fail(problem);

            const saved = store.saveSnippet(record);
            // The palettes in open windows cache the library; tell them.
            ctx?.snippetsChanged?.();
            return ok({ saved: existing ? 'updated' : 'created', ...publicSnippet(saved) });
        },
    },
];

const BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]));

/* ------------------------------------------------------------------ *
 * Blocked commands
 *
 * What this is, and what it is not.
 *
 * It is a guardrail. It catches the destructive command that arrives by
 * accident: a model that misread the question, a suggestion copied out of a
 * log, a plausible-looking answer to "clear some space". That is the common
 * case by a wide margin, and refusing it outright is worth doing.
 *
 * It is not a security boundary, and it must never be treated as one. A shell
 * has unlimited ways to spell the same command, and anything that can write a
 * script can sidestep any list of words: `bash -c "$(echo cm0gLXJmIC8K |
 * base64 -d)"` is not going to be caught here and neither is the next one.
 * The control that actually stands between a compromised server and a bad
 * command is the approval card, which is why nothing about this list loosens
 * anything above it.
 *
 * So the matching below is written to be hard to trip over by accident rather
 * than impossible to evade: it reads through the quoting, the wrappers, the
 * flag spellings and the chaining that show up in ordinary commands, and it
 * errs towards refusing when a string is ambiguous.
 * ------------------------------------------------------------------ */

/**
 * Words that stand in front of the command that actually runs.
 *
 * Seeing one is what lets `sudo rm -rf /` be read as the `rm` it is, rather
 * than as a command called `sudo` that no rule mentions. See `readingsOf`.
 */
const WRAPPERS = new Set([
    'sudo', 'doas', 'env', 'nice', 'ionice', 'nohup', 'time', 'timeout',
    'command', 'builtin', 'exec', 'xargs', 'stdbuf', 'setsid', 'strace',
]);

/**
 * Long flags that mean the same as a short letter, so `--recursive --force`
 * is not a way around a rule written `-rf`.
 *
 * Deliberately short. These are the spellings that matter for the commands
 * anyone actually blocks; a general table would be one per program and would
 * still be incomplete.
 */
const LONG_FLAGS = {
    recursive: 'r',
    force: 'f',
    all: 'a',
    verbose: 'v',
};

/** Anything that can end one command and begin another, or nest one inside. */
const SEPARATORS = /[;&|\n\r`(){}<>]/g;

/** The last path segment, so `/bin/rm` and `rm` are the same command. */
const commandName = (token) => token.split(/[/\\]/).pop();

/**
 * Drop the quoting that lets one word be written as several.
 *
 * `r''m`, `"rm"` and `r\m` are all `rm` to a shell, and a rule that missed
 * that would be a rule that only stops the careless spelling.
 */
const unquote = (text) => text.replace(/['"]/g, '').replace(/\\(.)/g, '$1');

/**
 * Split a command line into the individual commands it runs.
 *
 * Substitutions and subshells are cut at their brackets rather than parsed, so
 * the command inside `$(...)` is checked as its own segment. That over-splits
 * a string with a stray bracket in it, which costs an occasional false refusal
 * and never a missed one. For a list whose whole job is to say no, that is the
 * direction to be wrong in.
 */
function segmentsOf(command) {
    return unquote(String(command ?? '').toLowerCase())
        .replace(SEPARATORS, '\n')
        .split('\n')
        .map(part => part.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

/**
 * Read a command starting at one token: what is being run, which flags it
 * carries, and its remaining arguments.
 *
 * Flags are gathered as a set of letters, so `-rf`, `-fr` and `-r -f` are one
 * answer and the order they were typed in stops mattering.
 */
function parseFrom(tokens, position) {
    const flags = new Set();
    const positionals = [];

    for (const token of tokens.slice(position + 1)) {
        if (token.startsWith('--') && token.length > 2) {
            const short = LONG_FLAGS[token.slice(2).split('=')[0]];
            if (short) flags.add(short);
        } else if (token.startsWith('-') && token.length > 1) {
            for (const letter of token.slice(1)) flags.add(letter);
        } else {
            positionals.push(token);
        }
    }

    return { name: commandName(tokens[position]), flags, positionals };
}

/**
 * Every reading of a segment that could be the command it runs.
 *
 * Usually there is one, and it is the first word. A wrapper is what makes a
 * second reading possible, and the reason this is a list rather than a single
 * parse: `sudo -u root rm -rf /` cannot be read by walking past the wrapper's
 * flags, because `-u` takes a value and knowing which flags do that means
 * knowing every wrapper's option table. So once a wrapper has been seen, every
 * later word is offered as a candidate and the rules decide.
 *
 * That permission is deliberately not granted without one. If any word could
 * be the command, a rule naming `ls` would fire on `cat ls`, and a list that
 * refuses things nobody asked it to is a list people turn off.
 */
function readingsOf(segment) {
    const tokens = String(segment).split(' ').filter(Boolean);
    const readings = [];

    // `FOO=bar cmd` sets a variable for one command; the command is what
    // follows it.
    let start = 0;
    while (start < tokens.length && /^[a-z_][a-z0-9_]*=/.test(tokens[start])) start += 1;

    let sawWrapper = false;
    for (let position = start; position < tokens.length; position += 1) {
        const token = tokens[position];
        if (token.startsWith('-')) continue;

        readings.push(parseFrom(tokens, position));

        if (WRAPPERS.has(commandName(token))) sawWrapper = true;
        else if (!sawWrapper) break;
    }

    return readings;
}

/**
 * Whether one command matches one rule.
 *
 * The rule's flags must all be present, and its words must lead the command's
 * own. So `rm -rf` catches `rm -rf /var`, `rm -fr /var` and `rm -r -f /var`,
 * while `rm -r /var` is left to the ordinary approval path: it is not what the
 * rule named, and silently widening a rule is how a block list ends up
 * refusing things nobody asked it to.
 */
function matchesRule(command, rule) {
    if (command.name !== rule.name) return false;
    for (const flag of rule.flags) {
        if (!command.flags.has(flag)) return false;
    }
    return rule.positionals.every((word, position) => command.positionals[position] === word);
}

/** The text a tool call would put on a server, or '' for one that runs nothing. */
function commandTextFor(toolName, input) {
    if (toolName === 'run_command') return String(input?.command ?? '');
    // Typing into the terminal reaches the same shell by another door. A list
    // that only covered run_command would be one tool call away from useless.
    if (toolName === 'send_input') return String(input?.text ?? '');
    return '';
}

/**
 * The blocked rule a call trips, or '' when it trips none.
 *
 * Returns the rule rather than a boolean so the refusal can quote the line the
 * user wrote, which is the difference between "no" and "no, because of this,
 * which you can change here".
 */
function blockedReason(toolName, input, settings) {
    const rules = Array.isArray(settings?.blockedCommands) ? settings.blockedCommands : [];
    if (rules.length === 0) return '';

    const text = commandTextFor(toolName, input);
    if (!text.trim()) return '';

    const segments = segmentsOf(text);

    for (const raw of rules) {
        // A rule is taken literally, from its first word: it is what someone
        // typed into a settings box, not something a shell handed us. That is
        // also what lets a wrapper be blocked by name, since `sudo` as a rule
        // has to mean the command `sudo`.
        const tokens = unquote(String(raw).toLowerCase()).trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
        if (tokens.length === 0) continue;
        const rule = parseFrom(tokens, 0);

        for (const segment of segments) {
            if (readingsOf(segment).some(reading => matchesRule(reading, rule))) return raw;
        }
    }

    return '';
}

/** What the model is told, phrased so its next move is not to try again. */
const blockedMessage = (rule) =>
    `Refused: "${rule}" is on the blocked command list in this app's assistant settings, `
    + 'so it cannot be run here and there is no approval that would let it through. '
    + 'Do not try to reach the same result another way. Tell the user what you wanted to run '
    + 'and why, and let them run it themselves or change the list in Settings.';

/**
 * Whether a call can go ahead without asking, under the current policy.
 *
 * A tool the catalog does not know is never auto-approved. That is the case
 * that matters: it is what happens when a tool is added and this function is
 * not revisited, and the safe answer is to ask.
 */
function isAutoApproved(toolName, input, settings) {
    // Before the approval mode, not after it. A blocked command is refused
    // rather than approved, so it must never come back from here as "run it",
    // and `never ask` is exactly the setting under which that would happen.
    if (blockedReason(toolName, input, settings)) return false;

    const tool = BY_NAME.get(toolName);

    // A question to the user is a card already. Under "ask every time" it
    // would otherwise be preceded by a second card asking whether it may ask,
    // which is the same click twice and teaches nobody anything.
    if (tool?.asksUser) return true;

    if (settings.approval === 'never') return true;
    if (settings.approval === 'always') return false;

    if (!tool) return false;
    if (tool.readOnly) return true;

    // A command whose leading words are on the safe list is a read wearing a
    // shell's clothing, and making someone approve `ls` teaches them to
    // approve without looking.
    if (toolName === 'run_command') {
        const command = String(input?.command || '').trim().toLowerCase();
        // Anything chained, redirected or carried onto a second line is judged
        // as a whole rather than by its first word, because `ls; rm -rf /` and
        // `ls -la\nrm -rf /` both start with `ls`.
        //
        // The line breaks are not an afterthought to the list. A newline ends a
        // command exactly as `;` does, so a payload whose first line is `ls`
        // would otherwise be approved in full and run in full; and a carriage
        // return is Enter to the PTY that the terminal path types into, which
        // is the default place a command goes.
        if (/[;&|><`$(\n\r]/.test(command)) return false;
        return settings.autoApproveCommands.some(prefix => (
            command === prefix || command.startsWith(`${prefix} `)
        ));
    }

    return false;
}

/* ------------------------------------------------------------------ *
 * The runtimes' own tools
 *
 * Claude Code and OpenCode bring tools of their own, which act on this machine
 * rather than on a server: a file read, a grep, a shell. They reach the panel
 * through each runtime's permission hook rather than through the catalog
 * above, and the approval mode has to mean the same thing there. Before this,
 * every one of them put up a card whatever the mode said, so a session on
 * "never" still stopped on each grep and each file read.
 * ------------------------------------------------------------------ */

/**
 * The runtimes' own tools that only look, across the naming conventions in
 * use: Claude Code's `Read`, OpenCode's `read`, Grok's `read_file`. Compared
 * in lower case with the underscores kept.
 */
const NATIVE_READS = new Set([
    'read', 'read_file', 'glob', 'grep', 'ls', 'list', 'list_dir', 'list_directory',
    'notebookread', 'bashoutput', 'get_command_or_subagent_output', 'search_tool',
    'todowrite', 'todoread', 'todo_write', 'exitplanmode',
    // Handing work to a subagent, or checking on one, touches nothing by
    // itself: each call the subagent makes is asked about on its own.
    'task', 'agent', 'taskoutput', 'taskstop',
]);

/**
 * The runtimes' own tools that reach the web. Kept apart from the reads: a
 * page fetched is something leaving this machine, so under the default it
 * stops for a card even though nothing local changes.
 */
const NATIVE_WEB = new Set(['webfetch', 'web_fetch', 'websearch', 'web_search']);

/** An MCP tool that reaches the web, by its bare name: `fetch`, `web_search`. */
const WEB_TOOL_NAME = /(^|_)web(_|$)|(^|_)fetch(_|$)|webfetch|websearch/;

/** The runtimes' own shells, which are judged by the allow list like any command. */
const NATIVE_SHELLS = new Set(['bash', 'run_terminal_command', 'shell']);

/** An MCP tool whose name says it only looks: `browser_snapshot`, `list_issues`, `get_page`. */
const READ_NAME = /^(list|get|read|search|find|fetch|query|describe|show|check|health)[_a-z0-9]*$|^browser_(snapshot|take_screenshot|console_messages|network_requests?|find|tabs)$|^healthcheck$/;

/** The bare tool of an MCP name, `mcp__server__tool`, or '' for anything else. */
function bareMcpName(toolName) {
    const doubled = toolName.lastIndexOf('__');
    if (toolName.startsWith('mcp__') && doubled > 0) return toolName.slice(doubled + 2);
    return '';
}

/** The command a runtime's own shell is about to run, or '' when there is none. */
function nativeShellCommand(input) {
    return String(input?.command ?? input?.cmd ?? '');
}

/**
 * The blocked rule a runtime's own shell trips, or ''.
 *
 * The list applies to a shell on this machine exactly as it does to one on a
 * server, and like there it applies whatever the approval mode says: "never
 * ask" waves calls through, it does not unblock them.
 *
 * OpenCode's permission request carries the command in its metadata in some
 * releases and only as its `pattern` in others, so the pattern is checked as
 * well. Only here: a pattern is good enough to refuse on, not to wave through.
 */
function nativeBlockedReason(toolName, input, settings) {
    if (!NATIVE_SHELLS.has(String(toolName || '').toLowerCase())) return '';
    const pattern = Array.isArray(input?.pattern) ? input.pattern.join('\n') : String(input?.pattern ?? '');
    const command = [nativeShellCommand(input), pattern].filter(text => text.trim()).join('\n');
    return command ? blockedReason('run_command', { command }, settings) : '';
}

/**
 * Whether one of the runtime's own tools can go ahead without asking.
 *
 * Nothing waits under "never", everything waits under "always", and under the
 * default a read runs and a change stops, a web call stops, and the runtime's
 * shell is judged by the same allow list as a command on a server. An MCP tool
 * is a read when its name says so.
 *
 * A name this does not recognise is a change, and a change asks. That is the
 * case that matters: a runtime grows a tool, nobody revisits this, and the safe
 * answer is the one that puts a card in front of a person.
 */
function nativeAutoApproved(toolName, input, settings) {
    // As in `isAutoApproved`: refused is never "run it", whatever the mode.
    if (nativeBlockedReason(toolName, input, settings)) return false;

    if (settings.approval === 'never') return true;
    if (settings.approval === 'always') return false;

    const name = String(toolName || '').toLowerCase();
    if (NATIVE_WEB.has(name)) return false;
    if (NATIVE_READS.has(name)) return true;
    if (NATIVE_SHELLS.has(name)) {
        return isAutoApproved('run_command', { command: nativeShellCommand(input) }, settings);
    }

    const bare = bareMcpName(String(toolName || '')).toLowerCase();
    if (bare) {
        if (WEB_TOOL_NAME.test(bare)) return false;
        return READ_NAME.test(bare);
    }
    return false;
}

module.exports = {
    TOOLS,
    BY_NAME,
    isAutoApproved,
    nativeAutoApproved,
    nativeBlockedReason,
    blockedReason,
    blockedMessage,
    resolveSession,
    sessionInScope,
    hostInScope,
    publicHost,
};
