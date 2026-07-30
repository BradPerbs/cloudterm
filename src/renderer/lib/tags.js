/**
 * Tags, on the renderer's side: what the chip field commits, what the sort
 * menu offers, and what colour a tag is drawn in.
 *
 * `src/main/host-tags.js` is the authority — everything is normalised again on
 * the way into the store, and nothing here is trusted there. This mirrors the
 * same rule so that the chips you see while typing are the ones that get saved,
 * rather than something that quietly changes shape the moment you press Save.
 * The split is the one the app already runs between `main/snippet-config.js`
 * and `lib/snippets.js`: main decides what a record is, the renderer decides
 * how it reads.
 *
 * Keep the two in step. A rule added on one side and not the other shows up as
 * a chip that vanishes on save, which is the confusing kind of wrong.
 */

export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS = 24;

/** One tag, or '' if there was nothing there. Commas cannot survive: they separate. */
export function normalizeTag(value) {
    return String(value ?? '')
        .replace(/[\s,]+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, MAX_TAG_LENGTH)
        .trim();
}

/** A tag list from an array or one comma-separated string: cleaned, deduped, sorted. */
export function normalizeTags(raw) {
    // Only an array or a comma-separated string is a tag list. Anything else is
    // not one at all, and coercing it would invent a tag out of nothing.
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

/** The list with `tag` added, or removed if it was already there. */
export function toggleTag(list, value) {
    const tag = normalizeTag(value);
    if (!tag) return list;
    const current = normalizeTags(list);
    return current.includes(tag)
        ? current.filter(entry => entry !== tag)
        : normalizeTags([...current, tag]);
}

/**
 * Every tag in use, most used first and alphabetical within a count.
 *
 * Most-used first because the list is read top down and the tag you want is
 * usually the one you have spent the most: a list sorted by name alone buries
 * "prod" behind whatever begins with an "a".
 */
export function tagCounts(hosts = []) {
    const counts = new Map();

    for (const host of hosts) {
        for (const tag of host?.tags || []) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }

    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Whether a host satisfies a tag filter.
 *
 *   all   every picked tag, which is how picking a second one narrows
 *   any    at least one, for "show me the databases and the caches"
 *
 * An empty filter is not a filter, and passes everything.
 */
export function hostHasTags(host, selected = [], mode = 'all') {
    if (selected.length === 0) return true;

    const list = host?.tags || [];
    return mode === 'any'
        ? selected.some(tag => list.includes(tag))
        : selected.every(tag => list.includes(tag));
}

/**
 * A colour per tag, decided by the tag's own letters.
 *
 * Deterministic rather than stored, so a tag is the same colour on every card,
 * in the sort menu and in the editor, without anybody having to choose one or
 * the record having to carry it. The point is scanning: on a grid of forty
 * cards, "the green ones" is findable in a way that four identical grey pills
 * are not.
 *
 * Filled solid rather than tinted. A 10%-opacity wash reads as a disabled
 * control at the size these are drawn — it took the hue and threw away the
 * thing that made it findable across a grid. One shade per tone, with no
 * `dark:` variant, because a 600 is dark enough to carry white text and bright
 * enough to sit on a near-black surface: the chip looks the same in both
 * themes, which is the point of a colour that identifies something.
 *
 * Amber is the exception and takes near-black text, because there is no yellow
 * that white reads on.
 *
 * Written out in full because Tailwind reads this file as text — a class built
 * by joining strings at runtime is a class that never gets generated.
 */
const TONES = [
    'bg-sky-600 text-white',
    'bg-emerald-600 text-white',
    'bg-violet-600 text-white',
    'bg-amber-500 text-amber-950',
    'bg-rose-600 text-white',
    'bg-teal-600 text-white',
    'bg-indigo-600 text-white',
    'bg-orange-600 text-white',
];

/** The tone a tag is drawn in: FNV-1a over its letters, so it never drifts. */
export function tagTone(tag) {
    let hash = 0x811c9dc5;
    const text = String(tag ?? '');

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        // The FNV prime, by shifts: `hash * 16777619` overflows a double's
        // integer range and starts losing the low bits that make this a hash.
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        hash >>>= 0;
    }

    return TONES[hash % TONES.length];
}
