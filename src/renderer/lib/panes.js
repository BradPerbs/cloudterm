/**
 * A terminal tab's layout: a tree of panes.
 *
 * A tab used to be one terminal. It is now a tree whose leaves are panes and
 * whose branches are splits, so a tab can hold several sessions side by side.
 * Every leaf carries its own id, and that id *is* the session key the main
 * process knows the SSH connection by, so a pane is a session in every way a
 * tab used to be. The tab's own id is reused for its first pane, which keeps
 * sessions saved by earlier versions restorable.
 *
 *   pane   { kind: 'pane', id, mode, host, title, connected }
 *   split  { kind: 'split', id, direction, sizes, children }
 *
 * `direction` is a flex direction: 'row' puts panes side by side, 'column'
 * stacks them. `sizes` holds one fraction per child, summing to 1.
 *
 * Splits are n-ary rather than strictly binary. Splitting a pane again along
 * the axis it already sits on adds a sibling instead of nesting, so three
 * columns are three children of one split: each divider then moves exactly the
 * two panes it sits between, which is not true of a nested binary tree.
 *
 * Every function here is pure and returns a new tree, sharing the subtrees it
 * did not touch so React can skip re-rendering them.
 */

/** Gap between two panes, and the width of the handle drawn in it. */
export const DIVIDER_SIZE = 8;

/** Inset around the whole grid, but only once a tab is actually split. */
export const PANE_INSET = 6;

/** A pane may never be dragged smaller than this. */
export const MIN_PANE_PX = 160;
export const MIN_PANE_FRACTION = 0.06;

/** Past this the panes are too small to be worth the geometry. */
export const MAX_PANES = 8;

let sequence = 0;

