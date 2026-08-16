import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    ShieldKeyIcon,
    Delete02Icon,
    Search01Icon,
    Cancel01Icon,
    ArrowDown01Icon,
    Copy01Icon,
} from 'hugeicons-react';
import ConfirmDialog from '../ui/ConfirmDialog';
import SettingCard from './ui/SettingCard';
import { useStacked } from './ui/stacked';
import { formatDateTime } from '../../lib/format';
import { toastOptions } from '../../lib/toast';
import { useT } from '../../i18n';

function KeyRow({ entry, onForget }) {
    const t = useT();

    return (
        <div className="flex items-center gap-3 py-2 pl-8 pr-3 border-t border-gray-100 dark:border-surface-control/60">
            <span className="shrink-0 w-36 font-mono text-[11px] truncate text-gray-500 dark:text-gray-400">
                {entry.keyType || t('settings.knownHosts.unknownType')}
            </span>

            <span className="flex-1 min-w-0 font-mono text-[11px] text-gray-600 dark:text-gray-400 truncate selectable">
                {entry.fingerprint}
            </span>

            {entry.addedAt && (
                <span className="shrink-0 text-[11px] text-gray-400 dark:text-neutral-500">
                    {formatDateTime(entry.addedAt)}
                </span>
            )}

            <button
                onClick={() => {
                    navigator.clipboard.writeText(entry.fingerprint);
                    toast.success(t('settings.knownHosts.copied'), toastOptions({ duration: 1500 }));
                }}
                title={t('settings.knownHosts.copy')}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
            >
                <Copy01Icon size={12} strokeWidth={2} />
            </button>

            <button
                onClick={onForget}
                title={t('settings.knownHosts.forgetKey')}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
                <Delete02Icon size={12} strokeWidth={2} />
            </button>
        </div>
    );
}

function HostRow({ record, expanded, onToggle, onForgetHost, onForgetKey }) {
    const t = useT();

    return (
        <div className="border border-gray-200 dark:border-surface-control rounded-xl overflow-hidden">
            {/* The row itself is the control, so the whole strip highlights and
                presses rather than just the text under the pointer. "Forget" is
                a sibling, since a button cannot be nested inside one. */}
            <div className="flex items-stretch">
                <button
                    onClick={onToggle}
                    aria-expanded={expanded}
                    className="flex items-center gap-2 min-w-0 flex-1 h-11 pl-3 pr-2 text-left outline-none
                        transition-colors duration-150
                        hover:bg-gray-50 dark:hover:bg-surface-control/40
                        active:bg-gray-100 dark:active:bg-surface-control/70
                        focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900/20
                        dark:focus-visible:ring-white/25"
                >
                    <ArrowDown01Icon
                        size={14}
                        strokeWidth={2.5}
                        className={`shrink-0 text-gray-400 transition-transform duration-200 motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`}
                    />
                    <span className="font-mono text-sm text-gray-900 dark:text-white truncate">
                        {record.host}
                    </span>
                    {record.port !== 22 && (
                        <span className="font-mono text-xs text-gray-400 dark:text-neutral-500">
                            :{record.port}
                        </span>
                    )}
                    <span className="shrink-0 text-[11px] text-gray-400 dark:text-neutral-500">
                        {t('settings.knownHosts.keyCount', { count: record.entries.length })}
                    </span>
                </button>

                <div className="shrink-0 flex items-center pr-3 pl-1">
                    <button
                        onClick={onForgetHost}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 active:scale-95 transition-all"
                    >
                        {t('settings.knownHosts.forget')}
                    </button>
                </div>
            </div>

            {expanded && record.entries.map(entry => (
                <KeyRow
                    key={entry.fingerprint}
                    entry={entry}
                    onForget={() => onForgetKey(record, entry)}
                />
            ))}
        </div>
    );
}

/**
 * Trusted server host keys. Forgetting one means the next connection to that
 * host prompts again, which is the only way back if a key legitimately
 * changed and the hard warning is now blocking the connection.
 */
