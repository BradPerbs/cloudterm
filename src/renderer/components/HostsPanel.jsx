import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CloudServerIcon, FolderOpenIcon, SearchRemoveIcon } from 'hugeicons-react';
import HostCard from './HostCard';
import FolderCard from './FolderCard';
import HostsToolbar from './hosts/HostsToolbar';
import HostsBreadcrumb from './hosts/HostsBreadcrumb';
import SelectionBar from './hosts/SelectionBar';
import MoveToFolderDialog from './hosts/MoveToFolderDialog';
import GroupIntoFolderDialog from './hosts/GroupIntoFolderDialog';
import TagSelectionDialog from './hosts/TagSelectionDialog';
import EmptyFrame from './ui/EmptyFrame';
import ConfirmDialog from './ui/ConfirmDialog';
import Tag from './ui/Tag';
import { toastOptions } from '../lib/toast';
import { hostHasTags, tagCounts, toggleTag } from '../lib/tags';
import { useCardDrag } from '../hooks/useCardDrag';
import { useFlipOrder } from '../hooks/useFlipOrder';
import { useMarqueeSelection } from '../hooks/useMarqueeSelection';
import {
    ROOT_LABEL,
    SORT_MANUAL,
    SORT_NAME,
    SORT_LABELS,
    canMoveFolder,
    cardKey,
    folderLabel,
    folderMatches,
    folderPath,
    hostMatches,
    orderUpdates,
    searchTerms,
    sortItems,
    splitCardKeys,
} from '../lib/organize';

/** How the page was left last time. Neither is worth a round trip to the store. */
const VIEW_KEY = 'hosts.view';
const SORT_KEY = 'hosts.sort';

const readPreference = (key, allowed, fallback) => {
    const stored = localStorage.getItem(key);
    return allowed.includes(stored) ? stored : fallback;
};

/** Shared, so clearing an already-empty selection is not a state change. */
const NOTHING_SELECTED = new Set();

const countLabel = (n) => `${n} item${n === 1 ? '' : 's'}`;

/**
 * The list as the drag is currently proposing it.
 *
 * Anything the preview does not name keeps its place at the end: a folder that
 * arrives from elsewhere mid-drag should appear, not disappear because it was
 * missing from an order captured a moment earlier.
 */
function applyPreview(items, preview, kind) {
    if (!preview || preview.kind !== kind) return items;

    const byId = new Map(items.map(item => [item.id, item]));
    const named = preview.ids.map(id => byId.get(id)).filter(Boolean);
    const seen = new Set(preview.ids);

    return [...named, ...items.filter(item => !seen.has(item.id))];
}

/**
 * The Hosts page.
 *
 * Three things run through here that the cards themselves cannot answer: what
 * is visible (the folder you are in, or a search across the whole tree), what
 * order it is in, and what a drag would do. The cards are told; they decide
 * nothing.
 *
 * Dragging is deliberately switched off while a search is showing. Search
 * results come from every folder at once, so "put this before that one" has no
 * single list to mean anything in, and a move you did not intend is a worse
 * outcome than one you have to clear the search to make.
 *
 * Selecting several at once is not switched off there, because none of the
 * things you can do to a selection depend on the list having an order: filing
 * twelve search results into one folder is the case the feature is for.
 */
