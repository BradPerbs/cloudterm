import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { toastStyle as getToastStyle } from './lib/toast';
import TitleBar from './components/TitleBar';
import HostKeyModal from './components/HostKeyModal';
import AuthPromptModal from './components/AuthPromptModal';
import Sidebar from './components/Sidebar';
import HomeView from './components/HomeView';
import TerminalView from './components/TerminalView';
import HostModal from './components/HostModal';
import NewTabView from './components/NewTabView';
import FolderModal from './components/FolderModal';
import SplitLayout from './components/panes/SplitLayout';
import PanePicker from './components/panes/PanePicker';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useTerminalTheme } from './hooks/useTerminalTheme';
import { useTerminalSettings } from './hooks/useTerminalSettings';
import { useKeychain } from './hooks/useKeychain';
import useSettingsSnapshot from './hooks/useSettingsSnapshot';
import { APP_GUTTER } from './lib/layout';
import { tagCounts } from './lib/tags';
import {
    createGroup,
    joinGroup,
    nextGroupColor,
    suggestGroupName,
} from './lib/tabs';
import {
    MAX_PANES,
    cloneLayout,
    collectPanes,
    createPane,
    deserializeLayout,
    equalizeSplit,
    findPane,
    measureLayout,
    neighborPane,
    paneCount,
    removePane,
    resizeSplit,
    serializeLayout,
    splitPane,
    updatePane,
    updatePanes,
} from './lib/panes';

// Which terminal tabs were open when the app last closed, so a launch (or a
// stray reload) can pick up where the user left off.
const SESSION_TABS_KEY = 'session.tabs';

// Tab groups outlive the tabs in them: closing every tab of a group and opening
// a new session into it later is ordinary, so the group survives on its own.
const TAB_GROUPS_KEY = 'session.tabGroups';

const readSavedSession = () => {
    if (localStorage.getItem('restoreSessions') === 'false') return null;
    try {
        const saved = JSON.parse(localStorage.getItem(SESSION_TABS_KEY) || 'null');
        return Array.isArray(saved?.tabs) && saved.tabs.length > 0 ? saved : null;
    } catch {
        return null;
    }
};

const readSavedGroups = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(TAB_GROUPS_KEY) || 'null');
        if (!Array.isArray(saved)) return [];
        return saved
            .filter(group => group?.id && group?.name)
            .map(group => ({
                id: String(group.id),
                name: String(group.name).slice(0, 40),
                color: String(group.color || 'slate'),
            }));
    } catch {
        return [];
    }
};

/**
 * How wide the keyboard reaches.
 *
 *   off      the focused pane, which is what a terminal has always done
 *   tab      every live session in the tab in front
 *   window   every live session anywhere in the window
 *
 * Deliberately not persisted. Broadcasting is a mode you enter to do one thing,
 * the same `apt upgrade` on nine boxes, and a launch that silently restored it
 * would send the next thing typed to all nine.
 */
const BROADCAST_SCOPES = ['off', 'tab', 'window'];

/**
 * A terminal tab, holding one pane to begin with.
 *
 * The first pane deliberately reuses the tab's own id as its session key: it is
 * the id the main process already knows this connection by, and the id a
 * restored session was saved under.
 */
const createTerminalTab = (id, host) => ({
    id,
    type: 'terminal',
    layout: createPane({ id, host, title: host.name }),
    focusedPaneId: id,
    zoomedPaneId: null,
});

/** Alt+arrow moves between panes; these are the directions it can mean. */
const ARROW_DIRECTIONS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
};

