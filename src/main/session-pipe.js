/**
 * The channel between one live session and the pane drawing it.
 *
 * Every transport ends up doing the same four things with its bytes, and doing
 * them slightly differently in three files is how a transcript ends up with a
 * hole in it that nobody notices for months. So they are done once, here:
 *
 *   a MessagePort per session, rather than IPC. Terminal output is the highest
 *   rate traffic in the app and the only thing on this channel, so it does not
 *   queue behind a transfer's progress updates the way a shared channel would;
 *
 *   output coalesced to one post per tick. A verbose command is thousands of
 *   small reads, and one message each pins the renderer;
 *
 *   the transcript fed from the arriving bytes rather than from the flush, so
 *   it records what the far end sent even when the port has gone away. A
 *   window reload leaves the session perfectly alive and unable to be drawn;
 *
 *   multi-byte characters held across reads. A UTF-8 sequence split down the
 *   middle by a socket read is not an edge case at 9600 baud, and decoding each
 *   half on its own puts a replacement character in the middle of a word.
 *
 * ssh.js predates this and carries its own copy. It is left alone deliberately:
 * it is the path every session in the app takes today, and a refactor of it is
 * not part of adding two more transports.
 */

const { MessageChannelMain } = require('electron');
const { StringDecoder } = require('string_decoder');
const sessionLog = require('./session-log');

/**
 * Wire up a session's data path.
 *
 *   tabId     the pane's id, which is the session key everywhere else too
 *   window    where to hand the far end of the port
 *   label     what the transcript header and the log lines name this session
 *   protocol  which transport this is ('telnet', 'serial'), so the transcript
 *             settings can decide whether this kind of session is recorded
 *   onInput   bytes typed in the pane, already a string
 *   onResize  the pane's new geometry; transports with no concept of one
 *             simply leave it out
 */
function createPipe({ tabId, window, label = {}, protocol = '', onInput, onResize }) {
    const { port1, port2 } = new MessageChannelMain();
    const decoder = new StringDecoder('utf8');

    let closed = false;

    // Started before a single byte can arrive, so a transcript never begins
    // half way through the far end's banner.
    sessionLog.start(tabId, {
        hostName: label.hostName || '',
        address: label.address || '',
        hostId: label.hostId || '',
        protocol,
    });

    port1.on('message', (event) => {
        const message = event.data;
        if (closed) return;

        if (message?.type === 'input') {
            onInput?.(message.data);
        } else if (message?.type === 'resize') {
            onResize?.(message.cols, message.rows);
        }
    });
    port1.start();

    let buffer = '';
    let scheduled = false;

    const flush = () => {
        scheduled = false;
        if (!buffer) return;
        try {
            port1.postMessage(buffer);
        } catch {
            // The port went away while data was in flight. The transcript
            // already has this text; there is nothing left to do with it.
        }
        buffer = '';
    };

    /**
     * Bytes arrived from the far end. Takes a Buffer or a string; a transport
     * that has already decoded its own text (an error line this app wrote, say)
     * can hand it straight over.
     */
    const deliver = (chunk) => {
        if (closed || chunk === null || chunk === undefined) return;

        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        if (!text) return;

        buffer += text;
        sessionLog.write(tabId, text);

        if (!scheduled) {
            scheduled = true;
            setImmediate(flush);
        }
    };

    /** The session ended. Tells the pane, which is what starts its backoff. */
    const disconnected = () => {
        if (closed) return;
        // Anything still buffered is output the far end produced before it
        // went, and is usually the reason it went: the "Connection closed by
        // foreign host" line is the last thing on the wire.
        const tail = decoder.end();
        if (tail) {
            buffer += tail;
            sessionLog.write(tabId, tail);
        }
        flush();
        try {
            port1.postMessage({ type: 'disconnected' });
        } catch {
            // Already closed with the window.
        }
    };

    const close = () => {
        if (closed) return;
        closed = true;
        try {
            port1.close();
        } catch {
            // Already closed with the session it belonged to.
        }
    };

    if (window && !window.isDestroyed()) {
        window.webContents.postMessage('ssh-port', { tabId }, [port2]);
    }

    return { port: port1, deliver, disconnected, close };
}

module.exports = { createPipe };
