const ssh = require('../ssh');

/**
 * Run a command on a session's server and collect what it printed.
 *
 * This uses a separate exec channel rather than typing into the shell the user
 * is looking at, which matters for three reasons. The output comes back
 * attributed and with an exit code, instead of having to be scraped back out
 * of a screen. It cannot disturb whatever the person has half-typed at their
 * prompt. And it leaves no trace in their shell history, so a command the
 * assistant ran is never later mistaken for one they ran.
 *
 * Typing into the visible shell is a separate tool, because sometimes that is
 * exactly what is wanted: an interactive prompt, a program already running,
 * something the user should see happen.
 */

/** Long enough for a package install, short enough to not hang a turn. */
const DEFAULT_TIMEOUT = 60000;

/** What one command is allowed to return, per stream. */
const MAX_OUTPUT = 60000;

function clip(text, limit) {
    if (text.length <= limit) return { text, truncated: false };
    // The tail, not the head: the end of a long output is where the error and
    // the summary line are.
    return { text: text.slice(-limit), truncated: true };
}

function run(paneId, command, { timeout = DEFAULT_TIMEOUT, cwd = '' } = {}) {
    return new Promise((resolve) => {
        const session = ssh.sessions.get(paneId);
        if (!session) {
            resolve({ success: false, message: 'That session is not open' });
            return;
        }
        if (!session.client) {
            resolve({
                success: false,
                message: 'That session is not an SSH connection, so it cannot run a command on its own channel',
            });
            return;
        }

        let settled = false;
        let timer = null;
        let stream = null;
        // Declared before the timer that reads them, so what the command
        // managed to print before it was stopped is reported rather than lost.
        let out = '';
        let err = '';

        const settle = (value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
        };

        timer = setTimeout(() => {
            // Closed rather than left running: an abandoned channel keeps
            // producing output nobody will read, and on a busy server that is
            // a leak that lasts as long as the session does.
            try {
                stream?.close();
            } catch {
                // Already gone with the connection.
            }
            settle({
                success: false,
                timedOut: true,
                message: `The command was still running after ${Math.round(timeout / 1000)}s and was stopped`,
                stdout: clip(out, MAX_OUTPUT).text,
                stderr: clip(err, MAX_OUTPUT).text,
            });
        }, timeout);

        // A working directory is expressed as part of the command rather than
        // held as channel state, because each exec gets a fresh shell: there
        // is no session to carry a `cd` forward into.
        const full = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;

        session.client.exec(full, { pty: false }, (error, channel) => {
            if (error) {
                settle({ success: false, message: error.message });
                return;
            }
            stream = channel;

            channel.on('data', (data) => {
                // Capped as it arrives. Letting a runaway `cat` of a binary
                // build a hundred megabytes of string first, then trimming,
                // would be the same as not having a cap.
                if (out.length < MAX_OUTPUT * 4) out += data.toString('utf8');
            });
            channel.stderr.on('data', (data) => {
                if (err.length < MAX_OUTPUT * 4) err += data.toString('utf8');
            });

            channel.on('close', (code, signal) => {
                const stdout = clip(out, MAX_OUTPUT);
                const stderr = clip(err, MAX_OUTPUT);
                settle({
                    success: true,
                    exitCode: typeof code === 'number' ? code : null,
                    signal: signal || null,
                    stdout: stdout.text,
                    stderr: stderr.text,
                    truncated: stdout.truncated || stderr.truncated,
                });
            });

            channel.on('error', (channelError) => {
                settle({ success: false, message: channelError.message });
            });
        });
    });
}

/** Single quotes, with the one escape that survives inside them. */
function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

module.exports = { run, shellQuote, DEFAULT_TIMEOUT, MAX_OUTPUT };
