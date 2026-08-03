/**
 * Naming, colouring and grouping the tab strip.
 *
 * All of this is about telling one tab from another once there are more of them
 * than fit comfortably: eight sessions on the same fleet are eight tabs reading
 * `prod-web-*`, and the strip stops identifying anything. A name you chose, a
 * colour, and an outline around the ones that belong together are the three
 * answers, in ascending order of how many tabs you have.
 *
 * Groups hold *consecutive* tabs only. A group drawn around tabs with other
 * tabs in between would either have to reorder the strip behind the user's back
 * on every render, or draw an outline with holes in it. So joining a group moves
 * the tab to the end of that group instead, which is a move the user asked for
 * and can see.
 */

/**
 * Which of several sessions on the same host each one is.
 *
 * Four terminals on `web-01` are four tabs reading `web-01`, and the
 * assistant's scope menu lists the same four indistinguishable rows. Picking
 * the right one is a guess, which is no way to choose the box a command is
 * about to run on. So each gets an ordinal: the first `web-01` is 1, the next
 * is 2, counted the way you read the window, left to right along the strip and
 * top to bottom within a split.
 *
 * A host with one session open gets nothing back. Numbering something that is
 * already the only one of its kind is noise, and sameness is the whole problem
 * being solved here.
 *
 * Positional, so closing the first of three renumbers the two behind it. That
 * is the honest reading of "the second web-01": the second one you can see, not
 * the second one ever opened. Numbers that outlived their neighbours would
 * drift into a strip of two tabs labelled 3 and 7.
 *
 * `entries` are `{ id, key }` in that reading order, `key` being whatever
 * counts as the same host. Returns a Map of id to ordinal holding only the ids
 * that need one, so a caller can ask for any id and get `undefined` for the
 * ones that should stay unnumbered.
 */
export function numberSessions(entries) {
    const totals = new Map();
    for (const entry of entries || []) {
        if (!entry?.key) continue;
        totals.set(entry.key, (totals.get(entry.key) || 0) + 1);
    }

    const ordinals = new Map();
    const seen = new Map();

    for (const entry of entries || []) {
        if (!entry?.key || totals.get(entry.key) < 2) continue;
        const ordinal = (seen.get(entry.key) || 0) + 1;
        seen.set(entry.key, ordinal);
        ordinals.set(entry.id, ordinal);
    }

    return ordinals;
}

/**
 * The palette. Every colour is used as a solid mark and as a wash behind a
 * group, so each carries both: `hex` for the mark, `tint`/`wash` at the low
 * alphas that survive being laid over either theme's background.
 */
export const TAB_COLORS = [
    { id: 'slate', label: 'Slate', hex: '#64748B' },
    { id: 'red', label: 'Red', hex: '#EF4444' },
    { id: 'amber', label: 'Amber', hex: '#F59E0B' },
    { id: 'green', label: 'Green', hex: '#22C55E' },
    { id: 'teal', label: 'Teal', hex: '#14B8A6' },
    { id: 'blue', label: 'Blue', hex: '#3B82F6' },
    { id: 'violet', label: 'Violet', hex: '#8B5CF6' },
    { id: 'pink', label: 'Pink', hex: '#EC4899' },
];

const COLORS_BY_ID = Object.fromEntries(TAB_COLORS.map(color => [color.id, color]));

/** The colour a saved id means, or null for "no colour", which is the default. */
export function tabColor(colorId) {
    return COLORS_BY_ID[colorId] || null;
}

/**
 * `#RRGGBB` at an alpha, for the washes.
 *
 * Kept as rgba rather than an 8-digit hex so it composites over whatever the
 * theme puts behind it, which is the whole reason the palette is one set of
 * values for both themes.
 */
export function withAlpha(hex, alpha) {
    const value = String(hex || '').replace('#', '');
    if (value.length !== 6) return `rgba(100, 116, 139, ${alpha})`;
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Groups are created with whichever colour is least used, so two are rarely alike. */
export function nextGroupColor(groups) {
    const used = new Set((groups || []).map(group => group.color));
    const free = TAB_COLORS.find(color => !used.has(color.id));
    return (free || TAB_COLORS[(groups?.length || 0) % TAB_COLORS.length]).id;
}

let sequence = 0;

export function createGroup(name, color) {
    sequence += 1;
    return {
        id: `grp-${Date.now().toString(36)}-${sequence.toString(36)}`,
        name: String(name || 'Group').slice(0, 40),
        color,
    };
}

/** A default name that does not collide with one already in the strip. */
export function suggestGroupName(groups) {
    const taken = new Set((groups || []).map(group => group.name));
    for (let index = 1; index < 100; index += 1) {
        const candidate = `Group ${index}`;
        if (!taken.has(candidate)) return candidate;
    }
    return 'Group';
}

/**
 * The strip as a list of segments: single tabs, and runs of tabs that share a
 * group. Only consecutive tabs are collected, which is what keeps an outline
 * from ever being drawn around a tab that is not inside it.
 *
 * `items` are the strip's own entries (`{ tab, active, closing }`), so a tab
 * mid-close is outlined with the group it is collapsing out of.
 */
export function segmentStrip(items, groups) {
    const byId = Object.fromEntries((groups || []).map(group => [group.id, group]));
    const segments = [];

    for (const item of items) {
        const group = item.tab.groupId ? byId[item.tab.groupId] : null;

        if (!group) {
            segments.push({ kind: 'tab', key: item.tab.id, item });
            continue;
        }

        const last = segments[segments.length - 1];
        if (last?.kind === 'group' && last.group.id === group.id) {
            last.items.push(item);
            continue;
        }

        segments.push({ kind: 'group', key: `${group.id}-${item.tab.id}`, group, items: [item] });
    }

    return segments;
}

/**
 * Move `tabId` so it sits at the end of `groupId`'s run, and mark it as
 * belonging to that group. Returns the same array when nothing needs to move,
 * so React can skip the update.
 *
 * The run it joins is the *first* one, if the group has somehow been split
 * across the strip, by a tab being closed out of the middle of it, say. The
 * alternative is a second outline appearing with the same name on it.
 */
export function joinGroup(tabs, tabId, groupId) {
    const from = tabs.findIndex(tab => tab.id === tabId);
    if (from === -1) return tabs;

    const withoutTab = tabs.filter(tab => tab.id !== tabId);
    const moved = { ...tabs[from], groupId };

    const firstMember = withoutTab.findIndex(tab => tab.groupId === groupId);
    if (firstMember === -1) {
        // No members yet: the tab stays where it is and becomes the whole group.
        const next = [...tabs];
        next[from] = moved;
        return next;
    }

    let lastMember = firstMember;
    while (lastMember + 1 < withoutTab.length && withoutTab[lastMember + 1].groupId === groupId) {
        lastMember += 1;
    }

    const next = [...withoutTab];
    next.splice(lastMember + 1, 0, moved);
    return next;
}
