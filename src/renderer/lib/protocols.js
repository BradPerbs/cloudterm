/**
 * Renderer-side view of what a host connects with.
 *
 * The shape and the vocabulary mirror `src/main/protocol-config.js`. They are
 * restated here rather than shared because the renderer is sandboxed and cannot
 * reach main-process modules. Main stays the authority and normalises every
 * record again before a driver or a socket ever sees it.
 */

export const PROTOCOLS = [
    {
        id: 'ssh',
        label: 'SSH',
        summary: 'Encrypted shell, and everything built on it',
        detail: 'Files, port forwarding and a remote desktop are all channels on an SSH connection, so they are only offered here.',
    },
    {
        id: 'telnet',
        label: 'Telnet',
        summary: 'A plain socket to a device with no SSH',
        detail: 'Sends everything, passwords included, in the clear. For a console server, a PDU or a switch that has never had an SSH daemon.',
    },
    {
        id: 'serial',
        label: 'Serial',
        summary: 'A console cable on this machine',
        detail: 'No network at all. The settings have to match the device exactly: a wrong baud rate prints garbage rather than reporting an error.',
    },
];

/**
 * What the host editor's first question offers.
 *
 * Not the same list as PROTOCOLS, and the difference is the point. The three
 * above are session *transports* — what the shell pane runs on, and what the
 * record stores in `protocol`. "Desktop" is not one of those: it is a host with
 * no shell at all, which the record has always expressed as
 * `desktop.only`.
 *
 * They are offered together anyway, because "what kind of host is this" is one
 * question to the person answering it. A picker that listed three protocols and
 * left RDP to a section further down the form reads as RDP being missing, which
 * is exactly how it read.
 *
 * So `desktop` is a UI-level kind, resolved back to a stored protocol and a
 * desktop block by the editor. Nothing in the main process knows the word.
 */
export const HOST_KINDS = [
    ...PROTOCOLS,
    {
        id: 'desktop',
        label: 'Desktop',
        summary: 'RDP or VNC, with no shell behind it',
        detail: 'Opens straight into the remote desktop and never dials SSH. For a Windows box, which usually has no SSH server on it.',
    },
    {
        id: 'ipmi',
        label: 'IPMI',
        summary: 'A service processor, and nothing behind it',
        detail: 'Opens straight into the BMC\'s own web interface and never dials the machine. For an iDRAC, iLO or Supermicro board in front of a host this app has no session on.',
    },
];

/**
 * Which of those a saved record is.
 *
 * A host that is only a desktop, or only a service processor, is stored as an
 * SSH host carrying `desktop.only` or `bmc.only`, so the kind has to be read off
 * those fields rather than off `protocol` alone.
 *
 * IPMI is tested first. The picker sets one or the other and clears the one it
 * is not, so a record with both is one that predates the picker knowing about
 * IPMI at all, and for that record the service processor is the answer that
 * still reaches something.
 */
export function hostKind(host) {
    if (host?.bmc?.enabled && host.bmc.only) return 'ipmi';
    if (host?.desktop?.enabled && host.desktop.only) return 'desktop';
    return host?.protocol || 'ssh';
}

export const DEFAULT_PORTS = { ssh: 22, telnet: 23 };

export const protocolLabel = (protocol) =>
    PROTOCOLS.find(entry => entry.id === (protocol || 'ssh'))?.label || 'SSH';

/**
 * The rates worth listing. Any number is accepted on the record — an adapter
 * will run at 31250 for MIDI — but these are what a console is configured at,
 * and 115200 and 9600 are very nearly all of it.
 */
export const BAUD_RATES = [
    300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
];

export const DATA_BITS = [5, 6, 7, 8];
export const STOP_BITS = [1, 1.5, 2];

export const PARITIES = [
    { id: 'none', label: 'None' },
    { id: 'even', label: 'Even' },
    { id: 'odd', label: 'Odd' },
    { id: 'mark', label: 'Mark' },
    { id: 'space', label: 'Space' },
];

export const FLOW_CONTROLS = [
    { id: 'none', label: 'None' },
    { id: 'rtscts', label: 'Hardware (RTS/CTS)' },
    { id: 'xonxoff', label: 'Software (XON/XOFF)' },
];

export const NEWLINES = [
    { id: 'cr', label: 'CR', hint: 'Network gear, most consoles' },
    { id: 'lf', label: 'LF', hint: 'A Linux getty' },
    { id: 'crlf', label: 'CR LF', hint: 'Some embedded monitors' },
];

export const DEFAULT_SERIAL = {
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

/**
 * `115200 8N1` — the form every piece of console documentation is written in,
 * and the fastest way to check a setting against the label on a device.
 */
export function describeLine(serial = {}) {
    const config = { ...DEFAULT_SERIAL, ...serial };
    const parity = config.parity === 'none' ? 'N' : config.parity.charAt(0).toUpperCase();
    const stop = config.stopBits === 1.5 ? '1.5' : String(config.stopBits);
    return `${config.baudRate} ${config.dataBits}${parity}${stop}`;
}
