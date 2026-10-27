/**
 * What an edit changed, as lines to draw.
 *
 * Every runtime edits files, and each spells its tool differently: our own
 * `edit_file` and `write_file`, Claude Code's `Edit`, `Write` and
 * `MultiEdit`, OpenCode's `edit`, `write` and `patch`, Kimi's
 * `StrReplaceFile` and `WriteFile`, Grok's `search_replace` and
 * `str_replace_editor`. All of them carry the change in their arguments, as
 * the passage before and the passage after, as the whole new file, or as a
 * patch, so the change can be worked out from the call itself without reading
 * the file back. That is what `fromToolInput` does, and it is what the
 * transcript and the approval card draw instead of two blobs of text.
 *
 * Two patch shapes are read: a unified diff, which is what OpenCode's
 * permission request for an edit carries, and the `*** Begin Patch` envelope
 * that Codex's apply_patch and OpenCode's patch tool take.
 *
 * The comparison is by line and nothing cleverer. A word-level diff reads
 * better on a one-character change and worse on everything else, and the
 * question being answered is "what did it just do to my file", which lines
 * answer.
 */

/** Above this many changed lines, a diff is a wall rather than a thing to read. */
const MAX_LINES = 2000;
/** Lines of unchanged context kept around each run of changes. */
const CONTEXT = 3;
/**
 * The most lines a diff carried on an event keeps. The event goes into the
 * conversation's log and the history file, and the call's own arguments are
 * already there in full, so a long change is cut here and says how much was
 * left out rather than doubling the size of the log.
 */
const MAX_EVENT_LINES = 400;

/**
 * Lines to compare. Empty is no lines rather than one empty line, so a new
 * file reads as every line added and not as one blank line replaced, and the
 * newline that ends a file is not a line of its own. Windows line endings are
 * compared as plain ones: a file that kept its CRLF through an edit has not
 * changed on every line.
 */
const splitLines = (text) => {
    const body = String(text ?? '').replace(/\r\n/g, '\n');
    if (body === '') return [];
    const lines = body.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
};

/**
 * The longest common subsequence of two line arrays, as a list of steps.
 *
 * The plain dynamic-programming table, which is O(n*m) and fine at the size
 * a single edit is. Anything larger is cut off before it gets here, and the
 * lines both sides share at either end never reach it at all.
 */
