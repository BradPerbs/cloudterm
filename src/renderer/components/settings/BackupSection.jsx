import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import {
    ArchiveIcon,
    Download04Icon,
    Upload04Icon,
    Alert02Icon,
} from 'hugeicons-react';
import SettingCard from './ui/SettingCard';
import Checkbox from '../ui/Checkbox';
import { toastOptions } from '../../lib/toast';
import { formatDateTime } from '../../lib/format';
import { useT } from '../../i18n';

const MIN_PASSPHRASE = 8;

const INPUT_CLASS = 'h-9 px-3 rounded-xl border border-gray-200 dark:border-surface-control '
    + 'bg-white dark:bg-surface-base text-gray-900 dark:text-white text-sm outline-none '
    + 'focus:border-gray-400 dark:focus:border-neutral-600 transition-colors';

const PRIMARY_BUTTON = 'px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black '
    + 'font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md '
    + 'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100';

const SECONDARY_BUTTON = 'px-3 h-9 rounded-xl border border-gray-300 dark:border-surface-control '
    + 'text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 '
    + 'dark:hover:bg-surface-control transition-colors';

function Field({ label, value, onChange, ...rest }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
            <input
                type="password"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                spellCheck={false}
                className={INPUT_CLASS}
                {...rest}
            />
        </label>
    );
}

