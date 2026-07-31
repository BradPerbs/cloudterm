const ssh = require('../ssh');
const transcript = require('../transcript');

/**
 * Running a command in the terminal the user is watching.
 *
 * The other way to do this is an exec channel, which is tidier: a real exit
 * code, nothing typed at the user's prompt, no shell history. It is also
 * invisible, and being able to watch the assistant work is most of what makes
 * it trustworthy. So this is the default, and the exec channel is the option.
 *
 * The hard part is knowing when the command has finished, because a PTY has no
 * concept of one: bytes arrive until they stop. Rather than pollute the user's
 * screen with a sentinel `echo` after every command, this watches for the two
 * things a person watching would use. Output goes quiet, and the last line on
 * screen is a prompt again.
 *
 * That is a heuristic and it is treated like one. It never reports failure on
 * its own, it says how it decided, and on a timeout it returns what it saw
 * rather than nothing.
 */

/** How often the buffer is checked while waiting. */
const POLL_MS = 120;

/** Quiet for this long before the screen is considered settled. */
const IDLE_MS = 500;

/**
 * A line that looks like a shell waiting for input.
 *
 * Deliberately loose: every shell, prompt theme and platform differs, and the
 * cost of a false negative here is waiting out the timeout, while the cost of
 * being too strict is never detecting completion at all.
 */
const PROMPT_TAIL = /(?:[$#>%])\s*$/;

/** The last line with anything on it, which is where a prompt would be. */
function lastLine(text) {
    const lines = String(text).split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index].trim()) return lines[index];
    }
    return '';
}

/**
 * Whether the screen looks like it is back at a prompt.
 *
 * `promptLine` is whatever was on the last line before the command was sent,
 * which is the best available description of what this user's prompt looks
 * like. Matching it exactly is the strong signal; the shape of a prompt is the
 * weak one, for the common case of a prompt that carries a clock or a git
 * branch and is never byte-identical twice.
 */
function looksFinished(text, promptLine) {
    // Nothing has come back yet, not even the echo of what was typed.
    if (!text.includes('\n')) return false;

    const last = lastLine(text).trimEnd();
    if (!last) return false;

    if (promptLine) {
        const expected = promptLine.trimEnd();
        if (expected && (last === expected || last.startsWith(expected))) return true;
    }

    return PROMPT_TAIL.test(last);
}

/**
 * Strip the parts of the capture that are not output: the echo of the command
 * on the first line, and the fresh prompt on the last.
 */
function tidy(text, command, promptLine) {
    const lines = String(text).split('\n');

    while (lines.length > 0 && !lines[0].trim()) lines.shift();
    // The terminal echoes what was typed, usually with the prompt in front of
    // it. Either way the command itself is the tail of that first line.
    if (lines.length > 0 && lines[0].includes(command.trim())) lines.shift();

    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length > 0) {
        const last = lines[lines.length - 1].trimEnd();
        const expected = (promptLine || '').trimEnd();
        if ((expected && last.startsWith(expected)) || PROMPT_TAIL.test(last)) lines.pop();
    }
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();

    return lines.join('\n');
}

/** Put the text into the session, whichever transport it is. */
async function deliver(paneId, payload, sessionAction) {
    const session = ssh.sessions.get(paneId);
    if (session?.stream?.writable) {
        session.stream.write(payload);
        return { success: true };
    }
    // Telnet and serial are driven by the renderer, which owns their input
    // path. Deliberately not routed through the pane's broadcast: a tool that
    // names one session must act on that session only.
    const result = await sessionAction({ action: 'input', sessionId: paneId, data: payload });
    return result?.success ? { success: true } : {
        success: false,
        message: result?.message || 'That session could not accept input',
    };
}

/**
 * Type a command into a session and wait for the screen to settle.
 *
 * Resolves with what appeared, whether or not completion was detected, so a
 * caller always has something to report.
 */
async function run(paneId, command, { timeout = 60000, submit = true, sessionAction } = {}) {
    if (!transcript.has(paneId)) {
        return { success: false, message: 'That session is not open' };
    }

    // Captured before anything is sent: this is what this user's prompt looks
    // like, which is the only reliable description of it we will get.
    const promptLine = lastLine(transcript.read(paneId, { lines: 3 }).text);
    const mark = transcript.cursor(paneId);

    const sent = await deliver(paneId, submit ? `${command}\n` : command, sessionAction);
    if (!sent.success) return sent;

    const deadline = Date.now() + timeout;
    let lastText = '';
    let lastChange = Date.now();

    for (;;) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS));

        const seen = transcript.read(paneId, { since: mark, maxChars: 200000 });
        if (!seen.available) {
            return {
                success: true,
                completed: false,
                output: tidy(lastText, command, promptLine),
                note: 'The session closed while the command was running.',
            };
        }

        if (seen.text !== lastText) {
            lastText = seen.text;
            lastChange = Date.now();
        }

        const settled = Date.now() - lastChange >= IDLE_MS;
        if (settled && looksFinished(lastText, promptLine)) {
            return {
                success: true,
                completed: true,
                output: tidy(lastText, command, promptLine),
            };
        }

        if (Date.now() >= deadline) {
            return {
                success: true,
                completed: false,
                output: tidy(lastText, command, promptLine),
                note: 'It had not returned to a prompt when the time ran out. '
                    + 'It may still be running, so read the terminal again rather than sending it twice.',
            };
        }
    }
}

module.exports = { run, looksFinished, tidy, lastLine, IDLE_MS };
