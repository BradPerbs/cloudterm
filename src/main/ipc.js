const { ipcMain, dialog, app, shell, clipboard, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const knownHosts = require('./known-hosts');
const keygen = require('./keygen');
const certificate = require('./certificate');
const hello = require('./hello');
const ssh = require('./ssh');
const transport = require('./transport');
const serial = require('./serial');
const agent = require('./agent');
const sftp = require('./sftp');
const transfers = require('./transfers');
const remoteEdit = require('./remote-edit');
const screenshot = require('./screenshot');
const tunnels = require('./tunnels');
const vnc = require('./vnc');
const bmc = require('./bmc');
const rdp = require('./rdp');
const importer = require('./import');
const importCommon = require('./import-common');
const vault = require('./vault');
const backup = require('./backup');
const account = require('./account');
const serverSync = require('./server-sync');
const monitor = require('./monitor');
const cloudSnapshot = require('./cloud-snapshot');
const activity = require('./activity');
const sessionLog = require('./session-log');
const assistant = require('./ai');
const updates = require('./updates');
const startup = require('./startup');
const proxy = require('./proxy');
const { parseAddress } = require('./address');
const { describeTunnel } = require('./tunnel-config');
const { describeDesktop } = require('./desktop-config');
const { describeBmc } = require('./bmc-config');
const { describeProxy, nameProxy } = require('./proxy-config');

/**
 * Channels that still answer while the app is locked: the unlock flow itself,
 * and the status the lock screen reads to know it should be showing.
 */
const ALLOWED_WHILE_LOCKED = new Set(['app-lock-status', 'app-lock-unlock']);

/**
 * Register a channel behind the lock.
 *
 * Refusing here rather than in the renderer is the whole point: the lock screen
 * is a React component, and a component can be stepped around by anything with
 * a handle on the page. A locked main process cannot be, so no host list, key
 * or session is reachable until the password has actually been proven.
 *
 * A throw is deliberate over an error object. A caller that ignores the result
 * gets a rejected promise rather than something it might render as data.
 */
function handle(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
        if (vault.isLocked() && !ALLOWED_WHILE_LOCKED.has(channel)) {
            throw new Error('The app is locked');
        }
        return listener(event, ...args);
    });
}

/**
 * Image formats the title bar will accept for a custom logo, and the MIME type
 * each is handed back under. An extension not listed here is refused rather
 * than guessed at: the renderer draws whatever comes back in an `<img>`, and a
 * data URL is only as trustworthy as the type on the front of it.
 */
const LOGO_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
};

/**
 * What to store alongside a key's certificate, and whether to accept it at all.
 *
 * Read once here rather than on every render: the renderer cannot parse SSH
 * wire format, and the answers (who it lets you log in as, when it stops
 * working) are the ones a keychain has to show. A certificate that cannot be
 * read, or that belongs to some other key, is refused at the point it is
 * pasted. The alternative is storing it and finding out on a server, where it
 * arrives as "permission denied" with nothing to connect it to.
 */
function describeCertificate(key) {
    const text = String(key.certificate || '').trim();
    if (!text) return { certificate: '', certificateInfo: null };

    // Throws with its own message on anything malformed, which the save
    // reports; there is nothing useful to store for a certificate we cannot
    // read, and silently blanking it would look like it had been saved.
    const details = certificate.parse(text);

    // Checked against the public half when there is one, because that works
    // while editing a key whose private key was left alone. Falling back to the
    // private key covers a fresh import that pasted no public key.
    let matches = certificate.matchesPublicKey(text, key.publicKey);
    if (matches === null && key.privateKey) {
        matches = certificate.matchesKey(text, key.privateKey, key.passphrase);
    }
    if (matches === false) {
        throw new Error('That certificate was issued for a different key');
    }

    if (details.kind === 'host') {
        throw new Error('That is a host certificate; a key needs a user certificate to log in with');
    }

    return {
        certificate: text,
        certificateInfo: {
            type: details.type,
            keyId: details.keyId,
            principals: details.principals,
            validAfter: details.validAfter,
            validBefore: details.validBefore,
            caFingerprint: details.caFingerprint,
            serial: details.serial,
        },
    };
}

// The mark is drawn 24 pixels square and the data URL rides along in the
// settings snapshot, so there is no reason to carry a photograph.
const MAX_LOGO_BYTES = 512 * 1024;

// A private key file is a few KB at the very outside. The cap is here so that
// pointing the picker at a disk image reports what it is instead of reading the
// whole thing into memory to find out it is not a key.
const MAX_KEY_BYTES = 256 * 1024;

/**
 * The certificate OpenSSH keeps next to a key, if there is one.
 *
 * `ssh` looks for `<identity>-cert.pub` beside the key it was given, and this
 * looks in the same place. Anything that is not a certificate line is ignored
 * rather than reported: a file that happens to sit there under that name is not
 * an error in the import, it is just not a certificate.
 */
function readCertificateFile(privateKeyPath) {
    const certPath = `${privateKeyPath}-cert.pub`;
    try {
        if (fs.statSync(certPath).size > MAX_KEY_BYTES) return '';
        const text = fs.readFileSync(certPath, 'utf8').trim();
        return text.includes('-cert-v01@openssh.com') ? text : '';
    } catch {
        return '';
    }
}

// requestId -> resolve, for host key prompts awaiting a user decision.
const pendingHostKeyPrompts = new Map();
// requestId -> resolve, for BMC certificate prompts awaiting one. Separate from
// the host key map because a page load is held open on each of these, so
// cancelling them has to deny the load rather than leave Chromium waiting.
const pendingCertPrompts = new Map();
// requestId -> resolve, for keyboard-interactive rounds awaiting answers.
const pendingAuthPrompts = new Map();
// pendingKeyId -> freshly generated private key, awaiting a save.
const pendingKeys = new Map();
// token -> decrypted backup payload, awaiting a restore decision. Held here so
// the credentials inside a backup never have to cross the bridge to be counted.
const pendingBackups = new Map();
let promptCounter = 0;

