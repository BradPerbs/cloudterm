const { BrowserWindow, clipboard, dialog, screen, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// id -> { image, title, window }. Captures live only until their viewer closes.
const captures = new Map();
let counter = 0;

const VIEWER_CHROME_HEIGHT = 96; // header + padding around the preview
const MIN_WIDTH = 520;
const MIN_HEIGHT = 320;

/** capturePage needs integers, and a rect outside the page yields an empty image. */
function normalizeRect(rect, bounds) {
    const x = Math.max(0, Math.round(rect?.x ?? 0));
    const y = Math.max(0, Math.round(rect?.y ?? 0));
    const width = Math.round(rect?.width ?? 0);
    const height = Math.round(rect?.height ?? 0);

    return {
        x,
        y,
        width: Math.max(1, Math.min(width, bounds.width - x)),
        height: Math.max(1, Math.min(height, bounds.height - y)),
    };
}

/**
 * The viewer runs off the same bundle as the window that spawned it, so derive
 * its URL from the parent rather than branching on dev/packaged. Works for the
 * dev server and for file:// alike.
 */
function viewerUrl(parent, id) {
    const current = parent.webContents.getURL();
    const base = current.split('#')[0];
    if (base) return `${base}#screenshot=${id}`;

    const fallback = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
    return `file://${fallback.replace(/\\/g, '/')}#screenshot=${id}`;
}

function openViewer(id, parent) {
    const capture = captures.get(id);
    if (!capture) return;

    const size = capture.image.getSize();
    const work = screen.getDisplayMatching(parent.getBounds()).workAreaSize;

    const width = Math.min(Math.max(size.width + 48, MIN_WIDTH), Math.round(work.width * 0.9));
    const height = Math.min(
        Math.max(size.height + VIEWER_CHROME_HEIGHT, MIN_HEIGHT),
        Math.round(work.height * 0.9)
    );

    const viewer = new BrowserWindow({
        width,
        height,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        frame: false,
        backgroundColor: '#16161e',
        show: false,
        title: 'Screenshot',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
        },
    });

    // Same hardening as the main window: this renderer shows captured terminal
    // output and must not navigate or spawn windows.
    viewer.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
    });
    viewer.webContents.on('will-navigate', (event, url) => {
        const isDevServer = !app.isPackaged && url.startsWith('http://localhost:5173');
        if (!isDevServer) event.preventDefault();
    });

    viewer.once('ready-to-show', () => viewer.show());
    viewer.on('closed', () => captures.delete(id));

    capture.window = viewer;
    viewer.loadURL(viewerUrl(parent, id));
}

/** Capture a region of the main window and open it in its own viewer window. */
async function capture(parent, { rect, title } = {}) {
    if (!parent || parent.isDestroyed()) {
        return { success: false, message: 'No window to capture' };
    }

    try {
        const bounds = parent.getContentBounds();
        const image = await parent.webContents.capturePage(normalizeRect(rect, bounds));

        if (image.isEmpty()) {
            return { success: false, message: 'Capture produced an empty image' };
        }

        const id = `shot-${++counter}`;
        captures.set(id, { image, title: title || 'Screenshot' });
        openViewer(id, parent);
        return { success: true, id };
    } catch (error) {
        console.error('Screenshot failed:', error.message);
        return { success: false, message: error.message };
    }
}

function get(id) {
    const capture = captures.get(id);
    if (!capture) return null;
    const { width, height } = capture.image.getSize();
    return {
        // data: URL keeps the bytes off the IPC hot path as a plain string and
        // renders directly in an <img>.
        dataUrl: capture.image.toDataURL(),
        title: capture.title,
        width,
        height,
    };
}

function copy(id) {
    const capture = captures.get(id);
    if (!capture) return { success: false, message: 'Screenshot expired' };
    clipboard.writeImage(capture.image);
    return { success: true };
}

async function save(id) {
    const capture = captures.get(id);
    if (!capture) return { success: false, message: 'Screenshot expired' };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeTitle = String(capture.title).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');

    const result = await dialog.showSaveDialog(capture.window, {
        title: 'Save screenshot',
        defaultPath: path.join(app.getPath('pictures'), `${safeTitle || 'screenshot'}-${stamp}.png`),
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });

    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
        fs.writeFileSync(result.filePath, capture.image.toPNG());
        return { success: true, filePath: result.filePath };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

function reveal(filePath) {
    shell.showItemInFolder(filePath);
    return { success: true };
}

/** Close the window a renderer call came from. The viewer has no OS frame. */
function closeViewer(webContents) {
    BrowserWindow.fromWebContents(webContents)?.close();
    return { success: true };
}

function closeAll() {
    for (const { window } of captures.values()) {
        if (window && !window.isDestroyed()) window.close();
    }
    captures.clear();
}

module.exports = { capture, get, copy, save, reveal, closeViewer, closeAll };
