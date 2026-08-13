import { useCallback, useState } from 'react';
import { PlusSignIcon, Edit02Icon, Delete02Icon } from 'hugeicons-react';
import TunnelDialog from './TunnelDialog';
import { describeTunnel, typeInfo } from '../../lib/tunnels';
import { useT } from '../../i18n';

let localId = 0;

/**
 * The port-forwarding list inside the host editor. Config only: nothing here
 * opens a socket; the session's Tunnels panel does that once connected.
 *
 * `labelled` false drops the heading, for a caller that has already put the
 * words "Port forwarding" above this. The Add button stays and moves across to
 * the end of the row, since it is the only thing left on it.
 */
export default function TunnelsEditor({ tunnels = [], onChange, labelled = true }) {
    const t = useT();
    const [editing, setEditing] = useState(null);

    const handleSave = useCallback((tunnel) => {
        const next = [...tunnels];
        const index = next.findIndex(entry => entry.id === tunnel.id);

        if (index >= 0) {
            next[index] = { ...next[index], ...tunnel };
        } else {
            // An id is only needed so the row has a stable key until the host is
            // saved; the main process re-issues one it is happy with.
            localId += 1;
            next.push({ ...tunnel, id: tunnel.id || `new-${Date.now()}-${localId}` });
        }

        setEditing(null);
        onChange(next);
    }, [tunnels, onChange]);

    const handleDelete = useCallback((id) => {
        onChange(tunnels.filter(entry => entry.id !== id));
    }, [tunnels, onChange]);

    return (
        <div className="flex flex-col gap-2">
            <div className={`flex items-center ${labelled ? 'justify-between' : 'justify-end'}`}>
                {labelled && (
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {t('tunnel.heading')}
                    </label>
                )}
                <button
                    type="button"
                    onClick={() => setEditing({})}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                >
                    <PlusSignIcon size={13} strokeWidth={2.5} />
                    {t('common.add')}
                </button>
            </div>

            {tunnels.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 rounded-lg border border-dashed border-gray-300 dark:border-neutral-700 px-3 py-3">
                    {t('tunnel.editorEmpty')}
                </p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {tunnels.map((tunnel) => (
                        <div
                            key={tunnel.id}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800/50"
                        >
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-white dark:bg-surface-control text-[10px] font-semibold font-mono text-gray-600 dark:text-gray-400">
                                {typeInfo(tunnel.type).flag}
                            </span>

                            <div className="min-w-0 flex-1">
                                {tunnel.name && (
                                    <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                        {tunnel.name}
                                    </div>
                                )}
                                <div className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                                    {describeTunnel(tunnel)}
                                </div>
                            </div>

                            {tunnel.autoStart && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-surface-control text-gray-500 dark:text-neutral-400">
                                    {t('tunnel.autoBadge')}
                                </span>
                            )}

                            <button
                                type="button"
                                onClick={() => setEditing(tunnel)}
                                title={t('common.edit')}
                                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-surface-control transition-colors"
                            >
                                <Edit02Icon size={12} strokeWidth={2} />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDelete(tunnel.id)}
                                title={t('common.remove')}
                                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                                <Delete02Icon size={12} strokeWidth={2} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {editing && (
                <TunnelDialog
                    tunnel={editing.id ? editing : null}
                    onSave={handleSave}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}
