const { BrowserWindow, app, screen, shell } = require('electron');
const path = require('path');

/**
 * The assistant's own windows.
 *
 * A conversation can be lifted out of the panel beside the terminal and put in
 * a window of its own: one window for a set of tabs, or one per tab. The
 * conversations themselves stay where they were, in `ai/index.js`; a window is
 * only a place they are drawn, and the same events reach every window that
 * happens to be drawing them.
 *
 * Each window runs the same renderer bundle as the main window, told by its
 * URL hash to show the assistant alone, the way the screenshot viewer is told
 * to show one capture. What the renderer in it cannot know is which terminals
 * are open and which one the user is looking at, since those live in the main
 * window's tab tree, so the main window publishes that here and it is relayed.
 *
 * What a window holds is remembered here, not in the window: a reload asks
 * for it back, and a window that closes hands its tabs to the main window so
 * a conversation is never stranded with nothing showing it.
 */

/** windowId -> { id, window, conversationIds } */
const windows = new Map();
let counter = 0;

/**
 * What the main window's panel is showing, reported the same way a detached
 * window reports its own. Kept so that a conversation opened somewhere else
 * can be taken off the panel: a chat is shown in one place, never two.
 */
let mainTabs = [];

/** How the main window is told things: adopting tabs, going to a page. */
let notifyMain = () => {};

/**
 * What the main window knows and a detached one cannot: the open sessions,
 * the saved hosts, and the session in front. Kept so a window opening late
 * gets the current answer without waiting for the next change.
 */
let context = { sessions: [], hosts: [], activeSessionId: '' };

function setMainNotifier(fn) {
    notifyMain = fn;
}

const cleanIds = (list) => [...new Set((Array.isArray(list) ? list : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))];

/** The same bundle as the parent, whichever way the parent was loaded. */
function windowUrl(parent, id) {
    const current = parent && !parent.isDestroyed() ? parent.webContents.getURL() : '';
    const base = current.split('#')[0];
    if (base) return `${base}#assistant=${id}`;

    const fallback = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
    return `file://${fallback.replace(/\\/g, '/')}#assistant=${id}`;
}

function entryFor(webContents) {
    for (const entry of windows.values()) {
        if (entry.window.webContents === webContents) return entry;
    }
    return null;
}

/**
 * Open a window holding these conversations.
 *
 * Sized to a comfortable panel rather than to the parent, and placed beside
 * the parent's right edge when there is room, since that is where the panel
 * it came out of was.
 */
function open(parent, conversationIds = []) {
    const ids = cleanIds(conversationIds);

    counter += 1;
    const id = `aiw-${Date.now().toString(36)}-${counter}`;

    const width = 480;
    const height = 720;
    let position = {};
    if (parent && !parent.isDestroyed()) {
        const bounds = parent.getBounds();
        const work = screen.getDisplayMatching(bounds).workArea;
        // Beside the parent when that fits on the same screen, else over it.
        const x = bounds.x + bounds.width + 8 + width <= work.x + work.width
            ? bounds.x + bounds.width + 8
            : Math.max(work.x, bounds.x + bounds.width - width - 24);
        const y = Math.max(work.y, Math.min(bounds.y + 24, work.y + work.height - height));
        position = { x, y };
    }

    const window = new BrowserWindow({
        width,
        height,
        minWidth: 360,
        minHeight: 420,
        ...position,
        ...(process.platform === 'darwin'
            ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 19, y: 24 } }
            : { frame: false }),
        backgroundColor: '#16161e',
        show: false,
        title: 'CloudTerm - AI Agent',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
        },
    });

    // The same hardening as the main window: this renderer draws model output
    // and terminal text and must neither navigate nor spawn windows.
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
        const isDevServer = !app.isPackaged && url.startsWith('http://localhost:5173');
        if (!isDevServer) event.preventDefault();
    });

    const entry = { id, window, conversationIds: ids };
    windows.set(id, entry);

    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
        windows.delete(id);
        // Whatever it still held goes back to the panel, so closing the window
        // means "put these back", never "lose these".
        if (entry.conversationIds.length > 0) {
            notifyMain('ai-tabs-adopt', { conversationIds: entry.conversationIds });
        }
    });

    window.loadURL(windowUrl(parent, id));
    return { success: true, windowId: id };
}

