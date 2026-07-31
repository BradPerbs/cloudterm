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
            setError(`Use at least ${MIN_PASSPHRASE} characters`);
            return;
        }
        if (passphrase !== confirm) {
            setError('The two passphrases do not match');
            return;
        }

        setBusy(true);
        setError('');
        try {
            const result = await window.api.backup.export(passphrase);

            // The user closed the save dialog; that is not an error worth saying.
            if (result?.canceled) return;

            if (!result?.success) {
                setError(result?.message || 'The backup could not be written');
                return;
            }

            const { hosts, keys, snippets } = result.counts;
            toast.success(
                `Backup saved: ${hosts} host${hosts === 1 ? '' : 's'}, `
                + `${keys} key${keys === 1 ? '' : 's'}, ${snippets} snippet${snippets === 1 ? '' : 's'}`,
                toastOptions()
            );
            reset();
        } catch (caught) {
            setError(caught?.message || 'The backup could not be written');
        } finally {
            setBusy(false);
        }
    }, [busy, passphrase, confirm, reset]);

    return (
        <SettingCard>
            <div className="flex items-start justify-between gap-4">
                <CardHeader
                    icon={<Download04Icon size={18} strokeWidth={2} className="text-gray-400" />}
                    title="Export a backup"
                >
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Writes every host, folder, SSH key, snippet, port forward and trusted host
                        key to a single encrypted file, protected by a passphrase you choose here.
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        The passphrase is independent of your opening password, so the file opens on
                        a machine that has never seen this one.
                    </p>
                </CardHeader>

                {!open && (
                    <button onClick={() => setOpen(true)} className={`${PRIMARY_BUTTON} shrink-0`}>
                        Create backup
                    </button>
                )}
            </div>

            {open && (
                <form
                    onSubmit={submit}
                    className="mt-5 pt-5 border-t border-gray-200 dark:border-neutral-700 flex flex-col gap-3"
                >
                    <Field
                        label="Backup passphrase"
                        value={passphrase}
                        onChange={setPassphrase}
                        autoFocus
                        autoComplete="new-password"
                    />
                    <Field
                        label="Confirm passphrase"
                        value={confirm}
                        onChange={setConfirm}
                        autoComplete="new-password"
                    />

                    <Checkbox
                        variant="card"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                        label="I understand this file contains my saved credentials"
                        description="Anyone who has both the file and this passphrase can read every stored password, private key and passphrase in it. Keep it somewhere you would keep the credentials themselves."
                    />

                    {error && <p className="text-xs text-red-500">{error}</p>}

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                            Cancel
                        </button>
                        <button type="submit" disabled={busy || !acknowledged} className={PRIMARY_BUTTON}>
                            {busy ? 'Working…' : 'Choose location…'}
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
    ['hosts', 'Hosts'],
    ['folders', 'Folders'],
    ['keys', 'SSH keys'],
    ['snippets', 'Snippets'],
    ['proxies', 'Proxies'],
];

/** What the chosen file holds, and how much of it this machine already has. */
function RestoreSummary({ report, overwrite }) {
    const rows = CATEGORY_LABELS
        .map(([key, label]) => [label, report.summary?.[key]])
        .filter(([, counts]) => counts?.total > 0);

    const created = report.createdAt
        ? new Date(report.createdAt).toLocaleString()
        : 'an unknown date';

    return (
        <div className="rounded-xl border border-gray-200 dark:border-surface-control overflow-hidden">
            <div className="px-3 h-10 flex items-center gap-2 border-b border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base/60">
                <ArchiveIcon size={15} strokeWidth={2} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    Backup from {created}
                </span>
                {report.appVersion && (
                    <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                        app {report.appVersion}
                    </span>
                )}
            </div>

            <div className="divide-y divide-gray-100 dark:divide-surface-control">
                {rows.length === 0 && (
                    <p className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                        This backup is empty.
                    </p>
                )}
                {rows.map(([label, counts]) => (
                    <div key={label} className="px-3 py-2 flex items-center gap-3 text-sm">
                        <span className="text-gray-700 dark:text-gray-300 w-24 shrink-0">{label}</span>
                        <span className="text-gray-900 dark:text-white font-medium">
                            {counts.total}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                            {counts.new} new
                            {counts.existing > 0 && (
                                <> · {counts.existing} already here, {overwrite ? 'will be replaced' : 'will be skipped'}</>
                            )}
                        </span>
                    </div>
                ))}
                {report.knownHosts > 0 && (
                    <div className="px-3 py-2 flex items-center gap-3 text-sm">
                        <span className="text-gray-700 dark:text-gray-300 w-24 shrink-0">Trusted keys</span>
                        <span className="text-gray-900 dark:text-white font-medium">{report.knownHosts}</span>
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                            host{report.knownHosts === 1 ? '' : 's'}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

function RestoreCard({ onRestored }) {
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
                title: 'Open encrypted backup',
                properties: ['openFile'],
                filters: [
                    { name: 'CloudBlast backup', extensions: ['cbbackup'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            });
            if (result?.canceled || !result?.filePaths?.length) return;
            setFilePath(result.filePaths[0]);
            setReport(null);
            setPassphrase('');
        } catch {
            setError('Could not open the file picker');
        }
    }, []);

    const unlock = useCallback(async (event) => {
        event.preventDefault();
        if (busy || !filePath) return;

        setBusy(true);
        setError('');
        try {
            const result = await window.api.backup.inspect(passphrase, filePath);
            if (result?.canceled) return;
            if (!result?.success) {
                setError(result?.message || 'That backup could not be opened');
                return;
            }
            setReport(result);
            // Held only as long as it takes to decrypt; the payload lives in main.
            setPassphrase('');
        } catch (caught) {
            setError(caught?.message || 'That backup could not be opened');
        } finally {
            setBusy(false);
        }
    }, [busy, filePath, passphrase]);

    const apply = useCallback(async () => {
        if (busy || !report?.token) return;

        setBusy(true);
        setError('');
        try {
            const result = await window.api.backup.restore(report.token, overwrite);
            if (!result?.success) {
                setError(result?.message || 'The restore did not finish');
                return;
            }

            // A collection older builds did not write is missing from their
            // report, so every count is read defensively rather than assumed.
            const total = (field) => CATEGORY_LABELS
                .reduce((sum, [key]) => sum + (result[key]?.[field] || 0), 0);

            const added = total('added');
            const replaced = total('replaced');

            toast.success(
                `Restored ${added} new item${added === 1 ? '' : 's'}`
                + (replaced > 0 ? `, replaced ${replaced}` : ''),
                toastOptions()
            );

            if (result.knownHosts?.duplicateTypes > 0) {
                toast(
                    `${result.knownHosts.duplicateTypes} host${result.knownHosts.duplicateTypes === 1 ? '' : 's'} `
                    + 'now trust more than one key of the same type. Check Security → Known hosts.',
                    toastOptions()
                );
            }

            setFilePath('');
            setPassphrase('');
            setReport(null);
            setOverwrite(false);
            onRestored?.();
        } catch (caught) {
            setError(caught?.message || 'The restore did not finish');
        } finally {
            setBusy(false);
        }
    }, [busy, report, overwrite, onRestored]);

    return (
        <SettingCard>
            <div className="flex items-start justify-between gap-4">
                <CardHeader
                    icon={<Upload04Icon size={18} strokeWidth={2} className="text-gray-400" />}
                    title="Restore a backup"
                >
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Reads a `.cbbackup` file and adds what it holds. You are shown what is in it
                        before anything changes.
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Anything already here is left alone by default, so restoring twice is safe.
                    </p>
                </CardHeader>

                {!filePath && (
                    <button onClick={choose} className={`${SECONDARY_BUTTON} shrink-0`}>
                        Choose file…
                    </button>
                )}
            </div>

            {filePath && (
                <div className="mt-5 pt-5 border-t border-gray-200 dark:border-neutral-700 flex flex-col gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-400 dark:text-neutral-500 shrink-0">File</span>
                        <span className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate">
                            {filePath}
                        </span>
                        <button
                            onClick={choose}
                            className="ml-auto shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                            Change
                        </button>
                    </div>

                    {!report ? (
                        <form onSubmit={unlock} className="flex flex-col gap-3">
                            <Field
                                label="Backup passphrase"
                                value={passphrase}
                                onChange={setPassphrase}
                                autoFocus
                                autoComplete="current-password"
                            />
                            {error && <p className="text-xs text-red-500">{error}</p>}
                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                                    Cancel
                                </button>
                                <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                                    {busy ? 'Opening…' : 'Open backup'}
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
                                label="Replace items that are already here"
                                description="Matches on the record's id, not its name. Leave this off to add only what is missing; turn it on to make this machine match the backup, discarding local edits to those records."
                            />

                            {overwrite && (
                                <p className="text-xs text-amber-600 dark:text-amber-500 flex items-start gap-1.5">
                                    <Alert02Icon size={14} strokeWidth={2} className="shrink-0 mt-px" />
                                    Local changes to the matching records will be lost.
                                </p>
                            )}

                            {error && <p className="text-xs text-red-500">{error}</p>}

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                                    Cancel
                                </button>
                                <button onClick={apply} disabled={busy} className={PRIMARY_BUTTON}>
                                    {busy ? 'Restoring…' : 'Restore'}
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
