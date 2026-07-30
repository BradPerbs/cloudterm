/**
 * What a host connects *with*, and the settings each way of connecting needs.
 *
 * Kept free of dependencies for the same reason tunnel-config.js is: the store
 * (persistence), the three transports (ssh.js, telnet.js, serial.js), the
 * dispatcher and the host editor all have to agree on one record shape without
 * any of them requiring the others.
 *
 *   ssh      the default, and the only one the rest of the app builds on:
 *            SFTP, port forwarding and the desktop panes are all SSH channels
 *   telnet   a socket and RFC 854 negotiation; no auth of its own, the far end
 *            asks for a login in-band the way it would on a physical terminal
 *   serial   a local port, no network at all
 *
 * A host record carries exactly one of these. Everything a protocol does not
 * use is left on the record rather than cleared, so switching a host to telnet
 * to reach its console and back to SSH does not lose its keys or its forwards.
 */

const PROTOCOLS = ['ssh', 'telnet', 'serial'];

const DEFAULT_PORTS = { ssh: 22, telnet: 23 };

/**
 * The rates worth offering. Anything is accepted on the record — USB adapters
 * will run at rates no list would think to include — but these are the ones a
 * console is actually configured at, and 115200 and 9600 cover almost all of
 * it.
 */
const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const DATA_BITS = [5, 6, 7, 8];
const STOP_BITS = [1, 1.5, 2];
const PARITIES = ['none', 'even', 'odd', 'mark', 'space'];
const FLOW_CONTROLS = ['none', 'rtscts', 'xonxoff'];

/**
 * What the Enter key puts on the wire.
 *
 * There is no answering this from the protocol. A Cisco console wants CR, a
 * Linux getty wants LF, and a device expecting one and given the other looks
 * broken in a way that reads as a bad cable: the prompt simply never comes
 * back. So it is a setting, defaulted to CR because that is what the network
 * gear this exists for expects.
 */
const NEWLINES = ['cr', 'lf', 'crlf'];

const NEWLINE_BYTES = { cr: '\r', lf: '\n', crlf: '\r\n' };

const DEFAULT_SERIAL = {
    path: '',
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
    newline: 'cr',
    localEcho: false,
    dtr: true,
    rts: true,
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function normalizeProtocol(value) {
    return PROTOCOLS.includes(value) ? value : 'ssh';
}

/** The port a protocol uses when the record does not say. */
function defaultPort(protocol) {
    return DEFAULT_PORTS[normalizeProtocol(protocol)] || 0;
}

function toBaud(value) {
    const rate = Number(value);
    // Not restricted to the list: an adapter will happily run at 31250 for MIDI
    // or 250000 for DMX, and refusing those would be inventing a limit the
    // hardware does not have.
    return Number.isFinite(rate) && rate > 0 && rate <= 20000000
        ? Math.round(rate)
        : DEFAULT_SERIAL.baudRate;
}

/**
 * Coerce anything the renderer or a restored backup might carry into a serial
 * block the port layer can be handed directly.
 */
function normalizeSerial(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};

    return {
        path: clean(source.path),
        baudRate: toBaud(source.baudRate),
        dataBits: oneOf(Number(source.dataBits), DATA_BITS, DEFAULT_SERIAL.dataBits),
        stopBits: oneOf(Number(source.stopBits), STOP_BITS, DEFAULT_SERIAL.stopBits),
        parity: oneOf(clean(source.parity), PARITIES, DEFAULT_SERIAL.parity),
        flowControl: oneOf(clean(source.flowControl), FLOW_CONTROLS, DEFAULT_SERIAL.flowControl),
        newline: oneOf(clean(source.newline), NEWLINES, DEFAULT_SERIAL.newline),
        // Most consoles echo what you type back. The ones that do not (a bare
        // MCU reading characters, a device in a mode with no line discipline)
        // look dead until this is on, so it is offered rather than guessed at.
        localEcho: Boolean(source.localEcho),
        // Asserted by default, which is what a terminal program does and what
        // most devices expect. Worth being able to turn off: a board wired to
        // reset on DTR reboots every time the port is opened.
        dtr: source.dtr === undefined ? DEFAULT_SERIAL.dtr : Boolean(source.dtr),
        rts: source.rts === undefined ? DEFAULT_SERIAL.rts : Boolean(source.rts),
    };
}

/**
 * Is this serial block usable? Only the port itself can really fail, and it
 * fails at open time, so this checks the one thing that is knowable up front.
 */
function validateSerial(serial) {
    const config = normalizeSerial(serial);
    if (!config.path) return { ok: false, message: 'No serial port chosen' };
    return { ok: true, message: '' };
}

/** How a serial connection is named in a header, a log line or a tab. */
function describeSerial(serial) {
    const config = normalizeSerial(serial);
    if (!config.path) return 'serial';

    // The four-part form every terminal program and every piece of console
    // documentation uses: 115200 8N1.
    const parity = config.parity === 'none' ? 'N' : config.parity.charAt(0).toUpperCase();
    const stop = config.stopBits === 1.5 ? '1.5' : String(config.stopBits);
    return `${config.path} · ${config.baudRate} ${config.dataBits}${parity}${stop}`;
}

/** What the Enter key sends on this connection. */
function newlineFor(serial) {
    return NEWLINE_BYTES[normalizeSerial(serial).newline] || '\r';
}

module.exports = {
    PROTOCOLS,
    BAUD_RATES,
    DATA_BITS,
    STOP_BITS,
    PARITIES,
    FLOW_CONTROLS,
    NEWLINES,
    DEFAULT_SERIAL,
    normalizeProtocol,
    defaultPort,
    normalizeSerial,
    validateSerial,
    describeSerial,
    newlineFor,
};
