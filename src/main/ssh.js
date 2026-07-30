const { MessageChannelMain } = require('electron');
const { Client } = require('ssh2');
const store = require('./store');
const knownHosts = require('./known-hosts');
const agent = require('./agent');
const proxy = require('./proxy');
const { describeProxyChain, proxyHops } = require('./proxy-config');
const certificate = require('./certificate');
const hello = require('./hello');
const activity = require('./activity');
const sessionLog = require('./session-log');
const { classifyShellOutput } = require('./os-detect');

// tabId -> { client, stream, port, sftp }
const sessions = new Map();

/** How long the server gets to complete a handshake, excluding time spent
 *  waiting on a person, see `handshakeDeadline`. */
const READY_TIMEOUT = 30000;

/**
 * Legacy algorithms, enabled only when a host explicitly opts in. Without this
 * flag ssh2's curated defaults apply. Do not add algorithms globally, doing so
 * replaces the safe defaults wholesale.
 */
const LEGACY_ALGORITHMS = {
    kex: [
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1',
        'diffie-hellman-group1-sha1',
    ],
    cipher: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'],
    serverHostKey: ['ssh-rsa', 'ssh-dss'],
    hmac: ['hmac-sha1'],
};

function get(tabId) {
    return sessions.get(tabId);
}

/**
 * Name the server a tab is attached to, for anything that only holds a tab id:
 * the SFTP handlers, the transfer queue, the port forwards. Returns blanks
 * rather than null so a caller can spread it into a log entry unconditionally.
 */
function describe(tabId) {
    const session = sessions.get(tabId);
    return {
        hostId: session?.hostId || '',
        hostName: session?.hostName || '',
        subject: session?.address || '',
    };
}

/**
 * Teardown hooks. Transfers and remote-file watches outlive a single IPC call,
 * so they register here rather than being torn down at the call site, and
 * they cannot require this module back without a cycle.
 */
const destroyHooks = [];

function onDestroy(hook) {
    destroyHooks.push(hook);
}

