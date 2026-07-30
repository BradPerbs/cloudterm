/**
 * The Hosts page's arithmetic: what a search matches, what order cards sit in,
 * and where a dragged card would land.
 *
 * Kept out of the components because every one of these is a plain question
 * about the two flat lists the store hands back, and because the rule that
 * stops a folder being dragged inside itself is worth reading on its own rather
 * than buried in a drop handler.
 */

// Numeric so "web-2" sorts before "web-10", base sensitivity so a stray capital
// does not push a name to the far end of the list.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const SORT_NAME = 'name';
export const SORT_NAME_DESC = 'name-desc';
export const SORT_RECENT = 'recent';
export const SORT_MANUAL = 'manual';

export const SORT_LABELS = {
    [SORT_NAME]: 'Name A-Z',
    [SORT_NAME_DESC]: 'Name Z-A',
    [SORT_RECENT]: 'Recently used',
    [SORT_MANUAL]: 'Manual',
};

/** The breadcrumb's first crumb, and the name of the folder that is no folder. */
export const ROOT_LABEL = 'All hosts';

const nameOf = (item) => item?.name || '';

// An item that has never been dragged has no order at all. Sorting those last
// rather than first keeps a manual arrangement stable as new hosts are added:
// the ones you placed stay where you put them, and the new arrival lands at the
// end where you can find it.
const orderOf = (item) => (Number.isFinite(item?.order) ? item.order : Number.MAX_SAFE_INTEGER);

/** One folder's worth of records, in the order the page should show them. */
export function sortItems(items, mode) {
    const list = [...items];

    switch (mode) {
        case SORT_MANUAL:
            return list.sort((a, b) => orderOf(a) - orderOf(b) || collator.compare(nameOf(a), nameOf(b)));
        case SORT_NAME_DESC:
            return list.sort((a, b) => collator.compare(nameOf(b), nameOf(a)));
        case SORT_RECENT:
            // Folders have never been connected to, so they fall back to name
            // and keep their usual order rather than shuffling.
            return list.sort((a, b) =>
                (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)
                || collator.compare(nameOf(a), nameOf(b)));
        default:
            return list.sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
    }
}

/**
 * Root-first path to a folder, always beginning with the root crumb.
 *
 * The `seen` guard is not paranoia about our own writes: the store is a JSON
 * file a user can edit, and a parent loop in it would otherwise hang the
 * renderer rather than showing a slightly wrong breadcrumb.
 */
export function folderPath(folders, folderId) {
    const path = [];
    const seen = new Set();
    let current = folderId || '';

    while (current && !seen.has(current)) {
        seen.add(current);
        const folder = folders.find(entry => entry.id === current);
        if (!folder) break;
        path.unshift({ id: folder.id, name: folder.name });
        current = folder.parentId || '';
    }

    return [{ id: '', name: ROOT_LABEL }, ...path];
}

/** "AWS / Production", or '' for a host sitting at the root. */
export function folderLabel(folders, folderId) {
    return folderPath(folders, folderId).slice(1).map(crumb => crumb.name).join(' / ');
}

/** Every folder inside this one, at any depth, plus the folder itself. */
export function folderSubtree(folders, folderId) {
    const ids = new Set([folderId]);

    // Repeated passes rather than recursion: the list is flat and unsorted, so
    // a child can appear before its parent.
    let grew = true;
    while (grew) {
        grew = false;
        for (const folder of folders) {
            if (ids.has(folder.id)) continue;
            if (!ids.has(folder.parentId || '')) continue;
            ids.add(folder.id);
            grew = true;
        }
    }

    return ids;
}

/**
 * Whether a folder may be moved into a destination. A folder cannot go inside
 * itself or inside anything it contains: the result would be a branch with no
 * route to it from the root, which is to say hosts that quietly vanish.
 */