function HostsPanel({
    hosts,
    folders,
    allHosts,
    allFolders,
    currentFolderId = '',
    connectedHostIds,
    isActive = true,
    reachedForPage = 0,
    onNewHost,
    onEditHost,
    onDuplicateHost,
    onDeleteHost,
    onConnect,
    onNewFolder,
    onCreateFolder,
    onEditFolder,
    onDeleteFolder,
    onDeleteMany,
    onNavigateFolder,
    onArrange,
    onTagHosts,
}) {
    const [query, setQuery] = useState('');
    const [view, setView] = useState(() => readPreference(VIEW_KEY, ['grid', 'list'], 'grid'));
    const [sort, setSort] = useState(() => readPreference(SORT_KEY, Object.keys(SORT_LABELS), SORT_NAME));

    // Which tags the page is filtered down to, and whether a host has to carry
    // all of them or just one. Not persisted, for the same reason the search box
    // is not: it is a question you are asking now, not a setting.
    const [tagFilter, setTagFilter] = useState([]);
    const [tagMode, setTagMode] = useState('all');

    const [confirming, setConfirming] = useState(null);

    // Cards picked out by the rubber band or a modifier-click, as `kind:id`.
    const [selected, setSelected] = useState(NOTHING_SELECTED);
    const [choosingDestination, setChoosingDestination] = useState(false);
    const [naming, setNaming] = useState(false);
    const [tagging, setTagging] = useState(false);

    const searchRef = useRef(null);
    const scrollRef = useRef(null);
    const gridRef = useRef(null);
    const bandRef = useRef(null);

    // Read by the pointer loops and by handlers that run long after the render
    // they were made in, neither of which can wait for a closure to catch up.
    const selectedRef = useRef(selected);
    selectedRef.current = selected;

    // Where a shift-click measures its range from.
    const anchorRef = useRef(null);

    // What the drag in the air is carrying, frozen as the card left the ground.
    //
    // A spring-open changes folder mid-gesture, and the page drops its
    // selection whenever the folder changes — rightly, since the bar is about
    // the cards in front of you. The cards already in the air are still going,
    // though, so the drop reads this rather than the live set: without it,
    // carrying five hosts and springing on the way would land one of them.
    const payloadRef = useRef(NOTHING_SELECTED);

    useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
    useEffect(() => { localStorage.setItem(SORT_KEY, sort); }, [sort]);

    /**
     * A dialog opened here belongs to this page, and goes when the page does.
     * Home stays mounted behind a terminal tab, so without this one would sit
     * over the session you switched to; reaching for this page again is the
     * other way of saying you want what is over it gone.
     *
     * All four are centred dialogs, which have no exit animation to cut short —
     * they simply stop being rendered. The sheets that do are unmounted through
     * their own close, further up.
     */
    useEffect(() => {
        setConfirming(null);
        setChoosingDestination(false);
        setNaming(false);
        setTagging(false);
    }, [isActive, reachedForPage]);

    /* ------------------------------------------------------------------ *
     * What is on screen
     * ------------------------------------------------------------------ */

    const terms = useMemo(() => searchTerms(query), [query]);
    const searching = terms.length > 0;

    /** Every tag in the collection, most used first: the filter row's contents. */
    const availableTags = useMemo(() => tagCounts(allHosts), [allHosts]);

    // A tag that stops existing — its last host retagged, or deleted, or a sync
    // that took it away — must not go on filtering from a row it has left.
    useEffect(() => {
        setTagFilter((current) => {
            if (current.length === 0) return current;
            const live = new Set(availableTags.map(entry => entry.tag));
            const next = current.filter(tag => live.has(tag));
            return next.length === current.length ? current : next;
        });
    }, [availableTags]);

    const filteringByTag = tagFilter.length > 0;

    /**
     * Whether the page is showing a question's answer rather than a folder.
     *
     * Both narrowings run over the whole tree: a half-remembered name and a tag
     * are questions about the collection, not about where you happen to be
     * standing. It follows that dragging is off and the breadcrumb steps aside
     * for either of them, which is why they share one flag.
     */
    const filtering = searching || filteringByTag;

    const path = useMemo(() => folderPath(allFolders, currentFolderId), [allFolders, currentFolderId]);

    // Resolved once per render rather than per card: every host in a search
    // result needs the path of the folder it lives in, and most of them share it.
    const labels = useMemo(() => {
        const map = new Map();
        for (const folder of allFolders) map.set(folder.id, folderLabel(allFolders, folder.id));
        return map;
    }, [allFolders]);

    const visibleFolders = useMemo(() => {
        // A folder carries no tags, so no folder can satisfy a tag filter.
        // Listing them anyway would leave a filtered page whose folders are the
        // one thing on it the filter did not apply to.
        if (filteringByTag) return [];

        return sortItems(
            searching
                ? allFolders.filter(folder => folderMatches(folder, terms, labels.get(folder.id)))
                : folders,
            sort,
        );
    }, [filteringByTag, searching, allFolders, folders, terms, labels, sort]);

    const visibleHosts = useMemo(() => sortItems(
        filtering
            ? allHosts.filter(host => hostHasTags(host, tagFilter, tagMode)
                && (!searching || hostMatches(host, terms, labels.get(host.folderId || '') || '')))
            : hosts,
        sort,
    ), [filtering, searching, tagFilter, tagMode, allHosts, hosts, terms, labels, sort]);

    /** Direct contents of each folder, for the count on its card. */
    const counts = useMemo(() => {
        const map = new Map();
        const bump = (id, field) => {
            const key = id || '';
            if (!map.has(key)) map.set(key, { hosts: 0, folders: 0 });
            map.get(key)[field] += 1;
        };
        for (const host of allHosts) bump(host.folderId, 'hosts');
        for (const folder of allFolders) bump(folder.parentId, 'folders');
        return map;
    }, [allHosts, allFolders]);

    /* ------------------------------------------------------------------ *
     * Selecting several
     * ------------------------------------------------------------------ */

    const applySelection = useCallback((next) => {
        // The band reports a set on every frame it changes, and the frame after
        // the last card leaves it reports an empty one. Nothing has changed
        // then, and a fresh empty Set would still re-render the whole grid.
        setSelected(prev => (prev.size === 0 && next.size === 0 ? prev : next));
    }, []);

    const clearSelection = useCallback(() => {
        anchorRef.current = null;
        setSelected(prev => (prev.size === 0 ? prev : NOTHING_SELECTED));
    }, []);

    // What Ctrl+A means, and the line a shift-click measures its range along:
    // folders first, then hosts, which is the order they are drawn in.
    const visibleKeys = useMemo(() => [
        ...visibleFolders.map(folder => cardKey('folder', folder.id)),
        ...visibleHosts.map(host => cardKey('host', host.id)),
    ], [visibleFolders, visibleHosts]);

    /** A modifier-click on a card: pick it out rather than open it. */
    const pickCard = useCallback((key, event) => {
        const base = selectedRef.current;
        const anchor = anchorRef.current;

        // Shift extends from the last card picked and leaves the anchor where
        // it is, so the range can be stretched and restretched from one end.
        if (event.shiftKey && anchor && anchor !== key) {
            const from = visibleKeys.indexOf(anchor);
            const to = visibleKeys.indexOf(key);
            if (from >= 0 && to >= 0) {
                const range = visibleKeys.slice(Math.min(from, to), Math.max(from, to) + 1);
                setSelected(new Set(event.ctrlKey || event.metaKey ? [...base, ...range] : range));
                return;
            }
        }

        const next = new Set(base);
        if (next.has(key)) next.delete(key);
        else next.add(key);

        anchorRef.current = key;
        setSelected(next);
    }, [visibleKeys]);

    const getSelection = useCallback(() => selectedRef.current, []);

    const { surfaceProps: marqueeProps } = useMarqueeSelection({
        scrollRef,
        bandRef,
        getSelection,
        onChange: applySelection,
    });

    // A selection is about the cards in front of you. Walking into another
    // folder, or changing what the search or the tag filter is showing,
    // replaces all of them.
    const tagFilterKey = tagFilter.join();
    useEffect(() => { clearSelection(); }, [currentFolderId, query, tagFilterKey, tagMode, clearSelection]);

    // Records can also go without this page asking: a delete from the card's
    // own menu, a background sync, a setup pulled down from another device. A
    // selection that outlived its cards would act on nothing and say it acted.
    useEffect(() => {
        setSelected((prev) => {
            if (prev.size === 0) return prev;

            const live = new Set();
            for (const host of allHosts) live.add(cardKey('host', host.id));
            for (const folder of allFolders) live.add(cardKey('folder', folder.id));

            const next = new Set([...prev].filter(key => live.has(key)));
            return next.size === prev.size ? prev : next;
        });
    }, [allHosts, allFolders]);

    const selectionCount = selected.size;
    const { hostIds: selectedHostIds, folderIds: selectedFolderIds } = useMemo(
        () => splitCardKeys(selected),
        [selected],
    );

    /* ------------------------------------------------------------------ *
     * Dragging
     * ------------------------------------------------------------------ */

    const applyArrange = useCallback(async (changes) => {
        try {
            await onArrange(changes);
        } catch (error) {
            toast.error(`Could not move that: ${error.message}`, toastOptions());
        }
    }, [onArrange]);

    /**
     * File everything in `keys` into one destination, in a single write.
     *
     * Anything that cannot go is dropped rather than refusing the whole move:
     * a folder cannot be filed inside itself or inside anything it contains,
     * and a card already in the destination has nowhere to travel to. The count
     * that comes back is what actually moved, so the caller can say so when it
     * is not what was asked for.
     */
    const moveSelection = useCallback(async (destination, keys) => {
        const { hostIds, folderIds } = splitCardKeys(keys);

        const movingFolders = sortItems(folderIds
            .map(id => allFolders.find(folder => folder.id === id))
            .filter(folder => folder
                && (folder.parentId || '') !== destination
                && canMoveFolder(allFolders, folder.id, destination)), sort);

        const movingHosts = sortItems(hostIds
            .map(id => allHosts.find(host => host.id === id))
            .filter(host => host && (host.folderId || '') !== destination), sort);

        if (movingFolders.length === 0 && movingHosts.length === 0) return 0;

        const moved = new Set([...movingFolders, ...movingHosts].map(item => item.id));
        const changes = {};

        // Same rule as a single drop: the destination is renumbered as a whole,
        // and the arrivals go on the end in the order you were looking at them.
        if (movingFolders.length > 0) {
            const siblings = sortItems(
                allFolders.filter(folder => (folder.parentId || '') === destination && !moved.has(folder.id)),
                SORT_MANUAL,
            );
            changes.folders = orderUpdates([...siblings, ...movingFolders]).map(update => (
                moved.has(update.id) ? { ...update, parentId: destination } : update
            ));
        }

        if (movingHosts.length > 0) {
            const siblings = sortItems(
                allHosts.filter(host => (host.folderId || '') === destination && !moved.has(host.id)),
                SORT_MANUAL,
            );
            changes.hosts = orderUpdates([...siblings, ...movingHosts]).map(update => (
                moved.has(update.id) ? { ...update, folderId: destination } : update
            ));
        }

        await applyArrange(changes);
        return movingFolders.length + movingHosts.length;
    }, [allFolders, allHosts, sort, applyArrange]);

    /**
     * File a card inside a folder, or at the root when `destination` is blank.
     *
     * The destination list is renumbered as a whole so a manual arrangement
     * stays a run of whole positions, and the incoming card goes on the end,
     * which is where you look for the thing you just moved.
     */
    const moveInto = useCallback((kind, id, destination = '') => {
        // Dragging one of several picked-out cards takes all of them. The
        // selection is the statement of what you meant; leaving the rest behind
        // is the one outcome nobody drags for. Read from what the gesture
        // picked up rather than from the live set, which a spring-open on the
        // way to the destination has already emptied.
        const selection = payloadRef.current;
        if (selection.size > 1 && selection.has(cardKey(kind, id))) {
            const asked = selection.size;
            return moveSelection(destination, selection).then((count) => {
                clearSelection();
                if (count > 0) {
                    toast.success(
                        count === asked
                            ? `Moved ${countLabel(count)}`
                            : `Moved ${count} of ${countLabel(asked)}; the rest could not go there`,
                        toastOptions({ duration: 2400 }),
                    );
                }
            });
        }

        if (kind === 'folder') {
            if (!canMoveFolder(allFolders, id, destination)) {
                toast.error('A folder cannot be moved inside itself.', toastOptions({ duration: 2500 }));
                return undefined;
            }

            const moved = allFolders.find(folder => folder.id === id);
            if (!moved || (moved.parentId || '') === destination) return undefined;

            const siblings = sortItems(
                allFolders.filter(folder => (folder.parentId || '') === destination && folder.id !== id),
                SORT_MANUAL,
            );
            return applyArrange({
                folders: orderUpdates([...siblings, moved]).map(update => (
                    update.id === id ? { ...update, parentId: destination } : update
                )),
            });
        }

        const moved = allHosts.find(host => host.id === id);
        if (!moved || (moved.folderId || '') === destination) return undefined;

        const siblings = sortItems(
            allHosts.filter(host => (host.folderId || '') === destination && host.id !== id),
            SORT_MANUAL,
        );
        return applyArrange({
            hosts: orderUpdates([...siblings, moved]).map(update => (
                update.id === id ? { ...update, folderId: destination } : update
            )),
        });
    }, [allFolders, allHosts, applyArrange, moveSelection, clearSelection]);

    /** Whether a card may be filed into a folder, asked once per frame mid-drag. */
    const canFile = useCallback((kind, id, folderId) => {
        if (kind === 'folder') {
            const folder = allFolders.find(entry => entry.id === id);
            if (!folder || (folder.parentId || '') === folderId) return false;
            return canMoveFolder(allFolders, id, folderId);
        }
        const host = allHosts.find(entry => entry.id === id);
        return Boolean(host) && (host.folderId || '') !== folderId;
    }, [allFolders, allHosts]);

    const commitOrder = useCallback((kind, ids) => {
        // Placing a card by hand is a statement about the order, so the page
        // stops sorting for you rather than throwing the move away on the next
        // render, which is what every other outcome here would look like.
        if (sort !== SORT_MANUAL) {
            setSort(SORT_MANUAL);
            toast.success('Sorting switched to Manual', toastOptions({ duration: 2200 }));
        }
        return applyArrange({ [kind === 'folder' ? 'folders' : 'hosts']: orderUpdates(ids.map(id => ({ id }))) });
    }, [sort, applyArrange]);

    const dragLists = useMemo(
        () => ({ folder: visibleFolders, host: visibleHosts }),
        [visibleFolders, visibleHosts],
    );

    // How many cards a drag from this one is carrying, which the ghost says out
    // loud. Dragging a card that is not in the selection carries only itself.
    const dragCount = useCallback((kind, id) => (
        selectedRef.current.has(cardKey(kind, id)) ? selectedRef.current.size : 1
    ), []);

    const { carrying, into, preview, cardProps } = useCardDrag({
        scrollRef,
        // Filtered results come from every folder at once, so "put this before
        // that one" has no single list to mean anything in.
        enabled: !filtering,
        axis: view === 'list' ? 'y' : 'x',
        lists: dragLists,
        canFile,
        dragCount,
        onFile: moveInto,
        onReorder: commitOrder,
        onSpringOpen: onNavigateFolder,
    });

    // Picking up a card that was not part of the selection means the selection
    // is over: the bar would otherwise keep offering to act on cards you have
    // visibly stopped talking about. Either way the gesture now knows what it
    // is carrying, and nothing that happens to the selection after this changes
    // what is going to land.
    useEffect(() => {
        if (!carrying) return;
        const held = selectedRef.current.has(cardKey(carrying.kind, carrying.id));
        payloadRef.current = held ? selectedRef.current : NOTHING_SELECTED;
        if (!held) clearSelection();
    }, [carrying, clearSelection]);

    // What the drag is proposing, which is what gets drawn while it is live.
    const displayFolders = useMemo(
        () => applyPreview(visibleFolders, preview, 'folder'),
        [visibleFolders, preview],
    );
    const displayHosts = useMemo(
        () => applyPreview(visibleHosts, preview, 'host'),
        [visibleHosts, preview],
    );

    // Cards slide between positions whenever this changes, which covers the
    // live preview, the commit that follows it, and a plain change of sort.
    const orderKey = useMemo(
        () => `${displayFolders.map(f => f.id).join()}|${displayHosts.map(h => h.id).join()}`,
        [displayFolders, displayHosts],
    );
    useFlipOrder(gridRef, orderKey, { resetKey: `${view}|${currentFolderId}|${filtering}` });

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */

    const confirmDeleteHost = useCallback((host) => setConfirming({
        title: 'Delete this host?',
        message: `“${host.name}” and its stored credentials will be removed. Any session already open stays connected.`,
        confirmLabel: 'Delete host',
        onConfirm: async () => {
            setConfirming(null);
            await onDeleteHost(host.id);
            toast.success(`Deleted “${host.name}”`, toastOptions({ duration: 2200 }));
        },
    }), [onDeleteHost]);

    const confirmDeleteFolder = useCallback((folder) => setConfirming({
        title: 'Delete this folder?',
        message: `“${folder.name}” will be removed. Everything inside it moves up a level rather than being deleted.`,
        confirmLabel: 'Delete folder',
        onConfirm: async () => {
            setConfirming(null);
            await onDeleteFolder(folder.id);
            toast.success(`Deleted “${folder.name}”`, toastOptions({ duration: 2200 }));
        },
    }), [onDeleteFolder]);

    const handleDuplicate = useCallback(async (host) => {
        await onDuplicateHost(host);
        toast.success(`Duplicated “${host.name}”`, toastOptions({ duration: 2200 }));
    }, [onDuplicateHost]);

    /* ------------------------------------------------------------------ *
     * Acting on a selection
     * ------------------------------------------------------------------ */

    /** The one folder everything selected already sits in, if they agree on one. */
    const selectionSource = useMemo(() => {
        const parents = new Set([
            ...selectedHostIds.map(id => allHosts.find(host => host.id === id)?.folderId || ''),
            ...selectedFolderIds.map(id => allFolders.find(folder => folder.id === id)?.parentId || ''),
        ]);
        return parents.size === 1 ? [...parents][0] : null;
    }, [selectedHostIds, selectedFolderIds, allHosts, allFolders]);

    const handleMoveTo = useCallback(async (destination) => {
        const keys = selectedRef.current;
        const asked = keys.size;

        setChoosingDestination(false);
        const count = await moveSelection(destination, keys);
        clearSelection();

        const where = destination ? `“${labels.get(destination) || ''}”` : ROOT_LABEL;
        if (count === 0) toast(`Nothing to move: all of it is already there`, toastOptions({ duration: 2400 }));
        else if (count === asked) toast.success(`Moved ${countLabel(count)} to ${where}`, toastOptions({ duration: 2400 }));
        else toast.success(`Moved ${count} of ${countLabel(asked)} to ${where}`, toastOptions({ duration: 3000 }));
    }, [moveSelection, clearSelection, labels]);

    /**
     * Gather the selection into a folder that does not exist yet.
     *
     * The folder is made where you are standing rather than at the root: you
     * asked for it from this page, looking at these cards.
     */
    const handleGroup = useCallback(async (name) => {
        const keys = selectedRef.current;

        let folder;
        try {
            folder = await onCreateFolder({ name, parentId: currentFolderId });
        } catch (error) {
            toast.error(`Could not create that folder: ${error.message}`, toastOptions());
            return;
        }

        if (!folder?.id) {
            toast.error('Could not create that folder', toastOptions());
            return;
        }

        const count = await moveSelection(folder.id, keys);
        setNaming(false);
        clearSelection();
        toast.success(`Moved ${countLabel(count)} into “${name}”`, toastOptions({ duration: 2600 }));
    }, [onCreateFolder, currentFolderId, moveSelection, clearSelection]);

    /**
     * Add and remove tags across the hosts in the selection.
     *
     * Folders in the selection are ignored rather than refused: picking out a
     * folder and eight hosts and then tagging is a perfectly clear instruction,
     * and the count in the message is of hosts, so nothing is claimed that did
     * not happen.
     */
    const handleTagSelection = useCallback(async ({ add, remove }) => {
        const hostIds = [...selectedHostIds];
        if (hostIds.length === 0) return;

        let result;
        try {
            result = await onTagHosts({ hostIds, add, remove });
        } catch (error) {
            toast.error(`Could not tag those: ${error.message}`, toastOptions());
            return;
        }

        setTagging(false);
        clearSelection();

        const changed = result?.changed || 0;
        if (changed === 0) {
            toast('Nothing to change: they were already tagged that way', toastOptions({ duration: 2600 }));
            return;
        }

        const what = [
            add.length > 0 && `added ${add.join(', ')}`,
            remove.length > 0 && `removed ${remove.join(', ')}`,
        ].filter(Boolean).join(' · ');

        toast.success(
            `${changed} host${changed === 1 ? '' : 's'}: ${what}`,
            toastOptions({ duration: 2800 }),
        );
    }, [selectedHostIds, onTagHosts, clearSelection]);

    /** A tag chip on a card: filter the page by it rather than open the host. */
    const handleTagClick = useCallback((tag) => {
        setTagFilter(current => toggleTag(current, tag));
    }, []);

    const clearTagFilter = useCallback(() => setTagFilter([]), []);

    const clearFilters = useCallback(() => {
        setQuery('');
        setTagFilter([]);
    }, []);

    const confirmDeleteSelection = useCallback(() => {
        const hostIds = [...selectedHostIds];
        const folderIds = [...selectedFolderIds];
        const total = hostIds.length + folderIds.length;
        if (total === 0) return;

        // Two very different consequences, so the message only promises the
        // ones that are actually about to happen.
        const consequences = [
            hostIds.length > 0 && 'Hosts are removed along with their stored credentials, and any session already open stays connected.',
            folderIds.length > 0 && 'Folders are removed, but everything inside them moves up a level rather than being deleted.',
        ].filter(Boolean);

        setConfirming({
            title: `Delete ${countLabel(total)}?`,
            message: consequences.join(' '),
            confirmLabel: `Delete ${countLabel(total)}`,
            details: [
                ...folderIds.map(id => allFolders.find(folder => folder.id === id)?.name).filter(Boolean),
                ...hostIds.map(id => allHosts.find(host => host.id === id)?.name).filter(Boolean),
            ],
            onConfirm: async () => {
                setConfirming(null);
                try {
                    await onDeleteMany({ hostIds, folderIds });
                } catch (error) {
                    toast.error(`Could not delete that: ${error.message}`, toastOptions());
                    return;
                }
                clearSelection();
                toast.success(`Deleted ${countLabel(total)}`, toastOptions({ duration: 2400 }));
            },
        });
    }, [selectedHostIds, selectedFolderIds, allHosts, allFolders, onDeleteMany, clearSelection]);

    /* ------------------------------------------------------------------ *
     * Keyboard
     * ------------------------------------------------------------------ */

    useEffect(() => {
        if (!isActive) return;

        const handler = (event) => {
            if (event.defaultPrevented) return;

            const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');

            // The two ways every list in every app offers to start searching.
            if (((event.ctrlKey || event.metaKey) && event.key === 'f' && !event.altKey)
                || (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
                return;
            }

            // Alt+Left is free here: the pane-navigation binding in App only
            // claims it once the active tab holds a terminal.
            if (event.altKey && event.key === 'ArrowLeft' && path.length > 1) {
                event.preventDefault();
                onNavigateFolder(path[path.length - 2].id);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === 'a' && !event.altKey && !typing) {
                event.preventDefault();
                anchorRef.current = null;
                setSelected(new Set(visibleKeys));
                return;
            }

            // Only when there is something to let go of, so this stays out of
            // the way of every other thing Escape closes on this page.
            if (event.key === 'Escape' && !typing && selectedRef.current.size > 0) {
                event.preventDefault();
                clearSelection();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isActive, path, onNavigateFolder, visibleKeys, clearSelection]);

    const handleSearchKeyDown = useCallback((event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (query) setQuery('');
        else event.currentTarget.blur();
    }, [query]);

    /* ------------------------------------------------------------------ *
     * Render
     * ------------------------------------------------------------------ */

    const nothingAtAll = allHosts.length === 0 && allFolders.length === 0;
    const empty = visibleFolders.length === 0 && visibleHosts.length === 0;

    const dragState = (kind, item) => ({
        view,
        dragging: carrying?.kind === kind && carrying.id === item.id,
        selected: selected.has(cardKey(kind, item.id)),
        onPick: (event) => pickCard(cardKey(kind, item.id), event),
        ...cardProps(kind, item),
    });

    return (
        <div className="relative flex flex-col gap-4 h-full min-h-0" id="hosts-panel">
            <HostsToolbar
                ref={searchRef}
                query={query}
                onQueryChange={setQuery}
                onQueryKeyDown={handleSearchKeyDown}
                sort={sort}
                onSortChange={setSort}
                tags={availableTags}
                selectedTags={tagFilter}
                tagMode={tagMode}
                onToggleTag={handleTagClick}
                onTagModeChange={setTagMode}
                onClearTags={clearTagFilter}
                view={view}
                onViewChange={setView}
                onNewFolder={onNewFolder}
                onNewHost={onNewHost}
            />

            <div className="flex items-center justify-between gap-4 shrink-0 min-h-[28px]">
                {filtering ? (
                    /* Named so the count on screen is never a mystery: a page
                       showing three of forty hosts should say why.

                       The picked tags are drawn here rather than left in the
                       menu they were picked from. There are rarely more than
                       two or three, they are what the page is currently about,
                       and dropping one should not cost a trip back into a
                       dropdown — which is the whole difference between this and
                       the row of every tag in the collection it replaced. */
                    <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {!filteringByTag
                                ? 'Searching every folder.'
                                : searching
                                    ? `Searching, and tagged with ${tagMode === 'any' ? 'any' : 'all'} of these:`
                                    : `Tagged with ${tagMode === 'any' ? 'any' : 'all'} of these, across every folder:`}
                        </span>

                        {tagFilter.map(tag => (
                            <Tag
                                key={tag}
                                tag={tag}
                                onRemove={() => handleTagClick(tag)}
                                title={`Stop filtering by “${tag}”`}
                            />
                        ))}

                        <button
                            type="button"
                            onClick={clearFilters}
                            className="ml-0.5 text-sm font-medium text-gray-900 dark:text-white hover:underline"
                        >
                            Clear
                        </button>
                    </div>
                ) : (
                    <HostsBreadcrumb
                        path={path}
                        dropTargetId={into?.id ?? null}
                        onNavigate={onNavigateFolder}
                    />
                )}

                {/* Said once, quietly, where the thing it describes is. A feature
                    nobody discovers is the same as one that is not there, which
                    goes double for a box you have to drag across empty space to
                    find out exists. */}
                {!empty && selectionCount === 0 && (
                    <p className="hidden lg:block text-[11px] text-gray-400 dark:text-gray-500 shrink-0 text-right">
                        {filtering
                            ? 'Drag a box across the cards to pick out several'
                            : 'Drag a card onto a folder to file it · Drag a box to pick out several'}
                    </p>
                )}
            </div>

            {/* The panel scrolls its own list, so the header and the path stay
                put however long the collection gets. It is also what the rubber
                band is measured against, and the box is drawn inside it so that
                it scrolls with the cards rather than floating over them. */}
            <div
                ref={scrollRef}
                {...marqueeProps}
                // Also the drop target for the folder you are standing in,
                // which is the whole of what a spring-open leaves you needing:
                // it opens the folder under the card, and then the card has to
                // have somewhere in it to land. Never a target for a card that
                // already lives here — `canFile` refuses that — so it costs an
                // ordinary drag nothing.
                data-drop-body={currentFolderId}
                className={`relative flex-1 min-h-0 overflow-y-auto -mx-2 px-2 pb-1
                    ${into?.id === currentFolderId ? 'org-drop-here' : ''}`}
            >
                <div ref={bandRef} className="org-marquee" aria-hidden="true" />

                {empty ? (
                    <EmptyState
                        nothingAtAll={nothingAtAll}
                        filtering={filtering}
                        query={query}
                        tags={tagFilter}
                    />
                ) : (
                    <div
                        ref={gridRef}
                        className={view === 'list'
                            ? 'flex flex-col gap-1.5'
                            : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3'}
                    >
                        {displayFolders.map(folder => (
                            <FolderCard
                                key={folder.id}
                                folder={folder}
                                counts={counts.get(folder.id) || { hosts: 0, folders: 0 }}
                                dropInto={into?.id === folder.id}
                                // Both narrowings go, not just the query: walking
                                // into a folder while a tag filter was still on
                                // would open it onto nothing.
                                onOpen={() => { clearFilters(); onNavigateFolder(folder.id); }}
                                onEdit={() => onEditFolder(folder)}
                                onDelete={() => confirmDeleteFolder(folder)}
                                {...dragState('folder', folder)}
                            />
                        ))}

                        {displayHosts.map(host => (
                            <HostCard
                                key={host.id}
                                host={host}
                                connected={connectedHostIds?.has(host.id)}
                                folderLabel={filtering ? (labels.get(host.folderId || '') || '') : ''}
                                onEdit={() => onEditHost(host)}
                                onDuplicate={() => handleDuplicate(host)}
                                onDelete={() => confirmDeleteHost(host)}
                                onConnect={() => onConnect(host)}
                                onTagClick={handleTagClick}
                                {...dragState('host', host)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {selectionCount > 0 && (
                <SelectionBar
                    hostCount={selectedHostIds.length}
                    folderCount={selectedFolderIds.length}
                    onMove={() => setChoosingDestination(true)}
                    onGroup={() => setNaming(true)}
                    onTag={() => setTagging(true)}
                    onDelete={confirmDeleteSelection}
                    onClear={clearSelection}
                />
            )}

            {choosingDestination && (
                <MoveToFolderDialog
                    folders={allFolders}
                    movingFolderIds={selectedFolderIds}
                    sourceId={selectionSource}
                    count={selectionCount}
                    onMove={handleMoveTo}
                    onCancel={() => setChoosingDestination(false)}
                />
            )}

            {naming && (
                <GroupIntoFolderDialog
                    count={selectionCount}
                    parentLabel={currentFolderId ? `“${labels.get(currentFolderId) || ''}”` : ROOT_LABEL}
                    onCreate={handleGroup}
                    onCancel={() => setNaming(false)}
                />
            )}

            {tagging && (
                <TagSelectionDialog
                    hosts={selectedHostIds.map(id => allHosts.find(host => host.id === id)).filter(Boolean)}
                    allTags={availableTags.map(entry => entry.tag)}
                    onApply={handleTagSelection}
                    onCancel={() => setTagging(false)}
                />
            )}

            {confirming && <ConfirmDialog {...confirming} onCancel={() => setConfirming(null)} />}
        </div>
    );
}

/** Three different nothings, and only one of them is a problem to solve. */
function EmptyState({ nothingAtAll, filtering, query, tags = [] }) {
    if (filtering) {
        // What was asked, so an empty page is a readable answer rather than a
        // shrug: with both a query and a tag row live, either one could be the
        // reason nothing came back.
        const asked = [
            query.trim() && `“${query.trim()}”`,
            tags.length > 0 && tags.map(tag => `#${tag}`).join(' '),
        ].filter(Boolean).join(' · ');

        return (
            <EmptyFrame
                icon={<SearchRemoveIcon size={28} strokeWidth={1.5} />}
                title="No matches"
                note={asked}
            />
        );
    }

    // Inside a folder the page already says where you are, twice: the
    // breadcrumb above and the folder you clicked to get here. It only has to
    // say that it is empty.
    if (!nothingAtAll) {
        return <EmptyFrame icon={<FolderOpenIcon size={28} strokeWidth={1.5} />} title="Nothing here yet" />;
    }

    return (
        <EmptyFrame
            icon={<CloudServerIcon size={28} strokeWidth={1.5} />}
            title="No hosts yet"
            note="Add a server to get started."
        />
    );
}

export default memo(HostsPanel);
