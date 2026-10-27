const { StringDecoder } = require('string_decoder');

/**
 * Reading a stretch of a text file, and replacing one passage of it.
 *
 * Kept apart from the tool definitions because none of it knows about SFTP or
 * sessions: it is what to do with the text once it is here, and that is the
 * part worth testing on its own.
 */

/** How much one read may hand back, matched to `read_file`'s cap. */
const MAX_CHARS = 120000;

/**
 * How far into a file a read by line will scan before giving up.
 *
 * A stretch out of the middle of a big log is the commonest reason to read by
 * line, and the lines before it have to be counted to find it. Past this the
 * shell does it better: `sed -n` or `tail` on the server reads the file where
 * it is rather than across the connection.
 */
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

/** Whether a buffer is a binary file rather than text, from a NUL in its head. */
function looksBinary(buffer) {
    return buffer.subarray(0, 8000).includes(0);
}

/** The lines of a text, without the empty one a final newline would add. */
function linesOf(text) {
    const lines = text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/** Where a read starts and how many lines it takes, from what the agent asked for. */
function range({ offset, limit } = {}) {
    const first = Math.max(1, Math.floor(Number(offset) || 1));
    // No limit is the rest of the file, not one line of it.
    const count = limit ? Math.max(1, Math.floor(Number(limit))) : 0;
    return { first, last: count ? first + count - 1 : Infinity };
}

/**
 * The lines taken, capped at what one read may return.
 *
 * Whole lines where possible, so the stretch that comes back ends where a line
 * does. A single line longer than the cap on its own, which a minified file
 * is, is cut rather than dropped.
 */
function capped(taken) {
    let chars = 0;
    for (let index = 0; index < taken.length; index += 1) {
        chars += taken[index].length + 1;
        if (chars <= MAX_CHARS) continue;
        if (index === 0) return { lines: [taken[0].slice(0, MAX_CHARS)], trimmed: true };
        return { lines: taken.slice(0, index), trimmed: true };
    }
    return { lines: taken, trimmed: false };
}

/**
 * A stretch of a text already in memory, by line.
 *
 * One-based, as every editor and every error message counts lines. Each line
 * keeps whatever ending it had, so a passage copied out of the result matches
 * the file when it is handed back to `applyEdit`.
 */
function sliceLines(text, options = {}) {
    const { first, last } = range(options);
    const lines = linesOf(text);
    if (first > lines.length) return { content: '', from: first, to: first - 1, lines: lines.length, past: true };

    const { lines: taken, trimmed } = capped(lines.slice(first - 1, last === Infinity ? undefined : last));
    return {
        content: taken.join('\n'),
        from: first,
        to: first + taken.length - 1,
        lines: lines.length,
        ...(trimmed ? { trimmed: true } : {}),
    };
}

/**
 * The same, from a stream, for a file too big to bring over whole.
 *
 * Stops reading as soon as the stretch is complete, so the first hundred lines
 * of a gigabyte log cost a hundred lines. The file's length is only known when
 * the read reached its end, and is left out otherwise rather than guessed.
 */
function streamLines(stream, options = {}) {
    const { first, last } = range(options);
    const maxBytes = options.maxBytes || MAX_SCAN_BYTES;

    return new Promise((resolve, reject) => {
        const decoder = new StringDecoder('utf8');
        const taken = [];
        let carry = '';
        let line = 0;
        let bytes = 0;
        let chars = 0;
        let done = false;

        const finish = (outcome) => {
            if (done) return;
            done = true;
            stream.removeAllListeners?.('data');
            stream.destroy?.();
            const kept = capped(taken);
            resolve({
                content: kept.lines.join('\n'),
                from: first,
                to: first + kept.lines.length - 1,
                ...outcome,
                ...(kept.trimmed ? { trimmed: true } : {}),
            });
        };

        /** One whole line. Returns false once nothing more is wanted. */
        const take = (text) => {
            line += 1;
            if (line < first) return true;
            taken.push(text);
            chars += text.length + 1;
            // Enough to fill a read: anything further would be cut anyway.
            if (chars > MAX_CHARS) {
                finish({ trimmed: true });
                return false;
            }
            if (line >= last) {
                finish({});
                return false;
            }
            return true;
        };

        stream.on('data', (chunk) => {
            if (done) return;
            bytes += chunk.length;
            const parts = (carry + decoder.write(chunk)).split('\n');
            carry = parts.pop();
            for (const part of parts) {
                if (!take(part)) return;
            }
            if (bytes > maxBytes) finish({ scanLimit: true, scanned: bytes, ...(line < first ? { past: true } : {}) });
        });

        stream.on('end', () => {
            if (done) return;
            carry += decoder.end();
            if (carry && !take(carry)) return;
            finish({ lines: line, ...(first > line ? { past: true } : {}) });
        });

        stream.on('error', (error) => {
            if (done) return;
            done = true;
            reject(error);
        });
    });
}

/* ------------------------------------------------------------------ *
 * Editing a passage
 * ------------------------------------------------------------------ */

/** How many of a text's line breaks are Windows ones. */
const crlfCount = (text) => (text.match(/\r\n/g) || []).length;
const toLf = (text) => text.replace(/\r\n/g, '\n');
const toCrlf = (text) => toLf(text).replace(/\n/g, '\r\n');

/**
 * Replace a passage of a file with another.
 *
 * Matched on the text with its line endings normalised, and written back with
 * the file's own. A model writes `\n` because that is what text is, and a
 * config file edited on Windows at some point in its life has `\r\n` in it:
 * matching literally meant "the text to replace was not found" on a passage
 * the agent had just read and copied exactly, and the way around it was to
 * rewrite the whole file, which changed every line ending in it and buried the
 * real change in a whitespace diff.
 */
function applyEdit(content, oldText, newText, { all = false } = {}) {
    if (!oldText) return { error: 'Say which text to replace: `old` is empty.' };

    // The file's own ending, by weight of evidence: a file that is mostly
    // CRLF keeps CRLF, whatever the passage coming in uses.
    const breaks = (toLf(content).match(/\n/g) || []).length;
    const windows = crlfCount(content) > 0 && crlfCount(content) >= breaks / 2;
    const flat = toLf(content);
    const needle = toLf(oldText);
    const replacement = toLf(String(newText ?? ''));

    let count = 0;
    let at = flat.indexOf(needle);
    while (at !== -1) {
        count += 1;
        at = flat.indexOf(needle, at + needle.length);
    }
    if (count === 0) {
        return { error: 'The text to replace was not found. Read the file again and copy it exactly, whitespace included.' };
    }
    if (count > 1 && !all) {
        return {
            error: `The text to replace appears ${count} times. Include more of the surrounding lines so it `
                + 'matches once, or pass all: true to replace every occurrence.',
        };
    }

    const edited = all ? flat.split(needle).join(replacement) : flat.replace(needle, () => replacement);
    return { content: windows ? toCrlf(edited) : edited, replaced: count };
}

module.exports = {
    MAX_CHARS,
    MAX_SCAN_BYTES,
    looksBinary,
    sliceLines,
    streamLines,
    applyEdit,
};
