import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
    Folder01Icon,
    File01Icon,
    FileAddIcon,
    FolderAddIcon,
    Download01Icon,
    Upload01Icon,
    Edit01Icon,
    PencilEdit01Icon,
    Delete02Icon,
    Copy01Icon,
    Scissor01Icon,
    ClipboardIcon,
    LockKeyIcon,
    InformationCircleIcon,
    Link01Icon,
    Loading03Icon,
    Refresh01Icon,
    Alert02Icon,
    HardDriveIcon,
} from 'hugeicons-react';

import { useSftp } from '../hooks/useSftp';
import { useTransfers } from '../hooks/useTransfers';
import { joinRemote, isInside } from '../lib/remote-path';
import { formatSize } from '../lib/format';
import { toastOptions } from '../lib/toast';

import SftpToolbar from './sftp/SftpToolbar';
import FileTable from './sftp/FileTable';
import TransferPanel from './sftp/TransferPanel';
import ContextMenu from './ui/ContextMenu';
import ConfirmDialog from './ui/ConfirmDialog';
import ConflictDialog from './sftp/ConflictDialog';
import PermissionsModal from './sftp/PermissionsModal';
import PropertiesModal from './sftp/PropertiesModal';

const SORT_STORAGE_KEY = 'sftp.sort';
const HIDDEN_STORAGE_KEY = 'sftp.showHidden';
const LOCAL_DIR_STORAGE_KEY = 'sftp.lastLocalDir';

const readStored = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
};

const writeStored = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage is full or blocked; the preference just won't persist.
    }
};

/**
 * Paths a drop event carries, in the order the OS reported them.
 *
 * Resolved through the preload rather than the old `File.path`, which Electron
 * removed in 32. A File with no backing path (dragged from another app's
 * virtual folder, or a synthesised one) resolves to '' and drops out here.
 */
function droppedPaths(event) {
    return Array.from(event.dataTransfer?.files || [])
        .map(file => window.api.local.pathForFile(file))
        .filter(Boolean);
}