export function canMoveFolder(folders, folderId, destinationId) {
    if (!folderId || folderId === destinationId) return false;
    return !folderSubtree(folders, folderId).has(destinationId || '');
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * Terms are ANDed, so "prod web" narrows rather than widens. Searching runs
 * over the whole tree instead of the folder you happen to be standing in: a
 * half-remembered name is exactly the case where you have forgotten where you
 * filed it.
 */
export const searchTerms = (query) => String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

const matches = (terms, fields) => {
    const haystack = fields.filter(Boolean).join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
};

/**
 * A term written `#prod` asks about tags and nothing else.
 *
 * Worth the syntax because a plain term is matched against the address too, and
 * a tag like "db" is a substring of half the hostnames anybody owns. `#db` is
 * the way to say you meant the tag. A bare `#` is not a tag term; it is
 * somebody halfway through typing one, and matching nothing at that moment
 * would empty the page under their hands.
 */
const partitionTerms = (terms) => {
    const tags = [];
    const words = [];

    for (const term of terms) {
        if (term.startsWith('#') && term.length > 1) tags.push(term.slice(1));
        else words.push(term);
    }

    return { tags, words };
};

/**
 * The folder path is part of the haystack, so "aws" finds everything filed
 * under AWS, and so are the host's tags: having typed one into the editor,
 * typing it into search should find what you filed under it.
 */
export const hostMatches = (host, terms, path) => {
    const { tags, words } = partitionTerms(terms);
    const list = host.tags || [];

    // Substring, not equality, so a half-typed `#prod` still finds
    // "production" while you are typing it.
    if (!tags.every(term => list.some(tag => tag.includes(term)))) return false;

    return matches(words, [host.name, host.host, host.username, host.os, host.distro, path, list.join(' ')]);
};

export const folderMatches = (folder, terms, path) => {
    const { tags, words } = partitionTerms(terms);

    // Folders are not tagged, so a `#term` can never be true of one. Falling
    // through to the name match would make `#web` list the "web" folder, which
    // is the one answer the syntax exists to rule out.
    if (tags.length > 0) return false;

    return matches(words, [folder.name, path]);
};

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/**
 * How a card is named while it is being pointed at rather than looked up: the
 * same string the DOM carries in `data-card-id`, so the drag hit-test, the
 * rubber band and the selection all speak about cards in one language.
 *
 * Kinds are namespaced because the two collections number themselves
 * separately, and a bare id could belong to either.
 */
export const cardKey = (kind, id) => `${kind}:${id}`;

/** The two lists a set of card keys stands for. */
export function splitCardKeys(keys) {
    const hostIds = [];
    const folderIds = [];

    for (const key of keys) {
        const at = key.indexOf(':');
        if (key.slice(0, at) === 'folder') folderIds.push(key.slice(at + 1));
        else hostIds.push(key.slice(at + 1));
    }

    return { hostIds, folderIds };
}

/* ------------------------------------------------------------------ *
 * Drag and drop
 * ------------------------------------------------------------------ */

// How much of a card's leading and trailing edge means "put it beside this one"
// rather than "put it inside this one". Capped so a wide list row does not turn
// into a target that is almost all edge.
const EDGE_RATIO = 0.3;
const EDGE_MAX = 56;

/**
 * What a drop on this card would mean: 'into' the folder, or 'before' / 'after'
 * it in the list. Null when the card is not a target for what is being carried.
 *
 * `axis` is the direction the cards flow in ('x' in the grid, 'y' in the list),
 * because "beside" means the left and right edges of a tile and the top and
 * bottom edges of a row.
 */
export function resolveDropMode({ rect, x, y, axis, dragKind, targetKind }) {
    const along = axis === 'y' ? y - rect.top : x - rect.left;
    const span = axis === 'y' ? rect.height : rect.width;

    if (targetKind === 'folder') {
        // A host has nowhere to sit among folders: the whole card means "file
        // it in here", which is also the drop people reach for first.
        if (dragKind !== 'folder') return 'into';

        const edge = Math.min(span * EDGE_RATIO, EDGE_MAX);
        if (along < edge) return 'before';
        if (along > span - edge) return 'after';
        return 'into';
    }

    // Folders are always drawn ahead of hosts, so there is no position among
    // the host cards for one to land in.
    if (dragKind === 'folder') return null;

    return along < span / 2 ? 'before' : 'after';
}

/**
 * The list as it would read after the move, or null if nothing would change.
 * Both the "no target" and the "dropped back where it started" cases return
 * null so the caller can skip the write rather than test for them itself.
 */
export function reorderList(list, movedId, targetId, position) {
    if (movedId === targetId) return null;

    const moved = list.find(item => item.id === movedId);
    if (!moved) return null;

    const without = list.filter(item => item.id !== movedId);
    const at = without.findIndex(item => item.id === targetId);
    if (at < 0) return null;

    const index = position === 'after' ? at + 1 : at;
    const next = [...without.slice(0, index), moved, ...without.slice(index)];

    return next.every((item, slot) => item.id === list[slot].id) ? null : next;
}

/** Positions to persist for a list that has just been rearranged. */
export const orderUpdates = (list) => list.map((item, index) => ({ id: item.id, order: index }));
