import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
    Cancel01Icon,
    CloudServerIcon,
    CommandLineIcon,
    ComputerIcon,
    CpuIcon,
    Copy01Icon,
    Delete02Icon,
    Edit02Icon,
    Folder01Icon,
    FolderAddIcon,
    FolderOpenIcon,
    FolderTransferIcon,
    SearchRemoveIcon,
    Tag01Icon,
} from 'hugeicons-react';
import HostCard from './HostCard';
import FolderCard from './FolderCard';
import HostsToolbar from './hosts/HostsToolbar';
import HostsBreadcrumb from './hosts/HostsBreadcrumb';
import SelectionBar from './hosts/SelectionBar';
import MoveToFolderDialog from './hosts/MoveToFolderDialog';
import GroupIntoFolderDialog from './hosts/GroupIntoFolderDialog';
import TagSelectionDialog from './hosts/TagSelectionDialog';
import ContextMenu from './ui/ContextMenu';
import EmptyFrame from './ui/EmptyFrame';
import ConfirmDialog from './ui/ConfirmDialog';
import Tag from './ui/Tag';
import { toastOptions } from '../lib/toast';
import { useT } from '../i18n';
import { hostOs } from '../lib/os-icons';
import { hostKind, protocolLabel } from '../lib/protocols';
import { hostHasTags, tagCounts, toggleTag } from '../lib/tags';
import { useCardDrag } from '../hooks/useCardDrag';
import { useFlipOrder } from '../hooks/useFlipOrder';
import useMonitor from '../hooks/useMonitor';
import { useMarqueeSelection } from '../hooks/useMarqueeSelection';
import { CARD_GRID } from '../lib/layout';
import {
    rootLabel,
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

/** The size the icons in a card's menu are drawn at, wherever it is shown. */
const ICON = 15;

const countLabel = (t, n) => t('hosts.itemCount', { count: n });

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
    const t = useT();
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
    /**
     * Which cards the move dialog is about, as `kind:id`, or null when it is
     * shut.
     *
     * A set rather than a flag because the dialog is now opened from two places
     * that mean different things by "these": the selection bar, and a
     * right-click on one card. Holding what is moving is the only way the
     * dialog can say how many that is and refuse a destination inside it.
     */
    const [moving, setMoving] = useState(null);
    const [naming, setNaming] = useState(false);
    const [tagging, setTagging] = useState(false);

    // Where the right-click menu is and what it is about: `{ x, y, kind, id,
    // forSelection }`. Null when nothing is open.
    const [menu, setMenu] = useState(null);

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
    // selection whenever the folder changes, rightly, since the bar is about
    // the cards in front of you. The cards already in the air are still going,
    // though, so the drop reads this rather than the live set: without it,
    // carrying five hosts and springing on the way would land one of them.
    const payloadRef = useRef(NOTHING_SELECTED);

    useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
    useEffect(() => { localStorage.setItem(SORT_KEY, sort); }, [sort]);

    // How the watched hosts are answering. Read here rather than by each card:
    // the states arrive as one push from main after every sweep, and a
    // subscription per card would be several hundred of them on a long list.
    const { statuses } = useMonitor();

    /**
     * A dialog opened here belongs to this page, and goes when the page does.
     * Home stays mounted behind a terminal tab, so without this one would sit
     * over the session you switched to; reaching for this page again is the
     * other way of saying you want what is over it gone.
     *
     * The right-click menu goes the same way, and for the same reason.
     *
     * All of them are centred dialogs (or, in the menu's case, a popover) with
     * no exit animation to cut short: they simply stop being rendered. The
     * sheets that do have one are unmounted through their own close, further up.
     */
    useEffect(() => {
        setConfirming(null);
        setMoving(null);
        setNaming(false);
        setTagging(false);
        setMenu(null);
    }, [isActive, reachedForPage]);

    /* ------------------------------------------------------------------ *
     * What is on screen
     * ------------------------------------------------------------------ */

    const terms = useMemo(() => searchTerms(query), [query]);
    const searching = terms.length > 0;

    /** Every tag in the collection, most used first: the filter row's contents. */
    const availableTags = useMemo(() => tagCounts(allHosts), [allHosts]);

    // A tag that stops existing (its last host retagged, or deleted, or a sync
    // that took it away) must not go on filtering from a row it has left.
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
                            ? t('hosts.moved', { what: countLabel(t, count) })
                            : t('hosts.movedSome', { count, of: countLabel(t, asked) }),
                        toastOptions({ duration: 2400 }),
                    );
                }
            });
        }

        if (kind === 'folder') {
            if (!canMoveFolder(allFolders, id, destination)) {
                toast.error(t('hosts.folderInsideItself'), toastOptions({ duration: 2500 }));
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
    }, [allFolders, allHosts, applyArrange, moveSelection, clearSelection, t]);

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
        title: t('hosts.deleteHostTitle'),
        message: t('hosts.deleteHostMessage', { name: host.name }),
        confirmLabel: t('hosts.deleteHost'),
        onConfirm: async () => {
            setConfirming(null);
            await onDeleteHost(host.id);
            toast.success(t('hosts.deleted', { name: host.name }), toastOptions({ duration: 2200 }));
        },
    }), [onDeleteHost, t]);

    const confirmDeleteFolder = useCallback((folder) => setConfirming({
        title: t('hosts.deleteFolderTitle'),
        message: t('hosts.deleteFolderMessage', { name: folder.name }),
        confirmLabel: t('hosts.deleteFolder'),
        onConfirm: async () => {
            setConfirming(null);
            await onDeleteFolder(folder.id);
            toast.success(t('hosts.deleted', { name: folder.name }), toastOptions({ duration: 2200 }));
        },
    }), [onDeleteFolder, t]);

    const handleDuplicate = useCallback(async (host) => {
        await onDuplicateHost(host);
        toast.success(`Duplicated “${host.name}”`, toastOptions({ duration: 2200 }));
    }, [onDuplicateHost]);

    /**
     * Open a session on this host, on a named view rather than on the shell.
     *
     * The middle argument of `onConnect` is the launcher tab a session should
     * fill, which this page never has: a connection asked for from here always
     * gets a tab of its own.
     */
    const connectAs = useCallback((host, view) => onConnect(host, null, view), [onConnect]);

    /* ------------------------------------------------------------------ *
     * Acting on a selection
     * ------------------------------------------------------------------ */

    /** The one folder a set of cards already sits in, if they agree on one. */
    const commonParent = useCallback((hostIds, folderIds) => {
        const parents = new Set([
            ...hostIds.map(id => allHosts.find(host => host.id === id)?.folderId || ''),
            ...folderIds.map(id => allFolders.find(folder => folder.id === id)?.parentId || ''),
        ]);
        return parents.size === 1 ? [...parents][0] : null;
    }, [allHosts, allFolders]);

    const handleMoveTo = useCallback(async (destination) => {
        const keys = moving || NOTHING_SELECTED;
        const asked = keys.size;

        setMoving(null);
        const count = await moveSelection(destination, keys);
        clearSelection();

        const where = destination ? `“${labels.get(destination) || ''}”` : rootLabel();
        if (count === 0) {
            toast(t('hosts.nothingToMove'), toastOptions({ duration: 2400 }));
        } else if (count === asked) {
            toast.success(
                t('hosts.movedTo', { what: countLabel(t, count), where }),
                toastOptions({ duration: 2400 }),
            );
        } else {
            toast.success(
                t('hosts.movedSomeTo', { count, of: countLabel(t, asked), where }),
                toastOptions({ duration: 3000 }),
            );
        }
    }, [moving, moveSelection, clearSelection, labels, t]);

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
            toast.error(t('hosts.folderCreateFailedWhy', { reason: error.message }), toastOptions());
            return;
        }

        if (!folder?.id) {
            toast.error(t('hosts.folderCreateFailed'), toastOptions());
            return;
        }

        const count = await moveSelection(folder.id, keys);
        setNaming(false);
        clearSelection();
        toast.success(
            t('hosts.movedInto', { what: countLabel(t, count), name }),
            toastOptions({ duration: 2600 }),
        );
    }, [onCreateFolder, currentFolderId, moveSelection, clearSelection, t]);

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
            hostIds.length > 0 && t('hosts.deleteManyHostsNote'),
            folderIds.length > 0 && t('hosts.deleteManyFoldersNote'),
        ].filter(Boolean);

        setConfirming({
            title: t('hosts.deleteManyTitle', { what: countLabel(t, total) }),
            message: consequences.join(' '),
            confirmLabel: t('hosts.deleteMany', { what: countLabel(t, total) }),
            details: [
                ...folderIds.map(id => allFolders.find(folder => folder.id === id)?.name).filter(Boolean),
                ...hostIds.map(id => allHosts.find(host => host.id === id)?.name).filter(Boolean),
            ],
            onConfirm: async () => {
                setConfirming(null);
                try {
                    await onDeleteMany({ hostIds, folderIds });
                } catch (error) {
                    toast.error(t('hosts.deleteFailed', { reason: error.message }), toastOptions());
                    return;
                }
                clearSelection();
                toast.success(
                    t('hosts.deletedMany', { what: countLabel(t, total) }),
                    toastOptions({ duration: 2400 }),
                );
            },
        });
    }, [selectedHostIds, selectedFolderIds, allHosts, allFolders, onDeleteMany, clearSelection, t]);

    /* ------------------------------------------------------------------ *
     * What a card can be told to do
     *
     * One list per card, in ContextMenu's shape, offered twice: from the button
     * on the card and from a right-click on it. Two menus over one card that
     * disagreed about what it can do would be a bug waiting to be reported, so
     * there is one description of it and the card renders it both ways.
     *
     * The panel builds them rather than the cards, because most of these are
     * not things a card could do for itself: filing needs the folder tree,
     * deleting needs a confirmation, and connecting needs the tab strip.
     * ------------------------------------------------------------------ */

    const hostMenu = useCallback((host) => {
        const kind = hostKind(host);
        // RDP and VNC are not interchangeable to anyone looking for one of
        // them, so the entry names the one this host is actually set up for.
        const desktopLabel = host.desktop?.protocol === 'rdp' ? 'RDP' : 'VNC';
        const hasDesktop = Boolean(host.desktop?.enabled);
        const hasBmc = Boolean(host.bmc?.enabled);

        /**
         * Every way in, in the order they are worth trying.
         *
         * Files and a desktop are channels on an SSH connection, so a telnet or
         * serial host has neither to offer. A desktop-only host is the mirror of
         * that: it never dials SSH, so the desktop is the only way in there is.
         */
        const ways = kind === 'desktop'
            ? [{
                label: t('hosts.connectVia', { protocol: desktopLabel }),
                icon: <ComputerIcon size={ICON} />,
                onClick: () => connectAs(host, 'desktop'),
            }]
            // And an IPMI-only host is the same case again: there is no session
            // to open, so the board's own interface is the only way in.
            : kind === 'ipmi'
            ? [{
                label: t('hosts.openIpmi'),
                icon: <CpuIcon size={ICON} />,
                onClick: () => connectAs(host, 'bmc'),
            }]
            : [
                {
                    label: t('hosts.connectVia', { protocol: protocolLabel(kind) }),
                    icon: <CommandLineIcon size={ICON} />,
                    onClick: () => connectAs(host, 'ssh'),
                },
                kind === 'ssh' && {
                    label: t('hosts.connectVia', { protocol: 'SFTP' }),
                    icon: <Folder01Icon size={ICON} />,
                    onClick: () => connectAs(host, 'sftp'),
                },
                kind === 'ssh' && hasDesktop && {
                    label: t('hosts.connectVia', { protocol: desktopLabel }),
                    icon: <ComputerIcon size={ICON} />,
                    onClick: () => connectAs(host, 'desktop'),
                },
                // Offered whatever the host connects over, unlike the desktop:
                // the service processor is a second address for the machine and
                // needs nothing from the session, which is exactly why it is
                // worth reaching for when the session is the thing that is down.
                hasBmc && {
                    label: t('hosts.openIpmi'),
                    icon: <CpuIcon size={ICON} />,
                    onClick: () => connectAs(host, 'bmc'),
                },
                // A Windows box with no desktop set up is the one case where the
                // missing entry is the surprising part, so it is shown and
                // turned off rather than left out: the answer to "where is RDP"
                // should be on screen and not a gap.
                kind === 'ssh' && !hasDesktop && hostOs(host) === 'windows' && {
                    label: t('hosts.connectVia', { protocol: 'RDP' }),
                    icon: <ComputerIcon size={ICON} />,
                    onClick: () => {},
                    disabled: true,
                    shortcut: t('hosts.notSetUp'),
                },
            ];

        return [
            ...ways,
            { type: 'separator' },
            { label: t('hosts.editHost'), icon: <Edit02Icon size={ICON} />, onClick: () => onEditHost(host) },
            { label: t('titleBar.duplicate'), icon: <Copy01Icon size={ICON} />, onClick: () => handleDuplicate(host) },
            {
                label: t('hosts.moveToFolder'),
                icon: <FolderTransferIcon size={ICON} />,
                onClick: () => setMoving(new Set([cardKey('host', host.id)])),
            },
            { type: 'separator' },
            {
                label: t('common.delete'),
                icon: <Delete02Icon size={ICON} />,
                danger: true,
                onClick: () => confirmDeleteHost(host),
            },
        ];
    }, [connectAs, onEditHost, handleDuplicate, confirmDeleteHost, t]);

    const folderMenu = useCallback((folder) => [
        {
            label: t('hosts.open'),
            icon: <FolderOpenIcon size={ICON} />,
            // Both narrowings go, not just the query: walking into a folder
            // while a tag filter was still on would open it onto nothing.
            onClick: () => { clearFilters(); onNavigateFolder(folder.id); },
        },
        { type: 'separator' },
        { label: t('common.rename'), icon: <Edit02Icon size={ICON} />, onClick: () => onEditFolder(folder) },
        {
            label: t('hosts.moveToFolder'),
            icon: <FolderTransferIcon size={ICON} />,
            onClick: () => setMoving(new Set([cardKey('folder', folder.id)])),
        },
        { type: 'separator' },
        {
            label: t('common.delete'),
            shortcut: t('hosts.keepsContents'),
            icon: <Delete02Icon size={ICON} />,
            danger: true,
            onClick: () => confirmDeleteFolder(folder),
        },
    ], [clearFilters, onNavigateFolder, onEditFolder, confirmDeleteFolder, t]);

    /**
     * The menu for a right-click on one of several picked-out cards.
     *
     * Same rule as a drag: the selection is the statement of what you meant, so
     * pointing at one of its cards and asking for a menu is asking about all of
     * them. Acting on the single card under the pointer instead is how a
     * carefully built selection of twelve gets one host deleted out of it.
     *
     * It offers what the selection bar offers, for the same reason the card menu
     * doubles as its own right-click menu.
     */
    const selectionMenu = useCallback(() => {
        const total = selectedHostIds.length + selectedFolderIds.length;

        return [
            {
                label: t('hosts.moveMany', { what: countLabel(t, total) }),
                icon: <FolderTransferIcon size={ICON} />,
                onClick: () => setMoving(selectedRef.current),
            },
            { label: t('hosts.groupIntoFolder'), icon: <FolderAddIcon size={ICON} />, onClick: () => setNaming(true) },
            selectedHostIds.length > 0 && {
                label: t('hosts.tags'),
                icon: <Tag01Icon size={ICON} />,
                onClick: () => setTagging(true),
            },
            { type: 'separator' },
            {
                label: t('hosts.deleteMany', { what: countLabel(t, total) }),
                icon: <Delete02Icon size={ICON} />,
                danger: true,
                onClick: confirmDeleteSelection,
            },
            { label: t('hosts.clearSelection'), icon: <Cancel01Icon size={ICON} />, onClick: clearSelection },
        ];
    }, [selectedHostIds, selectedFolderIds, confirmDeleteSelection, clearSelection, t]);

    /**
     * Right-click on a card.
     *
     * A card outside the selection is a statement about that card, so the
     * selection steps aside rather than leaving a menu that would quietly act on
     * cards you are not pointing at.
     */
    const openCardMenu = useCallback((kind, id, event) => {
        event.preventDefault();
        event.stopPropagation();

        const held = selectedRef.current.has(cardKey(kind, id));
        if (!held) clearSelection();

        setMenu({
            x: event.clientX,
            y: event.clientY,
            kind,
            id,
            forSelection: held && selectedRef.current.size > 1,
        });
    }, [clearSelection]);

    const openMenuItems = useMemo(() => {
        if (!menu) return [];
        if (menu.forSelection) return selectionMenu();

        if (menu.kind === 'folder') {
            const folder = allFolders.find(entry => entry.id === menu.id);
            return folder ? folderMenu(folder) : [];
        }

        const host = allHosts.find(entry => entry.id === menu.id);
        return host ? hostMenu(host) : [];
    }, [menu, selectionMenu, folderMenu, hostMenu, allFolders, allHosts]);

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

    // What the cards are told about a gesture that is not their own business:
    // which one is in the air, which are picked out, and where a press or a
    // right-click on them goes.
    const dragState = (kind, item) => ({
        view,
        dragging: carrying?.kind === kind && carrying.id === item.id,
        selected: selected.has(cardKey(kind, item.id)),
        onPick: (event) => pickCard(cardKey(kind, item.id), event),
        onContextMenu: (event) => openCardMenu(kind, item.id, event),
        ...cardProps(kind, item),
    });

    /** What the move dialog is about, when it is open. */
    const movingParts = moving ? splitCardKeys(moving) : null;

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
                       dropdown, which is the whole difference between this and
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
                                title={t('hosts.stopFilteringBy', { tag })}
                            />
                        ))}

                        <button
                            type="button"
                            onClick={clearFilters}
                            className="ml-0.5 text-sm font-medium text-gray-900 dark:text-white hover:underline"
                        >
                            {t('common.clear')}
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
                            ? t('hosts.dragHintFiltered')
                            : t('hosts.dragHint')}
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
                // already lives here (`canFile` refuses that), so it costs an
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
                        className={view === 'list' ? 'flex flex-col gap-1.5' : CARD_GRID}
                    >
                        {displayFolders.map(folder => (
                            <FolderCard
                                key={folder.id}
                                folder={folder}
                                counts={counts.get(folder.id) || { hosts: 0, folders: 0 }}
                                dropInto={into?.id === folder.id}
                                items={folderMenu(folder)}
                                // Both narrowings go, not just the query: walking
                                // into a folder while a tag filter was still on
                                // would open it onto nothing.
                                onOpen={() => { clearFilters(); onNavigateFolder(folder.id); }}
                                {...dragState('folder', folder)}
                            />
                        ))}

                        {displayHosts.map(host => (
                            <HostCard
                                key={host.id}
                                host={host}
                                connected={connectedHostIds?.has(host.id)}
                                status={statuses.get(host.id) || null}
                                folderLabel={filtering ? (labels.get(host.folderId || '') || '') : ''}
                                items={hostMenu(host)}
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
                    onMove={() => setMoving(selectedRef.current)}
                    onGroup={() => setNaming(true)}
                    onTag={() => setTagging(true)}
                    onDelete={confirmDeleteSelection}
                    onClear={clearSelection}
                />
            )}

            {moving && (
                <MoveToFolderDialog
                    folders={allFolders}
                    movingFolderIds={movingParts.folderIds}
                    sourceId={commonParent(movingParts.hostIds, movingParts.folderIds)}
                    count={moving.size}
                    onMove={handleMoveTo}
                    onCancel={() => setMoving(null)}
                />
            )}

            {naming && (
                <GroupIntoFolderDialog
                    count={selectionCount}
                    parentLabel={currentFolderId ? `“${labels.get(currentFolderId) || ''}”` : rootLabel()}
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

            {menu && openMenuItems.length > 0 && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={openMenuItems}
                    onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}

/** Three different nothings, and only one of them is a problem to solve. */
function EmptyState({ nothingAtAll, filtering, query, tags = [] }) {
    const t = useT();

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
                title={t('common.noMatchesTitle')}
                note={asked}
            />
        );
    }

    // Inside a folder the page already says where you are, twice: the
    // breadcrumb above and the folder you clicked to get here. It only has to
    // say that it is empty.
    if (!nothingAtAll) {
        return (
            <EmptyFrame
                icon={<FolderOpenIcon size={28} strokeWidth={1.5} />}
                title={t('hosts.emptyFolder')}
            />
        );
    }

    return (
        <EmptyFrame
            icon={<CloudServerIcon size={28} strokeWidth={1.5} />}
            title={t('hosts.empty')}
            note={t('hosts.emptyNote')}
        />
    );
}

export default memo(HostsPanel);