function register(getWindow) {
    const notify = (channel, payload) => {
        const window = getWindow();
        if (window && !window.isDestroyed()) {
            window.webContents.send(channel, payload);
        }
    };

    transfers.setNotifier(notify);

    // Schedules the launch sync and the interval behind it. Safe to call while
    // signed out or locked: it settles into doing nothing and retries when the
    // vault is unlocked.
    serverSync.start(notify);

    // The reachability poller. Given the window as well as the notifier because
    // it raises Windows notifications of its own, and a toast that is clicked
    // has to be able to bring the app forward.
    monitor.start(notify, getWindow);

    // Registers the store hooks that queue an upload, and pulls whatever another
    // device saved. Same tolerance for being signed out or locked.
    cloudSnapshot.start(notify);

    // Schedules the daily release check. Unlike the two above it does not care
    // about the account at all, so a locked or signed-out app still finds out
    // there is a new build.
    updates.start(notify);

    remoteEdit.setNotifier(notify);
    assistant.setNotifier(notify);
    tunnels.setNotifier(notify);
    vnc.setNotifier(notify);
    rdp.setNotifier(notify);
    bmc.setNotifier(notify);
    activity.setNotifier(notify);

    // Waking from sleep is when a session is most likely to be dead and a
    // retry most likely to succeed, so tabs are told rather than waiting out
    // their keepalive timeout.
    powerMonitor.on('resume', () => notify('system-resume', { reason: 'resume' }));
    powerMonitor.on('unlock-screen', () => notify('system-resume', { reason: 'unlock' }));

    // Closing a tab must stop its in-flight transfers, drop its scratch files,
    // tear down its port forwards and end any desktop riding the connection;
    // all of them outlive the IPC call that started them, and a forward left
    // running would hold its local port.
    ssh.onDestroy((tabId) => {
        transfers.cleanup(tabId);
        remoteEdit.cleanup(tabId);
        tunnels.cleanup(tabId);
        vnc.cleanup(tabId);
        rdp.cleanup(tabId);
        bmc.cleanup(tabId);
    });

    /**
     * Ask the user whether to trust an unknown or changed host key. Resolves
     * false if the window is gone, so a connection can never be silently
     * trusted without a human decision.
     */
    const requestTrust = (details) => new Promise((resolve) => {
        const window = getWindow();
        if (!window || window.isDestroyed()) {
            resolve(false);
            return;
        }
        const requestId = `hk-${++promptCounter}`;
        pendingHostKeyPrompts.set(requestId, resolve);
        window.webContents.send('host-key-prompt', { requestId, ...details });
    });

    /**
     * The same question for a BMC's TLS certificate. Resolves false with no
     * window, so a page load is never silently trusted either.
     *
     * Handed to bmc.js rather than called from it, so that module stays free of
     * any knowledge of how a prompt reaches a person, exactly as ssh.js is.
     */
    bmc.setTrustRequester((details) => new Promise((resolve) => {
        const window = getWindow();
        if (!window || window.isDestroyed()) {
            resolve(false);
            return;
        }
        const requestId = `bc-${++promptCounter}`;
        pendingCertPrompts.set(requestId, resolve);
        window.webContents.send('bmc-cert-prompt', { requestId, ...details });
    }));

    /**
     * Put a keyboard-interactive round in front of the user: a one-time code,
     * a push-approval choice, an expired-password change. Resolves null if the
     * window is gone, which the connection layer treats as a cancellation
     * rather than sending the server an empty answer.
     *
     * This is the one path where a secret travels renderer → main. The store's
     * rule is that secrets never travel the *other* way; an answer the user has
     * just typed has to start where the keyboard is. It is passed straight to
     * the server and never persisted.
     */
    const requestKeyboardInteractive = (details) => new Promise((resolve) => {
        const window = getWindow();
        if (!window || window.isDestroyed()) {
            resolve(null);
            return;
        }
        const requestId = `ki-${++promptCounter}`;
        pendingAuthPrompts.set(requestId, resolve);
        window.webContents.send('auth-prompt', { requestId, ...details });
    });

    handle('auth-prompt-response', (event, { requestId, answers }) => {
        const resolve = pendingAuthPrompts.get(requestId);
        if (!resolve) return false;

        pendingAuthPrompts.delete(requestId);
        // A cancel sends no answers at all, which is distinct from answering
        // with empty strings, since the former ends the attempt, the latter spends it.
        resolve(Array.isArray(answers) ? answers.map(answer => String(answer ?? '')) : null);
        return true;
    });

    /* ---------------- Store: hosts ---------------- */

    handle('get-hosts', () => store.getHosts());
    handle('save-host', (event, host) => store.saveHost(host));

    /**
     * An address typed into a picker rather than a host chosen from it.
     *
     * Parsed here rather than taken apart in the renderer, for the reason every
     * other record is built in main: what gets dialled is decided on this side
     * of the bridge. What goes back is an ordinary redacted host, held in
     * memory for this app run only, which the pane then connects by id like any
     * other. See store.openQuickConnect.
     */
    handle('host-quick-connect', (event, address) => {
        const parsed = parseAddress(address);
        const host = parsed.ok ? store.openQuickConnect(parsed) : null;

        return host
            ? { success: true, message: '', host }
            : { success: false, message: 'That is not an address this can dial', host: null };
    });

    handle('delete-host', (event, hostId) => store.deleteHost(hostId));
    handle('duplicate-host', (event, hostId) => store.duplicateHost(hostId));
    // Tagging a selection, in one write. Reads nothing but the tags, so it is
    // not a back door into a host record the way a full save would be.
    handle('tag-hosts', (event, payload) => store.tagHosts(payload));

    /* ---------------- Store: folders ---------------- */

    handle('get-folders', () => store.getFolders());
    handle('save-folder', (event, folder) => store.saveFolder(folder));
    handle('delete-folder', (event, folderId) => store.deleteFolder(folderId));

    /* ---------------- Store: arranging ---------------- */

    // One write for a whole drag: moving a card can renumber every card around it.
    handle('arrange-items', (event, changes) => store.arrangeItems(changes));

    /* ---------------- Store: keychain ---------------- */

    handle('get-keys', () => store.getKeys());

    handle('save-key', (event, key) => {
        const { pendingKeyId, ...rest } = key;
        // A freshly generated private key is claimed by reference so it never
        // has to travel through the renderer.
        if (pendingKeyId && pendingKeys.has(pendingKeyId)) {
            rest.privateKey = pendingKeys.get(pendingKeyId);
            pendingKeys.delete(pendingKeyId);
        }

        // The key names its own algorithm and fingerprints its own public half,
        // so neither is taken from the form: an import has no type picker to
        // read, and a generated key would only be restating what came back from
        // ssh-keygen. Whatever cannot be read leaves the stored value alone.
        return store.saveKey({ ...rest, ...keygen.identify(rest), ...describeCertificate(rest) });
    });

    // A Hello key's material is in the TPM, not in the store, so deleting the
    // record has to take the credential with it or it is left orphaned there
    // with nothing able to name it again.
    handle('delete-key', async (event, keyId) => {
        const credential = store.getKeys().find(key => key.id === keyId)?.helloCredential;
        const removed = store.deleteKey(keyId);
        if (credential) await hello.remove(credential);
        return removed;
    });

    /* ---------------- Store: Windows Hello keys ---------------- */

    handle('hello-supported', () => hello.isSupported());

    /**
     * Enrol a Windows Hello credential and save it as a keychain entry.
     *
     * The credential is named after the record that will point at it, so the
     * two cannot drift apart, and it is created before the record is written:
     * a cancelled prompt should leave nothing behind, where a record with no
     * credential would be a key that looks usable and is not.
     */
    handle('create-hello-key', async (event, { name, comment } = {}) => {
        const id = `key-${Date.now()}`;
        const credential = `cloudblast-${id}`;
        const enrolled = await hello.create(credential, comment || 'windows-hello');

        try {
            return store.saveKey({
                id,
                name: name || 'Windows Hello',
                type: 'RSA',
                hello: true,
                helloCredential: credential,
                helloPublicKey: enrolled.spki,
                publicKey: enrolled.publicKey,
                fingerprint: enrolled.fingerprint,
                comment: comment || '',
            });
        } catch (error) {
            // The record is what makes the credential reachable; without one it
            // is an orphan in the TPM that nothing will ever ask for again.
            await hello.remove(credential);
            throw error;
        }
    });

    handle('generate-key', async (event, options) => {
        const { privateKey, publicKey, fingerprint } = await keygen.generate(options);
        const pendingKeyId = `pending-${++promptCounter}`;
        pendingKeys.set(pendingKeyId, privateKey);
        return { publicKey, fingerprint, pendingKeyId };
    });

    /**
     * Take a key off disk, the way `ssh -i` would find it.
     *
     * Pasting a private key into a textarea was the only way in, which meant
     * opening `id_ed25519` in something else first and putting the whole of it
     * on the clipboard. Picking the file instead reads it here, so the private
     * half is held by the same map a generated one is and never crosses the
     * bridge: the renderer is handed an id, a fingerprint and the public halves.
     *
     * The two files OpenSSH keeps beside a key come with it. `id_ed25519.pub`
     * is where the fingerprint and the algorithm are most reliably read from,
     * and `id_ed25519-cert.pub` is exactly what `ssh` picks up on its own, so
     * requiring either to be found and pasted separately would be busywork.
     *
     * `replaces` is the id handed out by an earlier pick in the same form. A
     * second choice drops the first rather than leaving a private key sitting
     * in memory for a file the user changed their mind about.
     */
    handle('import-key-file', async (event, { replaces } = {}) => {
        if (replaces) pendingKeys.delete(replaces);

        const sshDir = path.join(app.getPath('home'), '.ssh');
        const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
            title: 'Choose a private key',
            // Only when it is there: a defaultPath that does not exist opens
            // somewhere arbitrary rather than the folder it names.
            defaultPath: fs.existsSync(sshDir) ? sshDir : undefined,
            // Hidden files, because `.ssh` itself is one on every platform.
            properties: ['openFile', 'showHiddenFiles'],
            // "All files" leads, since the keys people came here for have no
            // extension at all: an extension filter hides `id_ed25519`.
            filters: [
                { name: 'All files', extensions: ['*'] },
                { name: 'PEM and PuTTY keys', extensions: ['pem', 'key', 'ppk'] },
            ],
        });

        const filePath = filePaths?.[0];
        if (canceled || !filePath) return { success: false, canceled: true };

        try {
            const { size } = await fs.promises.stat(filePath);
            if (size > MAX_KEY_BYTES) {
                return {
                    success: false,
                    message: `That file is ${Math.round(size / 1024)} KB. No private key is `
                        + 'anywhere near that big, so this is something else.',
                };
            }
        } catch (error) {
            return { success: false, message: error.message };
        }

        const inspected = importCommon.inspectIdentityFile(filePath);

        if (inspected.state === 'ppk') {
            return {
                success: false,
                message: 'That is a PuTTY .ppk file, which this cannot read as it stands. '
                    + 'PuTTYgen can export it as an OpenSSH key, and that file imports fine.',
            };
        }

        if (inspected.state !== 'ready' && inspected.state !== 'encrypted') {
            return { success: false, message: inspected.reason || 'That file is not a private key' };
        }

        const pendingKeyId = `pending-${++promptCounter}`;
        pendingKeys.set(pendingKeyId, inspected.text);

        const publicHalf = importCommon.readPublicKey(filePath);

        return {
            success: true,
            pendingKeyId,
            file: path.basename(filePath),
            type: inspected.type || '',
            // Worth saying out loud in the form: an encrypted key saved without
            // its passphrase is a key that cannot dial, and the failure comes
            // much later, at the far end of a connection attempt.
            encrypted: inspected.state === 'encrypted',
            fingerprint: publicHalf?.fingerprint || inspected.fingerprint || '',
            publicKey: publicHalf?.text || '',
            certificate: readCertificateFile(filePath),
        };
    });

    /* ---------------- Store: snippets ---------------- */

    // Normalised in the store, so a malformed record from the renderer cannot
    // reach the palette or be written to disk in a shape nothing can read.
    handle('get-snippets', () => store.getSnippets());
    handle('save-snippet', (event, snippet) => store.saveSnippet(snippet));
    handle('delete-snippet', (event, snippetId) => store.deleteSnippet(snippetId));

    /* ---------------- Store: proxies ----------------
     *
     * Normalised in the store like the snippets above, and for a sharper reason:
     * these records decide where a socket is opened and what credential is handed
     * over on the way, so a malformed one must never reach the client.
     */

    handle('get-proxies', () => store.getProxies());
    handle('save-proxy', (event, record) => store.saveProxy(record));
    handle('delete-proxy', (event, proxyId) => store.deleteProxy(proxyId));
    // Copied in main, where the password is: a copy made by saving the redacted
    // record back would come out unable to authenticate.
    handle('duplicate-proxy', (event, proxyId) => store.duplicateProxy(proxyId));

    /**
     * Check a proxy, saved or still being typed.
     *
     * The draft form is the one that matters: an editor that can only check what
     * is already stored cannot help anyone get the settings right. A password
     * typed into the form travels renderer to main here, which is the same
     * direction, and the same exception, as a keyboard-interactive answer. The
     * store's rule is that secrets never travel the other way.
     */
    handle('proxies-test', async (event, payload = {}) => {
        const { chain, error } = store.resolveTestChain(payload || {});
        if (error) return { success: false, message: error };

        const result = await proxy.test(chain);
        const last = chain[chain.length - 1];

        activity.record({
            category: 'connection',
            action: 'proxy.test',
            outcome: result.success ? 'success' : 'failure',
            target: nameProxy(last),
            subject: describeProxy(last),
            detail: 'Proxy check',
            message: result.success ? '' : (result.message || ''),
        });

        return result;
    });

    handle('store-status', () => ({
        encryptionAvailable: store.isEncryptionAvailable(),
        protection: vault.status().protection,
        keystoreAvailable: vault.keystoreAvailable(),
    }));

    /* ---------------- App lock ---------------- */

    handle('app-lock-status', () => vault.status());

    /**
     * Record one lock event. A refused unlock is the entry that earns this its
     * place: a run of them is the only sign this file ever gives that someone
     * sat down in front of a locked app and started guessing.
     */
    const logLock = (action, result, detail = '') => {
        activity.record({
            category: 'security',
            action,
            outcome: result?.success ? 'info' : 'failure',
            target: 'App lock',
            detail,
            message: result?.success ? '' : (result?.message || ''),
        });
        return result;
    };

    handle('app-lock-unlock', (event, password) =>
        logLock('lock.unlock', vault.unlock(password)));
    handle('app-lock-set', (event, password) =>
        logLock('lock.enable', vault.set(password), 'An opening password is now required'));
    handle('app-lock-change', (event, { current, next }) =>
        logLock('lock.change', vault.change(current, next)));
    handle('app-lock-disable', (event, password) =>
        logLock('lock.disable', vault.disable(password), 'Stored secrets are no longer behind a password'));

    // Locking drops every live session first. Leaving them up would keep the
    // shells the password is meant to be guarding attached and running. The
    // ad-hoc records go with them: they hold a login in memory, which is the
    // one secret locking the app would otherwise leave sitting where it was.
    handle('app-lock-lock', () => {
        const result = vault.lock();
        if (result.success) {
            transport.destroyAll();
            store.forgetQuickConnects();
            notify('app-locked', {});
        }
        return logLock('lock.lock', result);
    });

    /* ---------------- Host keys ---------------- */

    handle('host-key-response', (event, { requestId, accepted }) => {
        const resolve = pendingHostKeyPrompts.get(requestId);
        if (resolve) {
            pendingHostKeyPrompts.delete(requestId);
            resolve(Boolean(accepted));
        }
        return true;
    });

    handle('known-hosts-list', () => knownHosts.list());

    /** Untrusting a key means the next connection will ask again; worth a line. */
    const logForget = (target, detail, removed) => {
        if (removed) {
            activity.record({
                category: 'security',
                action: 'hostkey.forget',
                outcome: 'info',
                target,
                detail,
            });
        }
        return removed;
    };

    handle('known-hosts-forget', (event, { host, port }) =>
        logForget(`${host}:${port || 22}`, 'All trusted keys removed', knownHosts.forget(host, port)));
    handle('known-hosts-forget-id', (event, id) =>
        logForget(id, 'All trusted keys removed', knownHosts.forgetById(id)));
    handle('known-hosts-forget-key', (event, { id, fingerprint }) =>
        logForget(id, `Key ${fingerprint} removed`, knownHosts.forgetFingerprint(id, fingerprint)));

    /* ---------------- Sessions ---------------- */

    // Still named for SSH because these are the channels a pane's session runs
    // on, whatever it turns out to be: the dispatcher reads the host record and
    // picks between ssh.js, telnet.js and serial.js. See transport.js.
    handle('ssh-connect', async (event, payload) => {
        // Both prompts below are raised mid-handshake, so they are stamped with
        // the pane that is dialling. The renderer asks the question inside that
        // pane rather than over the whole window, and a question with no pane
        // left to ask it in can be answered for: see App.jsx.
        const tabId = payload?.tabId || null;

        const result = await transport.connect(payload, {
            window: getWindow(),
            requestTrust: (details) => requestTrust({ tabId, ...details }),
            requestKeyboardInteractive: (details) =>
                requestKeyboardInteractive({ tabId, ...details }),
        });
        // Forwards belong to the session, not the app run, so they are armed on
        // every successful dial, including the reconnect after a drop, where
        // the previous session's listeners have already been torn down.
        //
        // Only SSH carries them: a forward is a channel on an SSH connection,
        // and there is nothing to open one on over telnet or a serial line.
        if (result.success && transport.protocolOf(payload.tabId) === 'ssh') {
            tunnels.autoStart(payload.tabId, payload.hostId);
        }
        return result;
    });

    handle('ssh-disconnect', (event, tabId) => transport.destroy(tabId));
    handle('ssh-detect-os', (event, tabId) => ssh.detectOS(tabId));

    /* ---------------- Serial ports ---------------- */

    // Read live on every call rather than cached: a USB adapter enumerates
    // under a different name each time it is plugged into a different socket,
    // so a remembered list would offer ports that stopped existing when the
    // cable moved.
    handle('serial-list-ports', () => serial.listPorts());

    /* ---------------- Port forwarding ---------------- */

    /** Name a forward the way its row in the tunnels view does. */
    const describeForward = (tabId, tunnelId) => {
        const found = tunnels.list(tabId).find(entry => entry.id === tunnelId);
        if (!found) return tunnelId;
        return found.name ? `${found.name} (${describeTunnel(found)})` : describeTunnel(found);
    };

    const logTunnel = (action, tabId, tunnelId, result) => {
        activity.record({
            category: 'connection',
            action,
            outcome: result?.success ? 'info' : 'failure',
            target: describeForward(tabId, tunnelId),
            detail: 'Port forward',
            message: result?.success ? '' : (result?.message || ''),
            ...ssh.describe(tabId),
        });
        return result;
    };

    handle('tunnels-list', (event, tabId) => tunnels.list(tabId));
    // Called after the host's tunnel list is edited, so what runs matches what
    // is configured without needing a reconnect.
    handle('tunnels-sync', (event, { tabId, hostId }) => tunnels.sync(tabId, hostId));
    handle('tunnels-start', (event, { tabId, tunnelId }) =>
        logTunnel('tunnel.start', tabId, tunnelId, tunnels.start(tabId, tunnelId)));
    handle('tunnels-stop', (event, { tabId, tunnelId }) =>
        logTunnel('tunnel.stop', tabId, tunnelId, tunnels.stop(tabId, tunnelId)));
    handle('tunnels-start-all', (event, tabId) => tunnels.startAll(tabId));
    handle('tunnels-stop-all', (event, tabId) => tunnels.stopAll(tabId));

    /* ---------------- Remote desktop ---------------- */

    /**
     * Named from the host record rather than from `ssh.describe`, because a
     * direct-transport desktop has no SSH session to describe and would
     * otherwise be logged as happening nowhere.
     */
    const describeDesktopHost = (hostId) => {
        const info = store.describeHost(hostId);
        return { hostId: info.id, hostName: info.name, subject: info.address };
    };

    handle('vnc-get', (event, paneId) => vnc.get(paneId));

    handle('vnc-open', async (event, { paneId, hostId }) => {
        const result = await vnc.open(paneId, hostId);

        activity.record({
            category: 'connection',
            action: 'desktop.open',
            outcome: result.success ? 'success' : 'failure',
            target: describeDesktop(store.getHostDesktop(hostId)),
            detail: 'Remote desktop',
            message: result.success ? '' : (result.message || ''),
            ...describeDesktopHost(hostId),
        });

        return result;
    });

    handle('vnc-close', (event, { paneId, hostId }) => {
        // Only a session that existed is worth a line; the view closes
        // defensively on unmount whether or not it ever opened one.
        const existed = Boolean(vnc.get(paneId));
        const result = vnc.close(paneId);

        if (existed && hostId) {
            activity.record({
                category: 'connection',
                action: 'desktop.close',
                target: describeDesktop(store.getHostDesktop(hostId)),
                detail: 'Remote desktop',
                ...describeDesktopHost(hostId),
            });
        }

        return result;
    });

    // The desktop's own name arrives in ServerInit, which only the viewer parses.
    handle('vnc-name', (event, { paneId, name }) => vnc.setDesktopName(paneId, name));

    /* ---------------- Service processors (IPMI / BMC) ---------------- */

    handle('bmc-get', (event, paneId) => bmc.get(paneId));

    /**
     * Prepare a BMC pane. Returns the URL and partition for the `<webview>` to
     * load; the password stays in main, and reaches the page from there.
     */
    handle('bmc-open', async (event, { paneId, hostId }) => {
        const result = await bmc.open(paneId, hostId);

        activity.record({
            category: 'connection',
            action: 'bmc.open',
            outcome: result.success ? 'success' : 'failure',
            target: describeBmc(store.getHostBmc(hostId)),
            detail: 'IPMI',
            message: result.success ? '' : (result.message || ''),
            ...describeDesktopHost(hostId),
        });

        return result;
    });

    /**
     * The renderer handing over the guest page it has just created. Everything
     * done *to* that page (the login, the popup policy, the load reporting)
     * happens in main from here on.
     */
    handle('bmc-attach', (event, { paneId, webContentsId }) => bmc.attach(paneId, webContentsId));

    /** Fill the login form again, from the pane's own button. */
    handle('bmc-login', (event, paneId) => bmc.login(paneId));

    handle('bmc-close', (event, { paneId, hostId }) => {
        const existed = Boolean(bmc.get(paneId));
        const result = bmc.close(paneId);

        if (existed && hostId) {
            activity.record({
                category: 'connection',
                action: 'bmc.close',
                target: describeBmc(store.getHostBmc(hostId)),
                detail: 'IPMI',
                ...describeDesktopHost(hostId),
            });
        }

        return result;
    });

    handle('bmc-cert-response', (event, { requestId, accepted }) => {
        const resolve = pendingCertPrompts.get(requestId);
        if (resolve) {
            pendingCertPrompts.delete(requestId);
            resolve(Boolean(accepted));
        }
        return true;
    });

    /* ---------------- Remote desktop: RDP ---------------- */

    handle('rdp-get', (event, paneId) => rdp.get(paneId));

    handle('rdp-open', async (event, { paneId, hostId }) => {
        const result = await rdp.open(paneId, hostId);

        activity.record({
            category: 'connection',
            action: 'desktop.open',
            outcome: result.success ? 'success' : 'failure',
            target: describeDesktop(store.getHostDesktop(hostId)),
            detail: 'Remote desktop (RDP)',
            message: result.success ? '' : (result.message || ''),
            ...describeDesktopHost(hostId),
        });

        return result;
    });

    handle('rdp-close', (event, { paneId, hostId }) => {
        // Only a session that existed is worth a line; the view closes
        // defensively on unmount whether or not it ever opened one.
        const existed = Boolean(rdp.get(paneId));
        const result = rdp.close(paneId);

        if (existed && hostId) {
            activity.record({
                category: 'connection',
                action: 'desktop.close',
                target: describeDesktop(store.getHostDesktop(hostId)),
                detail: 'Remote desktop (RDP)',
                ...describeDesktopHost(hostId),
            });
        }

        return result;
    });

    /**
     * The IronRDP WebAssembly module, as bytes.
     *
     * The module ships a loader that resolves the `.wasm` relative to
     * `import.meta.url` and fetches it. Electron does allow that under `file://`
     * for the app's own origin, so it would work, but only because Electron is
     * more permissive there than the web is, and only while `webSecurity` and
     * the sandbox flags stay as they are. Serving the bytes from here instead
     * depends on none of that, and keeps one copy of the module rather than a
     * second emitted into the bundle.
     *
     * Cached because it is four megabytes and every pane would otherwise ask
     * for its own copy.
     */
    let wasmBytes = null;
    handle('rdp-wasm', () => {
        if (wasmBytes) return wasmBytes;

        // Resolved through the package rather than by path so it is found the
        // same way inside an asar archive as it is in node_modules.
        const entry = require.resolve('ironrdp-wasm');
        const binary = path.join(path.dirname(entry), 'rdp_client_bg.wasm');

        wasmBytes = fs.readFileSync(binary);
        return wasmBytes;
    });

    /* ---------------- Import from other apps ---------------- */

    handle('import-paths', () => importer.defaultPaths());
    handle('import-detect', () => importer.detect());
    handle('import-scan', (event, options) => importer.scan(options || {}));
    // Only the selections cross the bridge; the files (or the registry) are
    // re-read here, so no host key or private key is ever taken on the
    // renderer's word.
    handle('import-apply', (event, options) => {
        const result = importer.apply(options || {});
        const sourceLabels = { putty: 'PuTTY', kitty: 'KiTTY', mobaxterm: 'MobaXterm' };
        activity.record({
            category: 'data',
            action: 'import.apply',
            outcome: result?.success === false ? 'failure' : 'success',
            target: sourceLabels[options?.source] || 'OpenSSH config',
            // The per-host saves are already logged one by one by the store;
            // this is the line that says the batch happened at all.
            detail: [
                result?.hosts?.imported ? `${result.hosts.imported} host(s)` : '',
                result?.keys?.imported ? `${result.keys.imported} key(s)` : '',
                result?.knownHosts?.imported ? `${result.knownHosts.imported} known host(s)` : '',
                result?.folders?.created ? `${result.folders.created} folder(s)` : '',
                // Which hosts are now relayed through a bastion is a routing
                // change, not a count of records, so it is named separately.
                result?.hosts?.relayed ? `${result.hosts.relayed} linked to a jump host` : '',
            ].filter(Boolean).join(' · ') || 'Nothing imported',
            message: result?.notes?.join('; ') || '',
        });
        return result;
    });

    /* ---------------- Backup ----------------
     *
     * The decrypted payload never crosses the bridge. `inspect` holds it here
     * under a token and hands back counts, exactly as a freshly generated key
     * is claimed by reference, so the renderer can show what a file contains
     * and offer a merge choice without ever holding the credentials in it.
     */

    handle('backup-export', async (event, { passphrase } = {}) => {
        const problem = backup.validatePassphrase(passphrase);
        if (problem) return { success: false, message: problem };

        // Before the dialog: a locked vault would export blanks, and finding
        // that out after picking a filename is a worse way to learn it.
        let payload;
        try {
            payload = { ...store.exportAll(), knownHosts: knownHosts.exportAll() };
        } catch (error) {
            return { success: false, message: error.message };
        }

        const stamp = new Date().toISOString().slice(0, 10);
        const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
            title: 'Save encrypted backup',
            defaultPath: `cloudblast-backup-${stamp}.cbbackup`,
            filters: [{ name: 'CloudBlast backup', extensions: ['cbbackup'] }],
        });
        if (canceled || !filePath) return { success: false, canceled: true };

        try {
            backup.writeFile(filePath, backup.seal(payload, passphrase));
        } catch (error) {
            activity.record({
                category: 'security',
                action: 'backup.export',
                outcome: 'failure',
                target: filePath,
                message: error.message,
            });
            return { success: false, message: `Could not write the backup: ${error.message}` };
        }

        // Worth a line precisely because it is the one operation that takes
        // every stored credential off this machine in a single file.
        activity.record({
            category: 'security',
            action: 'backup.export',
            target: filePath,
            detail: `${payload.hosts.length} host(s), ${payload.keys.length} key(s)`,
        });

        return {
            success: true,
            path: filePath,
            counts: {
                hosts: payload.hosts.length,
                folders: payload.folders.length,
                keys: payload.keys.length,
                snippets: payload.snippets.length,
                proxies: payload.proxies.length,
                knownHosts: Object.keys(payload.knownHosts).length,
            },
        };
    });

    handle('backup-inspect', async (event, { passphrase, filePath } = {}) => {
        let target = filePath;
        if (!target) {
            const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
                title: 'Open encrypted backup',
                properties: ['openFile'],
                filters: [
                    { name: 'CloudBlast backup', extensions: ['cbbackup'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            });
            if (canceled || filePaths.length === 0) return { success: false, canceled: true };
            target = filePaths[0];
        }

        let envelope;
        try {
            envelope = backup.readFile(target);
        } catch (error) {
            return { success: false, message: error.message };
        }

        let payload;
        try {
            payload = backup.unseal(envelope, passphrase);
        } catch (error) {
            return { success: false, message: error.message };
        }
        if (!payload) {
            return { success: false, message: 'Wrong passphrase, or the file has been altered' };
        }

        const token = `backup-${++promptCounter}`;
        pendingBackups.set(token, payload);

        return {
            success: true,
            token,
            path: target,
            createdAt: envelope.createdAt || '',
            appVersion: envelope.app || '',
            summary: store.previewImport(payload),
            knownHosts: Object.keys(payload.knownHosts || {}).length,
        };
    });

    handle('backup-restore', (event, { token, overwrite } = {}) => {
        const payload = pendingBackups.get(token);
        if (!payload) {
            return { success: false, message: 'That backup is no longer open. Choose the file again.' };
        }
        pendingBackups.delete(token);

        try {
            const result = store.importAll(payload, { overwrite: Boolean(overwrite) });
            const hostKeys = knownHosts.importAll(payload.knownHosts, {
                overwrite: Boolean(overwrite),
            });

            // A restore writes records straight into the store rather than
            // through saveHost, so nothing else would report it.
            activity.record({
                category: 'security',
                action: 'backup.restore',
                target: 'Encrypted backup',
                detail: [
                    `${result.hosts.added} host(s) added`,
                    result.hosts.replaced ? `${result.hosts.replaced} replaced` : '',
                    `${result.keys.added} key(s) added`,
                    overwrite ? 'existing records overwritten' : 'existing records kept',
                ].filter(Boolean).join(' · '),
            });

            return { success: true, ...result, knownHosts: hostKeys };
        } catch (error) {
            activity.record({
                category: 'security',
                action: 'backup.restore',
                outcome: 'failure',
                target: 'Encrypted backup',
                message: error.message,
            });
            return { success: false, message: error.message };
        }
    });

    /** Drop a payload the user decided not to restore, rather than holding it. */
    handle('backup-discard', (event, token) => {
        pendingBackups.delete(token);
        return true;
    });

    /* ---------------- CloudBlast account ----------------
     *
     * The whole OAuth exchange happens in main: the verifier, the code and the
     * resulting token never cross the bridge, so a renderer holding a reference
     * to the API has no more access to the credential than the page next to it.
     * Only the profile the user is looking at comes back.
     */

    handle('account-status', () => account.status());

    handle('account-sign-in', async () => {
        try {
            const status = await account.signIn();

            activity.record({
                category: 'security',
                action: 'account.connect',
                outcome: 'success',
                target: 'CloudBlast account',
                detail: status.account?.email || '',
            });

            // The sidebar shows who is signed in, and it is not the thing that
            // asked for this, so it has to be told.
            notify('account-state', status);

            /*
             * Signing in is the one moment a device has an account and none of
             * its data. Both of these normally run at launch, which for a fresh
             * sign-in has already been and gone, so without this the setup only
             * appears on the next poll or the next restart.
             *
             * Forced, because a stale revision left by a previous account would
             * otherwise make the pull decide it was already up to date.
             *
             * Not awaited: the browser round trip is already over and the user
             * is looking at the app. Both report themselves through their own
             * events when they land.
             */
            cloudSnapshot.pull({ force: true })
                .catch(error => console.error('Post sign-in restore failed:', error.message))
                .finally(() => serverSync.sync());

            return { success: true, status };
        } catch (error) {
            activity.record({
                category: 'security',
                action: 'account.connect',
                outcome: 'failure',
                target: 'CloudBlast account',
                message: error.message,
            });

            return { success: false, message: error.message };
        }
    });

    handle('account-sign-in-cancel', () => {
        account.cancelSignIn();
        return true;
    });

    handle('account-sign-out', async () => {
        const email = account.status().account?.email || '';
        const { revoked } = await account.signOut();

        activity.record({
            category: 'security',
            action: 'account.disconnect',
            // A local sign-out that could not reach the console leaves a live
            // token behind, so it is not the same outcome as a clean one.
            outcome: revoked ? 'success' : 'failure',
            target: 'CloudBlast account',
            detail: email,
            message: revoked ? '' : 'Signed out locally; the console could not be reached to revoke the token',
        });

        // The revision and key belong to the account that just left, not to
        // this machine.
        cloudSnapshot.reset();

        const status = account.status();
        notify('account-state', status);

        return { success: true, revoked, status };
    });

    handle('account-refresh', async () => {
        try {
            return { success: true, status: await account.refresh() };
        } catch (error) {
            return { success: false, message: error.message, status: account.status() };
        }
    });

    handle('account-servers', async () => {
        try {
            return { success: true, servers: await account.servers() };
        } catch (error) {
            return { success: false, message: error.message, servers: [] };
        }
    });

    /* ---------------- CloudBlast server sync ---------------- */

    handle('server-sync-status', () => serverSync.status());

    handle('server-sync-set-enabled', (event, enabled) => serverSync.setEnabled(enabled));

    handle('server-sync-now', async () => {
        const report = await serverSync.sync({ manual: true });
        return { report, status: serverSync.status() };
    });

    /* ---------------- Host monitoring ---------------- */

    handle('monitor-status', () => monitor.status());

    handle('monitor-configure', (event, patch) => monitor.configure(patch || {}));

    handle('monitor-check-now', () => monitor.checkNow());

    /* ---------------- Cloud setup snapshot ---------------- */

    handle('cloud-snapshot-status', () => cloudSnapshot.status());

    handle('cloud-snapshot-set-enabled', (event, enabled) => cloudSnapshot.setEnabled(enabled));

    handle('cloud-snapshot-push', async () => ({
        result: await cloudSnapshot.push(),
        status: cloudSnapshot.status(),
    }));

    handle('cloud-snapshot-pull', async () => ({
        result: await cloudSnapshot.pull({ force: true }),
        status: cloudSnapshot.status(),
    }));

    /**
     * Terminal settings live in the renderer's localStorage, which main cannot
     * read, so the renderer hands them over whenever they change. Held in
     * memory only -- the snapshot is the copy that persists.
     */
    handle('cloud-snapshot-settings', (event, settings) => {
        cloudSnapshot.setSettings(settings);
        return true;
    });

    /* ---------------- SSH agent ---------------- */

    handle('agent-status', (event, agentPath) => agent.probe(agentPath));
    handle('agent-default-path', () => ({
        path: agent.defaultAgentPath(),
        location: agent.describeLocation(agent.defaultAgentPath()),
    }));
    // Resize travels over the session's MessagePort, not IPC.

    /* ---------------- SFTP: browsing ---------------- */

    handle('sftp-init', (event, tabId) => sftp.init(tabId));
    handle('sftp-close', (event, tabId) => sftp.close(tabId));
    handle('sftp-list', (event, { tabId, remotePath }) => sftp.list(tabId, remotePath));
    handle('sftp-home', (event, tabId) => sftp.home(tabId));
    handle('sftp-realpath', (event, { tabId, remotePath }) => sftp.realpath(tabId, remotePath));
    handle('sftp-stat', (event, { tabId, remotePath, follow }) =>
        sftp.stat(tabId, remotePath, { follow }));
    handle('sftp-disk-usage', (event, { tabId, remotePath }) =>
        sftp.diskUsage(tabId, remotePath));

    /* ---------------- SFTP: mutations ----------------
     *
     * Every one of these changes something on a server, which is the half of
     * "who changed what" that happens outside this app's own store. They are
     * logged here rather than inside sftp.js because this is where the user's
     * intent is still legible: one entry per action taken, not one per file a
     * recursive walk happened to touch.
     */

    const logFile = async (action, tabId, target, detail, run) => {
        const result = await run();
        activity.record({
            category: 'files',
            action,
            outcome: result?.success ? 'success' : 'failure',
            target,
            detail,
            message: result?.success ? '' : (result?.message || ''),
            ...ssh.describe(tabId),
        });
        return result;
    };

    handle('sftp-mkdir', (event, { tabId, remotePath }) =>
        logFile('file.mkdir', tabId, remotePath, 'Folder created', () => sftp.mkdir(tabId, remotePath)));

    handle('sftp-create-file', (event, { tabId, remotePath }) =>
        logFile('file.create', tabId, remotePath, 'File created', () => sftp.createFile(tabId, remotePath)));

    handle('sftp-delete', (event, { tabId, remotePaths }) => {
        const targets = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
        return logFile(
            'file.delete',
            tabId,
            targets[0] || '',
            targets.length > 1 ? `and ${targets.length - 1} more` : '',
            () => sftp.remove(tabId, remotePaths),
        );
    });

    handle('sftp-rename', (event, { tabId, oldPath, newPath }) =>
        logFile('file.rename', tabId, oldPath, `to ${newPath}`, () =>
            sftp.rename(tabId, oldPath, newPath)));

    handle('sftp-chmod', (event, { tabId, remotePath, mode, recursive }) =>
        logFile(
            'file.chmod',
            tabId,
            remotePath,
            `${((mode || 0) & 0o7777).toString(8).padStart(4, '0')}${recursive ? ', recursively' : ''}`,
            () => sftp.chmod(tabId, remotePath, mode, { recursive }),
        ));

    handle('sftp-copy', (event, { tabId, sources, destinationDir, move }) => {
        const list = Array.isArray(sources) ? sources : [sources];
        return logFile(
            move ? 'file.move' : 'file.copy',
            tabId,
            list[0] || '',
            [`to ${destinationDir}`, list.length > 1 ? `and ${list.length - 1} more` : '']
                .filter(Boolean).join(' · '),
            () => sftp.transferRemote(tabId, sources, destinationDir, { move }),
        );
    });

    /* ---------------- Activity log ----------------
     *
     * Behind the same lock as everything else: the log names every server this
     * machine reaches and every path that was touched on them, which is worth
     * as much to someone snooping as the host list itself.
     */

    handle('activity-list', (event, options) => activity.list(options || {}));
    handle('activity-summary', () => activity.summary());
    handle('activity-clear', () => activity.clear());

    handle('activity-export', async () => {
        const stamp = new Date().toISOString().slice(0, 10);
        const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
            title: 'Export activity log',
            defaultPath: `cloudblast-activity-${stamp}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (canceled || !filePath) return { success: false, canceled: true };

        const entries = activity.exportAll();
        try {
            fs.writeFileSync(filePath, JSON.stringify({
                exportedAt: new Date().toISOString(),
                exportedBy: activity.actor(),
                entries,
            }, null, 2), 'utf8');
        } catch (error) {
            return { success: false, message: `Could not write the log: ${error.message}` };
        }

        return { success: true, path: filePath, count: entries.length };
    });

    /* ---------------- Session transcripts ----------------
     *
     * The output half of the audit trail. Everything here is about files on
     * this machine and the setting that governs them; the bytes themselves
     * never come back through the bridge, so the renderer can start, stop and
     * find a transcript without ever being handed its contents.
     */

    handle('session-log-config', () => sessionLog.getConfig());
    handle('session-log-configure', (event, patch) => sessionLog.setConfig(patch || {}));
    handle('session-log-status', (event, tabId) => sessionLog.status(tabId));
    handle('session-log-list', (event, options) => sessionLog.list(options || {}));

    // Recording this one session while the global setting is off. The host is
    // resolved from the live session rather than passed in, so the renderer
    // cannot name a file after a server it is not actually connected to.
    handle('session-log-start', (event, tabId) => {
        const session = ssh.get(tabId);
        if (!session) return { success: false, message: 'That session is not connected' };

        const filePath = sessionLog.start(tabId, {
            hostName: session.hostName,
            address: session.address,
            hostId: session.hostId,
            force: true,
        });

        return filePath
            ? { success: true, ...sessionLog.status(tabId) }
            : { success: false, message: 'Could not open a log file. Check the folder in Settings.' };
    });

    handle('session-log-stop', (event, tabId) => {
        const filePath = sessionLog.close(tabId, { reason: 'stopped' });
        return { success: Boolean(filePath), path: filePath || '', ...sessionLog.status(tabId) };
    });

    handle('session-log-choose-directory', async () => {
        const { directory } = sessionLog.getConfig();
        const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
            title: 'Where to keep session logs',
            defaultPath: directory,
            properties: ['openDirectory', 'createDirectory'],
        });
        if (canceled || !filePaths?.[0]) return { success: false, canceled: true };

        return { success: true, config: sessionLog.setConfig({ directory: filePaths[0] }) };
    });

    /** Back to the default folder, without having to navigate to it in a picker. */
    handle('session-log-reset-directory', () =>
        ({ success: true, config: sessionLog.setConfig({ directory: '' }) }));

    handle('session-log-reveal', async (event, filePath) => {
        // Only ever a path this module handed out, so it is checked against the
        // log directory rather than trusted: `showItemInFolder` on an arbitrary
        // string would let the renderer point Explorer anywhere.
        const { directory } = sessionLog.getConfig();
        const resolved = path.resolve(String(filePath || ''));
        const root = path.resolve(directory);

        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            return { success: false, message: 'That file is not in the session log folder' };
        }

        if (!fs.existsSync(resolved)) return { success: false, message: 'That log is no longer there' };
        shell.showItemInFolder(resolved);
        return { success: true };
    });

    handle('session-log-open-folder', async () => {
        const { directory } = sessionLog.getConfig();
        try {
            fs.mkdirSync(directory, { recursive: true });
        } catch (error) {
            return { success: false, message: error.message };
        }
        const failure = await shell.openPath(directory);
        return failure ? { success: false, message: failure } : { success: true };
    });

    /* ---------------- SFTP: transfers ---------------- */

    handle('sftp-transfer-enqueue', (event, { tabId, ...options }) =>
        transfers.enqueue(tabId, options));
    handle('sftp-transfer-list', (event, tabId) => transfers.list(tabId));
    handle('sftp-transfer-cancel', (event, id) => transfers.cancel(id));
    handle('sftp-transfer-cancel-all', (event, tabId) => transfers.cancelAll(tabId));
    handle('sftp-transfer-retry', (event, id) => transfers.retry(id));
    handle('sftp-transfer-clear', (event, tabId) => transfers.clearFinished(tabId));
    handle('sftp-conflict-response', (event, { requestId, decision }) =>
        transfers.resolveConflict(requestId, decision));

    /* ---------------- SFTP: local editing ---------------- */

    handle('sftp-edit-open', (event, { tabId, remotePath }) =>
        remoteEdit.open(tabId, remotePath));
    handle('sftp-edit-stop', (event, { tabId, remotePath }) =>
        remoteEdit.stop(tabId, remotePath));
    handle('sftp-edit-list', (event, tabId) => remoteEdit.list(tabId));

    /* ---------------- Local filesystem (SFTP targets only) ---------------- */

    handle('local-home', () => ({ success: true, path: app.getPath('downloads') }));
    handle('local-reveal', (event, localPath) => {
        shell.showItemInFolder(localPath);
        return { success: true };
    });

    /* ---------------- External links ---------------- */

    // Terminal output is whatever the far end chose to send, and a link in it
    // is a click target the user did not author. So the scheme is allowlisted
    // rather than filtered: `file:` would open a local path, and the
    // shell:/javascript:/ms-msdt: family are handed to the OS to interpret.
    // Only the two schemes a link in a log is ever meant to be get through.
    handle('open-external', async (event, url) => {
        let parsed;
        try {
            parsed = new URL(String(url));
        } catch {
            return { success: false, message: 'Not a valid URL' };
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return {
                success: false,
                message: `Refusing to open a ${parsed.protocol.replace(':', '')} link`,
            };
        }

        // `href` rather than the original string: it is the parsed form, so
        // nothing that survived parsing but was not part of the URL goes on
        // to the shell.
        await shell.openExternal(parsed.href);
        return { success: true };
    });

    /* ---------------- Appearance ---------------- */

    /**
     * Pick an image for the title bar and hand it back as a data URL.
     *
     * Read here rather than in the renderer: it has no filesystem, and the type
     * and size checks belong on the side doing the reading. Only the bytes of a
     * file the user just chose in a native dialog ever cross the bridge, so
     * there is no path for the page to name a file of its own.
     */
    handle('choose-logo-image', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
            title: 'Choose a logo',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: Object.keys(LOGO_TYPES).map(ext => ext.slice(1)) }],
        });

        const filePath = filePaths?.[0];
        if (canceled || !filePath) return { success: false, canceled: true };

        const type = LOGO_TYPES[path.extname(filePath).toLowerCase()];
        if (!type) return { success: false, message: 'That file is not an image the title bar can draw' };

        try {
            const { size } = await fs.promises.stat(filePath);
            if (size > MAX_LOGO_BYTES) {
                return {
                    success: false,
                    message: `That image is ${Math.round(size / 1024)} KB. The limit is `
                        + `${MAX_LOGO_BYTES / 1024} KB, because the mark is drawn 24 pixels square `
                        + 'and travels with your settings.',
                };
            }

            const bytes = await fs.promises.readFile(filePath);
            return {
                success: true,
                dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
                name: path.basename(filePath),
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    /* ---------------- Dialogs ---------------- */

    handle('show-save-dialog', (event, { defaultPath, filters, title }) =>
        dialog.showSaveDialog(getWindow(), {
            defaultPath,
            title,
            filters: filters || [{ name: 'All Files', extensions: ['*'] }],
        }));

    handle('show-open-dialog', (event, { properties, filters, defaultPath, title }) =>
        dialog.showOpenDialog(getWindow(), {
            properties: properties || ['openFile'],
            defaultPath,
            title,
            // A directory picker with file filters shows an empty list on Windows.
            filters: properties?.includes('openDirectory')
                ? undefined
                : filters || [{ name: 'All Files', extensions: ['*'] }],
        }));

    /* ---------------- Clipboard ---------------- */

    // The terminal needs clipboard access for copy/paste. Routed through main
    // rather than navigator.clipboard so it works in the sandboxed renderer
    // without a permission prompt.
    handle('clipboard-read-text', () => clipboard.readText());
    handle('clipboard-write-text', (event, text) => {
        clipboard.writeText(typeof text === 'string' ? text : '');
        return true;
    });

    /* ---------------- Screenshots ---------------- */

    handle('screenshot-capture', (event, options) =>
        screenshot.capture(getWindow(), options));
    handle('screenshot-get', (event, id) => screenshot.get(id));
    handle('screenshot-copy', (event, id) => screenshot.copy(id));
    handle('screenshot-save', (event, id) => screenshot.save(id));
    handle('screenshot-reveal', (event, filePath) => screenshot.reveal(filePath));
    handle('screenshot-close', (event) => screenshot.closeViewer(event.sender));

    /* ---------------- Updates ----------------
     *
     * Behind the lock like everything else, which costs nothing: the lock
     * screen shows no title bar and no settings, so there is no update UI to
     * reach while locked. The check on the timer runs in main regardless, so a
     * locked app still knows about a new build by the time it is unlocked.
     */

    handle('updates-status', () => updates.status());
    handle('updates-check', () => updates.check({ manual: true }));
    handle('updates-download', () => updates.download());
    handle('updates-install', () => updates.install());
    handle('updates-open', () => updates.open());
    handle('updates-dismiss', () => updates.dismiss());

    /* ---------------- Assistant ---------------- */

    handle('ai-status', () => assistant.status());
    // Brings the runtime up on its own if it has not been asked yet, so a
    // model menu is right the first time it is opened rather than after the
    // first message. Cached from then on; `ai-models` announces the answer.
    handle('ai-model-list', (event, options) => assistant.models(options || {}));
    handle('ai-settings-set', (event, patch) => {
        const before = assistant.settings.get();
        const next = assistant.settings.set(patch);
        // Tells any live conversation which of these it has to restart for.
        // The model chip in the composer is expected to change the answer to
        // the next question, not to the next conversation.
        assistant.reconfigure(before, next);

        // Only the two that widen what the assistant may do unattended are
        // logged. The model and the effort are changed from a chip in the
        // composer several times an hour, and a security log that fills up
        // with them is a security log nobody reads.
        const changes = [];
        if (before.approval !== next.approval) {
            changes.push({ field: 'approvals', from: before.approval, to: next.approval });
        }
        if (before.allowLocalTools !== next.allowLocalTools) {
            changes.push({
                field: 'local tools',
                from: before.allowLocalTools ? 'allowed' : 'blocked',
                to: next.allowLocalTools ? 'allowed' : 'blocked',
            });
        }
        if (changes.length > 0) {
            activity.record({
                category: 'security',
                action: 'assistant.configure',
                outcome: 'info',
                target: 'Assistant',
                detail: `Approvals: ${next.approval}`
                    + `${next.allowLocalTools ? ', local tools allowed' : ''}`,
                changes,
            });
        }

        // The settings page and the panel both show some of this, and they are
        // on screen at the same time. Whoever did not make the change hears
        // about it here rather than showing a stale copy until it is reopened.
        notify('ai-settings', next);

        return next;
    });
    // Write-only, like every other credential in the app: it goes in, and only
    // whether one exists ever comes back.
    handle('ai-set-key', (event, value) => assistant.settings.setApiKey(value));

    handle('ai-conversation-start', (event, payload) => assistant.create(payload || {}));
    handle('ai-conversation-list', () => assistant.list());
    handle('ai-conversation-history', (event, conversationId) => assistant.history(conversationId));
    handle('ai-conversation-park', (event, conversationId) => assistant.park(conversationId));
    handle('ai-conversation-close', (event, conversationId) => assistant.close(conversationId));
    handle('ai-scope', (event, payload) => assistant.setScope(payload?.conversationId, payload || {}));
    handle('ai-send', (event, payload) => assistant.send(payload?.conversationId, payload?.text));
    handle('ai-interrupt', (event, conversationId) => assistant.interrupt(conversationId));

    // The two answers the window owes the main process: whether a tool call may
    // go ahead, and whether it managed to open or close the session it was
    // asked to.
    handle('ai-approval-response', (event, payload) => assistant.respondToApproval(payload || {}));
    handle('ai-action-response', (event, payload) => assistant.respondToAction(payload || {}));

    /* ---------------- Startup ---------------- */

    // Read from the system on every call rather than cached, because the user
    // can turn this off somewhere that is not this app.
    handle('startup-status', () => startup.status());
    handle('startup-set-enabled', (event, enabled) => startup.setEnabled(enabled));

    /* ---------------- Window ---------------- */

    ipcMain.on('window-minimize', () => getWindow()?.minimize());
    ipcMain.on('window-maximize', () => {
        const window = getWindow();
        if (!window) return;
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
    });
    ipcMain.on('window-close', () => getWindow()?.close());
    ipcMain.on('open-devtools', () => getWindow()?.webContents.toggleDevTools());
    ipcMain.on('reload-window', () => getWindow()?.reload());
    ipcMain.on('force-quit', () => app.quit());
}

/** Deny any prompt still waiting when the window goes away, and drop unsaved keys. */
function cancelPendingPrompts() {
    for (const resolve of pendingHostKeyPrompts.values()) resolve(false);
    pendingHostKeyPrompts.clear();
    // Each of these is a page load held open waiting for an answer. Denying
    // them lets those loads fail instead of hanging on a window that has gone.
    for (const resolve of pendingCertPrompts.values()) resolve(false);
    pendingCertPrompts.clear();
    // null, not an empty answer set: a round nobody can answer must end the
    // attempt rather than hand the server blanks and spend a login try.
    for (const resolve of pendingAuthPrompts.values()) resolve(null);
    pendingAuthPrompts.clear();
    pendingKeys.clear();
    // Decrypted credentials from a backup nobody is going to restore now.
    pendingBackups.clear();
    // A tool call waiting on an approval nobody can give any more. Ending the
    // conversations denies them, which is the right answer once the window
    // that would have said yes has gone.
    assistant.shutdown();
}

module.exports = { register, cancelPendingPrompts };