function lcsDiff(before, after) {
    const rows = before.length;
    const columns = after.length;
    // One row at a time would be enough for the length, but the walk back
    // needs the whole table, and at these sizes it costs nothing.
    const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = columns - 1; j >= 0; j -= 1) {
            table[i][j] = before[i] === after[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    const steps = [];
    let i = 0;
    let j = 0;
    while (i < rows && j < columns) {
        if (before[i] === after[j]) {
            steps.push({ type: 'same', text: before[i] });
            i += 1;
            j += 1;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            steps.push({ type: 'remove', text: before[i] });
            i += 1;
        } else {
            steps.push({ type: 'add', text: after[j] });
            j += 1;
        }
    }
    while (i < rows) {
        steps.push({ type: 'remove', text: before[i] });
        i += 1;
    }
    while (j < columns) {
        steps.push({ type: 'add', text: after[j] });
        j += 1;
    }
    return steps;
}

/**
 * The steps, with long runs of unchanged lines dropped.
 *
 * Each hunk carries the line numbers it starts at on both sides, so the
 * lines can be numbered the way a diff on the command line numbers them.
 */
function toHunks(steps, { context = CONTEXT, startBefore = 1, startAfter = 1 } = {}) {
    const changed = steps.map(step => step.type !== 'same');
    const keep = steps.map((step, index) => {
        if (changed[index]) return true;
        for (let near = index - context; near <= index + context; near += 1) {
            if (changed[near]) return true;
        }
        return false;
    });

    const hunks = [];
    let current = null;
    let beforeLine = startBefore;
    let afterLine = startAfter;

    steps.forEach((step, index) => {
        const numbered = {
            type: step.type,
            text: step.text,
            before: step.type === 'add' ? null : beforeLine,
            after: step.type === 'remove' ? null : afterLine,
        };
        if (step.type !== 'add') beforeLine += 1;
        if (step.type !== 'remove') afterLine += 1;

        if (!keep[index]) {
            current = null;
            return;
        }
        if (!current) {
            current = { before: numbered.before ?? beforeLine, after: numbered.after ?? afterLine, lines: [] };
            hunks.push(current);
        }
        current.lines.push(numbered);
    });

    return hunks;
}

/**
 * The change between two texts, or null when there is none.
 *
 * The lines both sides share at the start and at the end are set aside before
 * the comparison, so a one-line edit to a long file costs a walk down it and
 * not a table the size of it, and the cap on what can be drawn is a cap on
 * the change rather than on the file.
 */
function between(before, after, options = {}) {
    const old = splitLines(before);
    const next = splitLines(after);

    let head = 0;
    while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
    let tail = 0;
    while (tail < old.length - head && tail < next.length - head
        && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;

    const removedLines = old.slice(head, old.length - tail);
    const addedLines = next.slice(head, next.length - tail);
    if (removedLines.length + addedLines.length === 0) return null;
    if (removedLines.length + addedLines.length > MAX_LINES) {
        return { tooLarge: true, added: addedLines.length, removed: removedLines.length, hunks: [] };
    }

    // Only the context either side of the change is drawn, so only that much
    // of the shared head and tail goes into the steps.
    const context = options.context ?? CONTEXT;
    const same = text => ({ type: 'same', text });
    const lead = old.slice(Math.max(0, head - context), head).map(same);
    const trail = old.slice(old.length - tail, old.length - tail + context).map(same);
    const middle = lcsDiff(removedLines, addedLines);
    const start = head - lead.length + 1;

    return {
        added: middle.filter(step => step.type === 'add').length,
        removed: middle.filter(step => step.type === 'remove').length,
        hunks: toHunks([...lead, ...middle, ...trail], { context, startBefore: start, startAfter: start }),
    };
}

/** Several changes to one file as one: every hunk, the counts summed. */
function combine(parts) {
    const kept = parts.filter(Boolean);
    if (kept.length === 0) return null;
    return {
        added: kept.reduce((total, part) => total + part.added, 0),
        removed: kept.reduce((total, part) => total + part.removed, 0),
        hunks: kept.flatMap(part => part.hunks),
        ...(kept.some(part => part.tooLarge) ? { tooLarge: true } : {}),
    };
}

/**
 * A diff cut to `limit` lines, for an event. The counts stay whole, and
 * `hidden` says how many lines were left off the end.
 */
function capped(change, limit = MAX_EVENT_LINES) {
    if (!change || change.tooLarge) return change;
    let room = limit;
    let hidden = 0;
    const hunks = [];
    for (const hunk of change.hunks) {
        if (room <= 0) {
            hidden += hunk.lines.length;
            continue;
        }
        if (hunk.lines.length <= room) {
            hunks.push(hunk);
            room -= hunk.lines.length;
            continue;
        }
        hunks.push({ ...hunk, lines: hunk.lines.slice(0, room) });
        hidden += hunk.lines.length - room;
        room = 0;
    }
    return hidden > 0 ? { ...change, hunks, hidden } : change;
}

/* ------------------------------------------------------------------ *
 * Patches
 * ------------------------------------------------------------------ */

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * A unified diff, as the same hunks `between` makes, numbered from its own
 * headers. Null for text that has no hunk in it. The file headers (`---`,
 * `+++`, `diff --git`, `Index:`) are read for the path and otherwise skipped,
 * as is the "no newline at end of file" marker.
 */
function fromUnified(text, { path = '' } = {}) {
    if (typeof text !== 'string' || !text.includes('@@')) return null;

    const hunks = [];
    let current = null;
    let beforeLine = 0;
    let afterLine = 0;
    let added = 0;
    let removed = 0;
    let named = path;

    const rows = text.replace(/\r\n/g, '\n').split('\n');
    // The newline that ends the text is not an empty line of context.
    if (rows[rows.length - 1] === '') rows.pop();

    for (const raw of rows) {
        const header = HUNK_HEADER.exec(raw);
        if (header) {
            beforeLine = Number(header[1]);
            afterLine = Number(header[2]);
            current = { before: beforeLine, after: afterLine, lines: [] };
            hunks.push(current);
            continue;
        }
        if (!current) {
            if (!named && raw.startsWith('+++ ')) {
                named = raw.slice(4).replace(/^b\//, '').split('\t')[0].trim();
            }
            continue;
        }
        if (raw.startsWith('+++ ') || raw.startsWith('--- ') || raw.startsWith('diff ') || raw.startsWith('Index: ')) {
            current = null;
            continue;
        }
        if (raw.startsWith('\\')) continue;
        const sign = raw[0];
        const body = raw.slice(1);
        if (sign === '+') {
            current.lines.push({ type: 'add', text: body, before: null, after: afterLine });
            afterLine += 1;
            added += 1;
        } else if (sign === '-') {
            current.lines.push({ type: 'remove', text: body, before: beforeLine, after: null });
            beforeLine += 1;
            removed += 1;
        } else if (sign === ' ' || raw === '') {
            current.lines.push({ type: 'same', text: body, before: beforeLine, after: afterLine });
            beforeLine += 1;
            afterLine += 1;
        }
    }

    if (added + removed === 0) return null;
    if (added + removed > MAX_LINES) return { path: named, tooLarge: true, added, removed, hunks: [] };
    return { path: named, added, removed, hunks: hunks.filter(hunk => hunk.lines.length > 0) };
}

const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/;

/**
 * The `*** Begin Patch` envelope Codex's apply_patch takes, and OpenCode's
 * patch tool after it: a section per file, each `@@` starting a stretch of
 * context and changed lines. It carries no line numbers, so it is drawn as
 * passages (`partial`), and a hunk names its file when the patch has more
 * than one. Null for text that is not one.
 */
function fromPatch(text) {
    if (typeof text !== 'string' || !text.includes('*** Begin Patch')) return null;

    const files = [];
    const hunks = [];
    let current = null;
    let file = '';
    let added = 0;
    let removed = 0;

    const open = () => {
        current = { before: null, after: null, file, lines: [] };
        hunks.push(current);
    };

    for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
        const section = PATCH_FILE.exec(raw);
        if (section) {
            file = section[2].trim();
            files.push(file);
            current = null;
            continue;
        }
        if (raw.startsWith('*** ')) {
            // Begin, End, End of File, Move to: none of them a line of the file.
            continue;
        }
        if (!file) continue;
        if (raw.startsWith('@@')) {
            open();
            continue;
        }
        const sign = raw[0];
        if (sign !== '+' && sign !== '-' && sign !== ' ') continue;
        if (!current) open();
        const type = sign === '+' ? 'add' : sign === '-' ? 'remove' : 'same';
        if (type === 'add') added += 1;
        if (type === 'remove') removed += 1;
        current.lines.push({ type, text: raw.slice(1), before: null, after: null });
    }

    if (added + removed === 0) return null;
    const path = files.join(', ');
    if (added + removed > MAX_LINES) return { path, tooLarge: true, added, removed, hunks: [], partial: true };
    const drawn = hunks.filter(hunk => hunk.lines.length > 0);
    // One file needs no name on each hunk: the header already says it.
    if (files.length < 2) for (const hunk of drawn) delete hunk.file;
    return { path, added, removed, hunks: drawn, partial: true };
}

/* ------------------------------------------------------------------ *
 * Tool calls
 * ------------------------------------------------------------------ */

/** The first value any of these keys has, as a string. */
function pick(input, keys) {
    for (const key of keys) {
        const value = input?.[key];
        if (typeof value === 'string') return value;
    }
    return undefined;
}

const PATH_KEYS = ['path', 'file_path', 'filePath', 'filepath', 'target_file', 'targetFile', 'file'];
const OLD_KEYS = ['old', 'old_string', 'oldString', 'old_str', 'oldText', 'search'];
const NEW_KEYS = ['new', 'new_string', 'newString', 'new_str', 'newText', 'replace'];
const CONTENT_KEYS = ['content', 'contents', 'file_text', 'text'];
const PATCH_KEYS = ['diff', 'patch', 'patchText', 'unified_diff'];

/** Tools that replace a file whole, across the runtimes. */
const WRITE_TOOLS = new Set(['write_file', 'write', 'create_file', 'writefile']);
/** Tools that replace a passage, across the runtimes. */
const EDIT_TOOLS = new Set([
    'edit_file', 'edit', 'multiedit', 'search_replace', 'str_replace', 'str_replace_editor',
    'strreplacefile', 'apply_patch', 'patch', 'replace',
]);
/** Tools whose patch arrives under the generic `input` key, as Codex's does. */
const PATCH_TOOLS = new Set(['apply_patch', 'patch']);

const bareName = toolName => String(toolName || '').toLowerCase().replace(/^mcp__[^_]+__/, '');

/**
 * The passages one call replaces, in the order they apply: Claude Code's
 * `MultiEdit` has `edits`, Kimi's `StrReplaceFile` has `edit` as one or a list,
 * and everyone else puts a single pair at the top level.
 */
function passagesOf(input) {
    if (!input || typeof input !== 'object') return [];
    const one = (value) => {
        const old = pick(value, OLD_KEYS);
        const next = pick(value, NEW_KEYS);
        return old !== undefined && next !== undefined
            ? [{ old, new: next, all: Boolean(value.replace_all || value.replaceAll || value.all) }]
            : [];
    };
    if (Array.isArray(input.edits)) return input.edits.flatMap(one);
    if (Array.isArray(input.edit)) return input.edit.flatMap(one);
    if (input.edit && typeof input.edit === 'object') return one(input.edit);
    return one(input);
}

/** Whether a call writes a file whole: by its name, or Grok's editor told to create one. */
const isWrite = (bare, input) => WRITE_TOOLS.has(bare)
    || (bare === 'str_replace_editor' && input?.command === 'create');

/**
 * The file an edit or write call is aimed at, or '' for any other call.
 * Named by the tool or by the shape of its arguments, since a runtime can
 * call its edit tool anything as long as it carries the two passages.
 */
function editTarget(toolName, input) {
    if (!input || typeof input !== 'object') return '';
    const bare = bareName(toolName);
    const shaped = passagesOf(input).length > 0;
    if (!shaped && !isWrite(bare, input) && !EDIT_TOOLS.has(bare)) return '';
    return pick(input, PATH_KEYS) || '';
}

/**
 * The change a tool call is about to make, from its arguments alone.
 *
 * Answers `{ path, added, removed, hunks }`, or null when the call is not an
 * edit or carries nothing to compare. A passage taken out of the middle of a
 * file is marked `partial`, since the line numbers its hunks would claim are
 * not the file's. A whole-file write has no before to compare against, so it
 * is reported as every line added, which is what it is, and marked `whole`.
 */
function fromToolInput(toolName, input) {
    if (!input || typeof input !== 'object') return null;
    const bare = bareName(toolName);
    const path = pick(input, PATH_KEYS) || '';

    const passages = passagesOf(input);
    if (passages.length > 0) {
        const change = combine(passages.map(item => between(item.old, item.new)));
        return change ? { path, ...change, partial: true } : null;
    }

    if (isWrite(bare, input)) {
        const content = pick(input, CONTENT_KEYS);
        if (content === undefined) return null;
        const change = between('', content);
        return change ? { path, ...change, whole: true } : null;
    }

    // A change described rather than asked for: OpenCode's permission request
    // carries its edit as a unified diff, with real line numbers in it, and a
    // patch tool carries the envelope.
    const patch = pick(input, PATCH_KEYS) ?? (PATCH_TOOLS.has(bare) ? pick(input, ['input']) : undefined);
    if (patch !== undefined) return fromPatch(patch) || fromUnified(patch, { path });

    return null;
}

/**
 * The change to stamp on a tool call or an approval card, cut to what an
 * event keeps, or null. Never throws: a diff that cannot be worked out is a
 * row without one, not a turn that breaks.
 */
function forEvent(toolName, input) {
    try {
        return capped(fromToolInput(toolName, input));
    } catch (error) {
        console.error('Could not describe an edit:', error.message);
        return null;
    }
}

module.exports = {
    between,
    combine,
    capped,
    forEvent,
    fromToolInput,
    fromUnified,
    fromPatch,
    editTarget,
    passagesOf,
    MAX_LINES,
    MAX_EVENT_LINES,
    CONTEXT,
    _test: { lcsDiff, toHunks, splitLines },
};
