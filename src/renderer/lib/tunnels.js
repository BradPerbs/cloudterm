/**
 * Renderer-side view of a port forward.
 *
 * The shape and rules mirror `src/main/tunnel-config.js`. They are restated
 * here rather than shared because the renderer is sandboxed and cannot reach
 * main-process modules. Main stays the authority, and validates again before
 * anything opens a socket.
 */

import { translate } from '../i18n';

export const TUNNEL_TYPES = [
    {
        id: 'local',
        labelKey: 'tunnel.local',
        flag: '-L',
        summaryKey: 'tunnel.local.summary',
        detailKey: 'tunnel.local.detail',
    },
    {
        id: 'remote',
        labelKey: 'tunnel.remote',
        flag: '-R',
        summaryKey: 'tunnel.remote.summary',
        detailKey: 'tunnel.remote.detail',
    },
    {
        id: 'dynamic',
        labelKey: 'tunnel.dynamic',
        flag: '-D',
        summaryKey: 'tunnel.dynamic.summary',
        detailKey: 'tunnel.dynamic.detail',
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
            return translate('tunnel.badRemotePort');
        }
    } else if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
        return translate('tunnel.badListenPort');
    }

    if (tunnel.type === 'dynamic') return '';

    if (!String(tunnel.destHost || '').trim()) return translate('tunnel.destHostRequired');
    if (!Number.isInteger(destPort) || destPort < 1 || destPort > 65535) {
        return translate('tunnel.badDestPort');
    }

    return '';
}

/** One line, written in the direction the traffic travels. */
export function describeTunnel(tunnel) {
    const port = tunnel.listenPort || '*';
    const listen = `${tunnel.listenHost}:${port}`;

    if (tunnel.type === 'dynamic') return `${listen} → SOCKS5 → ${translate('tunnel.anywhere')}`;
    if (tunnel.type === 'remote') return `${translate('tunnel.serverWord')}:${port} → ${tunnel.destHost}:${tunnel.destPort}`;
    return `${listen} → ${tunnel.destHost}:${tunnel.destPort}`;
}

/** What the user should type somewhere else to actually use the tunnel. */
export function usageHint(tunnel) {
    if (tunnel.state !== 'active') return '';

    const port = tunnel.boundPort || tunnel.listenPort;
    if (tunnel.type === 'dynamic') return translate('tunnel.usageDynamic', { where: `${tunnel.listenHost}:${port}` });
    if (tunnel.type === 'remote') return translate('tunnel.usageRemote', { where: `${tunnel.listenHost}:${port}` });
    return translate('tunnel.usageLocal', { where: `${tunnel.listenHost}:${port}` });
}

export const TUNNEL_STATES = {
    active: { dot: 'bg-green-500', labelKey: 'tunnel.stateActive', tone: 'text-green-600 dark:text-green-400' },
    starting: { dot: 'bg-yellow-500 animate-pulse', labelKey: 'tunnel.stateStarting', tone: 'text-amber-600 dark:text-amber-500' },
    stopped: { dot: 'bg-gray-400 dark:bg-neutral-600', labelKey: 'tunnel.stateStopped', tone: 'text-gray-500 dark:text-gray-400' },
    error: { dot: 'bg-red-500', labelKey: 'tunnel.stateFailed', tone: 'text-red-600 dark:text-red-400' },
};

export const stateInfo = (state) => TUNNEL_STATES[state] || TUNNEL_STATES.stopped;
