const { app, dialog } = require('electron');
const store = require('./store');
const account = require('./account');
const { parseAddress } = require('./address');

/**
 * `cloudterm://` links: a session opened from outside the app, by a browser,
 * a script, a shortcut or another program.
 *
 * The one shape today is `cloudterm://connect?address=user@host:port&code=…`.
 * Both parameters are optional and they are tried in this order:
 *
 *   1. `code` is a single-use connect code issued by the service the app is
 *      signed in to (see account.js). It is redeemed over that account's API
 *      with the device token, and the answer carries the login. The password
 *      arrives over that authenticated call and never sits in the link
 *      itself, which passes through a browser, a process list and possibly a
 *      chat log on its way here. Who may issue a code, and who may redeem
 *      one, is the issuing service's business; this end only presents it.
 *
 *   2. `address` is a plain `root@10.0.0.5`, used when there is no code, when
 *      no account is connected, or when the code has expired on the way. It
 *      dials the same machine and asks for the password on the pane.
 *
 * Whatever the source, the result is a quick connect (see store.openQuickConnect):
 * a record that lives for this run only, is never written to disk and is not
 * offered to be saved. A link is a one-off by nature, and a machine somebody
 * else pointed the app at should not end up in the host list on its own.
 *
 * A link can arrive before the renderer exists (a cold start from the browser)
 * or while it is behind the lock screen, so links queue here until the
 * renderer says it is listening, and the queue is closed again when it locks.
 */

const SCHEME = 'cloudterm';

const LINK = /^cloudterm:\/\//i;

/** What a connect code looks like. Anything else is refused before it is sent anywhere. */
const CODE = /^[A-Za-z0-9]{16,128}$/;

let notify = null;
let getWindow = () => null;
let ready = false;
const queue = [];

/** The first `cloudterm://` argument on a command line, or null. */
function extract(argv) {
    for (const arg of argv || []) {
        if (typeof arg === 'string' && LINK.test(arg)) return arg;
    }
    return null;
}

/**
 * `{ action: 'connect', code, address }` for a link this app understands,
 * null for anything else. Nothing here dials; parse is pure.
 */
function parse(link) {
    let url;
    try {
        url = new URL(String(link || ''));
    } catch {
        return null;
    }

    if (url.protocol !== `${SCHEME}:`) return null;

    // `cloudterm://connect?…` parses with `connect` as the host; a
    // `cloudterm:///connect` variant lands it in the path instead. Either is
    // the same request.
    const action = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase();
    if (action !== 'connect') return null;

    const code = url.searchParams.get('code') || '';
    if (code && !CODE.test(code)) return null;

    return {
        action,
        code,
        address: (url.searchParams.get('address') || '').trim(),
    };
}

/**
 * Turn a parsed link into a quick-connect host, or explain why not.
 *
 * Answers `{ host, notice, level }`: `host` is the redacted record to open
 * (null when nothing could be dialled), `notice` is what to tell the user
 * about how it got there, and `level` says whether that is an error.
 */
async function resolve(link) {
    let reason = '';

    if (link.code) {
        try {
            const login = await account.redeemConnectCode(link.code);
            const host = store.openQuickConnect({
                host: login.host,
                port: login.port,
                username: login.username,
                password: login.password,
                name: login.name,
            });

            if (host) {
                const notice = login.passwordStatus === 'ready'
                    ? ''
                    : 'The connected account has no password for this server yet. Enter one on the pane if you have it.';
                return { host, notice, level: 'info' };
            }

            reason = 'The connected account answered with no address to dial';
        } catch (error) {
            reason = error.message || 'The connected account did not accept the link';
        }
    }

    const parsed = parseAddress(link.address);

    if (!parsed.ok) {
        return {
            host: null,
            notice: reason ? `${reason}, and the link carried no address to fall back to.` : 'The link carried no address to dial.',
            level: 'error',
        };
    }

    // Without a redeemed code nothing has vouched for this, so anything that
    // can open a URL could have asked. The address is put in front of the
    // user before a pane is opened to it, in a dialog a web page cannot draw.
    const where = parsed.username ? `${parsed.username}@${parsed.host}` : parsed.host;
    const { response } = await dialog.showMessageBox(getWindow() || undefined, {
        type: 'question',
        buttons: ['Connect', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: `Open a session to ${where}?`,
        detail: reason
            ? `${reason}. The password will be asked for on the pane.`
            : 'A link outside CloudTerm asked for this. Nothing is saved.',
    });

    if (response !== 0) return { host: null, notice: '', level: 'info' };

    return {
        host: store.openQuickConnect(parsed),
        notice: reason ? `${reason}. Enter the password on the pane.` : '',
        level: 'info',
    };
}

function flush() {
    if (!ready || !notify) return;
    while (queue.length) notify('deep-link-connect', queue.shift());
}

/**
 * Handle one link, from whichever entry point delivered it.
 *
 * Resolves before queueing rather than after, so a cold start redeems the code
 * while the window is still loading and the session is ready to open the
 * moment the renderer is.
 */
async function open(link) {
    const parsed = parse(link);
    if (!parsed) {
        console.error('Ignored a cloudterm:// link this build does not understand:', String(link).slice(0, 200));
        return;
    }

    const window = getWindow();
    if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.focus();
    }

    let result;
    try {
        result = await resolve(parsed);
    } catch (error) {
        result = { host: null, notice: error.message || 'Could not open the link', level: 'error' };
    }

    if (!result.host && !result.notice) return;

    queue.push(result);
    flush();
}

/** Called by the renderer once it is listening; flushes anything that arrived first. */
function markReady() {
    ready = true;
    flush();
}

/** The renderer is gone (locked, or the window closed): hold links until it is back. */
function reset() {
    ready = false;
}

function setNotifier(fn, windowGetter) {
    notify = fn;
    if (typeof windowGetter === 'function') getWindow = windowGetter;
    flush();
}

/**
 * Make this build the handler for `cloudterm://`.
 *
 * The installer registers the scheme on its own; this covers the portable
 * build, which has no installer to do it. A development checkout is left
 * alone for the reason startup.js gives: `process.execPath` there is the
 * Electron binary in node_modules, and a registration pointing at it would
 * outlive the checkout. A dev run can still be handed a link on the command
 * line: `npx electron . "cloudterm://connect?address=root@10.0.0.5"`.
 */
function register() {
    if (!app.isPackaged) return false;
    try {
        return app.setAsDefaultProtocolClient(SCHEME);
    } catch (error) {
        console.error('Could not register the cloudterm:// handler:', error.message);
        return false;
    }
}

module.exports = {
    SCHEME,
    extract,
    parse,
    resolve,
    open,
    markReady,
    reset,
    setNotifier,
    register,
};
