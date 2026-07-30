/**
 * Shape and validation for snippets: named commands the user keeps around and
 * sends into a session instead of retyping.
 *
 * Kept free of dependencies for the same reason as `tunnel-config.js`, so the
 * store and the IPC layer agree on one record shape without requiring each
 * other.
 *
 * A snippet's text may carry `{{placeholders}}`. Those are resolved in the
 * renderer, immediately before the text is inserted, because that is where the
 * user is standing when they answer for them. Nothing here expands anything: a
 * stored snippet is stored exactly as it was written.
 *
 * A snippet is one of two kinds:
 *
 *   command   one piece of text, the original thing
 *   package   an ordered series of steps, each either inline text or a
 *             reference to a command in the library
 *
 * Packages are the same record rather than a second collection, so scoping,
 * tags, search and the palette all keep working without being taught about a
 * new type. What a package sends is worked out by `composeSnippet`.
 */

/** Long enough for a real here-doc, short enough that the store stays sane. */
const MAX_COMMAND_LENGTH = 10000;
const MAX_NAME_LENGTH = 120;

/** Well past any real runbook, and a bound on what one insert can send. */
const MAX_STEPS = 50;

const KINDS = ['command', 'package'];

/** `{{ name }}`: the inner text is the prompt label, trimmed. */
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

let counter = 0;