function CardHeader({ icon, title, children }) {
    return (
        <div className="min-w-0">
            <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                {icon}
                {title}
            </h4>
            {children}
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function ExportCard() {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const reset = useCallback(() => {
        setOpen(false);
        setPassphrase('');
        setConfirm('');
        setAcknowledged(false);
        setError('');
    }, []);

    const submit = useCallback(async (event) => {
        event.preventDefault();
        if (busy) return;

        if (passphrase.length < MIN_PASSPHRASE) {
            setError(t('settings.backup.tooShort', { count: MIN_PASSPHRASE }));
            return;
        }
        if (passphrase !== confirm) {
            setError(t('settings.backup.mismatch'));
            return;
        }

        setBusy(true);
        setError('');
        try {
            const result = await window.api.backup.export(passphrase);

            // The user closed the save dialog; that is not an error worth saying.
            if (result?.canceled) return;

            if (!result?.success) {
                setError(result?.message || t('settings.backup.exportFailed'));
                return;
            }

            const { hosts, keys, snippets } = result.counts;
            toast.success(
                t('settings.backup.exported', {
                    hosts: t('hosts.count', { count: hosts }),
                    keys: t('keychain.count', { count: keys }),
                    snippets: t('snippets.count', { count: snippets }),
                }),
                toastOptions()
            );
            reset();
        } catch (caught) {
            setError(caught?.message || t('settings.backup.exportFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, passphrase, confirm, reset, t]);

    return (
        <SettingCard>
            <div className="flex items-start justify-between gap-4">
                <CardHeader
                    icon={<Download04Icon size={18} strokeWidth={2} className="text-gray-400" />}
                    title={t('settings.backup.exportTitle')}
                >
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t('settings.backup.exportDesc')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        {t('settings.backup.exportNote')}
                    </p>
                </CardHeader>

                {!open && (
                    <button onClick={() => setOpen(true)} className={`${PRIMARY_BUTTON} shrink-0`}>
                        {t('settings.backup.create')}
                    </button>
                )}
            </div>

            {open && (
                <form
                    onSubmit={submit}
                    className="mt-5 pt-5 border-t border-gray-200 dark:border-neutral-700 flex flex-col gap-3"
                >
                    <Field
                        label={t('settings.backup.passphrase')}
                        value={passphrase}
                        onChange={setPassphrase}
                        autoFocus
                        autoComplete="new-password"
                    />
                    <Field
                        label={t('settings.backup.confirmPassphrase')}
                        value={confirm}
                        onChange={setConfirm}
                        autoComplete="new-password"
                    />

                    <Checkbox
                        variant="card"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                        label={t('settings.backup.acknowledge')}
                        description={t('settings.backup.acknowledgeDesc')}
                    />

                    {error && <p className="text-xs text-red-500">{error}</p>}

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                            {t('common.cancel')}
                        </button>
                        <button type="submit" disabled={busy || !acknowledged} className={PRIMARY_BUTTON}>
                            {busy ? t('common.working') : t('settings.backup.chooseLocation')}
                        </button>
                    </div>
                </form>
            )}
        </SettingCard>
    );
}

/* ------------------------------------------------------------------ *
 * Restore
 * ------------------------------------------------------------------ */

const CATEGORY_LABELS = [
    ['hosts', 'nav.hosts'],
    ['folders', 'settings.backup.folders'],
    ['keys', 'settings.backup.keys'],
    ['snippets', 'nav.snippets'],
    ['proxies', 'nav.proxies'],
];

/** What the chosen file holds, and how much of it this machine already has. */
function RestoreSummary({ report, overwrite }) {
    const t = useT();

    const rows = CATEGORY_LABELS
        .map(([key, labelKey]) => [key, t(labelKey), report.summary?.[key]])
        .filter(([, , counts]) => counts?.total > 0);

    const created = report.createdAt
        ? formatDateTime(report.createdAt)
        : t('settings.backup.unknownDate');

    return (
        <div className="rounded-xl border border-gray-200 dark:border-surface-control overflow-hidden">
            <div className="px-3 h-10 flex items-center gap-2 border-b border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base/60">
                <ArchiveIcon size={15} strokeWidth={2} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t('settings.backup.from', { when: created })}
                </span>
                {report.appVersion && (
                    <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                        {t('settings.backup.appVersion', { version: report.appVersion })}
                    </span>
                )}
            </div>

            <div className="divide-y divide-gray-100 dark:divide-surface-control">
                {rows.length === 0 && (
                    <p className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                        {t('settings.backup.emptyFile')}
                    </p>
                )}
                {rows.map(([key, label, counts]) => (
                    <div key={key} className="px-3 py-2 flex items-center gap-3 text-sm">
                        <span className="text-gray-700 dark:text-gray-300 w-24 shrink-0">{label}</span>
                        <span className="text-gray-900 dark:text-white font-medium">
                            {counts.total}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                            {t('settings.backup.newCount', { count: counts.new })}
                            {counts.existing > 0 && (
                                <> · {overwrite
                                    ? t('settings.backup.existingReplaced', { count: counts.existing })
                                    : t('settings.backup.existingSkipped', { count: counts.existing })}</>
                            )}
                        </span>
                    </div>
                ))}
                {report.knownHosts > 0 && (
                    <div className="px-3 py-2 flex items-center gap-3 text-sm">
                        <span className="text-gray-700 dark:text-gray-300 w-24 shrink-0">
                            {t('settings.backup.trustedKeys')}
                        </span>
                        <span className="text-gray-900 dark:text-white font-medium">{report.knownHosts}</span>
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                            {t('settings.backup.hostWord', { count: report.knownHosts })}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

function RestoreCard({ onRestored }) {
    const t = useT();
    const [filePath, setFilePath] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [report, setReport] = useState(null);
    const [overwrite, setOverwrite] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const reset = useCallback(() => {
        // Tell main to drop the decrypted payload rather than leaving it held
        // until the window closes.
        if (report?.token) window.api.backup.discard(report.token).catch(() => {});
        setFilePath('');
        setPassphrase('');
        setReport(null);
        setOverwrite(false);
        setError('');
    }, [report]);

    const choose = useCallback(async () => {
        setError('');
        try {
            const result = await window.api.dialog.open({
                title: t('settings.backup.openTitle'),
                properties: ['openFile'],
                filters: [
                    { name: t('settings.backup.fileKind'), extensions: ['cbbackup'] },
                    { name: t('common.allFiles'), extensions: ['*'] },
                ],
            });
            if (result?.canceled || !result?.filePaths?.length) return;
            setFilePath(result.filePaths[0]);
            setReport(null);
            setPassphrase('');
        } catch {
            setError(t('settings.backup.pickerFailed'));
        }
    }, [t]);

    const unlock = useCallback(async (event) => {
        event.preventDefault();
        if (busy || !filePath) return;

        setBusy(true);
        setError('');
        try {
            const result = await window.api.backup.inspect(passphrase, filePath);
            if (result?.canceled) return;
            if (!result?.success) {
                setError(result?.message || t('settings.backup.openFailed'));
                return;
            }
            setReport(result);
            // Held only as long as it takes to decrypt; the payload lives in main.
            setPassphrase('');
        } catch (caught) {
            setError(caught?.message || t('settings.backup.openFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, filePath, passphrase, t]);

    const apply = useCallback(async () => {
        if (busy || !report?.token) return;

        setBusy(true);
        setError('');
        try {
            const result = await window.api.backup.restore(report.token, overwrite);
            if (!result?.success) {
                setError(result?.message || t('settings.backup.restoreFailed'));
                return;
            }

            // A collection older builds did not write is missing from their
            // report, so every count is read defensively rather than assumed.
            const total = (field) => CATEGORY_LABELS
                .reduce((sum, [key]) => sum + (result[key]?.[field] || 0), 0);

            const added = total('added');
            const replaced = total('replaced');

            toast.success(
                replaced > 0
                    ? t('settings.backup.restoredAndReplaced', { count: added, replaced })
                    : t('settings.backup.restored', { count: added }),
                toastOptions()
            );

            if (result.knownHosts?.duplicateTypes > 0) {
                toast(
                    t('settings.backup.duplicateKeys', { count: result.knownHosts.duplicateTypes }),
                    toastOptions()
                );
            }

            setFilePath('');
            setPassphrase('');
            setReport(null);
            setOverwrite(false);
            onRestored?.();
        } catch (caught) {
            setError(caught?.message || t('settings.backup.restoreFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, report, overwrite, onRestored, t]);

    return (
        <SettingCard>
            <div className="flex items-start justify-between gap-4">
                <CardHeader
                    icon={<Upload04Icon size={18} strokeWidth={2} className="text-gray-400" />}
                    title={t('settings.backup.restoreTitle')}
                >
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t('settings.backup.restoreDesc')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        {t('settings.backup.restoreNote')}
                    </p>
                </CardHeader>

                {!filePath && (
                    <button onClick={choose} className={`${SECONDARY_BUTTON} shrink-0`}>
                        {t('settings.backup.chooseFile')}
                    </button>
                )}
            </div>

            {filePath && (
                <div className="mt-5 pt-5 border-t border-gray-200 dark:border-neutral-700 flex flex-col gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-400 dark:text-neutral-500 shrink-0">
                            {t('settings.backup.file')}
                        </span>
                        <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
                            {filePath}
                        </span>
                        <button
                            onClick={choose}
                            className="ml-auto shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                            {t('common.change')}
                        </button>
                    </div>

                    {!report ? (
                        <form onSubmit={unlock} className="flex flex-col gap-3">
                            <Field
                                label={t('settings.backup.passphrase')}
                                value={passphrase}
                                onChange={setPassphrase}
                                autoFocus
                                autoComplete="current-password"
                            />
                            {error && <p className="text-xs text-red-500">{error}</p>}
                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                                    {t('common.cancel')}
                                </button>
                                <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                                    {busy ? t('settings.backup.opening') : t('settings.backup.open')}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <>
                            <RestoreSummary report={report} overwrite={overwrite} />

                            <Checkbox
                                variant="card"
                                checked={overwrite}
                                onChange={(event) => setOverwrite(event.target.checked)}
                                label={t('settings.backup.overwrite')}
                                description={t('settings.backup.overwriteDesc')}
                            />

                            {overwrite && (
                                <p className="text-xs text-amber-600 dark:text-amber-500 flex items-start gap-1.5">
                                    <Alert02Icon size={14} strokeWidth={2} className="shrink-0 mt-px" />
                                    {t('settings.backup.overwriteWarning')}
                                </p>
                            )}

                            {error && <p className="text-xs text-red-500">{error}</p>}

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                                    {t('common.cancel')}
                                </button>
                                <button onClick={apply} disabled={busy} className={PRIMARY_BUTTON}>
                                    {busy ? t('settings.backup.restoring') : t('settings.backup.restore')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </SettingCard>
    );
}

/**
 * Export and restore, above the OpenSSH import on the Backup page.
 *
 * Separate from ImportSection on purpose: that one reads someone else's format
 * and can only ever bring in part of a setup, while this round-trips everything
 * this app holds, including the secrets, which is what makes it a backup rather
 * than an import.
 */
export default function BackupSection({ onRestored }) {
    return (
        <>
            <ExportCard />
            <RestoreCard onRestored={onRestored} />
        </>
    );
}
