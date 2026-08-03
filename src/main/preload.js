const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* ------------------------------------------------------------------ *
 * Terminal data channel
 *
 * MessagePorts cannot cross the context bridge, so the preload owns them and
 * exposes a callback API instead. Keystrokes that arrive before the port is
 * established are queued rather than dropped.
 * ------------------------------------------------------------------ */

const ports = new Map();        // tabId -> MessagePort
const handlers = new Map();     // tabId -> callback
const pending = new Map();      // tabId -> queued messages

// Every open tab subscribes to the broadcast channels (disconnects, transfer
// updates, resume). The default ceiling of 10 would start warning at five tabs.
ipcRenderer.setMaxListeners(200);

ipcRenderer.on('ssh-port', (event, { tabId }) => {
    const port = event.ports?.[0];
    if (!port) return;

    // A reconnect hands out a fresh port for the same tab; the old one has to
    // go or it leaks and its queued messages never land anywhere.
    const previous = ports.get(tabId);
    if (previous) {
        previous.onmessage = null;
        try {
            previous.close();
        } catch {
            // Already closed with the session it belonged to.
        }
    }

    ports.set(tabId, port);

    port.onmessage = (message) => {
        const handler = handlers.get(tabId);
        if (!handler) return;
        if (typeof message.data === 'string') {
            handler({ type: 'data', data: message.data });
        } else if (message.data?.type === 'disconnected') {
            handler({ type: 'disconnected' });
        }
    };
    port.start();

    const queued = pending.get(tabId);
    if (queued) {
        for (const message of queued) port.postMessage(message);
        pending.delete(tabId);
    }
});

function post(tabId, message) {
    const port = ports.get(tabId);
    if (port) {
        port.postMessage(message);
        return;
    }
    const queue = pending.get(tabId) || [];
    queue.push(message);
    pending.set(tabId, queue);
}

function closePort(tabId) {
    const port = ports.get(tabId);
    if (port) {
        port.close();
        ports.delete(tabId);
    }
    handlers.delete(tabId);
    pending.delete(tabId);
}