function SftpView({ tabId, isActive = true }) {
    const {
        path, homePath, entries, loading, ready, initError, disk,
        canGoBack, canGoForward, open, openTyped, refresh, goUp, goHome, goBack, goForward,
    } = useSftp(tabId);

    const {
        transfers, summary, conflict, respondToConflict,
        cancel, cancelAll, retry, clearFinished,
    } = useTransfers(tabId);

    const [selection, setSelection] = useState(() => new Set());
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [anchorIndex, setAnchorIndex] = useState(-1);

    const [sort, setSort] = useState(() => readStored(SORT_STORAGE_KEY, { key: 'name', direction: 'asc' }));
    const [filter, setFilter] = useState('');
    const [showHidden, setShowHidden] = useState(() => readStored(HIDDEN_STORAGE_KEY, true));

    const [renaming, setRenaming] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [draft, setDraft] = useState(null); // { type: 'folder' | 'file', value }

    const [contextMenu, setContextMenu] = useState(null);
    const [confirmState, setConfirmState] = useState(null);
    const [permissionsFor, setPermissionsFor] = useState(null);
    const [propertiesFor, setPropertiesFor] = useState(null);

    const [clipboard, setClipboard] = useState(null); // { mode, paths, sourceDir }
    const [editedPaths, setEditedPaths] = useState(() => new Set());
    const [transfersExpanded, setTransfersExpanded] = useState(false);
    const [dragDepth, setDragDepth] = useState(0);

    const listRef = useRef(null);
    const filterRef = useRef(null);
    const draftInputRef = useRef(null);
    // Enter commits and then the field blurs, which would commit a second time.
    const committing = useRef(false);
    // Inline editors commit on blur. Escape has to cancel *before* the field
    // unmounts, so the pending edit is tracked in a ref the blur handler can
    // see, because reading React state there would still show the cancelled edit.
    const renamingRef = useRef(null);
    const draftRef = useRef(null);
    const typeAhead = useRef({ buffer: '', timer: null });

    /* -------------------------------------------------------------- *
     * Derived list
     * -------------------------------------------------------------- */

    const visibleEntries = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        const direction = sort.direction === 'asc' ? 1 : -1;

        const list = entries
            .map(entry => ({ ...entry, hidden: entry.name.startsWith('.') }))
            .filter(entry => (showHidden || !entry.hidden)
                && (!needle || entry.name.toLowerCase().includes(needle)));

        return list.sort((a, b) => {
            // Directories lead regardless of the column, the way every file
            // manager does it, since sorting by size otherwise scatters them.
            const aDir = a.isDirectory || a.targetIsDirectory;
            const bDir = b.isDirectory || b.targetIsDirectory;
            if (aDir !== bDir) return aDir ? -1 : 1;

            switch (sort.key) {
                case 'size': return ((a.size || 0) - (b.size || 0)) * direction;
                case 'modifyTime': return ((a.modifyTime || 0) - (b.modifyTime || 0)) * direction;
                case 'mode': return (((a.mode || 0) & 0o7777) - ((b.mode || 0) & 0o7777)) * direction;
                default:
                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                        * direction;
            }
        });
    }, [entries, filter, showHidden, sort]);

    const selectedEntries = useMemo(
        () => visibleEntries.filter(entry => selection.has(entry.name)),
        [visibleEntries, selection]
    );

    const focusedEntry = focusedIndex >= 0 ? visibleEntries[focusedIndex] : null;

    const pathOf = useCallback((entry) => joinRemote(path, entry.name), [path]);

    /* -------------------------------------------------------------- *
     * Persisted preferences
     * -------------------------------------------------------------- */

    useEffect(() => writeStored(SORT_STORAGE_KEY, sort), [sort]);
    useEffect(() => writeStored(HIDDEN_STORAGE_KEY, showHidden), [showHidden]);

    // Entries changed under us, so drop selections that no longer exist.
    useEffect(() => {
        setSelection((current) => {
            if (current.size === 0) return current;
            const names = new Set(entries.map(entry => entry.name));
            const next = new Set([...current].filter(name => names.has(name)));
            return next.size === current.size ? current : next;
        });
    }, [entries]);

    // Navigating resets the cursor and any half-finished inline edit.
    useEffect(() => {
        setSelection(new Set());
        setFocusedIndex(-1);
        setAnchorIndex(-1);
        renamingRef.current = null;
        setRenaming(null);
        draftRef.current = null;
        setDraft(null);
        setFilter('');
    }, [path]);

    /* -------------------------------------------------------------- *
     * Main-process events
     * -------------------------------------------------------------- */

    // A finished upload changed the tree we are looking at.
    useEffect(() => window.api.sftp.onChanged((payload) => {
        if (payload.tabId === tabId && payload.direction === 'upload') {
            refresh({ silent: true });
        }
    }), [tabId, refresh]);

    useEffect(() => window.api.remoteEdit.onStatus((status) => {
        if (status.tabId !== tabId) return;

        setEditedPaths((current) => {
            const next = new Set(current);
            if (status.state === 'stopped' || status.state === 'error') next.delete(status.remotePath);
            else next.add(status.remotePath);
            return next;
        });

        if (status.state === 'saved') {
            toast.success(`Uploaded ${status.name}`, toastOptions({ duration: 2000 }));
            refresh({ silent: true });
        } else if (status.state === 'error') {
            toast.error(`${status.name}: ${status.message}`, toastOptions({ duration: 6000 }));
        }
    }), [tabId, refresh]);

    // Restore edit markers when the pane remounts on an existing session.
    useEffect(() => {
        window.api.remoteEdit.list(tabId)
            .then(list => setEditedPaths(new Set(list.map(item => item.remotePath))))
            .catch(() => {});
    }, [tabId]);

    // Open the drawer on its own the first time something starts moving.
    useEffect(() => {
        if (summary.active > 0) setTransfersExpanded(true);
    }, [summary.active > 0]); // eslint-disable-line react-hooks/exhaustive-deps

    /* -------------------------------------------------------------- *
     * Selection
     * -------------------------------------------------------------- */

    const selectOnly = useCallback((name, index) => {
        setSelection(new Set([name]));
        setFocusedIndex(index);
        setAnchorIndex(index);
    }, []);

    const selectRange = useCallback((from, to) => {
        const [start, end] = from <= to ? [from, to] : [to, from];
        setSelection(new Set(visibleEntries.slice(start, end + 1).map(entry => entry.name)));
    }, [visibleEntries]);

    const handleRowClick = useCallback((event, entry, index) => {
        event.stopPropagation();
        listRef.current?.focus();

        if (event.shiftKey && anchorIndex >= 0) {
            selectRange(anchorIndex, index);
            setFocusedIndex(index);
            return;
        }

        if (event.ctrlKey || event.metaKey) {
            setSelection((current) => {
                const next = new Set(current);
                if (next.has(entry.name)) next.delete(entry.name);
                else next.add(entry.name);
                return next;
            });
            setFocusedIndex(index);
            setAnchorIndex(index);
            return;
        }

        selectOnly(entry.name, index);
    }, [anchorIndex, selectRange, selectOnly]);

    const clearSelection = useCallback(() => {
        setSelection(new Set());
        setFocusedIndex(-1);
        setAnchorIndex(-1);
    }, []);

    /* -------------------------------------------------------------- *
     * Transfers
     * -------------------------------------------------------------- */

    const enqueue = useCallback(async (options) => {
        const result = await window.api.transfers.enqueue(tabId, options);
        if (!result.success) toast.error(result.message, toastOptions());
        return result;
    }, [tabId]);

    const pickLocalDirectory = useCallback(async (title) => {
        const result = await window.api.dialog.open({
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: readStored(LOCAL_DIR_STORAGE_KEY, undefined) || undefined,
            title,
        });
        if (result.canceled || !result.filePaths?.length) return null;
        writeStored(LOCAL_DIR_STORAGE_KEY, result.filePaths[0]);
        return result.filePaths[0];
    }, []);

    const downloadEntries = useCallback(async (targets, { ask = true } = {}) => {
        if (targets.length === 0) return;

        let destinationDir = ask ? await pickLocalDirectory('Download to') : null;

        if (!ask) {
            const downloads = await window.api.local.downloadsDir();
            destinationDir = downloads.path;
        }
        if (!destinationDir) return;

        await enqueue({
            direction: 'download',
            sources: targets.map(pathOf),
            destinationDir,
        });
    }, [enqueue, pathOf, pickLocalDirectory]);

    const uploadPaths = useCallback((localPaths, destinationDir = path) => {
        if (localPaths.length === 0) return;
        return enqueue({ direction: 'upload', sources: localPaths, destinationDir });
    }, [enqueue, path]);

    const handleUploadFiles = useCallback(async () => {
        const result = await window.api.dialog.open({
            properties: ['openFile', 'multiSelections'],
            title: 'Upload files',
        });
        if (result.canceled || !result.filePaths?.length) return;
        uploadPaths(result.filePaths);
    }, [uploadPaths]);

    const handleUploadFolder = useCallback(async () => {
        const result = await window.api.dialog.open({
            properties: ['openDirectory', 'multiSelections'],
            title: 'Upload folder',
        });
        if (result.canceled || !result.filePaths?.length) return;
        uploadPaths(result.filePaths);
    }, [uploadPaths]);

    /* -------------------------------------------------------------- *
     * Navigation / opening
     * -------------------------------------------------------------- */

    const navigate = useCallback(async (target) => {
        const result = await open(target);
        if (!result.success && !result.superseded) {
            toast.error(result.message || `Could not open ${target}`, toastOptions());
        }
        return result;
    }, [open]);

    const openEntry = useCallback((entry) => {
        if (entry.isDirectory || entry.targetIsDirectory) {
            navigate(pathOf(entry));
            return;
        }
        if (entry.broken) {
            toast.error(`${entry.name} is a broken symlink`, toastOptions());
            return;
        }
        downloadEntries([entry], { ask: false });
        toast.success(`Downloading ${entry.name}`, toastOptions({ duration: 2000 }));
    }, [navigate, pathOf, downloadEntries]);

    const handleSubmitPath = useCallback(async (value) => {
        const result = await openTyped(value);
        if (!result.success && !result.superseded) {
            toast.error(result.message || 'No such directory', toastOptions());
        }
    }, [openTyped]);

    /* -------------------------------------------------------------- *
     * Mutations
     * -------------------------------------------------------------- */

    const runAndRefresh = useCallback(async (action, successMessage) => {
        const result = await action();
        if (result?.success === false) {
            toast.error(result.message || 'Operation failed', toastOptions({ duration: 6000 }));
        } else if (successMessage) {
            toast.success(successMessage, toastOptions({ duration: 2000 }));
        }
        await refresh({ silent: true });
        return result;
    }, [refresh]);

    const startRename = useCallback((entry) => {
        renamingRef.current = entry.name;
        setRenaming(entry.name);
        setRenameValue(entry.name);
    }, []);

    const cancelRename = useCallback(() => {
        renamingRef.current = null;
        setRenaming(null);
    }, []);

    const commitRename = useCallback(async () => {
        if (committing.current) return;

        const original = renamingRef.current;
        const next = renameValue.trim();

        renamingRef.current = null;
        setRenaming(null);
        if (!original || !next || next === original) return;

        if (next.includes('/')) {
            toast.error('A name cannot contain "/"', toastOptions());
            return;
        }

        committing.current = true;
        try {
            await runAndRefresh(
                () => window.api.sftp.rename(tabId, joinRemote(path, original), joinRemote(path, next)),
                `Renamed to ${next}`
            );
        } finally {
            committing.current = false;
        }
    }, [renameValue, tabId, path, runAndRefresh]);

    const startDraft = useCallback((type) => {
        const next = { type, value: '' };
        draftRef.current = next;
        setDraft(next);
    }, []);

    const changeDraft = useCallback((value) => {
        // The ref is updated outside the updater, because StrictMode runs updaters
        // twice, and a side effect in there is a trap waiting to spring.
        if (draftRef.current) draftRef.current = { ...draftRef.current, value };
        setDraft(current => (current ? { ...current, value } : current));
    }, []);

    const cancelDraft = useCallback(() => {
        draftRef.current = null;
        setDraft(null);
    }, []);

    const commitDraft = useCallback(async () => {
        if (committing.current) return;

        const pending = draftRef.current;
        const name = pending?.value.trim();

        draftRef.current = null;
        setDraft(null);
        if (!pending || !name) return;

        if (name.includes('/')) {
            toast.error('A name cannot contain "/"', toastOptions());
            return;
        }

        committing.current = true;
        try {
            const target = joinRemote(path, name);
            await runAndRefresh(
                () => pending.type === 'folder'
                    ? window.api.sftp.mkdir(tabId, target)
                    : window.api.sftp.createFile(tabId, target),
                `Created ${name}`
            );
            setSelection(new Set([name]));
        } finally {
            committing.current = false;
        }
    }, [tabId, path, runAndRefresh]);

    const requestDelete = useCallback((targets) => {
        if (targets.length === 0) return;

        const directories = targets.filter(entry => entry.isDirectory).length;
        const noun = targets.length === 1 ? `“${targets[0].name}”` : `${targets.length} items`;

        setConfirmState({
            title: `Delete ${targets.length === 1 ? 'item' : 'items'}?`,
            message: directories > 0
                ? `${noun} will be deleted from the server, including everything inside ${
                    directories === 1 ? 'the folder' : 'the folders'
                }. This cannot be undone.`
                : `${noun} will be permanently deleted from the server. This cannot be undone.`,
            details: targets.length > 1 ? targets.map(entry => entry.name) : null,
            confirmLabel: 'Delete',
            onConfirm: async () => {
                setConfirmState(null);
                await runAndRefresh(
                    () => window.api.sftp.remove(tabId, targets.map(pathOf)),
                    `Deleted ${targets.length === 1 ? targets[0].name : `${targets.length} items`}`
                );
                clearSelection();
            },
        });
    }, [tabId, pathOf, runAndRefresh, clearSelection]);

    const handleChmod = useCallback(async (mode, recursive) => {
        const entry = permissionsFor;
        setPermissionsFor(null);
        await runAndRefresh(
            () => window.api.sftp.chmod(tabId, pathOf(entry), mode, recursive),
            `Permissions updated for ${entry.name}`
        );
    }, [permissionsFor, tabId, pathOf, runAndRefresh]);

    const handleEditLocally = useCallback(async (entry) => {
        const result = await window.api.remoteEdit.open(tabId, pathOf(entry));
        if (!result.success) {
            toast.error(result.message || 'Could not open the file', toastOptions({ duration: 6000 }));
            return;
        }
        if (!result.reused) {
            toast.success(`${entry.name} opened. Saves upload automatically`, toastOptions({ duration: 4000 }));
        }
    }, [tabId, pathOf]);

    const stopEditing = useCallback(async (entry) => {
        await window.api.remoteEdit.stop(tabId, pathOf(entry));
        toast.success(`Stopped watching ${entry.name}`, toastOptions({ duration: 2000 }));
    }, [tabId, pathOf]);

    /* -------------------------------------------------------------- *
     * Clipboard (remote to remote)
     * -------------------------------------------------------------- */

    const copyToClipboard = useCallback((mode, targets) => {
        if (targets.length === 0) return;
        setClipboard({ mode, paths: targets.map(pathOf), sourceDir: path });
        toast.success(
            `${targets.length} item${targets.length > 1 ? 's' : ''} ready to ${mode === 'cut' ? 'move' : 'copy'}`,
            toastOptions({ duration: 2000 })
        );
    }, [pathOf, path]);

    const paste = useCallback(async () => {
        if (!clipboard) return;

        const selfReferential = clipboard.paths.find(source => isInside(source, path));
        if (selfReferential) {
            toast.error('A folder cannot be pasted inside itself', toastOptions());
            return;
        }
        if (clipboard.mode === 'cut' && clipboard.sourceDir === path) {
            toast.error('Source and destination are the same folder', toastOptions());
            return;
        }

        const label = clipboard.mode === 'cut' ? 'Moved' : 'Copied';
        const count = clipboard.paths.length;

        const result = await runAndRefresh(
            () => window.api.sftp.copy(tabId, clipboard.paths, path, clipboard.mode === 'cut'),
            `${label} ${count} item${count > 1 ? 's' : ''}`
        );

        if (result?.success !== false && clipboard.mode === 'cut') setClipboard(null);
    }, [clipboard, path, tabId, runAndRefresh]);

    const duplicate = useCallback(async (entry) => {
        await runAndRefresh(
            () => window.api.sftp.copy(tabId, [pathOf(entry)], path, false),
            null
        );
    }, [tabId, pathOf, path, runAndRefresh]);

    /* -------------------------------------------------------------- *
     * Drag and drop
     * -------------------------------------------------------------- */

    const handleDragOver = useCallback((event) => {
        if (!event.dataTransfer?.types?.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDragEnter = useCallback((event) => {
        if (!event.dataTransfer?.types?.includes('Files')) return;
        event.preventDefault();
        // Counted, because dragging across child elements fires leave/enter pairs.
        setDragDepth(depth => depth + 1);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragDepth(depth => Math.max(0, depth - 1));
    }, []);

    const handleDrop = useCallback((event) => {
        event.preventDefault();
        setDragDepth(0);

        const paths = droppedPaths(event);
        if (paths.length === 0) {
            toast.error('Only files from your computer can be dropped here', toastOptions());
            return;
        }
        uploadPaths(paths);
    }, [uploadPaths]);

    const handleDropOnFolder = useCallback((event, entry) => {
        setDragDepth(0);
        const paths = droppedPaths(event);
        if (paths.length === 0) return;
        uploadPaths(paths, pathOf(entry));
    }, [uploadPaths, pathOf]);

    /* -------------------------------------------------------------- *
     * Keyboard
     * -------------------------------------------------------------- */

    const moveFocus = useCallback((delta, extend) => {
        if (visibleEntries.length === 0) return;

        const next = focusedIndex < 0
            ? (delta > 0 ? 0 : visibleEntries.length - 1)
            : Math.max(0, Math.min(visibleEntries.length - 1, focusedIndex + delta));

        setFocusedIndex(next);

        if (extend && anchorIndex >= 0) {
            selectRange(anchorIndex, next);
        } else {
            setSelection(new Set([visibleEntries[next].name]));
            setAnchorIndex(next);
        }
    }, [visibleEntries, focusedIndex, anchorIndex, selectRange]);

    /** Jump to the next entry starting with the typed run of characters. */
    const handleTypeAhead = useCallback((character) => {
        const state = typeAhead.current;
        clearTimeout(state.timer);
        state.buffer += character.toLowerCase();
        state.timer = setTimeout(() => { state.buffer = ''; }, 700);

        const from = state.buffer.length === 1 ? focusedIndex + 1 : focusedIndex;
        const total = visibleEntries.length;

        for (let step = 0; step < total; step++) {
            const index = (Math.max(0, from) + step) % total;
            if (visibleEntries[index].name.toLowerCase().startsWith(state.buffer)) {
                selectOnly(visibleEntries[index].name, index);
                return;
            }
        }
    }, [visibleEntries, focusedIndex, selectOnly]);

    const handleKeyDown = useCallback((event) => {
        // Inline editors and dialogs own their own keys.
        if (renaming || draft || confirmState || permissionsFor || propertiesFor || conflict) return;

        const modifier = event.ctrlKey || event.metaKey;

        if (modifier && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            setSelection(new Set(visibleEntries.map(entry => entry.name)));
            return;
        }
        if (modifier && event.key.toLowerCase() === 'c') {
            event.preventDefault();
            copyToClipboard('copy', selectedEntries);
            return;
        }
        if (modifier && event.key.toLowerCase() === 'x') {
            event.preventDefault();
            copyToClipboard('cut', selectedEntries);
            return;
        }
        if (modifier && event.key.toLowerCase() === 'v') {
            event.preventDefault();
            paste();
            return;
        }
        if (modifier && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            filterRef.current?.focus();
            return;
        }
        if ((modifier && event.key.toLowerCase() === 'r') || event.key === 'F5') {
            event.preventDefault();
            refresh();
            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveFocus(1, event.shiftKey);
                return;
            case 'ArrowUp':
                event.preventDefault();
                moveFocus(-1, event.shiftKey);
                return;
            case 'PageDown':
                event.preventDefault();
                moveFocus(15, event.shiftKey);
                return;
            case 'PageUp':
                event.preventDefault();
                moveFocus(-15, event.shiftKey);
                return;
            case 'Home':
                event.preventDefault();
                moveFocus(-visibleEntries.length, event.shiftKey);
                return;
            case 'End':
                event.preventDefault();
                moveFocus(visibleEntries.length, event.shiftKey);
                return;
            case 'Enter':
                event.preventDefault();
                if (focusedEntry) openEntry(focusedEntry);
                return;
            case 'Backspace':
                event.preventDefault();
                goUp();
                return;
            case 'Delete':
                event.preventDefault();
                requestDelete(selectedEntries);
                return;
            case 'F2':
                event.preventDefault();
                if (focusedEntry) startRename(focusedEntry);
                return;
            case 'F4':
                event.preventDefault();
                if (focusedEntry && !focusedEntry.isDirectory) handleEditLocally(focusedEntry);
                return;
            case 'Escape':
                event.preventDefault();
                if (filter) setFilter('');
                else clearSelection();
                return;
            default:
                break;
        }

        if (!modifier && !event.altKey && event.key.length === 1 && /\S/.test(event.key)) {
            event.preventDefault();
            handleTypeAhead(event.key);
        }
    }, [
        renaming, draft, confirmState, permissionsFor, propertiesFor, conflict,
        visibleEntries, selectedEntries, focusedEntry, filter,
        copyToClipboard, paste, refresh, moveFocus, openEntry, goUp,
        requestDelete, startRename, handleEditLocally, clearSelection, handleTypeAhead,
    ]);

    /* -------------------------------------------------------------- *
     * Context menu
     * -------------------------------------------------------------- */

    const openContextMenu = useCallback((event, entry, index) => {
        event.preventDefault();
        event.stopPropagation();

        // Right-clicking outside the selection re-targets it, as Explorer does.
        if (entry && !selection.has(entry.name)) selectOnly(entry.name, index);

        setContextMenu({ x: event.clientX, y: event.clientY, entry: entry || null });
    }, [selection, selectOnly]);

    const menuItems = useMemo(() => {
        if (!contextMenu) return [];

        const size = 15;
        const entry = contextMenu.entry;
        const targets = entry
            ? (selection.has(entry.name) ? selectedEntries : [entry])
            : [];

        if (!entry) {
            return [
                { label: 'New folder', icon: <FolderAddIcon size={size} />, onClick: () => startDraft('folder') },
                { label: 'New file', icon: <FileAddIcon size={size} />, onClick: () => startDraft('file') },
                { type: 'separator' },
                { label: 'Upload files…', icon: <Upload01Icon size={size} />, onClick: handleUploadFiles },
                { label: 'Upload folder…', icon: <Upload01Icon size={size} />, onClick: handleUploadFolder },
                {
                    label: `Paste${clipboard ? ` (${clipboard.paths.length})` : ''}`,
                    icon: <ClipboardIcon size={size} />,
                    onClick: paste,
                    disabled: !clipboard,
                    shortcut: 'Ctrl+V',
                },
                { type: 'separator' },
                { label: 'Refresh', icon: <Refresh01Icon size={size} />, onClick: () => refresh(), shortcut: 'F5' },
            ];
        }

        const single = targets.length === 1;
        const isFolder = entry.isDirectory || entry.targetIsDirectory;
        const beingEdited = editedPaths.has(pathOf(entry));

        return [
            isFolder
                ? { label: 'Open', icon: <Folder01Icon size={size} />, onClick: () => openEntry(entry), shortcut: '↵' }
                : { label: 'Download', icon: <Download01Icon size={size} />, onClick: () => downloadEntries(targets, { ask: false }), shortcut: '↵' },
            { label: 'Download to…', icon: <Download01Icon size={size} />, onClick: () => downloadEntries(targets) },
            !isFolder && (beingEdited
                ? { label: 'Stop editing', icon: <PencilEdit01Icon size={size} />, onClick: () => stopEditing(entry) }
                : { label: 'Edit locally', icon: <Edit01Icon size={size} />, onClick: () => handleEditLocally(entry), disabled: !single, shortcut: 'F4' }),
            { type: 'separator' },
            { label: 'Copy', icon: <Copy01Icon size={size} />, onClick: () => copyToClipboard('copy', targets), shortcut: 'Ctrl+C' },
            { label: 'Cut', icon: <Scissor01Icon size={size} />, onClick: () => copyToClipboard('cut', targets), shortcut: 'Ctrl+X' },
            {
                label: `Paste${clipboard ? ` (${clipboard.paths.length})` : ''}`,
                icon: <ClipboardIcon size={size} />,
                onClick: paste,
                disabled: !clipboard,
                shortcut: 'Ctrl+V',
            },
            { label: 'Duplicate', icon: <Copy01Icon size={size} />, onClick: () => duplicate(entry), disabled: !single },
            { type: 'separator' },
            { label: 'Rename', icon: <Edit01Icon size={size} />, onClick: () => startRename(entry), disabled: !single, shortcut: 'F2' },
            { label: 'Permissions…', icon: <LockKeyIcon size={size} />, onClick: () => setPermissionsFor(entry), disabled: !single },
            { label: 'Copy path', icon: <Link01Icon size={size} />, onClick: () => {
                navigator.clipboard.writeText(targets.map(pathOf).join('\n'));
                toast.success('Path copied', toastOptions({ duration: 1500 }));
            } },
            { label: 'Properties', icon: <InformationCircleIcon size={size} />, onClick: () => setPropertiesFor(entry), disabled: !single },
            { type: 'separator' },
            { label: `Delete${single ? '' : ` ${targets.length} items`}`, icon: <Delete02Icon size={size} />, onClick: () => requestDelete(targets), danger: true, shortcut: 'Del' },
        ];
    }, [
        contextMenu, selection, selectedEntries, clipboard, editedPaths, pathOf,
        openEntry, downloadEntries, handleEditLocally, stopEditing, copyToClipboard,
        paste, duplicate, startRename, requestDelete, handleUploadFiles, handleUploadFolder, refresh,
    ]);

    /* -------------------------------------------------------------- *
     * Render
     * -------------------------------------------------------------- */

    const handleSortChange = useCallback((key) => {
        setSort(current => current.key === key
            ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
            : { key, direction: 'asc' });
    }, []);

    useEffect(() => {
        if (draft) draftInputRef.current?.focus();
    }, [draft]);

    // Give the list the keyboard as soon as the pane becomes visible.
    useEffect(() => {
        if (isActive && ready) listRef.current?.focus();
    }, [isActive, ready]);

    if (initError) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 bg-white dark:bg-surface-base text-center px-6">
                <Alert02Icon size={40} strokeWidth={1.5} className="text-red-500" />
                <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                        SFTP is unavailable
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md">{initError}</p>
                </div>
                <button
                    onClick={() => navigate(homePath)}
                    className="mt-2 px-4 py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                    Try again
                </button>
            </div>
        );
    }

    const selectedBytes = selectedEntries.reduce(
        (sum, entry) => sum + (entry.isDirectory ? 0 : entry.size || 0), 0
    );

    const draftRow = draft && (
        <div className="flex items-center gap-3 px-3 h-8 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-900/40">
            {draft.type === 'folder'
                ? <Folder01Icon size={16} strokeWidth={2} className="shrink-0 text-yellow-500" />
                : <File01Icon size={16} strokeWidth={2} className="shrink-0 text-gray-400" />}
            <input
                ref={draftInputRef}
                value={draft.value}
                onChange={(event) => changeDraft(event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') commitDraft();
                    if (event.key === 'Escape') cancelDraft();
                }}
                onClick={(event) => event.stopPropagation()}
                onBlur={commitDraft}
                placeholder={draft.type === 'folder' ? 'New folder name' : 'New file name'}
                spellCheck={false}
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-gray-900 dark:text-white placeholder:text-gray-400"
            />
        </div>
    );

    const emptyState = (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12 pointer-events-none">
            <Folder01Icon size={40} strokeWidth={1.5} className="text-gray-300 dark:text-neutral-700 mb-3" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {filter ? `Nothing matches “${filter}”` : 'This folder is empty'}
            </p>
            {!filter && (
                <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1">
                    Drop files here to upload them
                </p>
            )}
        </div>
    );

    return (
        <div
            className="h-full flex flex-col bg-white dark:bg-surface-base overflow-hidden relative"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <SftpToolbar
                path={path}
                loading={loading}
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                selectionCount={selection.size}
                showHidden={showHidden}
                filter={filter}
                filterRef={filterRef}
                onBack={goBack}
                onForward={goForward}
                onUp={goUp}
                onHome={goHome}
                onRefresh={() => refresh()}
                onNavigate={navigate}
                onSubmitPath={handleSubmitPath}
                onNewFolder={() => startDraft('folder')}
                onNewFile={() => startDraft('file')}
                onUploadFiles={handleUploadFiles}
                onUploadFolder={handleUploadFolder}
                onDownload={() => downloadEntries(selectedEntries)}
                onDelete={() => requestDelete(selectedEntries)}
                onToggleHidden={() => setShowHidden(value => !value)}
                onFilterChange={setFilter}
            />

            <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                className="flex-1 min-h-0 flex flex-col outline-none"
            >
                <FileTable
                    entries={visibleEntries}
                    selection={selection}
                    focusedIndex={focusedIndex}
                    sort={sort}
                    currentPath={path}
                    editedPaths={editedPaths}
                    renaming={renaming}
                    renameValue={renameValue}
                    draft={draftRow}
                    emptyState={emptyState}
                    onSortChange={handleSortChange}
                    onRowClick={handleRowClick}
                    onRowDoubleClick={openEntry}
                    onRowContextMenu={openContextMenu}
                    onBackgroundClick={clearSelection}
                    onBackgroundContextMenu={(event) => openContextMenu(event, null, -1)}
                    onDropOnFolder={handleDropOnFolder}
                    onRenameChange={setRenameValue}
                    onRenameCommit={commitRename}
                    onRenameCancel={cancelRename}
                />
            </div>

            <TransferPanel
                transfers={transfers}
                summary={summary}
                expanded={transfersExpanded}
                onToggle={() => setTransfersExpanded(value => !value)}
                onCancel={cancel}
                onRetry={retry}
                onCancelAll={cancelAll}
                onClear={clearFinished}
            />

            {/* Status bar */}
            <div className="shrink-0 h-7 flex items-center gap-3 px-3 border-t border-gray-200 dark:border-surface-control text-[11px] text-gray-500 dark:text-gray-400">
                <span className="tabular-nums">
                    {visibleEntries.length} item{visibleEntries.length === 1 ? '' : 's'}
                    {entries.length !== visibleEntries.length && ` of ${entries.length}`}
                </span>

                {selection.size > 0 && (
                    <span className="tabular-nums">
                        · {selection.size} selected{selectedBytes > 0 && ` (${formatSize(selectedBytes)})`}
                    </span>
                )}

                {editedPaths.size > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                        <PencilEdit01Icon size={11} strokeWidth={2.5} />
                        {editedPaths.size} open in editor
                    </span>
                )}

                <span className="ml-auto flex items-center gap-3">
                    {loading && <Loading03Icon size={12} className="animate-spin" />}
                    {disk?.success && (
                        <span className="flex items-center gap-1.5 tabular-nums" title="Free space on this filesystem">
                            <HardDriveIcon size={12} strokeWidth={2} />
                            {formatSize(disk.free)} free of {formatSize(disk.total)}
                        </span>
                    )}
                </span>
            </div>

            {/* Drop overlay */}
            {dragDepth > 0 && (
                <div className="absolute inset-0 z-40 m-2 rounded-xl border-2 border-dashed border-blue-500 bg-blue-500/10 dark:bg-blue-500/15 flex items-center justify-center pointer-events-none sftp-drop-zone-active">
                    <div className="text-center">
                        <Upload01Icon size={40} className="mx-auto text-blue-500 mb-2" />
                        <p className="text-blue-600 dark:text-blue-400 font-semibold">Drop to upload</p>
                        <p className="text-blue-500/70 text-xs mt-1 font-mono">{path}</p>
                    </div>
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={menuItems}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {confirmState && (
                <ConfirmDialog {...confirmState} onCancel={() => setConfirmState(null)} />
            )}

            {conflict && (
                <ConflictDialog conflict={conflict} onRespond={respondToConflict} />
            )}

            {permissionsFor && (
                <PermissionsModal
                    entry={permissionsFor}
                    onApply={handleChmod}
                    onClose={() => setPermissionsFor(null)}
                />
            )}

            {propertiesFor && (
                <PropertiesModal
                    entry={propertiesFor}
                    path={pathOf(propertiesFor)}
                    onClose={() => setPropertiesFor(null)}
                />
            )}
        </div>
    );
}

export default memo(SftpView);
