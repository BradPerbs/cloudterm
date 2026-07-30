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
        frame: false,
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
        },
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
