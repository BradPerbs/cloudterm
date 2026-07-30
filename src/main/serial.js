/**
 * Serial console sessions.
 *
 * Same shape as ssh.js and telnet.js — one session per pane, a MessagePort
 * carrying the bytes — over a local port instead of a socket. There is no
 * network, no handshake and no authentication: whatever is on the other end of
 * the cable is already talking, and opening the port joins the conversation
 * part way through.
 *
 * Three things follow from that and shape everything here.
 *
 *   Nothing negotiates. A serial line carries no window size, no terminal type
 *   and no notion of a session at all, so a resize is a no-op rather than
 *   something to send. The far end assumes 80x24 and always will.
 *
 *   The settings have to be right or nothing works, and the failure is silent.
 *   A console at the wrong baud rate does not report an error, it prints
 *   plausible-looking garbage. That is why the editor puts the whole 8N1 line
 *   in front of the user rather than hiding it behind a default.
 *
 *   Enter is ambiguous. See `newline` in protocol-config.js: there is no
 *   answering it from the protocol, because there is no protocol.
 *
 * The `serialport` dependency is loaded lazily and its absence is reported
 * rather than thrown. It is the only native binding in the app, and a missing
 * or mismatched build must not take the whole main process down on startup —
 * an SSH client that cannot start because a serial driver is missing has
 * traded away far more than it gained.
 */

const store = require('./store');
const { createPipe } = require('./session-pipe');
const { recordOpen, recordClose } = require('./session-activity');
const { normalizeSerial, validateSerial, describeSerial, newlineFor } = require('./protocol-config');

// tabId -> { port, pipe, hostId, hostName, address, openedAt }
const sessions = new Map();

let binding = null;
let bindingError = '';

/**
 * Resolve `serialport` once, and remember either it or why it could not be
 * had. Called from every entry point, so the answer is the same whether the
 * user opened the port list or dialled a host.
 */
function load() {
    if (binding || bindingError) return binding;

    try {
        // eslint-disable-next-line global-require
        binding = require('serialport');
    } catch (error) {
        bindingError = /cannot find module/i.test(error.message)
            ? 'Serial support is not installed in this build (npm install serialport)'
            : `Serial support could not be loaded: ${error.message}`;
        console.error('serialport unavailable:', error.message);
    }

    return binding;
}

const available = () => Boolean(load());

/**
 * What went wrong, in terms of the cable rather than of errno.
 *
 * The two that actually happen are a port that is not there (unplugged, or the
 * adapter enumerated under a different name after a reboot) and one that is
 * there and held by something else — a serial monitor left open in another
 * window is the single most common serial failure there is.
 */
function describeOpenError(error, path) {
    const message = error?.message || '';

    if (/file not found|no such file|cannot open/i.test(message) || error?.code === 'ENOENT') {
        return `${path} is not there. Check the cable, or pick the port again`;
    }
    if (/access denied|resource busy|busy/i.test(message) || error?.code === 'EBUSY') {
        return `${path} is in use by another program`;
    }
    if (/permission denied/i.test(message) || error?.code === 'EACCES') {
        // The Linux and macOS shape of the same problem, and the fix is a group
        // membership rather than anything in this app.
        return `Not allowed to open ${path}. Your user may need to be in the dialout group`;
    }
    return message || `Could not open ${path}`;
}

function get(tabId) {
    return sessions.get(tabId);
}

function describe(tabId) {
    const session = sessions.get(tabId);
    return {
        hostId: session?.hostId || '',
        hostName: session?.hostName || '',
        subject: session?.address || '',
    };
}

/**
 * Every serial port the machine can see.
 *
 * Read live rather than remembered: a USB adapter is a different port every
 * time it is plugged into a different socket, and a saved list would offer
 * names that stopped existing when the cable moved.
 */
async function listPorts() {
    if (!available()) return { available: false, message: bindingError, ports: [] };

    try {
        const found = await binding.SerialPort.list();
        return {
            available: true,
            message: '',
            ports: found.map(port => ({
                path: port.path,
                // Windows has a name a person recognises ("USB Serial Device
                // (COM7)"); everywhere else the manufacturer is the closest
                // thing to one.
                label: port.friendlyName || port.manufacturer || '',
                manufacturer: port.manufacturer || '',
                serialNumber: port.serialNumber || '',
            })),
        };
    } catch (error) {
        return { available: false, message: error.message, ports: [] };
    }
}

function destroy(tabId, { reason = 'closed' } = {}) {
    const session = sessions.get(tabId);
    if (!session) return false;

    sessions.delete(tabId);

    recordClose({
        reason,
        hostId: session.hostId,
        hostName: session.hostName,
        address: session.address,
        openedAt: session.openedAt,
    });

    session.pipe.close();

    try {
        if (session.port.isOpen) session.port.close(() => {});
    } catch (error) {
        console.error(`Error closing serial port for ${tabId}:`, error.message);
    }

    return true;
}

