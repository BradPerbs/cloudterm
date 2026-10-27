/**
 * Documents attached to a message, checked before anything is done with them.
 *
 * Pictures travel as bytes the model looks at (see `images.js`). These travel
 * as words the model reads, inlined into the prompt as `<attached-file>`
 * blocks, so they work with every agent: no capability to negotiate, just text
 * like the message itself. The renderer has already turned a PDF, a Word file
 * or a spreadsheet into its words (see `lib/files` and `lib/office` there), so
 * what arrives here is always `{ name, mediaType, text }`.
 *
 * The limits keep one message from eating the context: five files of 64 KB
 * each is already a long read. Anything over is refused with the file named,
 * so the user can trim it rather than wonder what the model saw.
 *
 * Kept free of Electron, like `images.js`, so it can be tested on its own.
 */

const MAX_FILES = 5;
const MAX_FILE_CHARS = 64 * 1024;

/**
 * Room for the note the renderer adds when it cuts a long document short, so
 * a file clipped to the limit is not then refused for being over it.
 */
const CLIP_NOTE = 200;

/**
 * The attachments as `{ name, mediaType, text }`, or the reason one of them
 * cannot be sent. All or nothing, like images: a question written about two
 * files should not be answered with one silently missing.
 */
function readFiles(raw) {
    if (raw === undefined || raw === null) return { files: [], error: '' };
    if (!Array.isArray(raw)) return { files: [], error: 'The files were not a list' };
    if (raw.length > MAX_FILES) {
        return { files: [], error: `A message can carry at most ${MAX_FILES} files` };
    }

    const files = [];
    for (const entry of raw) {
        const name = String(entry?.name || 'file.txt').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file.txt';
        const mediaType = String(entry?.mediaType || 'text/plain').toLowerCase().slice(0, 120);
        const text = typeof entry?.text === 'string' ? entry.text : '';

        if (!text.trim()) {
            return { files: [], error: `${name} is empty` };
        }
        if (text.length > MAX_FILE_CHARS + CLIP_NOTE) {
            return { files: [], error: `${name} is larger than the ${MAX_FILE_CHARS / 1024} KB a file may be` };
        }
        files.push({ name, mediaType, text });
    }
    return { files, error: '' };
}

/** What may sit inside an attribute without ending it. */
const attribute = value => String(value || '').replace(/["\n\r]/g, ' ').trim();

/**
 * The files as prompt text: material first, the question last, like the rest.
 * A closing tag inside a document would end its block early, so it is spelled
 * out of harm's way rather than trusted, the way a spec's is.
 */
function fileBlock(files) {
    return (files || [])
        .map(entry => [
            `<attached-file name="${attribute(entry.name)}" type="${attribute(entry.mediaType)}">`,
            String(entry.text || '').replace(/<\/attached-file>/gi, '</ attached-file>'),
            '</attached-file>',
        ].join('\n'))
        .join('\n\n');
}

/**
 * The files without their words, for the transcript: enough for a chip. The
 * words went to the agent with the message and are not kept anywhere else, so
 * a long log does not end up in the history file twice.
 */
function stripFiles(files) {
    return (files || []).map(({ name, mediaType }) => ({ name, mediaType }));
}

module.exports = { readFiles, fileBlock, stripFiles, MAX_FILES, MAX_FILE_CHARS };