/** What the window a call came from is holding, for its first render. */
function tabs(webContents) {
    const entry = entryFor(webContents);
    return { conversationIds: entry ? [...entry.conversationIds] : [], detached: Boolean(entry) };
}

/**
 * A window telling us what it holds now, so a reload and a close agree.
 *
 * Also where "one place" is enforced. Anything this window has just taken on
 * that another window was showing is taken off that other window: it is told
 * to let go, and the record here is corrected at once so a close in between
 * cannot hand the same conversation back a second time. Only what is new to
 * this window counts, so two windows reporting the same standing list cannot
 * strip each other bare.
 */
function setTabs(webContents, conversationIds) {
    const ids = cleanIds(conversationIds);
    const entry = entryFor(webContents);

    const previous = entry ? entry.conversationIds : mainTabs;
    const added = ids.filter(id => !previous.includes(id));
    if (entry) entry.conversationIds = ids;
    else mainTabs = ids;

    if (added.length > 0) {
        for (const other of windows.values()) {
            if (other === entry || other.window.isDestroyed()) continue;
            const taken = other.conversationIds.filter(id => added.includes(id));
            if (taken.length === 0) continue;
            other.conversationIds = other.conversationIds.filter(id => !taken.includes(id));
            other.window.webContents.send('ai-tabs-release', { conversationIds: taken });
        }
        if (entry) {
            const taken = mainTabs.filter(id => added.includes(id));
            if (taken.length > 0) {
                mainTabs = mainTabs.filter(id => !taken.includes(id));
                notifyMain('ai-tabs-release', { conversationIds: taken });
            }
        }
    }

    return { success: true };
}

/**
 * Hand some or all of a window's tabs back to the main window. With nothing
 * left the window closes; its `closed` handler then has nothing to send.
 */
function reattach(webContents, conversationIds) {
    const entry = entryFor(webContents);
    if (!entry) return { success: false };

    const asked = cleanIds(conversationIds);
    const going = asked.length > 0
        ? entry.conversationIds.filter(id => asked.includes(id))
        : [...entry.conversationIds];

    entry.conversationIds = entry.conversationIds.filter(id => !going.includes(id));
    if (going.length > 0) notifyMain('ai-tabs-adopt', { conversationIds: going });
    if (entry.conversationIds.length === 0) entry.window.close();
    return { success: true };
}

/** Close the window a call came from, without handing anything back. */
function closeWindow(webContents) {
    const entry = entryFor(webContents);
    if (!entry) return { success: false };
    entry.conversationIds = [];
    entry.window.close();
    return { success: true };
}

/** Every conversation shown in a detached window. */
function held() {
    const ids = [];
    for (const entry of windows.values()) ids.push(...entry.conversationIds);
    return ids;
}

function setContext(next) {
    context = {
        sessions: Array.isArray(next?.sessions) ? next.sessions : [],
        hosts: Array.isArray(next?.hosts) ? next.hosts : [],
        activeSessionId: String(next?.activeSessionId || ''),
    };
    for (const entry of windows.values()) {
        if (!entry.window.isDestroyed()) entry.window.webContents.send('ai-context', context);
    }
    return { success: true };
}

function getContext() {
    return context;
}

/** On the main window going: nothing to hand tabs back to, so just close. */
function closeAll() {
    for (const entry of windows.values()) {
        entry.conversationIds = [];
        if (!entry.window.isDestroyed()) entry.window.close();
    }
    windows.clear();
}

module.exports = {
    setMainNotifier,
    open,
    tabs,
    setTabs,
    reattach,
    closeWindow,
    held,
    setContext,
    getContext,
    closeAll,
};