function destroyAll() {
    for (const tabId of [...sessions.keys()]) destroy(tabId, { reason: 'locked' });
}

/** The serialport options a normalised serial block maps to. */
function portOptions(config) {
    return {
        path: config.path,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        rtscts: config.flowControl === 'rtscts',
        xon: config.flowControl === 'xonxoff',
        xoff: config.flowControl === 'xonxoff',
        autoOpen: false,
    };
}

function connect({ tabId, hostId }, { window } = {}) {
    return new Promise((resolve) => {
        destroy(tabId, { reason: 'replaced' });

        const target = store.resolveCredentials(hostId);
        if (!target) {
            resolve({ success: false, message: 'Host not found' });
            return;
        }

        if (!available()) {
            resolve({ success: false, message: bindingError });
            return;
        }

        const config = normalizeSerial(target.serial);
        const valid = validateSerial(config);
        if (!valid.ok) {
            resolve({ success: false, message: valid.message });
            return;
        }

        const label = store.describeHost(hostId);
        const address = describeSerial(config);
        const newline = newlineFor(config);

        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;

            recordOpen({
                success: result.success,
                message: result.message,
                hostId,
                hostName: label.name,
                address,
                detail: `over serial · ${address}`,
            });

            resolve(result);
        };

        let port;
        try {
            port = new binding.SerialPort(portOptions(config));
        } catch (error) {
            settle({ success: false, message: describeOpenError(error, config.path) });
            return;
        }

        port.open((error) => {
            if (error) {
                settle({ success: false, message: describeOpenError(error, config.path) });
                return;
            }

            const pipe = createPipe({
                tabId,
                window,
                label: { hostName: label.name, address, hostId },
                protocol: 'serial',
                onInput: (data) => {
                    if (!port.isOpen) return;

                    // Every line ending becomes the one this device was
                    // configured for. A pasted block arriving with CRLF and a
                    // device that wants bare CR is the same problem as the
                    // Enter key, and answering it in one place means a paste
                    // and a keystroke behave the same.
                    const out = data.replace(/\r\n|\r|\n/g, newline);
                    port.write(Buffer.from(out, 'utf8'), (writeError) => {
                        if (writeError) {
                            pipe.deliver(`\r\n\x1b[1;31m>> ${writeError.message}\x1b[0m\r\n`);
                        }
                    });

                    // A device with no echo of its own leaves the pane blank
                    // while you type, which reads as a dead port rather than a
                    // quiet one. Echoed as CRLF whatever went on the wire, so
                    // the cursor both returns and advances on screen.
                    if (config.localEcho) {
                        pipe.deliver(data.replace(/\r\n|\r|\n/g, '\r\n'));
                    }
                },
                // No onResize: a serial line has no window size to tell anyone
                // about. The pane still refits itself locally.
            });

            sessions.set(tabId, {
                port,
                pipe,
                hostId,
                hostName: label.name,
                address,
                openedAt: Date.now(),
            });

            // Asserted explicitly rather than left to the driver's default, so
            // a board wired to reset on DTR can be told not to be. Skipped
            // under hardware flow control, where RTS belongs to the driver and
            // setting it by hand fights it.
            if (config.flowControl !== 'rtscts') {
                port.set({ dtr: config.dtr, rts: config.rts }, (setError) => {
                    if (setError) console.error(`Could not set DTR/RTS on ${config.path}:`, setError.message);
                });
            }

            port.on('data', (chunk) => pipe.deliver(chunk));

            port.on('error', (portError) => {
                sessions.get(tabId)?.pipe.deliver(
                    `\r\n\x1b[1;31m>> ${portError.message}\x1b[0m\r\n`
                );
            });

            port.on('close', () => {
                // Unplugging the adapter closes the port from underneath us,
                // which is the common case rather than an error: the pane
                // reports a drop and its backoff starts dialling, so plugging
                // the cable back in reconnects on its own.
                const session = sessions.get(tabId);
                if (!session || session.port !== port) return;
                session.pipe.disconnected();
                if (window && !window.isDestroyed()) {
                    window.webContents.send('ssh-disconnected', tabId);
                }
                destroy(tabId, { reason: 'dropped' });
            });

            // Written the moment the port is open, with nothing waited for.
            // On a serial line there is nothing to wait for: no prompt is
            // guaranteed to arrive at all, since a device that has already
            // booted has already printed everything it was going to.
            if (target.initCommand) {
                try {
                    port.write(Buffer.from(target.initCommand.replace(/\r\n|\r|\n/g, newline) + newline, 'utf8'));
                } catch (writeError) {
                    console.error(`Could not send the connect command for ${tabId}:`, writeError.message);
                }
            }

            settle({ success: true, message: 'Connected' });
        });
    });
}

module.exports = {
    sessions,
    get,
    describe,
    connect,
    destroy,
    destroyAll,
    listPorts,
    available,
};