/** Unique within a run, which is all these ids ever have to be. */
function uid(prefix) {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export const isPane = (node) => node?.kind === 'pane';
export const isSplit = (node) => node?.kind === 'split';

/**
 * A pane with no host is a picker: it shows the host list and turns into a
 * session once one is chosen. That is how a split opens something *other* than
 * the host you split from.
 *
 * `view` is the view the pane should open on: 'sftp' or 'desktop', from a
 * "Connect via…" on the Hosts page. It is a request rather than a state, read
 * once by the pane and then owned by the view switcher, because both of those
 * views need something the pane does not have yet at this point (a live SSH
 * session, in the one case, and a desktop that may ride on it in the other).
 */
export function createPane({ id, host = null, title, mode, view = null } = {}) {
    const resolved = mode || (host ? 'terminal' : 'picker');
    return {
        kind: 'pane',
        id: id || uid('pane'),
        mode: resolved,
        host: host || null,
        title: title || host?.name || 'Choose a host',
        view,
        connected: false,
    };
}

/**
 * The same arrangement over again: same hosts, same geometry, new panes.
 *
 * Ids are deliberately not copied. A pane's id *is* its session key, so a copy
 * that kept them would be the same connections rendered twice rather than a
 * second set of them.
 */
export function cloneLayout(node) {
    if (!node) return null;
    if (isPane(node)) {
        return createPane({ host: node.host, title: node.title, mode: node.mode, view: node.view });
    }
    return createSplit(node.direction, node.children.map(cloneLayout), node.sizes);
}

export function createSplit(direction, children, sizes) {
    return {
        kind: 'split',
        id: uid('split'),
        direction,
        children,
        sizes: normalize(sizes || children.map(() => 1 / children.length)),
    };
}

/** Fractions that always sum to 1, however they were arrived at. */
export function normalize(sizes) {
    const total = sizes.reduce((sum, size) => sum + (size > 0 ? size : 0), 0);
    if (!total) return sizes.map(() => 1 / sizes.length);
    return sizes.map(size => (size > 0 ? size : 0) / total);
}

/**
 * Rebuild the tree with `fn` applied to every node, keeping the original object
 * wherever nothing changed. The identity check is what lets callers compare
 * `next === previous` and skip a state update entirely.
 */
export function mapTree(node, fn) {
    if (isPane(node)) return fn(node);

    let changed = false;
    const children = node.children.map((child) => {
        const next = mapTree(child, fn);
        if (next !== child) changed = true;
        return next;
    });

    return fn(changed ? { ...node, children } : node);
}

export function findPane(root, id) {
    if (!root || !id) return null;
    if (isPane(root)) return root.id === id ? root : null;
    for (const child of root.children) {
        const found = findPane(child, id);
        if (found) return found;
    }
    return null;
}

/** Every leaf, in reading order. */
export function collectPanes(root) {
    if (!root) return [];
    if (isPane(root)) return [root];
    return root.children.flatMap(collectPanes);
}

export function paneCount(root) {
    return collectPanes(root).length;
}

/** `patch` is an object to merge, or a function returning the next pane. */
export function updatePane(root, id, patch) {
    return mapTree(root, (node) => {
        if (!isPane(node) || node.id !== id) return node;
        return typeof patch === 'function' ? patch(node) : { ...node, ...patch };
    });
}

/** Apply `fn` to every leaf, for edits that are not about one pane. */
export function updatePanes(root, fn) {
    return mapTree(root, node => (isPane(node) ? fn(node) : node));
}

/**
 * Put `newPane` next to `targetId`.
 *
 * The new pane takes half of the target's share and nothing else moves, so a
 * split never disturbs a pane the user was not pointing at.
 */
export function splitPane(root, targetId, direction, newPane) {
    if (isPane(root)) {
        return root.id === targetId ? createSplit(direction, [root, newPane]) : root;
    }

    const insert = (node) => {
        if (isPane(node)) return node;

        const index = node.children.findIndex(child => isPane(child) && child.id === targetId);
        if (index !== -1) {
            // Already on this axis: become a sibling rather than nesting.
            if (node.direction === direction) {
                const share = node.sizes[index] / 2;
                const sizes = [...node.sizes];
                sizes[index] = share;
                sizes.splice(index + 1, 0, share);

                const children = [...node.children];
                children.splice(index + 1, 0, newPane);

                return { ...node, children, sizes: normalize(sizes) };
            }

            // Crossing the axis: only the target's own slot is subdivided.
            const children = [...node.children];
            children[index] = createSplit(direction, [node.children[index], newPane]);
            return { ...node, children };
        }

        let changed = false;
        const children = node.children.map((child) => {
            const next = insert(child);
            if (next !== child) changed = true;
            return next;
        });

        return changed ? { ...node, children } : node;
    };

    return insert(root);
}

/**
 * Drop a pane. Its share goes back to whatever is left in the same split, and
 * a split left holding one child collapses into it. Returns null if the tab
 * has nothing left, which is the caller's cue to close the tab.
 */
export function removePane(root, id) {
    const prune = (node) => {
        if (isPane(node)) return node.id === id ? null : node;

        const children = [];
        const sizes = [];
        node.children.forEach((child, index) => {
            const next = prune(child);
            if (!next) return;
            children.push(next);
            sizes.push(node.sizes[index]);
        });

        if (children.length === 0) return null;
        if (children.length === 1) return children[0];
        return { ...node, children, sizes: normalize(sizes) };
    };

    return prune(root);
}

/**
 * Move the boundary between children `index` and `index + 1` by `delta`, a
 * share of the whole split. Only those two change: a divider moves the two
 * panes it sits between and nothing else. `floor` is the smallest share either
 * of them may be left with.
 */
export function movePair(sizes, index, delta, floor) {
    const pair = sizes[index] + sizes[index + 1];
    // Both are already at or under the floor; there is nothing to give.
    if (pair < floor * 2) return sizes;

    const first = Math.min(Math.max(sizes[index] + delta, floor), pair - floor);
    const next = [...sizes];
    next[index] = first;
    next[index + 1] = pair - first;
    return next;
}

export function resizeSplit(root, splitId, sizes) {
    return mapTree(root, node => (
        isSplit(node) && node.id === splitId ? { ...node, sizes: normalize(sizes) } : node
    ));
}

/** Even shares for one split, for a double-click on its divider. */
export function equalizeSplit(root, splitId) {
    return mapTree(root, node => (
        isSplit(node) && node.id === splitId
            ? { ...node, sizes: node.children.map(() => 1 / node.children.length) }
            : node
    ));
}

/* ------------------------------------------------------------------ *
 * Geometry
 *
 * Panes are laid out as absolutely positioned boxes rather than nested flex
 * containers, so that restructuring the tree never moves a terminal to a new
 * place in the React tree. A terminal that gets remounted loses its scrollback
 * and dials a second shell, which is exactly what splitting must not do.
 *
 * A box mixes both units, because the dividers are a fixed pixel size while
 * everything else is a share of the container:
 *
 *     left: calc(fracX * 100% + pxX)
 * ------------------------------------------------------------------ */

const FULL_BOX = { fracX: 0, pxX: 0, fracY: 0, pxY: 0, fracW: 1, pxW: 0, fracH: 1, pxH: 0 };

/**
 * Flatten the tree into positioned boxes.
 *
 * A zoomed pane is given the whole area and everything else is marked hidden,
 * keeping its own box: the other terminals then never change size, so zooming
 * in and back out costs no reflow and no window-size change on the remote.
 */
export function measureLayout(root, { zoomedPaneId = null } = {}) {
    const panes = [];
    const dividers = [];

    const walk = (node, box) => {
        if (isPane(node)) {
            panes.push({ id: node.id, node, box, hidden: false, zoomed: false });
            return;
        }

        const horizontal = node.direction === 'row';
        const gaps = DIVIDER_SIZE * (node.children.length - 1);

        // The children share what is left once the dividers have taken theirs.
        const availableFrac = horizontal ? box.fracW : box.fracH;
        const availablePx = (horizontal ? box.pxW : box.pxH) - gaps;

        let offsetFrac = horizontal ? box.fracX : box.fracY;
        let offsetPx = horizontal ? box.pxX : box.pxY;

        node.children.forEach((child, index) => {
            if (index > 0) {
                dividers.push({
                    key: `${node.id}:${index}`,
                    splitId: node.id,
                    // The child before the handle: a drag moves this one and
                    // the next, and no others.
                    index: index - 1,
                    direction: node.direction,
                    // Carried so a drag can work from the shares it started
                    // with; stepping from the live ones accumulates rounding.
                    sizes: node.sizes,
                    availableFrac,
                    availablePx,
                    hidden: false,
                    box: horizontal
                        ? { ...box, fracX: offsetFrac, pxX: offsetPx, fracW: 0, pxW: DIVIDER_SIZE }
                        : { ...box, fracY: offsetFrac, pxY: offsetPx, fracH: 0, pxH: DIVIDER_SIZE },
                });
                offsetPx += DIVIDER_SIZE;
            }

            const share = node.sizes[index];
            const spanFrac = share * availableFrac;
            const spanPx = share * availablePx;

            walk(child, horizontal
                ? {
                    fracX: offsetFrac, pxX: offsetPx,
                    fracY: box.fracY, pxY: box.pxY,
                    fracW: spanFrac, pxW: spanPx,
                    fracH: box.fracH, pxH: box.pxH,
                }
                : {
                    fracX: box.fracX, pxX: box.pxX,
                    fracY: offsetFrac, pxY: offsetPx,
                    fracW: box.fracW, pxW: box.pxW,
                    fracH: spanFrac, pxH: spanPx,
                });

            offsetFrac += spanFrac;
            offsetPx += spanPx;
        });
    };

    walk(root, FULL_BOX);

    if (zoomedPaneId && panes.some(pane => pane.id === zoomedPaneId)) {
        for (const pane of panes) {
            if (pane.id === zoomedPaneId) {
                pane.box = FULL_BOX;
                pane.zoomed = true;
            } else {
                pane.hidden = true;
            }
        }
        for (const divider of dividers) divider.hidden = true;
    }

    return { panes, dividers };
}

/** A box as the four CSS values that place it. */
export function boxStyle(box) {
    const value = (frac, px) => `calc(${(frac * 100).toFixed(4)}% + ${px.toFixed(2)}px)`;
    return {
        left: value(box.fracX, box.pxX),
        top: value(box.fracY, box.pxY),
        width: value(box.fracW, box.pxW),
        height: value(box.fracH, box.pxH),
    };
}

/**
 * The pane a directional move should land on, chosen from measured rectangles
 * rather than the tree: what looks like "the pane to the right" is a question
 * about the screen, and the tree only answers it for simple layouts.
 *
 * `rects` are `{ id, left, top, right, bottom }`, `direction` one of
 * left/right/up/down.
 */
export function neighborPane(rects, fromId, direction) {
    const from = rects.find(rect => rect.id === fromId);
    if (!from) return null;

    const horizontal = direction === 'left' || direction === 'right';
    const forward = direction === 'right' || direction === 'down';

    const near = rect => (horizontal ? rect.left : rect.top);
    const far = rect => (horizontal ? rect.right : rect.bottom);
    const crossNear = rect => (horizontal ? rect.top : rect.left);
    const crossFar = rect => (horizontal ? rect.bottom : rect.right);
    const crossCenter = rect => (crossNear(rect) + crossFar(rect)) / 2;

    let best = null;

    for (const rect of rects) {
        if (rect.id === fromId) continue;

        // Wholly past the edge we are moving away from, give or take the
        // rounding that fractional sizes leave behind.
        const beyond = forward ? near(rect) >= far(from) - 1 : far(rect) <= near(from) + 1;
        if (!beyond) continue;

        // Must actually share some of the other axis, or it is not in line.
        const overlap = Math.min(crossFar(from), crossFar(rect)) - Math.max(crossNear(from), crossNear(rect));
        if (overlap <= 0) continue;

        const distance = forward ? near(rect) - far(from) : near(from) - far(rect);
        const drift = Math.abs(crossCenter(rect) - crossCenter(from));

        const closer = !best
            || distance < best.distance - 0.5
            || (Math.abs(distance - best.distance) <= 0.5 && drift < best.drift);

        if (closer) best = { id: rect.id, distance, drift };
    }

    return best?.id || null;
}

/* ------------------------------------------------------------------ *
 * Persistence
 *
 * Hosts are stored by id and resolved on the way back in, so a layout saved
 * before a host was edited (or deleted) still restores something truthful.
 * ------------------------------------------------------------------ */

export function serializeLayout(node) {
    if (!node) return null;
    if (isPane(node)) {
        return { k: 'p', id: node.id, hostId: node.host?.id || null };
    }
    return {
        k: 's',
        direction: node.direction,
        sizes: node.sizes,
        children: node.children.map(serializeLayout),
    };
}

/**
 * Rebuild a saved layout against the current host list. Panes whose host is
 * gone are dropped, and a split left with one child collapses, so deleting a
 * host cannot resurrect it as an empty square.
 */
export function deserializeLayout(record, hostsById) {
    if (!record) return null;

    if (record.k === 'p') {
        const host = hostsById[record.hostId];
        if (!host) return null;
        return createPane({ id: record.id, host, title: host.name });
    }

    if (record.k !== 's' || !Array.isArray(record.children)) return null;

    const children = [];
    const sizes = [];
    record.children.forEach((child, index) => {
        const next = deserializeLayout(child, hostsById);
        if (!next) return;
        children.push(next);
        sizes.push(record.sizes?.[index] ?? 1 / record.children.length);
    });

    if (children.length === 0) return null;
    if (children.length === 1) return children[0];

    return createSplit(record.direction === 'column' ? 'column' : 'row', children, sizes);
}