export default function KnownHostsSection() {
    const t = useT();
    const stacked = useStacked();
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());
    const [confirmState, setConfirmState] = useState(null);

    const load = useCallback(async () => {
        try {
            setRecords(await window.api.hostKeys.list());
        } catch {
            setRecords([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const visible = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        if (!needle) return records;
        return records.filter(record =>
            record.host.toLowerCase().includes(needle)
            || record.entries.some(entry => entry.fingerprint?.toLowerCase().includes(needle)));
    }, [records, filter]);

    const toggle = useCallback((id) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const forgetHost = useCallback((record) => {
        setConfirmState({
            title: t('settings.knownHosts.confirmTitle'),
            message: t('settings.knownHosts.confirmMessage', {
                host: `${record.host}${record.port === 22 ? '' : `:${record.port}`}`,
            }),
            confirmLabel: t('settings.knownHosts.forget'),
            onConfirm: async () => {
                setConfirmState(null);
                await window.api.hostKeys.forgetById(record.id);
                toast.success(
                    t('settings.knownHosts.forgotHost', { host: record.host }),
                    toastOptions({ duration: 2000 }),
                );
                load();
            },
        });
    }, [load, t]);

    const forgetKey = useCallback(async (record, entry) => {
        await window.api.hostKeys.forgetKey(record.id, entry.fingerprint);
        toast.success(
            t('settings.knownHosts.forgotKey', { type: entry.keyType, host: record.host }),
            toastOptions({ duration: 2000 }),
        );
        load();
    }, [load, t]);

    return (
        <>
            <SettingCard>
                {/* Stacks with the rest of the page, and the filter field takes
                    the card's width there rather than a fixed 160px. */}
                <div className={`mb-5 ${stacked
                    ? 'flex flex-col gap-3'
                    : 'flex items-start justify-between gap-4'}`}
                >
                    <div className="min-w-0">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <ShieldKeyIcon size={18} strokeWidth={2} className="text-gray-400" />
                            {t('settings.knownHosts.title')}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {t('settings.knownHosts.desc')}
                        </p>
                    </div>

                    {records.length > 4 && (
                        <div className={stacked ? 'relative' : 'relative shrink-0'}>
                            <Search01Icon
                                size={14}
                                strokeWidth={2}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                            />
                            <input
                                value={filter}
                                onChange={(event) => setFilter(event.target.value)}
                                placeholder={t('common.filter')}
                                spellCheck={false}
                                className={`h-8 pl-8 pr-7 rounded-lg border border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base text-gray-900 dark:text-white text-xs outline-none focus:border-gray-300 dark:focus:border-neutral-700 placeholder:text-gray-400 ${stacked ? 'w-full' : 'w-40'}`}
                            />
                            {filter && (
                                <button
                                    onClick={() => setFilter('')}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                >
                                    <Cancel01Icon size={11} strokeWidth={2.5} />
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {loading ? (
                    <p className="text-sm text-gray-400 dark:text-neutral-500 py-6 text-center">
                        {t('common.loading')}
                    </p>
                ) : records.length === 0 ? (
                    <div className="py-8 text-center">
                        <ShieldKeyIcon size={32} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-neutral-700 mb-2" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t('settings.knownHosts.empty')}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-neutral-500 mt-1">
                            {t('settings.knownHosts.emptyNote')}
                        </p>
                    </div>
                ) : visible.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-neutral-500 py-6 text-center">
                        {t('common.noMatches', { query: filter.trim() })}
                    </p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {visible.map(record => (
                            <HostRow
                                key={record.id}
                                record={record}
                                expanded={expanded.has(record.id)}
                                onToggle={() => toggle(record.id)}
                                onForgetHost={() => forgetHost(record)}
                                onForgetKey={forgetKey}
                            />
                        ))}
                    </div>
                )}
            </SettingCard>

            {confirmState && (
                <ConfirmDialog {...confirmState} onCancel={() => setConfirmState(null)} />
            )}
        </>
    );
}