function nextId() {
    counter += 1;
    return `snippet-${Date.now()}-${counter}`;
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** Tags are a flat, deduplicated, lower-cased set; they only exist to filter by. */
function normalizeTags(raw) {
    const list = Array.isArray(raw)
        ? raw
        : String(raw || '').split(',');

    const seen = new Set();
    for (const entry of list) {
        const tag = clean(entry).toLowerCase();
        if (tag) seen.add(tag);
    }
    return [...seen];
}

/** Host ids this snippet is scoped to. Empty means every host. */
function normalizeHostIds(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    for (const entry of raw) {
        const id = clean(entry);
        if (id) seen.add(id);
    }
    return [...seen];
}

/** Only the trailing newline goes; interior lines and leading space are the text. */
const normalizeCommandText = (raw) => String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .slice(0, MAX_COMMAND_LENGTH);

/**
 * One step of a package: either a reference to a snippet in the library, or a
 * command written inline for this package alone.
 *
 * A referenced step keeps no text of its own. Holding both would let the two
 * drift and leave it ambiguous which one the user meant to run.
 */
function normalizeStep(raw = {}, index = 0) {
    const ref = clean(raw.ref);
    return {
        id: clean(raw.id) || `step-${Date.now()}-${index}-${++counter}`,
        ref,
        command: ref ? '' : normalizeCommandText(raw.command),
    };
}

/** Empty steps are dropped rather than stored: a blank line is not a step. */
const normalizeSteps = (list) => (Array.isArray(list) ? list : [])
    .map(normalizeStep)
    .filter(step => step.ref || step.command.trim())
    .slice(0, MAX_STEPS);

function normalizeSnippet(raw = {}) {
    return {
        id: clean(raw.id) || nextId(),
        name: clean(raw.name).slice(0, MAX_NAME_LENGTH),
        // Anything unrecognised is a command, which is what every record
        // written before packages existed is. No migration needed.
        kind: KINDS.includes(raw.kind) ? raw.kind : 'command',
        steps: normalizeSteps(raw.steps),
        // Only meaningful for a package: join the steps with `&&` so the series
        // stops at the first failure, instead of running each in turn.
        chain: Boolean(raw.chain),
        // Kept even on a package, so switching a record between the two kinds
        // and back does not throw the other form's work away.
        command: normalizeCommandText(raw.command),
        description: clean(raw.description).slice(0, MAX_NAME_LENGTH * 4),
        tags: normalizeTags(raw.tags),
        hostIds: normalizeHostIds(raw.hostIds),
        // Off by default. Sending a command *and* pressing Enter for the user
        // is the one thing a snippet does that cannot be taken back, so it is
        // opted into per snippet rather than assumed.
        runImmediately: Boolean(raw.runImmediately),
    };
}

const normalizeSnippets = (list) =>
    (Array.isArray(list) ? list : []).map(normalizeSnippet);

/** Returns an empty string when the snippet is usable, or the reason it isn't. */
function validateSnippet(snippet) {
    if (!clean(snippet?.name)) return 'Name is required';

    if (snippet?.kind === 'package') {
        const steps = Array.isArray(snippet.steps) ? snippet.steps : [];
        const usable = steps.filter(step =>
            clean(step?.ref) || String(step?.command ?? '').trim());
        if (usable.length === 0) return 'A package needs at least one step';
        if (usable.length > MAX_STEPS) return `A package holds at most ${MAX_STEPS} steps`;
        return '';
    }

    if (!String(snippet?.command ?? '').trim()) return 'Command is required';
    if (String(snippet.command).length > MAX_COMMAND_LENGTH) {
        return `Command is longer than ${MAX_COMMAND_LENGTH} characters`;
    }
    return '';
}

/**
 * Join a package's steps into the one block of text that gets sent.
 *
 *   chain off   one per line. Every step runs, whatever the one before it did.
 *   chain on    joined with `&&`, so the series stops at the first failure.
 *
 * A multi-line step in chained mode is wrapped in a brace group, because
 * `a\nb && c` would only guard the last line. Braces rather than a subshell:
 * a `cd` in one step has to still apply to the next, which `( )` would undo.
 * Single-line steps are left bare so the preview reads as what it is:
 * `git pull && npm ci && systemctl restart app`, not a wall of punctuation.
 */
function joinSteps(parts, chain) {
    if (!chain) return parts.join('\n');
    return parts
        .map(part => (part.includes('\n') ? `{\n${part}\n}` : part))
        .join(' && ');
}

/**
 * The text a snippet sends, and anything it could not resolve.
 *
 * A step pointing at a snippet that has since been deleted is reported rather
 * than skipped. Dropping it silently is the dangerous option: a package that
 * reads "stop the service, deploy, start the service" must not quietly become
 * "deploy, start the service" because one record went missing. The caller
 * refuses to run a package with anything in `missing`.
 *
 * A step referencing another *package* counts as missing too. One level of
 * nesting is all this allows, which is what makes a cycle impossible rather
 * than something that has to be detected.
 */
function composeSnippet(snippet, library = []) {
    if (snippet?.kind !== 'package') {
        return { text: String(snippet?.command ?? ''), missing: [], steps: [] };
    }

    const byId = new Map((library || []).map(entry => [entry.id, entry]));
    const parts = [];
    const missing = [];
    const steps = [];

    for (const step of snippet.steps || []) {
        if (step.ref) {
            const target = byId.get(step.ref);
            if (!target || target.kind === 'package') {
                missing.push({ id: step.id, ref: step.ref, name: target?.name || '' });
                continue;
            }
            parts.push(target.command);
            steps.push({ id: step.id, name: target.name, command: target.command, ref: step.ref });
            continue;
        }

        if (String(step.command ?? '').trim()) {
            parts.push(step.command);
            steps.push({ id: step.id, name: '', command: step.command, ref: '' });
        }
    }

    return { text: joinSteps(parts, Boolean(snippet.chain)), missing, steps };
}

/** The distinct placeholder names in a snippet, in the order they first appear. */
function placeholdersIn(command) {
    const found = [];
    const seen = new Set();

    for (const match of String(command ?? '').matchAll(PLACEHOLDER_PATTERN)) {
        const name = match[1].trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        found.push(name);
    }

    return found;
}

/**
 * Substitute answers into a snippet. A placeholder with no answer is left
 * standing rather than blanked: sending `rm -rf /var/log/` because the user
 * skipped a field would be considerably worse than sending something that
 * visibly still has a `{{path}}` in it.
 */
function fillPlaceholders(command, values = {}) {
    return String(command ?? '').replace(PLACEHOLDER_PATTERN, (match, name) => {
        const value = values[name.trim()];
        return value === undefined || value === '' ? match : String(value);
    });
}

module.exports = {
    MAX_COMMAND_LENGTH,
    MAX_NAME_LENGTH,
    MAX_STEPS,
    PLACEHOLDER_PATTERN,
    normalizeSnippet,
    normalizeSnippets,
    validateSnippet,
    placeholdersIn,
    fillPlaceholders,
    composeSnippet,
    joinSteps,
};