/** Subscribe to a main-process event, returning an unsubscribe function. */
function subscribe(channel, callback) {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
    hosts: {
        list: () => ipcRenderer.invoke('get-hosts'),
        save: (host) => ipcRenderer.invoke('save-host', host),
        remove: (hostId) => ipcRenderer.invoke('delete-host', hostId),
        // Copied in main, where the credentials are: a copy made by saving the
        // redacted record back would come out unable to log in.
        duplicate: (hostId) => ipcRenderer.invoke('duplicate-host', hostId),
        /**
         * Add and remove tags across several hosts at once:
         * `{ hostIds, add, remove }`. One call however many were selected, so
         * tagging a dozen is a single write rather than a dozen saves.
         */
        tag: (edit) => ipcRenderer.invoke('tag-hosts', edit),
    },

    folders: {
        list: () => ipcRenderer.invoke('get-folders'),
        save: (folder) => ipcRenderer.invoke('save-folder', folder),
        remove: (folderId) => ipcRenderer.invoke('delete-folder', folderId),
    },

    /**
     * Where records sit: which folder they belong to and in what order. Spans
     * both collections because one drag can move a folder and renumber the
     * hosts it landed among, and that should be a single write.
     */
    arrange: {
        apply: (changes) => ipcRenderer.invoke('arrange-items', changes),
    },

    keys: {
        list: () => ipcRenderer.invoke('get-keys'),
        save: (key) => ipcRenderer.invoke('save-key', key),
        remove: (keyId) => ipcRenderer.invoke('delete-key', keyId),
        generate: (options) => ipcRenderer.invoke('generate-key', options),
        // Whether this machine can hold a key in its TPM behind Windows Hello,
        // and the enrolment that puts one there.
        helloSupported: () => ipcRenderer.invoke('hello-supported'),
        createHello: (options) => ipcRenderer.invoke('create-hello-key', options),
    },

    snippets: {
        list: () => ipcRenderer.invoke('get-snippets'),
        save: (snippet) => ipcRenderer.invoke('save-snippet', snippet),
        remove: (snippetId) => ipcRenderer.invoke('delete-snippet', snippetId),
    },

    /**
     * Saved proxies: SOCKS5, SOCKS4 and HTTP CONNECT servers a host can be
     * dialled through, whatever it speaks once it is connected.
     *
     * A proxy's password comes back only as `hasPassword`, like every other
     * stored secret. It goes the other way when it is first typed, which is the
     * only direction a secret ever travels, and `test` may carry one for the same
     * reason: checking settings that have not been saved yet is most of what
     * checking is for.
     */
    proxies: {
        list: () => ipcRenderer.invoke('get-proxies'),
        save: (record) => ipcRenderer.invoke('save-proxy', record),
        remove: (proxyId) => ipcRenderer.invoke('delete-proxy', proxyId),
        duplicate: (proxyId) => ipcRenderer.invoke('duplicate-proxy', proxyId),
        // `{ proxyId }` for a saved record, `{ proxy }` for a draft.
        test: (payload) => ipcRenderer.invoke('proxies-test', payload || {}),
    },

    store: {
        status: () => ipcRenderer.invoke('store-status'),
    },

    // The audit trail: connections made, records edited, remote files touched.
    // Read-only from here apart from clearing it: entries are written by the
    // main process at the point the thing actually happened, never by the
    // renderer asking for a line to be added.
    activity: {
        list: (options) => ipcRenderer.invoke('activity-list', options || {}),
        summary: () => ipcRenderer.invoke('activity-summary'),
        clear: () => ipcRenderer.invoke('activity-clear'),
        export: () => ipcRenderer.invoke('activity-export'),

        onAppend: (callback) => subscribe('activity-append', callback),
        onCleared: (callback) => subscribe('activity-cleared', callback),
    },

    /**
     * Session transcripts: what the server printed, written to a file.
     *
     * Write-only from here in the sense that matters: the renderer can turn
     * recording on, off and find the files, but the transcript never travels
     * back across the bridge. It is captured in main, where the bytes arrive,
     * so a reload cannot punch a hole in it.
     */
    sessionLog: {
        config: () => ipcRenderer.invoke('session-log-config'),
        configure: (patch) => ipcRenderer.invoke('session-log-configure', patch || {}),
        chooseDirectory: () => ipcRenderer.invoke('session-log-choose-directory'),
        resetDirectory: () => ipcRenderer.invoke('session-log-reset-directory'),
        openFolder: () => ipcRenderer.invoke('session-log-open-folder'),

        status: (tabId) => ipcRenderer.invoke('session-log-status', tabId),
        start: (tabId) => ipcRenderer.invoke('session-log-start', tabId),
        stop: (tabId) => ipcRenderer.invoke('session-log-stop', tabId),

        list: (options) => ipcRenderer.invoke('session-log-list', options || {}),
        reveal: (filePath) => ipcRenderer.invoke('session-log-reveal', filePath),
    },

    // Optional password required to open the app. Main refuses everything else
    // while locked, so these are the only calls that answer before unlocking.
    appLock: {
        status: () => ipcRenderer.invoke('app-lock-status'),
        unlock: (password) => ipcRenderer.invoke('app-lock-unlock', password),
        set: (password) => ipcRenderer.invoke('app-lock-set', password),
        change: (current, next) => ipcRenderer.invoke('app-lock-change', { current, next }),
        disable: (password) => ipcRenderer.invoke('app-lock-disable', password),
        lock: () => ipcRenderer.invoke('app-lock-lock'),
        // Fired when main re-locks, so the renderer can drop back to the lock
        // screen without being the thing that decided to.
        onLocked: (callback) => subscribe('app-locked', callback),
    },

    // A pane's session, whatever it runs over. Named for SSH because that is
    // what every session was when this was written and what almost all of them
    // still are; main reads the host record and picks between SSH, telnet and a
    // serial port. Nothing on this side has to know which it got: the port
    // carries bytes either way.
    ssh: {
        connect: ({ tabId, hostId, cols, rows }) =>
            ipcRenderer.invoke('ssh-connect', { tabId, hostId, cols, rows }),
        disconnect: (tabId) => ipcRenderer.invoke('ssh-disconnect', tabId),
        detectOS: (tabId) => ipcRenderer.invoke('ssh-detect-os', tabId),

        sendInput: (tabId, data) => post(tabId, { type: 'input', data }),
        resize: (tabId, cols, rows) => post(tabId, { type: 'resize', cols, rows }),

        onData: (tabId, callback) => {
            handlers.set(tabId, callback);
            return () => handlers.delete(tabId);
        },
        release: (tabId) => closePort(tabId),

        onDisconnected: (callback) => subscribe('ssh-disconnected', callback),
    },

    agent: {
        // `agentPath` blank means "auto-detect"; main resolves it.
        status: (agentPath) => ipcRenderer.invoke('agent-status', agentPath || ''),
        defaultPath: () => ipcRenderer.invoke('agent-default-path'),
    },

    // The serial ports this machine can see, for the picker in the host editor.
    // Answers `{ available, message, ports }` rather than throwing when the
    // serial binding is missing, so the editor can say why the list is empty.
    serial: {
        listPorts: () => ipcRenderer.invoke('serial-list-ports'),
    },

    auth: {
        // Keyboard-interactive rounds the app cannot answer on its own: a
        // one-time code, a push approval, an expired password.
        onPrompt: (callback) => subscribe('auth-prompt', callback),
        // `answers` omitted (or null) cancels the attempt.
        respond: (requestId, answers) =>
            ipcRenderer.invoke('auth-prompt-response', { requestId, answers }),
    },

    hostKeys: {
        onPrompt: (callback) => subscribe('host-key-prompt', callback),
        respond: (requestId, accepted) =>
            ipcRenderer.invoke('host-key-response', { requestId, accepted }),
        list: () => ipcRenderer.invoke('known-hosts-list'),
        forget: (host, port) => ipcRenderer.invoke('known-hosts-forget', { host, port }),
        forgetById: (id) => ipcRenderer.invoke('known-hosts-forget-id', id),
        forgetKey: (id, fingerprint) =>
            ipcRenderer.invoke('known-hosts-forget-key', { id, fingerprint }),
    },

    sftp: {
        init: (tabId) => ipcRenderer.invoke('sftp-init', tabId),
        close: (tabId) => ipcRenderer.invoke('sftp-close', tabId),

        list: (tabId, remotePath) => ipcRenderer.invoke('sftp-list', { tabId, remotePath }),
        home: (tabId) => ipcRenderer.invoke('sftp-home', tabId),
        realpath: (tabId, remotePath) => ipcRenderer.invoke('sftp-realpath', { tabId, remotePath }),
        stat: (tabId, remotePath, follow = true) =>
            ipcRenderer.invoke('sftp-stat', { tabId, remotePath, follow }),
        diskUsage: (tabId, remotePath) => ipcRenderer.invoke('sftp-disk-usage', { tabId, remotePath }),

        mkdir: (tabId, remotePath) => ipcRenderer.invoke('sftp-mkdir', { tabId, remotePath }),
        createFile: (tabId, remotePath) => ipcRenderer.invoke('sftp-create-file', { tabId, remotePath }),
        remove: (tabId, remotePaths) => ipcRenderer.invoke('sftp-delete', { tabId, remotePaths }),
        rename: (tabId, oldPath, newPath) =>
            ipcRenderer.invoke('sftp-rename', { tabId, oldPath, newPath }),
        chmod: (tabId, remotePath, mode, recursive = false) =>
            ipcRenderer.invoke('sftp-chmod', { tabId, remotePath, mode, recursive }),
        copy: (tabId, sources, destinationDir, move = false) =>
            ipcRenderer.invoke('sftp-copy', { tabId, sources, destinationDir, move }),

        // Fired when a completed transfer may have changed the remote tree.
        onChanged: (callback) => subscribe('sftp-changed', callback),
    },

    transfers: {
        enqueue: (tabId, options) => ipcRenderer.invoke('sftp-transfer-enqueue', { tabId, ...options }),
        list: (tabId) => ipcRenderer.invoke('sftp-transfer-list', tabId),
        cancel: (id) => ipcRenderer.invoke('sftp-transfer-cancel', id),
        cancelAll: (tabId) => ipcRenderer.invoke('sftp-transfer-cancel-all', tabId),
        retry: (id) => ipcRenderer.invoke('sftp-transfer-retry', id),
        clearFinished: (tabId) => ipcRenderer.invoke('sftp-transfer-clear', tabId),

        respondToConflict: (requestId, decision) =>
            ipcRenderer.invoke('sftp-conflict-response', { requestId, decision }),

        onUpdate: (callback) => subscribe('sftp-transfers', callback),
        onConflict: (callback) => subscribe('sftp-conflict', callback),
        onConflictResolved: (callback) => subscribe('sftp-conflict-resolved', callback),
    },

    tunnels: {
        list: (tabId) => ipcRenderer.invoke('tunnels-list', tabId),
        sync: (tabId, hostId) => ipcRenderer.invoke('tunnels-sync', { tabId, hostId }),
        start: (tabId, tunnelId) => ipcRenderer.invoke('tunnels-start', { tabId, tunnelId }),
        stop: (tabId, tunnelId) => ipcRenderer.invoke('tunnels-stop', { tabId, tunnelId }),
        startAll: (tabId) => ipcRenderer.invoke('tunnels-start-all', tabId),
        stopAll: (tabId) => ipcRenderer.invoke('tunnels-stop-all', tabId),

        onUpdate: (callback) => subscribe('tunnels-update', callback),
    },

    // Remote desktop. `open` returns the loopback WebSocket address the viewer
    // attaches to; main has already authenticated to the VNC server by then,
    // so no credential is ever handed to this side of the bridge.
    vnc: {
        get: (paneId) => ipcRenderer.invoke('vnc-get', paneId),
        open: (paneId, hostId) => ipcRenderer.invoke('vnc-open', { paneId, hostId }),
        close: (paneId, hostId) => ipcRenderer.invoke('vnc-close', { paneId, hostId }),
        // Reported back so the header and the activity log can name the desktop
        // the way the server does.
        reportName: (paneId, name) => ipcRenderer.invoke('vnc-name', { paneId, name }),

        onUpdate: (callback) => subscribe('vnc-update', callback),
    },

    // Remote desktop over RDP. Unlike `vnc`, `open` returns the credentials
    // with the address: RDP authenticates with CredSSP inside the WASM client,
    // so the handshake cannot be completed in main the way RFB's is. The view
    // is written to use them once and not retain them; see src/main/rdp.js.
    rdp: {
        get: (paneId) => ipcRenderer.invoke('rdp-get', paneId),
        open: (paneId, hostId) => ipcRenderer.invoke('rdp-open', { paneId, hostId }),
        close: (paneId, hostId) => ipcRenderer.invoke('rdp-close', { paneId, hostId }),

        // The IronRDP module itself, which a `file://` renderer cannot fetch.
        wasm: () => ipcRenderer.invoke('rdp-wasm'),

        onUpdate: (callback) => subscribe('rdp-update', callback),
    },

    appearance: {
        // Main owns the picker and the reading; the renderer gets a data URL
        // for an image the user chose, or a reason it could not have one.
        chooseLogo: () => ipcRenderer.invoke('choose-logo-image'),
    },

    importer: {
        paths: () => ipcRenderer.invoke('import-paths'),
        // Which of the importable apps (OpenSSH, PuTTY, KiTTY, MobaXterm)
        // actually have sessions on this machine.
        detect: () => ipcRenderer.invoke('import-detect'),
        scan: (options) => ipcRenderer.invoke('import-scan', options || {}),
        apply: (options) => ipcRenderer.invoke('import-apply', options || {}),
    },

    backup: {
        // Main owns the file dialogs and the decrypted payload; only the
        // passphrase goes in and only counts come back.
        export: (passphrase) => ipcRenderer.invoke('backup-export', { passphrase }),
        inspect: (passphrase, filePath) =>
            ipcRenderer.invoke('backup-inspect', { passphrase, filePath }),
        restore: (token, overwrite) =>
            ipcRenderer.invoke('backup-restore', { token, overwrite }),
        discard: (token) => ipcRenderer.invoke('backup-discard', token),
    },

    account: {
        // No token ever crosses this bridge. Main runs the OAuth exchange and
        // holds the credential; the renderer only learns which account is
        // connected and what the console said.
        status: () => ipcRenderer.invoke('account-status'),
        signIn: () => ipcRenderer.invoke('account-sign-in'),
        cancelSignIn: () => ipcRenderer.invoke('account-sign-in-cancel'),
        signOut: () => ipcRenderer.invoke('account-sign-out'),
        refresh: () => ipcRenderer.invoke('account-refresh'),
        servers: () => ipcRenderer.invoke('account-servers'),
        // Signing in or out from Settings has to reach the sidebar, which did
        // not ask for it.
        onState: (callback) => subscribe('account-state', callback),
    },

    serverSync: {
        status: () => ipcRenderer.invoke('server-sync-status'),
        setEnabled: (enabled) => ipcRenderer.invoke('server-sync-set-enabled', enabled),
        now: () => ipcRenderer.invoke('server-sync-now'),
        // Fired after any sync, including the ones on a timer that nothing in
        // the renderer asked for, so the host list can refresh itself.
        onState: (callback) => subscribe('server-sync-state', callback),
    },

    cloudSnapshot: {
        status: () => ipcRenderer.invoke('cloud-snapshot-status'),
        setEnabled: (enabled) => ipcRenderer.invoke('cloud-snapshot-set-enabled', enabled),
        push: () => ipcRenderer.invoke('cloud-snapshot-push'),
        pull: () => ipcRenderer.invoke('cloud-snapshot-pull'),
        // Terminal settings live in localStorage, so the renderer is the only
        // side that can see them change.
        reportSettings: (settings) => ipcRenderer.invoke('cloud-snapshot-settings', settings),
        onState: (callback) => subscribe('cloud-snapshot-state', callback),
        // A pull brought settings down from another device.
        onSettings: (callback) => subscribe('cloud-snapshot-settings', callback),
    },

    remoteEdit: {
        open: (tabId, remotePath) => ipcRenderer.invoke('sftp-edit-open', { tabId, remotePath }),
        stop: (tabId, remotePath) => ipcRenderer.invoke('sftp-edit-stop', { tabId, remotePath }),
        list: (tabId) => ipcRenderer.invoke('sftp-edit-list', tabId),
        onStatus: (callback) => subscribe('sftp-edit-status', callback),
    },

    local: {
        downloadsDir: () => ipcRenderer.invoke('local-home'),
        reveal: (localPath) => ipcRenderer.invoke('local-reveal', localPath),

        // Where a dropped File actually lives on disk. `File.path` used to
        // carry this and was removed in Electron 32, because a renderer that
        // can read it learns real filesystem paths from any drop. It is a
        // preload-only API now, so the path is resolved on this side of the
        // bridge and the renderer only ever sees the string it asked for.
        pathForFile: (file) => {
            try {
                return webUtils.getPathForFile(file);
            } catch {
                // Not a real File (or one with no backing path, e.g. dragged
                // out of another app's virtual folder). Callers filter these.
                return '';
            }
        },
    },

    links: {
        // Main allowlists the scheme; a link out of a terminal is untrusted input.
        open: (url) => ipcRenderer.invoke('open-external', url),
    },

    system: {
        // Machine woke from sleep or the screen was unlocked.
        onResume: (callback) => subscribe('system-resume', callback),
    },

    dialog: {
        save: (options) => ipcRenderer.invoke('show-save-dialog', options || {}),
        open: (options) => ipcRenderer.invoke('show-open-dialog', options || {}),
    },

    clipboard: {
        readText: () => ipcRenderer.invoke('clipboard-read-text'),
        writeText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
    },

    screenshot: {
        capture: (options) => ipcRenderer.invoke('screenshot-capture', options),
        get: (id) => ipcRenderer.invoke('screenshot-get', id),
        copy: (id) => ipcRenderer.invoke('screenshot-copy', id),
        save: (id) => ipcRenderer.invoke('screenshot-save', id),
        reveal: (filePath) => ipcRenderer.invoke('screenshot-reveal', filePath),
        close: () => ipcRenderer.invoke('screenshot-close'),
    },

    updates: {
        // `status.mode` says which of the two shapes this is. On a build main
        // can get a signature checked for, these move a real installer along.
        // On one it cannot, they are a notice and a link and nothing else, and
        // the renderer has to say so rather than promise an install.
        status: () => ipcRenderer.invoke('updates-status'),
        // The button. Rate limited in main, which is why it answers with a
        // message rather than just a status.
        check: () => ipcRenderer.invoke('updates-check'),
        // The retry. Nothing normally calls it: an available update is already
        // downloading by the time the renderer hears about it.
        download: () => ipcRenderer.invoke('updates-download'),
        // Closes the app. Nothing after this resolves, because there is
        // nothing left to resolve into.
        install: () => ipcRenderer.invoke('updates-install'),
        open: () => ipcRenderer.invoke('updates-open'),
        dismiss: () => ipcRenderer.invoke('updates-dismiss'),
        // The daily check is not one the renderer asked for, a check started
        // from Settings has to reach the bell in the title bar, and download
        // progress is nobody's request at all.
        onState: (callback) => subscribe('updates-state', callback),
    },

    /**
     * The assistant. Named `ai` rather than `agent`, which is already taken by
     * the SSH agent and means something entirely different.
     *
     * A conversation lives in the main process, not here. This surface starts
     * one, feeds it text, and subscribes to the event stream it produces; a
     * window reload loses the panel and none of the conversation, which is why
     * `history` exists.
     */
    ai: {
        status: () => ipcRenderer.invoke('ai-status'),
        setSettings: (patch) => ipcRenderer.invoke('ai-settings-set', patch),
        // The settings, whenever anything changes them. Both the panel and the
        // settings page show some of these and can be open at once.
        onSettings: (callback) => subscribe('ai-settings', callback),
        // The models the installed Claude Code reports it can run, and the
        // effort levels each of them takes. Arrives once the runtime has
        // started, which is the first time it can be asked, so it is pushed
        // rather than only being read from `status`.
        onModels: (callback) => subscribe('ai-models', callback),
        // Asks for the list, starting the runtime briefly if that is what it
        // takes. Resolves null when this machine's Claude Code cannot say.
        // `refresh` throws away what was read for this agent and asks again,
        // for the button the menu shows when a read came back empty.
        models: ({ refresh = false } = {}) => ipcRenderer.invoke('ai-model-list', { refresh }),
        // Write-only. The key goes in and never comes back out.
        setApiKey: (value) => ipcRenderer.invoke('ai-set-key', value),

        start: ({ scope, sessionId } = {}) => ipcRenderer.invoke('ai-conversation-start', { scope, sessionId }),
        list: () => ipcRenderer.invoke('ai-conversation-list'),
        history: (conversationId) => ipcRenderer.invoke('ai-conversation-history', conversationId),
        // Releases the running query and keeps the transcript, so the
        // conversation can be picked up again from the history menu.
        park: (conversationId) => ipcRenderer.invoke('ai-conversation-park', conversationId),
        close: (conversationId) => ipcRenderer.invoke('ai-conversation-close', conversationId),
        // Which session the panel is pointed at, or none for every host.
        setScope: (conversationId, scope, sessionId) =>
            ipcRenderer.invoke('ai-scope', { conversationId, scope, sessionId }),

        send: (conversationId, text) => ipcRenderer.invoke('ai-send', { conversationId, text }),
        interrupt: (conversationId) => ipcRenderer.invoke('ai-interrupt', conversationId),

        // Every message, tool call and result for a conversation.
        onEvent: (callback) => subscribe('ai-event', callback),

        // A tool call waiting on the user. The panel draws it; the answer goes
        // back on the matching request id.
        // How an approval was settled, including a timeout, arrives on the
        // ordinary event stream, so there is no second channel to watch.
        approve: (requestId, approved, message) =>
            ipcRenderer.invoke('ai-approval-response', { requestId, approved, message }),

        // Main asking the window to open or close a session, which only the
        // window can do because that means touching the tab tree.
        onAction: (callback) => subscribe('ai-action', callback),
        respondToAction: (requestId, result) =>
            ipcRenderer.invoke('ai-action-response', { requestId, ...result }),
    },

    // Which OS this is, for the handful of places the interface has to differ:
    // macOS draws its own window controls, and Pageant and the registry
    // importers only exist on Windows. Read once at load; it cannot change.
    platform: process.platform,

    window: {
        minimize: () => ipcRenderer.send('window-minimize'),
        maximize: () => ipcRenderer.send('window-maximize'),
        close: () => ipcRenderer.send('window-close'),
        reload: () => ipcRenderer.send('reload-window'),
        toggleDevTools: () => ipcRenderer.send('open-devtools'),
        quit: () => ipcRenderer.send('force-quit'),
    },
});
