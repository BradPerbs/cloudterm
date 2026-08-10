const { app, BrowserWindow, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const ipc = require('./ipc');
const transport = require('./transport');
const cloudSnapshot = require('./cloud-snapshot');

let mainWindow = null;

const getWindow = () => mainWindow;

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        const state = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
        if (!Number.isFinite(state.width) || !Number.isFinite(state.height)) return null;

        // A position remembered on a monitor that has since been unplugged
        // would open the window off-screen, with no way to grab it.
        const visible = Number.isFinite(state.x) && Number.isFinite(state.y)
            && screen.getAllDisplays().some(({ workArea }) =>
                state.x < workArea.x + workArea.width
                && state.x + state.width > workArea.x
                && state.y < workArea.y + workArea.height
                && state.y + state.height > workArea.y);

        return {
            width: Math.max(900, Math.round(state.width)),
            height: Math.max(600, Math.round(state.height)),
            ...(visible ? { x: Math.round(state.x), y: Math.round(state.y) } : {}),
            maximized: Boolean(state.maximized),
        };
    } catch {
        return null; // First run, or an unreadable file. Use the defaults.
    }
}

function saveWindowState(window) {
    try {
        // getNormalBounds reports the pre-maximize rectangle, so restoring a
        // maximized window and then un-maximizing lands where it used to be.
        fs.writeFileSync(windowStateFile(), JSON.stringify({
            ...window.getNormalBounds(),
            maximized: window.isMaximized(),
        }));
    } catch (error) {
        console.error('Failed to save window state:', error.message);
    }
}

function createWindow() {
    const state = loadWindowState();

    mainWindow = new BrowserWindow({
        width: state?.width || 1200,
        height: state?.height || 800,
        ...(state?.x !== undefined ? { x: state.x, y: state.y } : {}),
        minWidth: 900,
        minHeight: 600,
        // Everywhere but macOS the window is frameless and the title bar draws
        // its own three buttons. macOS keeps its traffic lights: a frameless
        // window there loses them outright, and nothing this app could draw
        // instead would behave the way the rest of the system does. So it gets
        // an inset title bar, positioned to sit in the middle of the app's own
        // 40px bar (12px gutter above it, 16px of button), and TitleBar.jsx
        // leaves a gap on the left for them.
        ...(process.platform === 'darwin'
            ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 19, y: 24 } }
            : { frame: false }),
        // What the frame shows before the renderer has painted anything. The
        // app's own window colour, so the first frame is not a different dark.
        backgroundColor: '#16161e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            /*
             * On for one feature: the IPMI pane, which loads a service
             * processor's own web interface (see src/main/bmc.js).
             *
             * The alternative, a WebContentsView, is positioned by the main
             * process and painted outside the DOM, so it would sit on top of
             * every split, dropdown and modal and have to be moved by hand on
             * every layout change. A `<webview>` is an element: it clips,
             * scrolls and stacks like the rest of the pane.
             *
             * What keeps this from widening the app's attack surface is
             * `will-attach-webview` below, which is where the guest's
             * privileges are actually decided. Turning the tag on only makes
             * the element available; it grants the guest nothing.
             */
            webviewTag: true,
        },
    });

    /*
     * Every `<webview>` the renderer creates, on the way in.
     *
     * A guest here is a BMC's web UI: vendor JavaScript, often a decade old,
     * from a device on the LAN. It gets no preload, no node integration and no
     * escape from its sandbox, and those are enforced here rather than trusted
     * from the element's attributes, because the attributes are written by the
     * renderer and this is not.
     */
    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.allowRunningInsecureContent = false;
        webPreferences.experimentalFeatures = false;

        // Only ever http(s), and only ever into a partition bmc.js owns. A
        // guest asking for `file://`, or for the default session, is not one of
        // ours and does not get to attach.
        const url = String(params.src || '');
        const partition = String(params.partition || '');
        if (!/^https?:\/\//i.test(url) || !partition.startsWith('bmc-')) {
            event.preventDefault();
        }
    });

    // The renderer displays untrusted remote output; it must never navigate
    // away from the app or spawn windows.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        const isDevServer = !app.isPackaged && url.startsWith('http://localhost:5173');
        if (!isDevServer) event.preventDefault();
    });

    if (state?.maximized) mainWindow.maximize();

    // 'close' fires while the window is still alive, so its bounds are
    // still readable; 'closed' is too late.
    mainWindow.on('close', () => saveWindowState(mainWindow));

    mainWindow.on('closed', () => {
        ipc.cancelPendingPrompts();
        mainWindow = null;
    });

    const builtIndex = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');

    if (!app.isPackaged) {
        // Fall back to the built renderer when the dev server isn't running, so
        // `npm start` works without Vite.
        mainWindow.webContents.once('did-fail-load', () => mainWindow.loadFile(builtIndex));
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(builtIndex);
    }
}

app.whenReady().then(() => {
    /*
     * Windows attributes a notification to an Application User Model ID, and
     * without one set it uses the host executable's: toasts from the monitor
     * would arrive branded as Electron, and on some builds be dropped outright.
     * The same id electron-builder writes into the Start Menu shortcut, which
     * is what the toast has to be matched against.
     *
     * Harmless everywhere else; the call is a no-op off Windows.
     */
    app.setAppUserModelId('com.cloudblast.ssh');

    ipc.register(getWindow);
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', () => {
    // A debounced upload that has not fired yet would be lost with the process,
    // so quitting right after an edit is the case worth flushing for. Best
    // effort: nothing here delays the quit waiting on the network.
    cloudSnapshot.flush();
    transport.destroyAll();
});

app.on('window-all-closed', () => {
    transport.destroyAll();
    ipc.cancelPendingPrompts();
    if (process.platform !== 'darwin') app.quit();
});
