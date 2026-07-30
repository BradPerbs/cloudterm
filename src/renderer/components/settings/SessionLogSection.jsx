import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Folder01Icon, Refresh01Icon } from 'hugeicons-react';
import SettingCard from './ui/SettingCard';
import SettingRow, { DIVIDED } from './ui/SettingRow';
import Toggle from './ui/Toggle';
import SegmentedControl from '../ui/SegmentedControl';
import { toastOptions } from '../../lib/toast';
import { formatSize } from '../../lib/format';

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
            toast.error(error?.message || 'Could not save that setting', toastOptions());
        }
    }, [load]);

    const chooseFolder = useCallback(async () => {
        const result = await window.api.sessionLog.chooseDirectory();
        if (result?.canceled) return;
        if (!result?.success) {
            toast.error(result?.message || 'Could not use that folder', toastOptions());
            return;
        }
        setConfig(result.config);
        load();
        toast.success('Session logs will go there from now on', toastOptions());
    }, [load]);

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
            toast.error(result?.message || 'Could not open that folder', toastOptions());
        }
    }, []);

    const reveal = useCallback(async (filePath) => {
        const result = await window.api.sessionLog.reveal(filePath);
        if (!result?.success) {
            toast.error(result?.message || 'Could not find that log', toastOptions());
            load();
        }
    }, [load]);

    if (!config) return null;

    return (
        <SettingCard>
            <SettingRow
                align="center"
                title="Record every session"
                description="Write what the server prints to a file, for every session as it opens.
                    A single session can always be recorded on its own from its header,
                    without turning this on."
                control={
                    <Toggle
                        checked={config.enabled}
                        onChange={(next) => update({ enabled: next })}
                        ariaLabel="Record every session"
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                title="What to write"
                description="Readable strips the colour and cursor codes, which is what makes a log
                    greppable. Verbatim keeps every byte, for replaying it through a terminal later."
                align="center"
                control={
                    <SegmentedControl
                        ariaLabel="Log format"
                        value={config.format}
                        onChange={(next) => update({ format: next })}
                        segments={[
                            { value: 'plain', label: 'Readable' },
                            { value: 'raw', label: 'Verbatim' },
                        ]}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                align="center"
                title="Stamp each line with the time"
                description={config.format === 'raw'
                    ? 'Not available for verbatim logs: a timestamp in the middle of an escape sequence would corrupt it.'
                    : 'Prefixes every line with the local time it arrived.'}
                control={
                    <Toggle
                        checked={config.timestamps}
                        disabled={config.format === 'raw'}
                        onChange={(next) => update({ timestamps: next })}
                        ariaLabel="Stamp each line with the time"
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                title="Where they go"
                description="Logs hold whatever was on screen, which for a session that ran
                    a password manager or printed a token is as sensitive as the credentials
                    themselves. Keep them somewhere you would keep those."
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
                            Change…
                        </button>

                        <button
                            className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-300
                                dark:border-neutral-700 text-gray-600 dark:text-gray-400 transition-all
                                active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800 shrink-0"
                            onClick={openFolder}
                            title="Open the folder"
                        >
                            <Folder01Icon size={15} strokeWidth={2} />
                        </button>

                        {!config.usingDefaultDirectory && (
                            <button
                                className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-300
                                    dark:border-neutral-700 text-gray-600 dark:text-gray-400 transition-all
                                    active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800 shrink-0"
                                onClick={resetFolder}
                                title="Back to the default folder"
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
                                    title="Show in folder"
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
