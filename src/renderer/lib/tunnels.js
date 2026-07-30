/**
 * Renderer-side view of a port forward.
 *
 * The shape and rules mirror `src/main/tunnel-config.js`. They are restated
 * here rather than shared because the renderer is sandboxed and cannot reach
 * main-process modules. Main stays the authority, and validates again before
 * anything opens a socket.
 */

export const TUNNEL_TYPES = [
    {
        id: 'local',
        label: 'Local',
        flag: '-L',
        summary: 'Reach a remote service from this machine',
        detail: 'Opens a port here. Anything that connects to it comes out on the server, which then dials the destination.',
    },
    {
        id: 'remote',
        label: 'Remote',
        flag: '-R',
        summary: 'Expose a local service on the server',
        detail: 'Opens a port on the server. Connections it accepts are dialled from this machine.',
    },
    {
        id: 'dynamic',
        label: 'Dynamic',
        flag: '-D',
        summary: 'A SOCKS5 proxy through the server',
        detail: 'Opens a SOCKS5 proxy here. Each connection names its own destination, which the server dials.',
    },
];

export const typeInfo = (type) => TUNNEL_TYPES.find(entry => entry.id === type) || TUNNEL_TYPES[0];

/** Addresses that reach beyond this machine, and so deserve a warning. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*']);

export const isWildcardHost = (host) => WILDCARD_HOSTS.has(String(host || '').trim());

export const emptyTunnel = () => ({
    type: 'local',
    name: '',
    listenHost: '127.0.0.1',
    listenPort: '',
    destHost: '',
    destPort: '',
    autoStart: true,
});

/** Mirrors the main-process check, so the form can refuse before the IPC call. */
export function validateTunnel(tunnel) {
    const listenPort = Number(tunnel.listenPort);
    const destPort = Number(tunnel.destPort);

    if (tunnel.type === 'remote') {
        if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
            return 'Remote port must be between 0 and 65535';
        }
    } else if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
        return 'Listen port must be between 1 and 65535';
    }

    if (tunnel.type === 'dynamic') return '';

    if (!String(tunnel.destHost || '').trim()) return 'Destination host is required';
    if (!Number.isInteger(destPort) || destPort < 1 || destPort > 65535) {
        return 'Destination port must be between 1 and 65535';
    }

    return '';
}

/** One line, written in the direction the traffic travels. */
export function describeTunnel(tunnel) {
    const port = tunnel.listenPort || '*';
    const listen = `${tunnel.listenHost}:${port}`;

    if (tunnel.type === 'dynamic') return `${listen} → SOCKS5 → anywhere`;
    if (tunnel.type === 'remote') return `server:${port} → ${tunnel.destHost}:${tunnel.destPort}`;
    return `${listen} → ${tunnel.destHost}:${tunnel.destPort}`;
}

/** What the user should type somewhere else to actually use the tunnel. */
export function usageHint(tunnel) {
    if (tunnel.state !== 'active') return '';

    const port = tunnel.boundPort || tunnel.listenPort;
    if (tunnel.type === 'dynamic') return `SOCKS5 proxy at ${tunnel.listenHost}:${port}`;
    if (tunnel.type === 'remote') return `On the server: ${tunnel.listenHost}:${port}`;
    return `Connect to ${tunnel.listenHost}:${port}`;
}

export const TUNNEL_STATES = {
    active: { dot: 'bg-green-500', label: 'Active', tone: 'text-green-600 dark:text-green-400' },
    starting: { dot: 'bg-yellow-500 animate-pulse', label: 'Starting…', tone: 'text-amber-600 dark:text-amber-500' },
    stopped: { dot: 'bg-gray-400 dark:bg-neutral-600', label: 'Stopped', tone: 'text-gray-500 dark:text-gray-400' },
    error: { dot: 'bg-red-500', label: 'Failed', tone: 'text-red-600 dark:text-red-400' },
};

export const stateInfo = (state) => TUNNEL_STATES[state] || TUNNEL_STATES.stopped;
