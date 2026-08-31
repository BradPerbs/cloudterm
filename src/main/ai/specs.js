/**
 * Specs attached to a message: snippets of kind `spec`, which are documents
 * written for the assistant rather than for a shell.
 *
 * The renderer sends ids, not text. The library is the authority on what a spec
 * says, and the panel's cached copy of it can be a save behind; resolving here
 * also keeps a sixty-thousand-character runbook from crossing the bridge twice.
 *
 * Kept free of Electron, like `images.js`, so it can be tested on its own.
 */

/** A sanity cap. Ten runbooks on one question is a question about runbooks. */
const MAX_SPECS = 10;

/**
 * The specs as `{ id, name, text }`, in the order they were attached, or the
 * reason one of them cannot be sent.
 *
 * All or nothing, for the same reason images are: the message was written
 * about all of them, and a question answered against half its instructions is
 * worse than one that was refused and asked again.
 */
function readSpecs(raw, library = []) {
    if (raw === undefined || raw === null) return { specs: [], error: '' };
    if (!Array.isArray(raw)) return { specs: [], error: 'The specs were not a list' };
    if (raw.length > MAX_SPECS) {
        return { specs: [], error: `A message can carry at most ${MAX_SPECS} specs` };
    }

    const byId = new Map((library || []).map(entry => [entry.id, entry]));
    const seen = new Set();
    const specs = [];

    for (const entry of raw) {
        const id = String(entry ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const record = byId.get(id);
        if (!record || record.kind !== 'spec') {
            return { specs: [], error: 'One of the attached specs no longer exists. Take it off the message and try again.' };
        }
        if (!String(record.command || '').trim()) {
            return { specs: [], error: `“${record.name}” is empty` };
        }
        specs.push({ id: record.id, name: record.name, text: record.command });
    }

    return { specs, error: '' };
}

/**
 * The block that goes in front of the user's text.
 *
 * Tagged, and named, so the model can tell the instructions from the question
 * and can refer back to "the deploy checklist" by name. A closing tag inside
 * the text itself would end the block early, so it is spelled out of harm's way
 * rather than trusted.
 */
function specBlock(specs) {
    if (!specs?.length) return '';

    const lines = [
        specs.length === 1
            ? 'The user attached the following document from their library. Treat it as their instructions for this request, alongside whatever they wrote.'
            : `The user attached the following ${specs.length} documents from their library. Treat them as their instructions for this request, alongside whatever they wrote.`,
        '',
    ];

    for (const spec of specs) {
        const name = String(spec.name || 'spec').replace(/["\n]/g, ' ').trim();
        const text = String(spec.text || '').replace(/<\/spec>/gi, '</ spec>');
        lines.push(`<spec name="${name}">`, text, '</spec>', '');
    }

    return lines.join('\n').trimEnd();
}

/** The same specs without their text, for the transcript: enough for a chip. */
function stripSpecs(specs) {
    return specs.map(({ id, name }) => ({ id, name }));
}

module.exports = { readSpecs, specBlock, stripSpecs, MAX_SPECS };
