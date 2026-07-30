/**
 * Renderer-side view of a snippet.
 *
 * The shape and rules mirror `src/main/snippet-config.js`. They are restated
 * here rather than shared because the renderer is sandboxed and cannot reach
 * main-process modules. Main stays the authority and normalises again before
 * anything is written to disk.
 */

/** `{{ name }}`: the inner text is the prompt label. */
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const MAX_STEPS = 50;

export const emptySnippet = () => ({
    name: '',
    kind: 'command',
    steps: [],
    chain: false,
    command: '',
    description: '',
    tags: [],
    hostIds: [],
    runImmediately: false,
});

export const isPackage = (snippet) => snippet?.kind === 'package';

/** A blank step, ready to be filled in. Inline unless a `ref` is given. */
export const emptyStep = (ref = '') => ({
    id: `step-${Date.now()}-${Math.round(performance.now() * 1000)}`,
    ref,
    command: '',
});

export function validateSnippet(snippet) {
    if (!String(snippet?.name || '').trim()) return 'Name is required';

    if (isPackage(snippet)) {
        const usable = (snippet.steps || []).filter(step =>
            String(step?.ref || '').trim() || String(step?.command || '').trim());
        if (usable.length === 0) return 'A package needs at least one step';
        if (usable.length > MAX_STEPS) return `A package holds at most ${MAX_STEPS} steps`;
        return '';
    }

    if (!String(snippet?.command || '').trim()) return 'Command is required';
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
 */
export function joinSteps(parts, chain) {
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
 * "deploy, start the service" because one record went missing.
 *
 * A step referencing another package counts as missing too. One level of
 * nesting is all this allows, which is what makes a cycle impossible rather
 * than something that has to be detected.
 */
export function composeSnippet(snippet, library = []) {
    if (!isPackage(snippet)) {
        return { text: String(snippet?.command ?? ''), missing: [], steps: [] };
    }

    const byId = new Map((library || []).map(entry => [entry.id, entry]));
    const parts = [];
    const missing = [];
    const steps = [];

    for (const step of snippet.steps || []) {
        if (step.ref) {
            const target = byId.get(step.ref);
            if (!target || isPackage(target)) {
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

/** How many steps a package actually resolves to, for a count on a card. */
export const stepCount = (snippet, library = []) =>
    (isPackage(snippet) ? composeSnippet(snippet, library).steps.length : 0);

/** The distinct placeholder names in a command, in the order they first appear. */
export function placeholdersIn(command) {
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
 * Substitute answers into a command. A placeholder left unanswered stays
 * standing rather than collapsing to nothing: sending `rm -rf /var/log/`
 * because a field was skipped would be far worse than sending something that
 * visibly still has a `{{path}}` in it.
 */
export function fillPlaceholders(command, values = {}) {
    return String(command ?? '').replace(PLACEHOLDER_PATTERN, (match, name) => {
        const value = values[name.trim()];
        return value === undefined || value === '' ? match : String(value);
    });
}

/** An empty `hostIds` means every host; otherwise the host has to be named. */
export const matchesHost = (snippet, hostId) =>
    !snippet.hostIds?.length || (hostId ? snippet.hostIds.includes(hostId) : false);

/** How a snippet's scope reads in the library, resolved against live hosts. */
export function describeScope(snippet, hosts = []) {
    if (!snippet.hostIds?.length) return 'All hosts';

    const names = snippet.hostIds
        .map(id => hosts.find(host => host.id === id)?.name)
        .filter(Boolean);

    // Every host it was scoped to has since been deleted. Say so, rather than
    // leaving a snippet that silently never appears anywhere.
    if (names.length === 0) return 'No matching hosts';
    if (names.length === 1) return names[0];
    return `${names.length} hosts`;
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** Every query character in order, though not necessarily adjacent. */
function isSubsequence(query, text) {
    let index = 0;
    for (const character of text) {
        if (character === query[index]) index += 1;
        if (index === query.length) return true;
    }
    return false;
}

/**
 * Rank one snippet against a query. Higher is better, 0 means no match.
 *
 * Ordered so that what the user is most likely to have typed the start of wins:
 * a name prefix beats a name substring, which beats a tag, which beats
 * something only the command body mentions.
 */
function score(snippet, query, body) {
    const name = snippet.name.toLowerCase();
    // The composed text, so a package is findable by what its steps run and
    // not only by the name someone gave the package.
    const command = body.toLowerCase();
    const description = (snippet.description || '').toLowerCase();

    if (name.startsWith(query)) return 100;
    if (name.includes(query)) return 80;
    if (snippet.tags?.some(tag => tag.startsWith(query))) return 60;
    if (snippet.tags?.some(tag => tag.includes(query))) return 50;
    if (command.includes(query)) return 40;
    if (description.includes(query)) return 30;
    // Last resort, so a half-remembered name still finds it.
    if (isSubsequence(query, name)) return 10;

    return 0;
}

/**
 * The snippets available on a host, filtered by the query and ranked.
 * Ties keep the library's own order, so the list is stable while typing.
 */
export function filterSnippets(snippets, { hostId, query = '' } = {}) {
    const available = snippets.filter(snippet => matchesHost(snippet, hostId));
    const needle = query.trim().toLowerCase();
    if (!needle) return available;

    return available
        .map((snippet, index) => ({
            snippet,
            index,
            // Composed against the whole library, not just what is available on
            // this host: a package's steps are its text wherever they came from.
            rank: score(snippet, needle, composeSnippet(snippet, snippets).text),
        }))
        .filter(entry => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank || a.index - b.index)
        .map(entry => entry.snippet);
}
