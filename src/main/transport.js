/**
 * Which way a pane connects.
 *
 * A pane holds exactly one session, and until now that was always SSH. The
 * renderer never needs to know which transport it got: it asks for a session on
 * a pane id, receives a MessagePort, and writes bytes at it. That is why the
 * IPC channels are still called `ssh-connect` and `ssh-disconnect` — they are
 * the session channels, and renaming them would touch four files to say
 * something the renderer does not act on.
 *
 * What the renderer *does* act on is which panes a host can offer. SFTP, port
 * forwarding and the desktop views are all SSH channels; a telnet or serial
 * host has a shell and nothing else, and the view switcher drops the rest
 * rather than showing three tabs that can only ever say no.
 */

const store = require('./store');
const ssh = require('./ssh');
const telnet = require('./telnet');
const serial = require('./serial');
const { normalizeProtocol } = require('./protocol-config');

const BACKENDS = { ssh, telnet, serial };

function backendFor(protocol) {
    return BACKENDS[normalizeProtocol(protocol)] || ssh;
}

/**
 * Open a session for a pane, over whatever the host record says.
 *
 * The protocol is read from the store rather than passed in, for the same
 * reason credentials are: the renderer asking for a particular transport would
 * be the renderer deciding what a stored record means.
 */
function connect(payload, deps = {}) {
    const protocol = store.getHostProtocol(payload?.hostId);
    return backendFor(protocol).connect(payload, deps);
}

/**
 * Close whatever session this pane holds.
 *
 * Asks each backend rather than looking the host up again: by the time a pane
 * is being torn down its host record may already have been deleted, and a
 * session that outlived its record still has a socket to close.
 */
function destroy(tabId, options) {
    let closed = false;
    for (const backend of Object.values(BACKENDS)) {
        if (backend.destroy(tabId, options)) closed = true;
    }
    return closed;
}

/** Every live session, whatever it is. Used when the app locks or quits. */
function destroyAll() {
    for (const backend of Object.values(BACKENDS)) backend.destroyAll();
}

/** Which transport a live pane is on, or '' if it holds no session. */
function protocolOf(tabId) {
    for (const [protocol, backend] of Object.entries(BACKENDS)) {
        if (backend.get(tabId)) return protocol;
    }
    return '';
}

/** Name the far end of a pane's session, whichever backend holds it. */
function describe(tabId) {
    for (const backend of Object.values(BACKENDS)) {
        if (backend.get(tabId)) return backend.describe(tabId);
    }
    return { hostId: '', hostName: '', subject: '' };
}

module.exports = {
    connect,
    destroy,
    destroyAll,
    protocolOf,
    describe,
    backendFor,
};
