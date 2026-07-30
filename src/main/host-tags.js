/**
 * What a tag is.
 *
 * Kept free of dependencies for the same reason as `tunnel-config.js`, so the
 * store, the IPC layer and the tests agree on one record shape without
 * requiring each other.
 *
 * A tag is a short word a host is filed under, and the only thing on a host
 * that cuts across the folder tree: a host lives in exactly one folder, and can
 * carry as many tags as it needs. That is the whole point of having both.
 *
 * Three rules, and each of them exists to stop the tag list lying about how
 * many tags there are:
 *
 *   lower-cased    "Prod" and "prod" are one tag people type two ways. A
 *                  filter row that lists both offers a choice that isn't one.
 *   deduplicated   for the same reason, after the case has gone.
 *   sorted         so the stored order is canonical. Otherwise re-saving a
 *                  host with its tags in a different order reads as an edit in
 *                  the activity log, and the card's chips reshuffle for no
 *                  reason anyone can see.
 *
 * Commas can never appear inside a tag: they are the separator in the text
 * form, and a tag that swallowed one could not survive a round trip through it.
 */

/** Long enough for "needs-decommissioning", short enough to draw on a card. */
const MAX_TAG_LENGTH = 32;

/** Well past any real use, and a bound on what one card has to render. */
const MAX_TAGS = 24;

/**
 * One tag, or '' if there was nothing there.
 *
 * Interior whitespace collapses, so "web  server" and "web server" are the same
 * tag rather than two that look identical in a list. The trim runs again after
 * the length cap because slicing can leave a trailing space behind.
 */
function normalizeTag(value) {
    return String(value ?? '')
        .replace(/[\s,]+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, MAX_TAG_LENGTH)
        .trim();
}

/**
 * A tag list from whatever the caller had: an array, or one comma-separated
 * string. Array entries are split on commas too, because a paste into the chip
 * field arrives as a single entry holding several tags.
 */
function normalizeTags(raw) {
    // Two shapes are a tag list: the array a record holds, and the
    // comma-separated string a field produces. Anything else is not a malformed
    // tag list, it is not one at all — coercing it would invent a tag called
    // "42" out of a hand-edited store file.
    if (!Array.isArray(raw) && typeof raw !== 'string') return [];

    const list = Array.isArray(raw) ? raw : raw.split(',');

    const seen = new Set();
    for (const entry of list) {
        for (const part of String(entry ?? '').split(',')) {
            const tag = normalizeTag(part);
            if (tag) seen.add(tag);
        }
    }

    return [...seen].sort().slice(0, MAX_TAGS);
}

/**
 * The list a host would have after an edit, which is how tagging a selection is
 * expressed: what to add, what to take away, and everything else left alone.
 *
 * Removals are applied before additions, so a tag named in both ends up on the
 * host. That is the harmless way round: the other order would make "add prod"
 * silently do nothing whenever "remove prod" happened to be in the same edit.
 */
function applyTagEdit(current, { add = [], remove = [] } = {}) {
    const removing = new Set(normalizeTags(remove));
    const kept = normalizeTags(current).filter(tag => !removing.has(tag));
    return normalizeTags([...kept, ...normalizeTags(add)]);
}

/** Whether two tag lists say the same thing, both already normalised. */
const sameTags = (a, b) => a.length === b.length && a.every((tag, index) => tag === b[index]);

module.exports = {
    MAX_TAG_LENGTH,
    MAX_TAGS,
    normalizeTag,
    normalizeTags,
    applyTagEdit,
    sameTags,
};