/** How long a session lasted, phrased for a log line. */
function describeDuration(openedAt) {
    if (!openedAt) return '';
    const seconds = Math.round((Date.now() - openedAt) / 1000);
    if (seconds < 60) return `lasted ${seconds}s`;
    if (seconds < 3600) return `lasted ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `lasted ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const CLOSE_REASONS = {
    closed: 'Closed from the app',
    dropped: 'The connection dropped',
    locked: 'The app was locked',
    replaced: 'Replaced by a new session on the same tab',
};

/**
 * Tear a session down. Every path that ends one comes through here: closing a
 * tab, a dropped link, locking the app. That is why the log entry lives here
 * rather than at any single call site.
 */
function destroy(tabId, { reason = 'closed' } = {}) {
    const session = sessions.get(tabId);
    if (!session) return false;

    activity.record({
        category: 'connection',
        action: 'session.close',
        outcome: reason === 'dropped' ? 'failure' : 'info',
        target: session.hostName || '',
        subject: session.address || '',
        detail: [CLOSE_REASONS[reason] || CLOSE_REASONS.closed, describeDuration(session.openedAt)]
            .filter(Boolean).join(' · '),
        hostId: session.hostId || '',
        hostName: session.hostName || '',
    });

    // Before the hooks and the socket: the transcript's closing line should be
    // written while there is still a session to attribute it to.
    sessionLog.close(tabId, { reason: 'session' });

    for (const hook of destroyHooks) {
        try {
            hook(tabId);
        } catch (error) {
            console.error(`Session teardown hook failed for ${tabId}:`, error.message);
        }
    }

    try {
        if (session.sftp) session.sftp.end();
        if (session.port) session.port.close();
        if (session.stream) session.stream.end();

        // Innermost first. Every hop but the first is running over a channel
        // belonging to the hop below it, so ending the bastion first would pull
        // the transport out from under a client that has not been told to
        // disconnect, an unclean close on the server that actually matters.
        // `chain` is in dial order, so reversed it runs target → bastion.
        for (const client of [...(session.chain || [session.client])].reverse()) {
            if (client) client.end();
        }
    } catch (error) {
        console.error(`Error tearing down session ${tabId}:`, error.message);
    }

    sessions.delete(tabId);
    return true;
}

function destroyAll() {
    for (const tabId of [...sessions.keys()]) destroy(tabId, { reason: 'locked' });
}

function buildConfig(credentials, hostVerifier) {
    const config = {
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        readyTimeout: READY_TIMEOUT,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        hostVerifier,

        // Offered for every auth method, not only password.
        //
        // ssh2 orders its attempts none, password, publickey, agent,
        // keyboard-interactive, and only offers plain `password` when one is
        // configured. So a key or agent host still authenticates with its key
        // first, and only reaches an interactive round when the server asks
        // for something further. That is exactly the case this unlocks: a
        // server running `AuthenticationMethods publickey,keyboard-interactive`
        // accepts the key, then wants a one-time code, and without this the
        // whole thing surfaces as "All configured authentication methods
        // failed" with nothing the user can do about it.
        //
        // It also means a rejected key falls back to whatever the server asks
        // next instead of dead-ending, which is what `ssh` itself does. No
        // stored secret is ever handed to those prompts, and none is stored
        // for a key host in the first place, see planKeyboardInteractive.
        tryKeyboard: true,
    };

    if (credentials.authMethod === 'agent') {
        // Resolved against a live agent by the caller; falls back to the
        // first candidate so a direct call still produces something usable.
        config.agent = credentials.resolvedAgentPath || agent.resolvePath(credentials.agentPath);
        // ssh2 refuses forwarding unless an agent is configured, which it is here.
        if (credentials.agentForward) config.agentForward = true;
    } else if (credentials.authMethod === 'key') {
        // A Windows Hello key cannot be handed over at all: the private half is
        // in the TPM and signing puts a prompt on screen. Same shape as the
        // certificate case below (a one-identity agent) for the same reason.
        if (credentials.hello) {
            config.agent = hello.agentFor(credentials.hello.credential, credentials.hello.publicKey);
        } else if (credentials.certificate) {
            config.agent = certificate.agentFor({
                privateKey: credentials.privateKey,
                passphrase: credentials.passphrase,
                certificate: credentials.certificate,
            });
        } else {
            config.privateKey = credentials.privateKey;
            if (credentials.passphrase) config.passphrase = credentials.passphrase;
        }
    } else {
        config.password = credentials.password;
    }

    if (credentials.legacyAlgorithms) {
        config.algorithms = LEGACY_ALGORITHMS;
    }

    return config;
}

/**
 * A prompt that is unmistakably asking for the password we already hold.
 * Deliberately narrow: anything else (an OTP, a Duo passcode, a changed
 * password confirmation) is the user's to answer, not ours to guess at.
 */
const PASSWORD_PROMPT = /pass(word|phrase)/i;

/**
 * How many rounds may be put in front of the user in one attempt. A server can
 * send keyboard-interactive requests without limit, and the handshake deadline
 * is suspended while a prompt is up, so without a bound a hostile server could
 * keep a dialog on screen forever. Legitimate flows need one or two rounds,
 * three for a password change.
 */
const MAX_INTERACTIVE_ROUNDS = 8;

/**
 * ssh2 arms one `readyTimeout` for the whole handshake and only clears it when
 * the session comes up or dies, so a keyboard-interactive prompt sits inside
 * that window. Left alone it would kill the connection 30 seconds into the
 * user reading their authenticator app. The timer is suspended while a prompt
 * is on screen and a fresh one armed once the answer goes back, so the
 * deadline keeps measuring the server rather than the person.
 *
 * `_readyTimeout` is ssh2's own field. If a future version renames it the
 * clear becomes a no-op and we are back to the stock 30-second behaviour:
 * degraded, but never broken.
 */
function handshakeDeadline(client, onExpired) {
    let timer = null;

    return {
        suspend() {
            clearTimeout(client._readyTimeout);
            clearTimeout(timer);
            timer = null;
        },
        resume() {
            clearTimeout(timer);
            timer = setTimeout(onExpired, READY_TIMEOUT);
        },
        clear() {
            clearTimeout(timer);
            timer = null;
        },
    };
}

/**
 * Decide what to answer in a keyboard-interactive round, and what has to go to
 * the user.
 *
 * Split out from the handler because it is the part that has to be exactly
 * right: it decides whether a stored password is sent, and to which question.
 *
 *   answers        one slot per prompt, pre-filled where we could answer
 *   unanswered     prompts the user has to see, carrying their original index
 *   spentPassword  whether this round consumed the stored password
 */
function planKeyboardInteractive(prompts, password, passwordAlreadySpent) {
    const answers = new Array(prompts.length).fill('');
    const unanswered = [];
    let spentPassword = false;

    prompts.forEach((prompt, index) => {
        const text = prompt.prompt || '';
        // Echo off is the server saying "this one is a secret". A prompt that
        // echoes wants something visible, which a stored password never is.
        const looksLikePassword = !prompt.echo && PASSWORD_PROMPT.test(text);
        const canAnswer = looksLikePassword
            && Boolean(password)
            && !passwordAlreadySpent
            && !spentPassword;

        if (canAnswer) {
            spentPassword = true;
            answers[index] = password;
            return;
        }

        unanswered.push({ index, text, echo: Boolean(prompt.echo) });
    });

    return { answers, unanswered, spentPassword };
}

/**
 * Open the channel the next hop runs over: an ordinary TCP connection, made by
 * the server we are already on, to the address of the server we want next.
 *
 * This is the whole mechanism of a jump host. The next hop's SSH session is
 * negotiated end to end over this channel, so the server carrying it never sees
 * a credential or a byte of the session inside it. It relays an opaque stream,
 * exactly as it would for a port forward.
 *
 * The source address is informational. OpenSSH sends its own loopback in the
 * same position; nothing routes by it.
 */
function openRelay(client, next) {
    return new Promise((resolve) => {
        client.forwardOut('127.0.0.1', 0, next.host, next.port, (err, stream) => {
            resolve(err ? { success: false, message: err.message } : { success: true, stream });
        });
    });
}

/**
 * Dial one hop and resolve once it has authenticated.
 *
 * `sock` is what SSH runs over. Left out, ssh2 opens its own TCP socket to the
 * address in `credentials`, unless the hop has a proxy, in which case this opens
 * the socket through it and hands that over instead; passed in, it is a channel
 * on the hop before this one, opened by `openRelay`. Nothing else differs: host
 * key verification, the auth methods and the interactive prompts are identical
 * either way, because to this function a relayed hop is just a server on the
 * other end of a stream.
 *
 * Resolves `{ success, client, message }` and never rejects. The client comes
 * back still carrying this function's own error and close listeners. They do
 * nothing once the dial has settled, and they are deliberately left attached:
 * an `error` reaching an emitter with no listener for it would be thrown.
 */
async function dialHop(credentials, { sock, requestTrust, requestKeyboardInteractive }) {
    const name = credentials.label?.name || credentials.host;

    // Pin the agent to one that is actually answering. Without this a stopped
    // agent surfaces as "All configured authentication methods failed", which
    // says nothing about the real problem.
    if (credentials.authMethod === 'agent') {
        const found = await agent.probe(credentials.agentPath);
        if (!found?.available) {
            return {
                success: false,
                message: `No SSH agent available${found?.message ? `: ${found.message}` : ''}`,
            };
        }
        credentials.resolvedAgentPath = found.path;
    }

    /*
     * A proxy only applies where a real socket is opened, which is the first hop
     * of a chain. Every hop after it is already inside a channel on the hop
     * below, and that channel was opened by a server on the far side of the
     * proxy: there is nothing local left to route.
     *
     * Done before the handshake rather than inside it so a proxy that refuses is
     * reported as what it is, instead of as a server that would not answer.
     */
    let proxied = null;
    if (!sock && credentials.proxyChain?.length > 0) {
        try {
            proxied = await proxy.openSocket({
                host: credentials.host,
                port: credentials.port,
                chain: credentials.proxyChain,
            });
            sock = proxied;
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    const dialled = await new Promise((resolve) => {
        const client = new Client();

        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const deadline = handshakeDeadline(client, () => {
            settle({ success: false, message: 'Timed out while waiting for handshake' });
            client.end();
        });

        client.on('ready', () => {
            deadline.clear();
            settle({ success: true, client, message: 'Connected' });
        });

        /**
         * Answer one keyboard-interactive round.
         *
         * This used to reply to every prompt with the stored password, which
         * had two consequences. Any host with a second factor was unusable (the
         * OTP prompt received the password and the login failed), and the
         * password went to whatever the server chose to ask, with the user
         * never seeing the question.
         *
         * Now a prompt is auto-answered only when it is unmistakably the
         * password prompt, and the stored password is spent at most once per
         * attempt: a server that asks twice is retrying a rejected password,
         * and answering again would burn attempts against a lockout policy.
         * Everything else is put in front of the user in the server's own
         * wording. The common case (one password prompt, one round) still
         * completes without anything appearing on screen.
         *
         * Each hop answers for itself, with its own stored password and its own
         * round count, which is the only thing that makes a chain through a
         * bastion with 2FA workable: the bastion's code and the target's are
         * separate questions and are asked separately.
         */
        let passwordSpent = false;
        let interactiveRounds = 0;

        client.on('keyboard-interactive', async (name_, instructions, lang, prompts, finish) => {
            const { answers, unanswered, spentPassword } =
                planKeyboardInteractive(prompts, credentials.password, passwordSpent);

            if (spentPassword) passwordSpent = true;

            if (unanswered.length === 0) {
                finish(answers);
                return;
            }

            if (!requestKeyboardInteractive) {
                // No prompt channel wired up. Fail the round rather than
                // guessing at answers the server did not ask us for.
                finish(answers);
                return;
            }

            if (++interactiveRounds > MAX_INTERACTIVE_ROUNDS) {
                settle({
                    success: false,
                    message: 'The server kept asking for more authentication',
                });
                client.end();
                return;
            }

            deadline.suspend();

            const replies = await requestKeyboardInteractive({
                host: credentials.host,
                port: credentials.port,
                username: credentials.username,
                name: name_,
                instructions,
                prompts: unanswered.map(({ text, echo }) => ({ text, echo })),
            });

            if (!replies) {
                // Cancelled, or the window went away. Settle with something
                // truthful before ending the client, so the close below does
                // not report this as a connection the server dropped.
                settle({ success: false, message: 'Authentication cancelled' });
                client.end();
                return;
            }

            deadline.resume();

            unanswered.forEach(({ index }, position) => {
                answers[index] = replies[position] || '';
            });

            finish(answers);
        });

        client.on('error', (err) => {
            deadline.clear();
            console.error(`SSH error dialling ${name}:`, err.message);
            settle({ success: false, message: err.message });
        });

        client.on('close', () => {
            deadline.clear();
            settle({ success: false, message: 'Connection closed' });
        });

        const hostVerifier = knownHosts.createHostVerifier({
            host: credentials.host,
            port: credentials.port,
            requestTrust,
        });

        try {
            const config = buildConfig(credentials, hostVerifier);
            // ssh2 skips its own TCP connect when handed a socket, and treats a
            // stream with no `connecting` flag as already up, which a channel
            // is the moment forwardOut hands it over. The handshake deadline is
            // still armed, so a relayed hop that never answers fails like any
            // other rather than hanging.
            if (sock) config.sock = sock;

            client.connect(config);

            // Nagle's algorithm holds a small write back until the previous one
            // has been acknowledged. That is exactly wrong for a shell: every
            // keystroke is a small write, so the character waits a round trip
            // before it even leaves the machine, and against a receiver doing
            // delayed ACK it can stall for tens of milliseconds more. OpenSSH
            // and PuTTY both clear it unconditionally for interactive sessions.
            //
            // It has to be done here because Node enables it on every socket and
            // ssh2 never turns it off: it exposes setNoDelay but does not call
            // it. Safe this early, ssh2 assigns its socket synchronously inside
            // connect(), and Node defers the option to the socket's own connect
            // event if the handle is not up yet.
            //
            // A no-op on a relayed hop: ssh2 only forwards the call to a socket
            // that has the option and a channel does not. There is one real
            // socket in a chain, at the bottom, and that hop clears the flag on
            // it, which is where the round trip it saves actually happens.
            client.setNoDelay(true);
        } catch (error) {
            settle({ success: false, message: error.message });
        }
    });

    // ssh2 owns the socket from the moment it accepts one, and closes it with
    // the client. A dial that never got that far leaves a proxied socket with
    // nothing holding it, so it is closed here.
    if (!dialled.success) proxied?.destroy();

    return dialled;
}

/**
 * The path a session actually took, outward first, for the pane header to show.
 *
 * Structure only, no wording: the renderer phrases it, the same way it phrases
 * the activity log. It is built from the resolved chain rather than from the host
 * record, so it describes the connection that was made rather than the one the
 * settings currently describe: a proxy or a bastion edited mid-session does not
 * rewrite the path of the session already running on it.
 *
 * The proxy belongs to the hop that opened the socket, which is the first of the
 * chain however long it is. Every hop after it is dialled through a channel on
 * the one below, so there is nothing local left for a proxy to route.
 */
function describeRoute(chain) {
    return [
        ...proxyHops(chain[0].proxyChain),
        ...chain.map(hop => ({
            kind: hop.isTarget ? 'host' : 'jump',
            label: hop.label.name,
            detail: hop.label.address,
        })),
    ];
}

/**
 * Open a session for a tab.
 *
 * Credentials are resolved here from the encrypted store by host id, and are
 * never passed in from the renderer. What comes back is a *chain*: the host,
 * preceded by whatever jump hosts it is reached through. A host reached
 * directly is a chain of one, so there is no separate path for the ordinary
 * case: this dials a list either way.
 */
function connect({ tabId, hostId, cols, rows }, { window, requestTrust, requestKeyboardInteractive }) {
    return new Promise(async (resolve) => {
        destroy(tabId, { reason: 'replaced' });

        const { chain, error } = store.resolveChain(hostId);
        if (error) {
            resolve({ success: false, message: error });
            return;
        }

        const target = chain[chain.length - 1];
        const hops = chain.slice(0, -1);
        const label = store.describeHost(hostId);

        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;

            // One entry per attempt, whichever path ended it. The close handler
            // settles again after a successful session ends, and is a no-op
            // here, so a session is never logged as both opened and refused.
            activity.record({
                category: 'connection',
                action: 'session.open',
                outcome: result.success ? 'success' : 'failure',
                target: label.name,
                subject: label.address,
                // The relay is named on the line that succeeded as well as the
                // one that failed: which servers a session was routed through is
                // half of what this log is for.
                detail: result.success
                    ? [
                        `via ${target.authMethod}`,
                        hops.length
                            ? `relayed through ${hops.map(hop => hop.label.name).join(' → ')}`
                            : '',
                        // The proxy belongs to the hop that opened the socket,
                        // which is the first of the chain however long it is.
                        chain[0].proxyChain?.length
                            ? `proxied by ${describeProxyChain(chain[0].proxyChain)}`
                            : '',
                    ].filter(Boolean).join(' · ')
                    : '',
                message: result.success ? '' : result.message,
                hostId,
                hostName: label.name,
            });

            resolve(result);
        };

        /* ---- dial the chain, outermost hop first ---- */

        const clients = [];

        /** Give up, taking down whatever part of the chain is already up. */
        const abandon = (message) => {
            // Innermost first, matching destroy(): a partial chain comes down
            // the same way a whole one does, so no hop has its transport pulled
            // out from under it by the hop below.
            for (const open of [...clients].reverse()) {
                try {
                    open.end();
                } catch {
                    // Already gone. This is the failure path; there is nothing
                    // further to report about a client that is closed twice.
                }
            }
            settle({ success: false, message });
        };

        let sock = null;
        for (const [index, hop] of chain.entries()) {
            const dialled = await dialHop(hop, { sock, requestTrust, requestKeyboardInteractive });

            if (!dialled.success) {
                // A failed jump host is named. Without that, "All configured
                // authentication methods failed" reads as being about the host
                // the user asked for, and they go and check the wrong key.
                abandon(hop.isTarget ? dialled.message : `${hop.label.name}: ${dialled.message}`);
                return;
            }
            clients.push(dialled.client);

            if (hop.isTarget) break;

            const next = chain[index + 1];
            const relay = await openRelay(dialled.client, next);
            if (!relay.success) {
                // Distinct from a failure to authenticate: the bastion is fine
                // and we are logged into it, it just cannot see the next hop.
                // That is a firewall or a wrong address, not a credential.
                abandon(`${hop.label.name} could not reach ${next.host}:${next.port}: ${relay.message}`);
                return;
            }
            sock = relay.stream;
        }

        // Everything downstream (SFTP, forwards, the desktop views, detectOS)
        // runs on the last hop, which is the host the user actually asked for.
        const client = clients[clients.length - 1];

        /**
         * Any hop going away ends the session: a jump host that drops takes the
         * channel every hop above it was running on with it.
         *
         * All of them share this one handler, which is written to run once. The
         * first close tears the session down and the closes cascading from it
         * find nothing left to do.
         */
        const handleClosed = () => {
            const session = sessions.get(tabId);
            // A reconnect may already have registered a fresh session under
            // this tab id. A stale close from the replaced chain must not
            // tear that one down or report a drop the renderer would chase.
            if (session && session.client !== client) return;

            if (window && !window.isDestroyed()) {
                window.webContents.send('ssh-disconnected', tabId);
            }
            // Through destroy(), not sessions.delete(), because the teardown hooks
            // must run on a network drop too, or transfers and remote-edit
            // watchers keep holding a dead connection.
            if (session) destroy(tabId, { reason: 'dropped' });

            // Only reaches anything in the window between the chain coming up
            // and the shell opening. After that the attempt is long settled.
            settle({ success: false, message: 'Connection closed' });
        };
        for (const open of clients) open.on('close', handleClosed);

        const shellOptions = {
            term: 'xterm-256color',
            cols: cols || 80,
            rows: rows || 24,
        };

        client.shell(shellOptions, (err, stream) => {
            if (err) {
                // No session is registered yet, so destroy() would find nothing
                // to close. The chain has to be ended here or it is left open
                // with nothing holding a reference to it.
                abandon(err.message);
                return;
            }

            const { port1, port2 } = new MessageChannelMain();
            // The host is carried on the session so anything holding only a
            // tab id (SFTP, transfers, forwards) can name the server it
            // is acting on without resolving credentials again.
            sessions.set(tabId, {
                client,
                // Every hop, in dial order. Only teardown reads it; everything
                // else wants `client`, the far end.
                chain: clients,
                stream,
                port: port1,
                hostId,
                hostName: label.name,
                address: label.address,
                openedAt: Date.now(),
            });

            // Decides for itself whether recording is on. Started before
            // the first byte can arrive, so a transcript never begins
            // mid-banner.
            sessionLog.start(tabId, {
                hostName: label.name,
                address: label.address,
                hostId,
                protocol: 'ssh',
            });

            port1.on('message', (event) => {
                const message = event.data;
                if (message?.type === 'input' && stream.writable) {
                    stream.write(message.data);
                } else if (message?.type === 'resize') {
                    stream.setWindow(message.rows, message.cols, 0, 0);
                }
            });
            port1.start();

            // Coalesce burst output into one post per tick.
            let buffer = '';
            let scheduled = false;
            const flush = () => {
                scheduled = false;
                if (!buffer) return;
                try {
                    port1.postMessage(buffer);
                } catch {
                    // Port closed while data was in flight.
                }
                buffer = '';
            };
            const append = (data) => {
                const text = data.toString('utf8');
                buffer += text;
                // The transcript is fed here rather than from the flush, so
                // it records what the server sent even if the port has gone
                // away: a reload leaves the window unable to receive while
                // the session itself is still perfectly alive.
                sessionLog.write(tabId, text);
                if (!scheduled) {
                    scheduled = true;
                    setImmediate(flush);
                }
            };

            stream.on('data', append);
            stream.stderr.on('data', append);

            stream.on('close', () => {
                flush();
                try {
                    port1.postMessage({ type: 'disconnected' });
                } catch {
                    // Already closed.
                }
                // Same guard as handleClosed: never tear down a session this
                // stream no longer belongs to.
                if (sessions.get(tabId)?.stream === stream) destroy(tabId);
            });

            if (window && !window.isDestroyed()) {
                window.webContents.postMessage('ssh-port', { tabId }, [port2]);
            }

            // Whatever the host wants run as soon as its shell is up: a
            // `cd`, an `export`, `tmux attach`. Written straight to the PTY,
            // which buffers it until the shell reads, so there is no prompt
            // to detect and nothing to wait for.
            //
            // It runs on reconnects too, which is the point of storing it on
            // the host rather than typing it: a session that dropped comes
            // back in the directory it was working in. The newline is added
            // here rather than stored, so a record whose last line was
            // trimmed still runs.
            //
            // The target's, not a jump host's: a bastion is passed through,
            // never worked in, and its own shell is never opened.
            if (target.initCommand) {
                try {
                    stream.write(`${target.initCommand}\n`);
                } catch (error) {
                    console.error(`Could not send the connect command for ${tabId}:`, error.message);
                }
            }

            // The path travels with the result rather than being asked for
            // separately: this is the one moment the whole of it is known.
            settle({ success: true, message: 'Connected', route: describeRoute(chain) });
        });
    });
}

function detectOS(tabId) {
    return new Promise((resolve) => {
        const session = sessions.get(tabId);
        if (!session?.client) {
            resolve({ os: 'unknown' });
            return;
        }

        let settled = false;
        let timer = null;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
        };

        timer = setTimeout(() => settle({ os: 'unknown' }), 5000);

        const cmd = '(cat /etc/os-release 2>/dev/null || true) && echo "---UNAME---" && (uname -a 2>/dev/null || ver 2>/dev/null || echo unknown)';
        session.client.exec(cmd, (err, stream) => {
            if (err) {
                settle({ os: 'unknown' });
                return;
            }

            let output = '';
            stream.on('data', (data) => { output += data.toString(); });
            stream.stderr.on('data', (data) => { output += data.toString(); });
            stream.on('close', () => settle(classifyShellOutput(output)));
        });
    });
}

module.exports = {
    sessions,
    get,
    describe,
    onDestroy,
    connect,
    destroy,
    destroyAll,
    detectOS,
    // Exported so the auth decisions can be exercised without a live server.
    planKeyboardInteractive,
    buildConfig,
};