function App() {
    // Theme management
    const {
        theme, setTheme,
        appColors, setAppColors,
        showLogo, setShowLogo,
        logoImage, setLogoImage,
        logoSide, setLogoSide,
    } = useTheme();
    const { terminalTheme, setTerminalTheme, customTerminalTheme, setCustomTerminalTheme } = useTerminalTheme();
    const {
        terminalSettings,
        setTerminalSettings,
        resetTerminalSettings,
        fonts: terminalFonts,
    } = useTerminalSettings();

    // Navigation state
    const [activeNav, setActiveNav] = useState('hosts');

    const activeNavRef = useRef(activeNav);
    activeNavRef.current = activeNav;

    /**
     * Bumped when the chrome is used to ask for a page that is already up — the
     * sidebar item you are standing on, the Home tab while Home is showing.
     *
     * That click has nothing to change, so on its own it does nothing at all,
     * and an editor sitting over the page stays there. But asking for a page
     * you can see is a way of asking for it back, which means what is over it
     * goes: this is the only signal that says so, since neither the section nor
     * the tab has moved. Real navigation is not routed through here — leaving a
     * page takes its sheet with it further down, and instantly, because that
     * sheet belongs to a page you are no longer looking at.
     */
    const [reachedForPage, setReachedForPage] = useState(0);

    const handleNavChange = useCallback((nav) => {
        if (nav === activeNavRef.current) setReachedForPage(count => count + 1);
        else setActiveNav(nav);
    }, []);

    // Tab management
    const [tabs, setTabs] = useState([{ id: 'home', type: 'home', title: 'Home' }]);
    const [activeTabId, setActiveTabId] = useState('home');
    const [tabGroups, setTabGroups] = useState(readSavedGroups);

    // Where typing goes: 'off' | 'tab' | 'window'. See BROADCAST_SCOPES.
    const [broadcast, setBroadcast] = useState('off');

    // Mirrors for callbacks that must not re-bind on every tab change.
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    const activeTabIdRef = useRef(activeTabId);
    activeTabIdRef.current = activeTabId;

    // Read on every keystroke by a callback that must never re-bind: rebuilding
    // it would mean re-registering xterm's data handler in every open pane.
    const broadcastRef = useRef(broadcast);
    broadcastRef.current = broadcast;

    // Data management
    const {
        hosts,
        folders,
        saveHost,
        deleteHost,
        duplicateHost,
        saveFolder,
        deleteFolder,
        deleteMany,
        arrangeItems,
        tagHosts,
        loadData,
    } = useSessions();
    const { keys, loadData: loadKeys, saveKey, deleteKey, generateKey } = useKeychain();
    const [currentFolderId, setCurrentFolderId] = useState('');

    // Modal state
    const [hostModalOpen, setHostModalOpen] = useState(false);
    const [folderModalOpen, setFolderModalOpen] = useState(false);
    const [editingHost, setEditingHost] = useState(null);
    const [editingFolder, setEditingFolder] = useState(null);

    // Fullscreen state - which tab is currently fullscreen (null if none)
    const [fullscreenTabId, setFullscreenTabId] = useState(null);

    // Pending host key confirmations, oldest first
    const [hostKeyPrompts, setHostKeyPrompts] = useState([]);

    // Pending keyboard-interactive rounds, oldest first. Queued rather than
    // held one at a time: two tabs can be mid-handshake at once, and a
    // one-time code is worth nothing by the time the other finishes timing out.
    const [authPrompts, setAuthPrompts] = useState([]);

    const tabCounter = useRef(0);

    // Read once, on first render. The persist effect below would otherwise
    // overwrite the record with the tab-less startup state before the restore
    // effect gets to read it.
    const savedSessionRef = useRef(undefined);
    if (savedSessionRef.current === undefined) savedSessionRef.current = readSavedSession();

    // Load data on mount
    useEffect(() => {
        loadData();
    }, [loadData]);

    // Reopen the terminal tabs from the last run once the host list is in.
    // Hosts deleted since then are skipped. Every restored pane keeps its old
    // id on purpose: connecting under the same id makes the main process
    // replace any orphaned session (left by a reload) instead of stacking a
    // second one.
    useEffect(() => {
        const saved = savedSessionRef.current;
        if (!saved || hosts.length === 0) return;
        savedSessionRef.current = null;

        const hostsById = Object.fromEntries(hosts.map(host => [host.id, host]));

        const restored = saved.tabs
            .map((entry) => {
                if (!entry?.id) return null;

                // What the user called the tab, what colour they gave it and
                // which group it sat in are theirs, not the session's, so they
                // come back whether or not the layout does.
                const identity = {
                    customTitle: entry.customTitle || null,
                    color: entry.color || null,
                    groupId: entry.groupId || null,
                };

                // Written before tabs could split: one host, one pane.
                if (!entry.layout) {
                    const host = hostsById[entry.hostId];
                    return host ? { ...createTerminalTab(entry.id, host), ...identity } : null;
                }

                const layout = deserializeLayout(entry.layout, hostsById);
                if (!layout) return null;

                const panes = collectPanes(layout);
                const focused = panes.some(pane => pane.id === entry.focusedPaneId)
                    ? entry.focusedPaneId
                    : panes[0].id;

                return {
                    id: entry.id,
                    type: 'terminal',
                    layout,
                    focusedPaneId: focused,
                    zoomedPaneId: null,
                    ...identity,
                };
            })
            .filter(Boolean);
        if (restored.length === 0) return;

        setTabs(prev => [...prev, ...restored.filter(t => !prev.some(p => p.id === t.id))]);
        if (restored.some(t => t.id === saved.activeTabId)) {
            setActiveTabId(saved.activeTabId);
        }
    }, [hosts]);

    // Remember which terminal tabs are open, and how each one is laid out.
    // Held back until the restore effect has consumed the previous record, or
    // startup would wipe it.
    useEffect(() => {
        if (savedSessionRef.current) return;
        const openTabs = tabs
            .filter(tab => tab.type === 'terminal')
            .map(tab => ({
                id: tab.id,
                layout: serializeLayout(tab.layout),
                focusedPaneId: tab.focusedPaneId,
                customTitle: tab.customTitle || null,
                color: tab.color || null,
                groupId: tab.groupId || null,
            }))
            .filter(entry => entry.layout);
        localStorage.setItem(SESSION_TABS_KEY, JSON.stringify({ tabs: openTabs, activeTabId }));
    }, [tabs, activeTabId]);

    // Groups are saved separately, and are not gated on the restore having run:
    // they are not sessions, so an empty one is still worth keeping.
    useEffect(() => {
        localStorage.setItem(TAB_GROUPS_KEY, JSON.stringify(tabGroups));
    }, [tabGroups]);

    // Warn once if the OS keystore is unavailable, so the user knows their
    // credentials are only obfuscated on disk rather than encrypted.
    useEffect(() => {
        window.api.store.status().then(({ encryptionAvailable }) => {
            if (!encryptionAvailable) {
                toast.error(
                    'OS keystore unavailable: stored credentials are not encrypted on this machine.',
                    { style: getToastStyle(), duration: 8000 }
                );
            }
        }).catch(() => {});
    }, []);

    // Host key confirmations raised by the main process mid-handshake
    useEffect(() => window.api.hostKeys.onPrompt((prompt) => {
        setHostKeyPrompts(prev => [...prev, prompt]);
    }), []);

    const handleHostKeyResponse = useCallback((requestId, accepted) => {
        window.api.hostKeys.respond(requestId, accepted);
        setHostKeyPrompts(prev => prev.filter(p => p.requestId !== requestId));
    }, []);

    // Keyboard-interactive rounds the main process could not answer on its own
    // (a one-time code, a push approval, an expired password).
    useEffect(() => window.api.auth.onPrompt((prompt) => {
        setAuthPrompts(prev => [...prev, prompt]);
    }), []);

    const handleAuthPromptResponse = useCallback((requestId, answers) => {
        window.api.auth.respond(requestId, answers);
        setAuthPrompts(prev => prev.filter(p => p.requestId !== requestId));
    }, []);

    /** The tab holding a pane, and the pane itself. */
    const locatePane = useCallback((paneId) => {
        for (const tab of tabsRef.current) {
            if (tab.type !== 'terminal') continue;
            const pane = findPane(tab.layout, paneId);
            if (pane) return { tab, pane };
        }
        return null;
    }, []);

    /**
     * Rewrite one tab, leaving every other one untouched.
     *
     * Returning the previous array when `fn` changed nothing makes React drop
     * the update entirely. That matters: focus is claimed on every mousedown,
     * so without it a click inside a terminal would re-render every pane in
     * the window.
     */
    const patchTab = useCallback((tabId, fn) => {
        setTabs((prev) => {
            let changed = false;
            const next = prev.map((tab) => {
                if (tab.id !== tabId || tab.type !== 'terminal') return tab;
                const updated = fn(tab) || tab;
                if (updated !== tab) changed = true;
                return updated;
            });
            return changed ? next : prev;
        });
    }, []);

    // Open an empty launcher tab; picking a host inside it fills this same tab.
    const handleNewTab = useCallback(() => {
        tabCounter.current += 1;
        const tabId = `new-${Date.now()}-${tabCounter.current}`;

        setTabs(prev => [...prev, { id: tabId, type: 'launcher', title: 'New Tab' }]);
        setActiveTabId(tabId);
    }, []);

    // Opening a tab is all the renderer does. TerminalView dials once it has
    // measured itself, so the PTY is created with the real geometry.
    // `intoTabId` turns an existing launcher tab into the session rather than
    // stacking an empty tab next to it.
    const handleConnect = useCallback((host, intoTabId) => {
        if (intoTabId) {
            setTabs(prev => prev.map(tab => tab.id === intoTabId
                ? createTerminalTab(intoTabId, host)
                : tab));
            setActiveTabId(intoTabId);
            return { success: true };
        }

        tabCounter.current += 1;
        const tabId = `term-${Date.now()}-${tabCounter.current}`;

        setTabs(prev => [...prev, createTerminalTab(tabId, host)]);
        setActiveTabId(tabId);

        return { success: true };
    }, []);

    const handleConnectResult = useCallback((paneId, result, { reconnect = false } = {}) => {
        const found = locatePane(paneId);
        if (!found) return;

        patchTab(found.tab.id, current => ({
            ...current,
            layout: updatePane(current.layout, paneId, pane => (
                pane.connected === result.success ? pane : { ...pane, connected: result.success }
            )),
        }));

        const host = found.pane.host;

        if (!result.success) {
            toast.error(
                reconnect
                    ? `Lost connection to ${host?.name || 'host'}: ${result.message}`
                    : `Failed to connect: ${result.message}`,
                { style: getToastStyle() }
            );
            return;
        }

        toast.success(
            reconnect ? `Reconnected to ${host?.name || 'host'}` : `Connected to ${host?.name || 'host'}`,
            { style: getToastStyle() }
        );

        // The OS cannot have changed under a reconnect, and re-detecting it
        // would fire an exec on every wake from sleep.
        if (reconnect) {
            if (host) saveHost({ ...host, lastConnectedAt: Date.now() });
            return;
        }

        // Remember when we last reached this host so the launcher can surface
        // it under "Recent".
        if (host) saveHost({ ...host, lastConnectedAt: Date.now() });

        // Detection runs a command over an SSH exec channel, which is a thing
        // only an SSH session has. A serial console would be sent `cat
        // /etc/os-release` at whatever it happens to be showing.
        if ((host?.protocol || 'ssh') !== 'ssh') return;

        // Detect remote OS in the background and remember it on the host
        window.api.ssh.detectOS(paneId).then(({ os, distro }) => {
            if (host && os && os !== 'unknown' && (os !== host.os || distro !== host.distro)) {
                saveHost({ ...host, os, distro });
            }
        }).catch(() => {});
    }, [saveHost, locatePane, patchTab]);

    // The connection hook inside TerminalView owns the session state; this
    // keeps the pane record in step so the tab strip dims a dropped session
    // and the saved-session record stays honest.
    const handleConnectionChange = useCallback((paneId, connected) => {
        setTabs((prev) => {
            let changed = false;
            const next = prev.map((tab) => {
                if (tab.type !== 'terminal') return tab;
                const layout = updatePane(tab.layout, paneId, pane => (
                    pane.connected === connected ? pane : { ...pane, connected }
                ));
                if (layout === tab.layout) return tab;
                changed = true;
                return { ...tab, layout };
            });
            return changed ? next : prev;
        });
    }, []);

    /**
     * Live connection controls, one entry per open terminal pane, registered by
     * the pane itself.
     *
     * A session's state belongs to the hook inside its pane, and only that hook
     * may end it: going straight to the main process from out here would look
     * like a drop from in there, and the pane would dial it back.
     */
    const paneConnections = useRef(new Map());

    const registerPaneConnection = useCallback((paneId, controls) => {
        if (controls) paneConnections.current.set(paneId, controls);
        else paneConnections.current.delete(paneId);
    }, []);

    /** A tab-level action means every session in the tab, split or not. */
    const eachPaneConnection = useCallback((tabId, fn) => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (tab?.type !== 'terminal') return;

        for (const pane of collectPanes(tab.layout)) {
            const controls = paneConnections.current.get(pane.id);
            if (controls) fn(controls);
        }
    }, []);

    /* -------------------------------------------------------------- *
     * Broadcast input
     * -------------------------------------------------------------- */

    /**
     * Which sessions a keystroke from `paneId` reaches.
     *
     * The originating pane is always included, even if its own session has
     * dropped: it is where the keys were typed, and swallowing them would look
     * like the keyboard had stopped working. Everything else has to be live:
     * writing to a dead session queues bytes that arrive on the next reconnect,
     * which is exactly the wrong time for half a command to show up.
     */
    const broadcastTargets = useCallback((paneId, scope) => {
        if (scope === 'off') return [paneId];

        const source = scope === 'window'
            ? tabsRef.current.filter(tab => tab.type === 'terminal')
            : tabsRef.current.filter(tab => tab.type === 'terminal' && findPane(tab.layout, paneId));

        const targets = new Set([paneId]);
        for (const tab of source) {
            for (const pane of collectPanes(tab.layout)) {
                if (pane.mode === 'terminal' && pane.connected) targets.add(pane.id);
            }
        }
        return [...targets];
    }, []);

    /**
     * Every keystroke, paste and snippet from a pane comes through here.
     *
     * Panes used to write straight to their own session. Routing it centrally is
     * what makes broadcasting possible at all: the pane cannot know what else is
     * open, and the alternative (each pane subscribing to every other) is the
     * same fan-out with more places to get it wrong.
     */
    const handlePaneInput = useCallback((paneId, data) => {
        const scope = broadcastRef.current;
        if (scope === 'off') {
            window.api.ssh.sendInput(paneId, data);
            return;
        }
        for (const target of broadcastTargets(paneId, scope)) {
            window.api.ssh.sendInput(target, data);
        }
    }, [broadcastTargets]);

    /**
     * How many sessions the keyboard currently reaches, for the warning in the
     * title bar. Counted from the focused tab, which is the one being typed in.
     */
    const broadcastCount = useMemo(() => {
        if (broadcast === 'off') return 0;
        const tab = tabs.find(item => item.id === activeTabId);
        const scope = broadcast === 'window'
            ? tabs.filter(item => item.type === 'terminal')
            : (tab?.type === 'terminal' ? [tab] : []);

        let count = 0;
        for (const item of scope) {
            for (const pane of collectPanes(item.layout)) {
                if (pane.mode === 'terminal' && pane.connected) count += 1;
            }
        }
        return count;
    }, [broadcast, tabs, activeTabId]);

    // Leaving broadcast on with nothing to broadcast to is a trap: the next tab
    // opened would silently join a mode the user has forgotten about.
    useEffect(() => {
        if (broadcast !== 'off' && broadcastCount === 0) setBroadcast('off');
    }, [broadcast, broadcastCount]);

    const handleDisconnectTab = useCallback((tabId) => {
        eachPaneConnection(tabId, controls => controls.disconnect());
    }, [eachPaneConnection]);

    const handleReconnectTab = useCallback((tabId) => {
        eachPaneConnection(tabId, controls => controls.reconnect());
    }, [eachPaneConnection]);

    /**
     * The same tab again, opened next to the one it came from.
     *
     * A split tab is copied whole, same hosts and same geometry, but the copies
     * are new sessions rather than the same ones, which is what duplicating a
     * terminal has always meant.
     */
    const handleDuplicateTab = useCallback((tabId) => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (tab?.type !== 'terminal') return;

        tabCounter.current += 1;
        const newTabId = `term-${Date.now()}-${tabCounter.current}`;

        const panes = collectPanes(tab.layout);
        // One pane keeps the convention that a tab's first session is filed
        // under the tab's own id; there is no such id to reuse for the rest.
        const copy = panes.length === 1 && panes[0].host
            ? createTerminalTab(newTabId, panes[0].host)
            : (() => {
                const layout = cloneLayout(tab.layout);
                return {
                    id: newTabId,
                    type: 'terminal',
                    layout,
                    focusedPaneId: collectPanes(layout)[0]?.id || null,
                    zoomedPaneId: null,
                };
            })();

        setTabs((prev) => {
            const at = prev.findIndex(t => t.id === tabId);
            const next = [...prev];
            next.splice(at === -1 ? prev.length : at + 1, 0, copy);
            return next;
        });
        setActiveTabId(newTabId);
    }, []);

    /**
     * Close a batch of tabs at once.
     *
     * Not a loop over the single-tab close: every call in that loop would work
     * from the tab list as it stood before the batch, and which tab was left
     * focused would come down to whichever call happened to run last.
     */
    const closeTabs = useCallback((doomed, keepId) => {
        if (doomed.length === 0) return;

        for (const tab of doomed) {
            if (tab.type !== 'terminal') continue;
            for (const pane of collectPanes(tab.layout)) {
                if (pane.mode === 'terminal') window.api.ssh.disconnect(pane.id);
            }
        }

        const gone = new Set(doomed.map(tab => tab.id));
        setFullscreenTabId(prev => (prev && gone.has(prev) ? null : prev));
        setTabs(prev => prev.filter(tab => !gone.has(tab.id)));
        setActiveTabId(prev => (gone.has(prev) ? keepId : prev));
    }, []);

    const handleCloseOtherTabs = useCallback((tabId) => {
        closeTabs(tabsRef.current.filter(tab => tab.type !== 'home' && tab.id !== tabId), tabId);
    }, [closeTabs]);

    const handleCloseTabsToRight = useCallback((tabId) => {
        const at = tabsRef.current.findIndex(tab => tab.id === tabId);
        if (at === -1) return;
        closeTabs(tabsRef.current.slice(at + 1).filter(tab => tab.type !== 'home'), tabId);
    }, [closeTabs]);

    const handleCloseTab = useCallback((tabId) => {
        if (tabId === 'home') return;

        // Only terminal tabs hold sessions, one per pane. `invoke`, not `send`,
        // because the handler is registered with ipcMain.handle, so a `send`
        // would be dropped and leak the session.
        const closing = tabsRef.current.find(tab => tab.id === tabId);
        if (closing?.type === 'terminal') {
            for (const pane of collectPanes(closing.layout)) {
                if (pane.mode === 'terminal') window.api.ssh.disconnect(pane.id);
            }
        }

        // Otherwise the shell stays in fullscreen with no title bar to leave it.
        setFullscreenTabId(prev => (prev === tabId ? null : prev));

        setTabs(prev => {
            const newTabs = prev.filter(tab => tab.id !== tabId);
            if (activeTabId === tabId) {
                setActiveTabId(newTabs[newTabs.length - 1]?.id || 'home');
            }
            return newTabs;
        });
    }, [activeTabId]);

    /* -------------------------------------------------------------- *
     * Tab identity: name, colour, group
     *
     * None of this touches a session. A tab is a place the user put something,
     * and what they called it and where they filed it is theirs to keep, which
     * is why it survives a reconnect, a restore, and the host being renamed
     * underneath it.
     * -------------------------------------------------------------- */

    /** An empty name clears the override, so the host's name comes back. */
    const handleRenameTab = useCallback((tabId, title) => {
        const trimmed = String(title || '').trim().slice(0, 60);
        setTabs(prev => prev.map(tab => (
            tab.id === tabId ? { ...tab, customTitle: trimmed || null } : tab
        )));
    }, []);

    const handleColorTab = useCallback((tabId, color) => {
        setTabs(prev => prev.map(tab => (
            tab.id === tabId ? { ...tab, color: color || null } : tab
        )));
    }, []);

    /**
     * Put a tab in a group, moving it next to the group's other members so the
     * bracket the strip draws has nothing foreign inside it.
     */
    const handleGroupTab = useCallback((tabId, groupId) => {
        setTabs(prev => joinGroup(prev, tabId, groupId));
    }, []);

    const handleUngroupTab = useCallback((tabId) => {
        setTabs(prev => prev.map(tab => (
            tab.id === tabId ? { ...tab, groupId: null } : tab
        )));
    }, []);

    const handleNewGroupFromTab = useCallback((tabId) => {
        setTabGroups((groups) => {
            const group = createGroup(suggestGroupName(groups), nextGroupColor(groups));
            // Assigning inside the groups updater keeps the two writes in one
            // commit, so the strip never renders a tab pointing at a group that
            // does not exist yet.
            setTabs(prev => prev.map(tab => (tab.id === tabId ? { ...tab, groupId: group.id } : tab)));
            return [...groups, group];
        });
    }, []);

    const handleRenameGroup = useCallback((groupId, name) => {
        const trimmed = String(name || '').trim().slice(0, 40);
        if (!trimmed) return;
        setTabGroups(groups => groups.map(group => (
            group.id === groupId ? { ...group, name: trimmed } : group
        )));
    }, []);

    const handleColorGroup = useCallback((groupId, color) => {
        setTabGroups(groups => groups.map(group => (
            group.id === groupId ? { ...group, color } : group
        )));
    }, []);

    /** Dissolve the group; its tabs stay open and stay where they are. */
    const handleDeleteGroup = useCallback((groupId) => {
        setTabs(prev => prev.map(tab => (tab.groupId === groupId ? { ...tab, groupId: null } : tab)));
        setTabGroups(groups => groups.filter(group => group.id !== groupId));
    }, []);

    /* -------------------------------------------------------------- *
     * Panes
     * -------------------------------------------------------------- */

    /**
     * Put a second session beside this one.
     *
     * `source` is 'duplicate' to open the same host again, which is what a
     * split usually means, or 'pick' to drop a host chooser into the new pane.
     */
    const handleSplitPane = useCallback((tabId, paneId, direction, source = 'duplicate') => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (tab?.type !== 'terminal') return;

        const target = findPane(tab.layout, paneId);
        if (!target) return;

        if (paneCount(tab.layout) >= MAX_PANES) {
            toast.error(`A tab holds at most ${MAX_PANES} panes.`, { style: getToastStyle() });
            return;
        }

        const addition = source === 'duplicate' && target.host
            ? createPane({ host: target.host, title: target.title })
            : createPane({ mode: 'picker' });

        patchTab(tabId, current => ({
            ...current,
            layout: splitPane(current.layout, paneId, direction, addition),
            focusedPaneId: addition.id,
            // A new pane you cannot see is not much use.
            zoomedPaneId: null,
        }));
    }, [patchTab]);

    const handleClosePane = useCallback((tabId, paneId) => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (tab?.type !== 'terminal') return;

        const target = findPane(tab.layout, paneId);
        if (!target) return;

        const layout = removePane(tab.layout, paneId);
        if (!layout) {
            // That was the last pane, so the tab goes with it, and closing the
            // tab is what ends the session.
            handleCloseTab(tabId);
            return;
        }

        if (target.mode === 'terminal') window.api.ssh.disconnect(paneId);

        // Focus lands where the closed pane was, or on its neighbour if it was
        // the last one, rather than jumping back to the start of the tab.
        const position = collectPanes(tab.layout).findIndex(pane => pane.id === paneId);
        const remaining = collectPanes(layout);
        const focused = remaining.some(pane => pane.id === tab.focusedPaneId) && tab.focusedPaneId !== paneId
            ? tab.focusedPaneId
            : remaining[Math.min(Math.max(position, 0), remaining.length - 1)].id;

        patchTab(tabId, current => ({
            ...current,
            layout,
            focusedPaneId: focused,
            zoomedPaneId: current.zoomedPaneId === paneId ? null : current.zoomedPaneId,
        }));
    }, [handleCloseTab, patchTab]);

    const handleFocusPane = useCallback((tabId, paneId) => {
        patchTab(tabId, current => (
            current.focusedPaneId === paneId ? current : { ...current, focusedPaneId: paneId }
        ));
    }, [patchTab]);

    /** Fill the tab with one pane, without disturbing the others' geometry. */
    const handleToggleZoom = useCallback((tabId, paneId) => {
        patchTab(tabId, current => ({
            ...current,
            focusedPaneId: paneId,
            zoomedPaneId: current.zoomedPaneId === paneId ? null : paneId,
        }));
    }, [patchTab]);

    const handleResizeSplit = useCallback((tabId, splitId, sizes) => {
        patchTab(tabId, current => ({ ...current, layout: resizeSplit(current.layout, splitId, sizes) }));
    }, [patchTab]);

    const handleEqualizeSplit = useCallback((tabId, splitId) => {
        patchTab(tabId, current => ({ ...current, layout: equalizeSplit(current.layout, splitId) }));
    }, [patchTab]);

    /** A picker pane became a session. Same pane, same id, now with a host. */
    const handlePanePick = useCallback((tabId, paneId, host) => {
        patchTab(tabId, current => ({
            ...current,
            layout: updatePane(current.layout, paneId, {
                mode: 'terminal',
                host,
                title: host.name,
                connected: false,
            }),
            focusedPaneId: paneId,
        }));
    }, [patchTab]);

    /**
     * Move focus to whichever pane sits in that direction.
     *
     * Worked out from the layout's own geometry rather than from the tree: what
     * looks like "the pane below" is a question about the screen, and it is
     * still the right answer while another pane is zoomed over the top of it.
     */
    const handleFocusNeighbor = useCallback((tabId, direction) => {
        const tab = tabsRef.current.find(t => t.id === tabId);
        if (tab?.type !== 'terminal') return;

        const surface = document.querySelector(`[data-tab-panes="${tabId}"]`);
        const bounds = surface?.getBoundingClientRect();
        if (!bounds) return;

        const rects = measureLayout(tab.layout).panes.map(({ id, box }) => {
            const left = box.fracX * bounds.width + box.pxX;
            const top = box.fracY * bounds.height + box.pxY;
            return {
                id,
                left,
                top,
                right: left + box.fracW * bounds.width + box.pxW,
                bottom: top + box.fracH * bounds.height + box.pxH,
            };
        });

        const next = neighborPane(rects, tab.focusedPaneId, direction);
        if (!next) return;

        patchTab(tabId, current => ({
            ...current,
            focusedPaneId: next,
            // Zoomed, the move carries the zoom along with it: the alternative
            // is focusing a pane the user cannot see.
            zoomedPaneId: current.zoomedPaneId ? next : null,
        }));
    }, [patchTab]);

    /**
     * Pane shortcuts, following Windows Terminal so they are already in the
     * fingers of anyone who splits terminals. Taken in the capture phase, since
     * xterm would otherwise forward them to the remote shell.
     */
    useEffect(() => {
        const handler = (event) => {
            const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
            if (tab?.type !== 'terminal') return;

            const paneId = tab.focusedPaneId;
            const split = paneCount(tab.layout) > 1;

            const claim = () => {
                event.preventDefault();
                event.stopPropagation();
            };

            // Broadcast is a two-state chord on purpose: it toggles the scope
            // people actually want, this tab, and the window-wide scope is
            // left to the menu, where it can say how many sessions it means.
            if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyB') {
                claim();
                setBroadcast(current => (current === 'off' ? 'tab' : 'off'));
                return;
            }

            if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
                if (event.code === 'Equal' || event.code === 'NumpadAdd') {
                    claim();
                    handleSplitPane(tab.id, paneId, 'row');
                    return;
                }
                if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
                    claim();
                    handleSplitPane(tab.id, paneId, 'column');
                    return;
                }
                if (event.code === 'KeyZ' && split) {
                    claim();
                    handleToggleZoom(tab.id, paneId);
                    return;
                }
            }

            // Everything below only means anything once a tab is split, so an
            // unsplit tab keeps handing these to the shell.
            if (!split) return;

            if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyW') {
                claim();
                handleClosePane(tab.id, paneId);
                return;
            }

            if (event.altKey && !event.shiftKey && !event.ctrlKey && ARROW_DIRECTIONS[event.key]) {
                claim();
                handleFocusNeighbor(tab.id, ARROW_DIRECTIONS[event.key]);
            }
        };

        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [handleSplitPane, handleToggleZoom, handleClosePane, handleFocusNeighbor]);

    /** Clicking the tab you are on is the same gesture. See `reachedForPage`. */
    const handleTabClick = useCallback((tabId) => {
        if (tabId === activeTabIdRef.current) setReachedForPage(count => count + 1);
        else setActiveTabId(tabId);
    }, []);

    /**
     * A sheet belongs to the page it was opened from. Leaving that page (to
     * another section of Home, or out to a terminal tab) has to take it with
     * you. Home stays mounted behind a terminal tab rather than unmounting, so
     * without this an open editor would sit over the shell you switched to.
     *
     * Nothing is animated here on purpose: the page the sheet was over is no
     * longer the page on screen, and sliding it away over its replacement puts
     * the motion somewhere it does not belong. Being reached for is the case
     * that does animate, and the sheet handles that itself.
     */
    useEffect(() => {
        setHostModalOpen(false);
        setFolderModalOpen(false);
    }, [activeNav, activeTabId]);

    const handleNewHost = useCallback(() => {
        setEditingHost(null);
        setHostModalOpen(true);
    }, []);

    const handleEditHost = useCallback((host) => {
        setEditingHost(host);
        setHostModalOpen(true);
    }, []);

    /**
     * The tags already in use anywhere in the collection, most used first.
     *
     * Resolved here rather than in the editor because the editor only ever sees
     * one host, and the whole point of offering them is that a tag is shared:
     * you should be able to see that "staging" exists before typing "stage".
     */
    const allTags = useMemo(() => tagCounts(hosts).map(entry => entry.tag), [hosts]);

    const handleSaveHost = useCallback(async (hostData) => {
        const isEditing = !!hostData.id;
        // A new host is filed where you are standing. An edited one keeps the
        // folder it is already in: the editor can be opened from a search
        // result belonging to another one, and saving is not a move.
        await saveHost(isEditing ? hostData : { ...hostData, folderId: currentFolderId });
        // Closing is the sheet's job: it animates out and then unmounts itself
        // through onClose. Clearing the flag here would cut that short.
        toast.success(isEditing ? `Host "${hostData.name}" updated` : `Host "${hostData.name}" created`, { style: getToastStyle() });
    }, [saveHost, currentFolderId]);

    const handleDeleteHost = useCallback(async (hostId) => {
        await deleteHost(hostId);
    }, [deleteHost]);

    // Copied in the main process, where the credentials are; the renderer has
    // only ever seen the redacted record.
    const handleDuplicateHost = useCallback(async (host) => {
        await duplicateHost(host.id);
    }, [duplicateHost]);

    /** An import writes hosts and keys straight to the store, behind our state. */
    const handleDataImported = useCallback(() => {
        loadData();
        loadKeys();
    }, [loadData, loadKeys]);

    // A background sync adds, renames and removes hosts without the renderer
    // asking for anything, so the sidebar has to be told rather than left
    // showing whatever it loaded at startup.
    useEffect(() => window.api.serverSync.onState(({ report }) => {
        if (report && !report.error && !report.skipped) loadData();
    }), [loadData]);

    // Same for a setup pulled down from another device.
    useEffect(() => window.api.cloudSnapshot.onState((state) => {
        if (state?.pulled && state.added > 0) {
            loadData();
            loadKeys();
        }
    }), [loadData, loadKeys]);

    // Carries terminal settings to and from the snapshot; they live in
    // localStorage, which main cannot reach.
    useSettingsSnapshot();

    /**
     * Persist a host edited from inside a live session, currently its port
     * forwards. Panes carry a snapshot of the host they opened with, so every
     * pane pointing at it is refreshed too, or the next edit would be made
     * against a stale copy and silently undo this one.
     */
    const handleUpdateHost = useCallback(async (hostData) => {
        const saved = await saveHost(hostData);
        setTabs(prev => prev.map((tab) => {
            if (tab.type !== 'terminal') return tab;
            const layout = updatePanes(tab.layout, pane => (
                pane.host?.id === saved.id ? { ...pane, host: { ...pane.host, ...saved } } : pane
            ));
            return layout === tab.layout ? tab : { ...tab, layout };
        }));
        // A host edit is rare enough that a wasted array is not worth guarding.
        return saved;
    }, [saveHost]);

    // Folder modal handlers
    const handleNewFolder = useCallback(() => {
        setEditingFolder(null);
        setFolderModalOpen(true);
    }, []);

    const handleEditFolder = useCallback((folder) => {
        setEditingFolder(folder);
        setFolderModalOpen(true);
    }, []);

    const handleSaveFolder = useCallback(async (folderData) => {
        // Same rule as a host: only a new folder is filed where you are
        // standing. Renaming one must not also move it.
        await saveFolder(folderData.id ? folderData : { ...folderData, parentId: currentFolderId });
        // The sheet closes itself once it has finished animating out.
    }, [saveFolder, currentFolderId]);

    const handleDeleteFolder = useCallback(async (folderId) => {
        await deleteFolder(folderId);
    }, [deleteFolder]);

    /**
     * Make a folder without opening the editor, and hand it back.
     *
     * The Hosts page gathers a selection into a new folder, which needs the
     * record (its id, specifically) before it can move anything into it. The
     * sheet is a form; this is one step of a larger action.
     */
    const handleCreateFolder = useCallback((folder) => saveFolder(folder), [saveFolder]);

    const handleDeleteMany = useCallback(async (selection) => {
        await deleteMany(selection);
    }, [deleteMany]);

    const handleNavigateFolder = useCallback((folderId) => {
        setCurrentFolderId(folderId);
    }, []);

    // Fullscreen toggle handler
    const handleToggleFullscreen = useCallback((tabId) => {
        setFullscreenTabId(prev => prev === tabId ? null : tabId);
    }, []);

    /**
     * What the tab strip needs to know, which is about the tab's focused pane
     * rather than the tab. Derived rather than mirrored into the tab, so a
     * split can never leave the strip describing a pane that is gone.
     */
    const stripTabs = useMemo(() => tabs.map((tab) => {
        if (tab.type !== 'terminal') return tab;

        const panes = collectPanes(tab.layout);
        const focused = panes.find(pane => pane.id === tab.focusedPaneId) || panes[0];
        const sessions = panes.filter(pane => pane.mode === 'terminal');

        return {
            ...tab,
            // A name the user typed wins over the pane's, and keeps winning
            // after a split changes which pane is focused.
            title: tab.customTitle || focused?.title || 'Session',
            renamed: Boolean(tab.customTitle),
            host: focused?.host,
            // One pane still dialling, or dropped, is worth showing on the tab.
            connected: sessions.length > 0 && sessions.every(pane => pane.connected),
            paneCount: panes.length,
            // What the strip's own menu offers: there is nothing to disconnect
            // with none of them up, and nothing to reconnect with all of them.
            sessionCount: sessions.length,
            liveCount: sessions.filter(pane => pane.connected).length,
        };
    }), [tabs]);

    // Filter hosts and folders for current view
    const currentHosts = hosts.filter(h => (h.folderId || '') === currentFolderId);
    const currentFolders = folders.filter(f => (f.parentId || '') === currentFolderId);

    /**
     * Hosts with a session open somewhere in the window, so the Hosts page can
     * mark them. Derived from the tabs rather than tracked alongside them: a
     * mirrored set would be one more thing to keep in step every time a pane
     * opens, drops or closes.
     */
    const connectedHostIds = useMemo(() => {
        const ids = new Set();
        for (const tab of tabs) {
            if (tab.type !== 'terminal') continue;
            for (const pane of collectPanes(tab.layout)) {
                if (pane.mode === 'terminal' && pane.connected && pane.host?.id) ids.add(pane.host.id);
            }
        }
        return ids;
    }, [tabs]);

    return (
        // `app-drag` turns the gutter around the shell into a window frame you
        // can drag; `#app-layout` below opts back out for the content.
        <div
            className="h-full flex flex-col bg-gray-100 dark:bg-surface-base text-gray-900 dark:text-gray-100 font-inter overflow-hidden app-drag selection:bg-yellow-500/30 selection:text-yellow-600 dark:selection:text-yellow-400"
            style={{
                // A single gutter around the shell, and the same value between
                // the title bar and the content below it. Fullscreen drops it
                // so the terminal reaches the window edges.
                padding: fullscreenTabId ? 0 : APP_GUTTER,
                gap: fullscreenTabId ? 0 : APP_GUTTER,
            }}
        >
            {!fullscreenTabId && (
                <TitleBar
                    tabs={stripTabs}
                    activeTabId={activeTabId}
                    onTabClick={handleTabClick}
                    onTabClose={handleCloseTab}
                    onTabCloseOthers={handleCloseOtherTabs}
                    onTabCloseRight={handleCloseTabsToRight}
                    onTabDuplicate={handleDuplicateTab}
                    onTabDisconnect={handleDisconnectTab}
                    onTabReconnect={handleReconnectTab}
                    onTabRename={handleRenameTab}
                    onTabColor={handleColorTab}
                    onTabGroup={handleGroupTab}
                    onTabUngroup={handleUngroupTab}
                    onTabNewGroup={handleNewGroupFromTab}
                    onGroupRename={handleRenameGroup}
                    onGroupColor={handleColorGroup}
                    onGroupDelete={handleDeleteGroup}
                    groups={tabGroups}
                    showLogo={showLogo}
                    logoImage={logoImage}
                    logoSide={logoSide}
                    broadcast={broadcast}
                    broadcastCount={broadcastCount}
                    onBroadcastChange={setBroadcast}
                    onNewSession={handleNewTab}
                />
            )}

            <div className="flex flex-1 min-h-0 app-no-drag" id="app-layout">
                <Sidebar
                    activeNav={activeNav}
                    onNavChange={handleNavChange}
                    isTerminalView={activeTabId !== 'home'}
                />

                <main className="flex-1 relative overflow-hidden flex flex-col" id="main-content">
                    {/* Home view - show when home tab is active */}
                    <div style={{
                        visibility: activeTabId === 'home' ? 'visible' : 'hidden',
                        position: activeTabId === 'home' ? 'relative' : 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: activeTabId === 'home' ? 10 : 0,
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1
                    }}>
                        <HomeView
                            activeNav={activeNav}
                            isActive={activeTabId === 'home'}
                            reachedForPage={reachedForPage}
                            hosts={currentHosts}
                            folders={currentFolders}
                            allHosts={hosts}
                            allFolders={folders}
                            currentFolderId={currentFolderId}
                            connectedHostIds={connectedHostIds}
                            theme={theme}
                            appColors={appColors}
                            showLogo={showLogo}
                            logoImage={logoImage}
                            logoSide={logoSide}
                            terminalTheme={terminalTheme}
                            customTerminalTheme={customTerminalTheme}
                            terminalSettings={terminalSettings}
                            terminalFonts={terminalFonts}
                            onThemeChange={setTheme}
                            onAppColorsChange={setAppColors}
                            onShowLogoChange={setShowLogo}
                            onLogoImageChange={setLogoImage}
                            onLogoSideChange={setLogoSide}
                            onTerminalThemeChange={setTerminalTheme}
                            onCustomTerminalThemeChange={setCustomTerminalTheme}
                            onTerminalSettingsChange={setTerminalSettings}
                            onTerminalSettingsReset={resetTerminalSettings}
                            onDataImported={handleDataImported}
                            onNewHost={handleNewHost}
                            onEditHost={handleEditHost}
                            onDuplicateHost={handleDuplicateHost}
                            onDeleteHost={handleDeleteHost}
                            onConnect={handleConnect}
                            onNewFolder={handleNewFolder}
                            onCreateFolder={handleCreateFolder}
                            onEditFolder={handleEditFolder}
                            onDeleteFolder={handleDeleteFolder}
                            onDeleteMany={handleDeleteMany}
                            onNavigateFolder={handleNavigateFolder}
                            onArrange={arrangeItems}
                            onTagHosts={tagHosts}
                            // Keychain props
                            keys={keys}
                            onLoadKeys={loadKeys}
                            onSaveKey={saveKey}
                            onDeleteKey={deleteKey}
                            onGenerateKey={generateKey}
                        />
                    </div>

                    {/* Launcher tabs - the host picker lives in the tab itself */}
                    {tabs.filter(t => t.type === 'launcher').map(tab => (
                        <div
                            key={tab.id}
                            style={{
                                visibility: activeTabId === tab.id ? 'visible' : 'hidden',
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                zIndex: activeTabId === tab.id ? 10 : 0,
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <NewTabView
                                hosts={hosts}
                                folders={folders}
                                isActive={activeTabId === tab.id}
                                onConnect={(host) => handleConnect(host, tab.id)}
                                onNewHost={handleNewHost}
                                onClose={() => handleCloseTab(tab.id)}
                            />
                        </div>
                    ))}

                    {/* Render ALL terminal tabs - use visibility to show/hide */}
                    {tabs.filter(t => t.type === 'terminal').map((tab) => {
                        const isActiveTab = activeTabId === tab.id;
                        const split = paneCount(tab.layout) > 1;

                        return (
                            <div
                                key={tab.id}
                                data-tab-panes={tab.id}
                                style={{
                                    visibility: isActiveTab ? 'visible' : 'hidden',
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    zIndex: isActiveTab ? 10 : 0,
                                }}
                            >
                                <SplitLayout
                                    layout={tab.layout}
                                    focusedPaneId={tab.focusedPaneId}
                                    zoomedPaneId={tab.zoomedPaneId}
                                    onResizeSplit={(splitId, sizes) => handleResizeSplit(tab.id, splitId, sizes)}
                                    onEqualizeSplit={(splitId) => handleEqualizeSplit(tab.id, splitId)}
                                    renderPane={(pane, { focused }) => (
                                        pane.mode === 'picker' ? (
                                            <PanePicker
                                                hosts={hosts}
                                                isActive={isActiveTab && focused}
                                                onPick={(host) => handlePanePick(tab.id, pane.id, host)}
                                                onCancel={() => handleClosePane(tab.id, pane.id)}
                                            />
                                        ) : (
                                            <TerminalView
                                                pane={pane}
                                                terminalTheme={terminalTheme}
                                                customTerminalTheme={customTerminalTheme}
                                                terminalSettings={terminalSettings}
                                                broadcast={broadcast}
                                                // Under 'tab' scope only the tab
                                                // in front is in range, which is
                                                // the tab the keys are typed in.
                                                isBroadcastTarget={
                                                    broadcast === 'window'
                                                    || (broadcast === 'tab' && isActiveTab)
                                                }
                                                broadcastCount={broadcastCount}
                                                onBroadcastChange={setBroadcast}
                                                onInput={handlePaneInput}
                                                isActive={isActiveTab}
                                                isFocused={focused}
                                                isSplit={split}
                                                isZoomed={tab.zoomedPaneId === pane.id}
                                                canSplit={paneCount(tab.layout) < MAX_PANES}
                                                isFullscreen={fullscreenTabId === tab.id}
                                                onToggleFullscreen={() => handleToggleFullscreen(tab.id)}
                                                onFocus={() => handleFocusPane(tab.id, pane.id)}
                                                onSplit={(direction, source) => handleSplitPane(tab.id, pane.id, direction, source)}
                                                onToggleZoom={() => handleToggleZoom(tab.id, pane.id)}
                                                onClosePane={() => handleClosePane(tab.id, pane.id)}
                                                onConnectResult={handleConnectResult}
                                                onConnectionChange={handleConnectionChange}
                                                onRegisterConnection={registerPaneConnection}
                                                onUpdateHost={handleUpdateHost}
                                            />
                                        )
                                    )}
                                />
                            </div>
                        );
                    })}
                </main>
            </div>

            {/* Mounted only while open. The sheet animates itself out and calls
                onClose when it has finished, so there is no half-open state to
                track here. */}
            {hostModalOpen && (
                <HostModal
                    host={editingHost}
                    dismiss={reachedForPage}
                    onClose={() => { setHostModalOpen(false); setEditingHost(null); }}
                    onSave={handleSaveHost}
                    keys={keys}
                    // For the jump host picker: a host is reached through
                    // another saved host, so the editor has to see the rest.
                    hosts={hosts}
                    allTags={allTags}
                />
            )}

            {folderModalOpen && (
                <FolderModal
                    folder={editingFolder}
                    dismiss={reachedForPage}
                    onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
                    onSave={handleSaveFolder}
                />
            )}

            <HostKeyModal
                prompt={hostKeyPrompts[0] || null}
                onRespond={handleHostKeyResponse}
            />

            {/* Below the host key modal on purpose: a key has to be trusted
                before anything is worth typing into that connection. */}
            <AuthPromptModal
                prompt={hostKeyPrompts.length === 0 ? (authPrompts[0] || null) : null}
                onRespond={handleAuthPromptResponse}
            />
        </div>
    );
}

export default App;
