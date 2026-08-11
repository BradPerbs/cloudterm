import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Folder01Icon, Refresh01Icon } from 'hugeicons-react';
import SettingCard from './ui/SettingCard';
import SettingRow, { DIVIDED } from './ui/SettingRow';
import Toggle from './ui/Toggle';
import SegmentedControl from '../ui/SegmentedControl';
import Checkbox from '../ui/Checkbox';
import { toastOptions } from '../../lib/toast';
import { formatSize } from '../../lib/format';
import { useT } from '../../i18n';

/**
 * Recording what the terminal showed.
 *
 * The settings live in the main process, not in localStorage, because that is
 * where the writing happens: a transcript has to keep being written while the
 * window is reloading, and a setting the renderer owned would be unreadable at
 * exactly that moment. So this section asks main for the current state rather
 * than holding its own copy.
 */
export default function SessionLogSection() {
    const t = useT();
    const [config, setConfig] = useState(null);
    const [logs, setLogs] = useState({ files: [], directory: '' });

    const load = useCallback(async () => {
        try {
            const [nextConfig, nextLogs] = await Promise.all([
                window.api.sessionLog.config(),
                window.api.sessionLog.list({ limit: 8 }),
            ]);
            setConfig(nextConfig);
            setLogs(nextLogs);
        } catch {
            // Locked, or the folder has gone. The card stays as it was.
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const update = useCallback(async (patch) => {
        try {
            setConfig(await window.api.sessionLog.configure(patch));
            load();
        } catch (error) {
            toast.error(error?.message || t('settings.logging.saveFailed'), toastOptions());
        }
    }, [load, t]);

    const chooseFolder = useCallback(async () => {
        const result = await window.api.sessionLog.chooseDirectory();
        if (result?.canceled) return;
        if (!result?.success) {
            toast.error(result?.message || t('settings.logging.folderFailed'), toastOptions());
            return;
        }
        setConfig(result.config);
        load();
        toast.success(t('settings.logging.folderChanged'), toastOptions());
    }, [load, t]);

    const resetFolder = useCallback(async () => {
        const result = await window.api.sessionLog.resetDirectory();
        if (result?.success) {
            setConfig(result.config);
            load();
        }
    }, [load]);

    const openFolder = useCallback(async () => {
        const result = await window.api.sessionLog.openFolder();
        if (!result?.success) {
            toast.error(result?.message || t('settings.logging.openFailed'), toastOptions());
        }
    }, [t]);

    const reveal = useCallback(async (filePath) => {
        const result = await window.api.sessionLog.reveal(filePath);
        if (!result?.success) {
            toast.error(result?.message || t('settings.logging.revealFailed'), toastOptions());
            load();
        }
    }, [load, t]);

    if (!config) return null;

    return (
        <SettingCard>
            <SettingRow
                align="center"
                title={t('settings.logging.recordAll')}
                description={t('settings.logging.recordAllDesc')}
                control={
                    <Toggle
                        checked={config.enabled}
                        onChange={(next) => update({ enabled: next })}
                        ariaLabel={t('settings.logging.recordAll')}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                align="center"
                title={t('settings.logging.whichSessions')}
                description={t('settings.logging.whichSessionsDesc')}
                control={
                    <div className="flex items-center gap-4">
                        {[
                            { key: 'ssh', label: 'SSH' },
                            { key: 'telnet', label: 'Telnet' },
                            { key: 'serial', label: 'Serial' },
                        ].map(({ key, label }) => (
                            <Checkbox
                                key={key}
                                size="sm"
                                label={label}
                                checked={config.protocols?.[key] !== false}
                                onChange={(event) => update({
                                    protocols: { ...config.protocols, [key]: event.target.checked },
                                })}
                            />
                        ))}
                    </div>
                }
            />

            <SettingRow
                className={DIVIDED}
                title={t('settings.logging.format')}
                description={t('settings.logging.formatDesc')}
                align="center"
                control={
                    <SegmentedControl
                        ariaLabel={t('settings.logging.format')}
                        value={config.format}
                        onChange={(next) => update({ format: next })}
                        segments={[
                            { value: 'plain', label: t('settings.logging.formatPlain') },
                            { value: 'raw', label: t('settings.logging.formatRaw') },
                        ]}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                align="center"
                title={t('settings.logging.timestamps')}
                description={config.format === 'raw'
                    ? t('settings.logging.timestampsUnavailable')
                    : t('settings.logging.timestampsDesc')}
                control={
                    <Toggle
                        checked={config.timestamps}
                        disabled={config.format === 'raw'}
                        onChange={(next) => update({ timestamps: next })}
                        ariaLabel={t('settings.logging.timestamps')}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                align="center"
                title={t('settings.logging.retention')}
                description={t('settings.logging.retentionDesc')}
                control={
                    <SegmentedControl
                        ariaLabel={t('settings.logging.retention')}
                        value={config.retentionDays}
                        onChange={(next) => update({ retentionDays: next })}
                        segments={[
                            { value: 0, label: t('settings.logging.forever') },
                            { value: 7, label: t('settings.logging.days', { count: 7 }) },
                            { value: 30, label: t('settings.logging.days', { count: 30 }) },
                            { value: 90, label: t('settings.logging.days', { count: 90 }) },
                        ]}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                align="center"
                title={t('settings.logging.cap')}
                description={t('settings.logging.capDesc')}
                control={
                    <SegmentedControl
                        ariaLabel={t('settings.logging.cap')}
                        value={config.maxTotalMB}
                        onChange={(next) => update({ maxTotalMB: next })}
                        segments={[
                            { value: 0, label: t('settings.logging.noCap') },
                            { value: 100, label: '100 MB' },
                            { value: 500, label: '500 MB' },
                            { value: 2048, label: '2 GB' },
                        ]}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                title={t('settings.logging.folder')}
                description={t('settings.logging.folderDesc')}
            >
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <code
                            className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl text-xs font-mono
                                bg-gray-50 dark:bg-neutral-800/60 border border-gray-200 dark:border-neutral-700
                                text-gray-700 dark:text-gray-300"
                            title={config.directory}
                        >
                            {config.directory}
                        </code>

                        <button
                            className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-300
                                dark:border-neutral-700 text-gray-700 dark:text-gray-300 transition-all
                                active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800 shrink-0"
                            onClick={chooseFolder}
                        >
                            {t('common.changeEllipsis')}
                        </button>

                        <button
                            className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-300
                                dark:border-neutral-700 text-gray-600 dark:text-gray-400 transition-all
                                active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800 shrink-0"
                            onClick={openFolder}
                            title={t('settings.logging.openFolder')}
                        >
                            <Folder01Icon size={15} strokeWidth={2} />
                        </button>

                        {!config.usingDefaultDirectory && (
                            <button
                                className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-300
                                    dark:border-neutral-700 text-gray-600 dark:text-gray-400 transition-all
                                    active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800 shrink-0"
                                onClick={resetFolder}
                                title={t('settings.logging.defaultFolder')}
                            >
                                <Refresh01Icon size={15} strokeWidth={2} />
                            </button>
                        )}
                    </div>

                    {logs.files.length > 0 && (
                        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 divide-y
                            divide-gray-100 dark:divide-neutral-800 overflow-hidden">
                            {logs.files.map(file => (
                                <button
                                    key={file.path}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors
                                        hover:bg-gray-50 dark:hover:bg-neutral-800/60"
                                    onClick={() => reveal(file.path)}
                                    title={t('settings.logging.showInFolder')}
                                >
                                    <span className="flex-1 min-w-0 truncate text-xs font-mono text-gray-700 dark:text-gray-300">
                                        {file.name}
                                    </span>
                                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">
                                        {formatSize(file.bytes)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </SettingRow>
        </SettingCard>
    );
}
