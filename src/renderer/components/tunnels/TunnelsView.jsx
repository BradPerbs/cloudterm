import { memo, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
    PlusSignIcon,
    PlayIcon,
    StopIcon,
    Edit02Icon,
    Delete02Icon,
    ArrowDataTransferHorizontalIcon,
    Copy01Icon,
} from 'hugeicons-react';
import TunnelDialog from './TunnelDialog';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useTunnels } from '../../hooks/useTunnels';
import { describeTunnel, stateInfo, typeInfo, usageHint } from '../../lib/tunnels';
import { formatSize } from '../../lib/format';
import { toastOptions } from '../../lib/toast';

function Counter({ label, value }) {
    return (
        <span className="flex items-baseline gap-1">
            <span className="text-[11px] text-gray-400 dark:text-neutral-500">{label}</span>
            <span className="text-[11px] font-mono tabular-nums text-gray-600 dark:text-gray-400">{value}</span>
        </span>
    );
}

function TunnelCard({ tunnel, isLive, onStart, onStop, onEdit, onDelete }) {
    const state = stateInfo(tunnel.state);
    const info = typeInfo(tunnel.type);
    const running = tunnel.state === 'active' || tunnel.state === 'starting';
    const hint = usageHint(tunnel);

    return (
        <div className="border border-gray-200 dark:border-surface-control rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${state.dot}`} title={state.label} />

                <span className="shrink-0 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-surface-control text-[10px] font-semibold font-mono text-gray-600 dark:text-gray-400">
                    {info.flag}
                </span>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {tunnel.name || describeTunnel(tunnel)}
                        </span>
                        {tunnel.autoStart && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-neutral-400">
                                auto
                            </span>
                        )}
                    </div>
                    <div className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                        {tunnel.name ? describeTunnel(tunnel) : info.summary}
                    </div>
                </div>

                {tunnel.state === 'active' && (
                    <div className="hidden sm:flex items-center gap-3 shrink-0">
                        <Counter label="conn" value={tunnel.activeConnections} />
                        <Counter label="↑" value={formatSize(tunnel.bytesUp)} />
                        <Counter label="↓" value={formatSize(tunnel.bytesDown)} />
                    </div>
                )}

                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={running ? onStop : onStart}
                        disabled={!isLive && !running}
                        title={running ? 'Stop' : isLive ? 'Start' : 'Not connected'}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                            running
                                ? 'text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                                : 'text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                        }`}
                    >
                        {running
                            ? <StopIcon size={13} strokeWidth={2.5} />
                            : <PlayIcon size={13} strokeWidth={2.5} />}
                    </button>

                    <button
                        onClick={onEdit}
                        title="Edit"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                    >
                        <Edit02Icon size={13} strokeWidth={2} />
                    </button>

                    <button
                        onClick={onDelete}
                        title="Remove"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <Delete02Icon size={13} strokeWidth={2} />
                    </button>
                </div>
            </div>

            {/* Whatever the row cannot say on its own line: how to use it, or why
                it is not running. */}
            {(hint || tunnel.state === 'error' || tunnel.lastError) && (
                <div className="px-3 py-2 border-t border-gray-100 dark:border-surface-control/60 flex items-center gap-2">
                    {tunnel.state === 'error' ? (
                        <span className="text-[11px] text-red-600 dark:text-red-400">{tunnel.message}</span>
                    ) : (
                        <>
                            <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 flex-1 truncate">
                                {hint}
                            </span>
                            {tunnel.type !== 'remote' && (
                                <button
                                    onClick={() => {
                                        const port = tunnel.boundPort || tunnel.listenPort;
                                        navigator.clipboard.writeText(`${tunnel.listenHost}:${port}`);
                                        toast.success('Address copied', toastOptions({ duration: 1500 }));
                                    }}
                                    title="Copy address"
                                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                                >
                                    <Copy01Icon size={11} strokeWidth={2} />
                                </button>
                            )}
                        </>
                    )}
                    {tunnel.state !== 'error' && tunnel.lastError && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-500 truncate max-w-[45%]" title={tunnel.lastError}>
                            last error: {tunnel.lastError}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Port forwards for one session. Editing here writes through to the host, so a
 * tunnel added mid-session is still there the next time it connects.
 */
function TunnelsView({ tabId, host, isLive, onUpdateHost }) {
    const { tunnels, start, stop, startAll, stopAll, sync } = useTunnels(tabId);
    const [editing, setEditing] = useState(null);
    const [confirming, setConfirming] = useState(null);

    // Connecting seeds the runtime with the host's forwards, so normally the
    // list is already there. Syncing on open covers the case where the dial
    // failed. The forwards are still configured and should still be shown.
    useEffect(() => {
        if (host?.id) sync(host.id);
    }, [host?.id, sync]);

    /** Persist the host's tunnel list, then reconcile what is running with it. */
    const persist = useCallback(async (list) => {
        await onUpdateHost({ ...host, tunnels: list });
        await sync(host.id);
    }, [host, onUpdateHost, sync]);

    const handleSave = useCallback(async (tunnel) => {
        const current = tunnels.map(entry => ({ ...entry }));
        const index = current.findIndex(entry => entry.id === tunnel.id);

        if (index >= 0) current[index] = { ...current[index], ...tunnel };
        else current.push(tunnel);

        setEditing(null);
        await persist(current);
        toast.success(index >= 0 ? 'Forward updated' : 'Forward added', toastOptions({ duration: 1800 }));
    }, [tunnels, persist]);

    const handleDelete = useCallback((tunnel) => {
        setConfirming({
            title: 'Remove this port forward?',
            message: `${tunnel.name || describeTunnel(tunnel)} will be stopped and removed from ${host.name}.`,
            confirmLabel: 'Remove',
            onConfirm: async () => {
                setConfirming(null);
                await persist(tunnels.filter(entry => entry.id !== tunnel.id));
                toast.success('Forward removed', toastOptions({ duration: 1800 }));
            },
        });
    }, [tunnels, persist, host.name]);

    const anyRunning = tunnels.some(tunnel => tunnel.state === 'active' || tunnel.state === 'starting');

    return (
        <div className="absolute inset-0 overflow-y-auto bg-gray-50 dark:bg-surface-base">
            <div className="max-w-3xl mx-auto p-6 flex flex-col gap-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Port forwarding</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                            Tunnels run over this session's connection and stop when it closes.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {tunnels.length > 1 && (
                            <button
                                onClick={anyRunning ? stopAll : startAll}
                                disabled={!isLive && !anyRunning}
                                className="px-3 h-9 rounded-xl border border-gray-300 dark:border-surface-control text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {anyRunning ? 'Stop all' : 'Start all'}
                            </button>
                        )}
                        <button
                            onClick={() => setEditing({})}
                            className="flex items-center gap-2 px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                        >
                            <PlusSignIcon size={16} strokeWidth={2.5} />
                            <span>Add forward</span>
                        </button>
                    </div>
                </div>

                {!isLive && tunnels.length > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-500 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 px-3 py-2">
                        The session is not connected. Forwards will start again when it reconnects.
                    </p>
                )}

                {tunnels.length === 0 ? (
                    <div className="py-16 text-center">
                        <ArrowDataTransferHorizontalIcon
                            size={36}
                            strokeWidth={1.5}
                            className="mx-auto text-gray-300 dark:text-neutral-700 mb-3"
                        />
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                            No port forwards yet
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                            Forward a port to reach a database or an internal dashboard through this
                            server, or open a SOCKS proxy to browse from it.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {tunnels.map(tunnel => (
                            <TunnelCard
                                key={tunnel.id}
                                tunnel={tunnel}
                                isLive={isLive}
                                onStart={() => start(tunnel.id)}
                                onStop={() => stop(tunnel.id)}
                                onEdit={() => setEditing(tunnel)}
                                onDelete={() => handleDelete(tunnel)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {editing && (
                <TunnelDialog
                    tunnel={editing.id ? editing : null}
                    onSave={handleSave}
                    onClose={() => setEditing(null)}
                />
            )}

            {confirming && (
                <ConfirmDialog {...confirming} onCancel={() => setConfirming(null)} />
            )}
        </div>
    );
}

export default memo(TunnelsView);
