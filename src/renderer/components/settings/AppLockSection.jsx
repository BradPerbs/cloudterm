import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { LockPasswordIcon } from 'hugeicons-react';
import SettingCard from './ui/SettingCard';
import Checkbox from '../ui/Checkbox';
import ConfirmDialog from '../ui/ConfirmDialog';
import { toastOptions } from '../../lib/toast';
import { useT } from '../../i18n';

function Field({ label, value, onChange, autoFocus = false, ...rest }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
            <input
                type="password"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoFocus={autoFocus}
                spellCheck={false}
                className="h-9 px-3 rounded-xl border border-gray-200 dark:border-surface-control bg-white dark:bg-surface-base text-gray-900 dark:text-white text-sm outline-none focus:border-gray-400 dark:focus:border-neutral-600 transition-colors"
                {...rest}
            />
        </label>
    );
}

/**
 * The three states this can be in are different enough to be separate forms
 * rather than one with conditional fields: setting a first password, changing
 * one, and removing one each ask for a different set of things.
 */
function LockForm({ mode, onCancel, onDone }) {
    const t = useT();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const needsCurrent = mode !== 'set';
    const needsNext = mode !== 'disable';
    // Only on first set. Changing keeps the same data key, and removing gives
    // up protection rather than risking anything.
    const needsAcknowledgement = mode === 'set';

    const submit = useCallback(async (event) => {
        event.preventDefault();
        if (busy) return;

        if (needsNext && next !== confirm) {
            setError(t('settings.lock.mismatch'));
            return;
        }

        setBusy(true);
        setError('');
        try {
            const result = mode === 'set' ? await window.api.appLock.set(next)
                : mode === 'change' ? await window.api.appLock.change(current, next)
                : await window.api.appLock.disable(current);

            if (!result?.success) {
                setError(result?.message || t('settings.lock.failed'));
                return;
            }

            toast.success(
                mode === 'set' ? t('settings.lock.passwordSet')
                    : mode === 'change' ? t('settings.lock.passwordChanged')
                    : t('settings.lock.passwordRemoved'),
                toastOptions()
            );
            onDone();
        } catch {
            setError(t('settings.lock.failed'));
        } finally {
            setBusy(false);
        }
    }, [busy, mode, current, next, confirm, needsNext, onDone, t]);

    const label = mode === 'set' ? t('settings.lock.setPassword')
        : mode === 'change' ? t('settings.lock.changePassword')
        : t('settings.lock.removePassword');

    return (
        <form onSubmit={submit} className="mt-5 pt-5 border-t border-gray-200 dark:border-neutral-700 flex flex-col gap-3">
            {needsCurrent && (
                <Field
                    label={t('settings.lock.currentPassword')}
                    value={current}
                    onChange={setCurrent}
                    autoFocus
                    autoComplete="current-password"
                />
            )}
            {needsNext && (
                <>
                    <Field
                        label={mode === 'set' ? t('settings.lock.password') : t('settings.lock.newPassword')}
                        value={next}
                        onChange={setNext}
                        autoFocus={!needsCurrent}
                        autoComplete="new-password"
                    />
                    <Field
                        label={t('settings.lock.confirmPassword')}
                        value={confirm}
                        onChange={setConfirm}
                        autoComplete="new-password"
                    />
                </>
            )}

            {needsAcknowledgement && (
                <Checkbox
                    variant="card"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    label={t('settings.lock.acknowledge')}
                    description={t('settings.lock.acknowledgeDesc')}
                />
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 h-9 rounded-xl border border-gray-300 dark:border-surface-control text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                >
                    {t('common.cancel')}
                </button>
                <button
                    type="submit"
                    disabled={busy || (needsAcknowledgement && !acknowledged)}
                    className={`px-4 h-9 rounded-xl font-semibold text-sm shadow-md active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        mode === 'disable'
                            ? 'bg-red-600 text-white hover:bg-red-500'
                            : 'bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90'
                    }`}
                >
                    {busy ? t('common.working') : label}
                </button>
            </div>
        </form>
    );
}

/**
 * Opening password. Enforced in the main process, which refuses every host, key
 * and session channel while locked, so this is a real gate rather than a screen
 * in front of an app that is already holding the data.
 */
export default function AppLockSection() {
    const t = useT();
    const [enabled, setEnabled] = useState(null);
    const [mode, setMode] = useState(null); // 'set' | 'change' | 'disable'
    const [confirmLock, setConfirmLock] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const status = await window.api.appLock.status();
            setEnabled(Boolean(status?.enabled));
        } catch {
            setEnabled(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const finish = useCallback(() => {
        setMode(null);
        refresh();
    }, [refresh]);

    return (
        <>
            <SettingCard>
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <LockPasswordIcon size={18} strokeWidth={2} className="text-gray-400" />
                            {t('settings.lock.title')}
                            {enabled && (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                                    {t('settings.lock.badgeOn')}
                                </span>
                            )}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {enabled ? t('settings.lock.descOn') : t('settings.lock.descOff')}
                        </p>
                        <p className={`text-xs mt-2 ${enabled
                            ? 'text-gray-500 dark:text-gray-400'
                            : 'text-amber-600 dark:text-amber-500'}`}>
                            {enabled ? t('settings.lock.warnOn') : t('settings.lock.warnOff')}
                        </p>
                    </div>

                    {mode === null && (
                        <div className="flex items-center gap-2 shrink-0">
                            {enabled ? (
                                <>
                                    <button
                                        onClick={() => setConfirmLock(true)}
                                        className="px-3 h-9 rounded-xl border border-gray-300 dark:border-surface-control text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                                    >
                                        {t('settings.lock.lockNow')}
                                    </button>
                                    <button
                                        onClick={() => setMode('disable')}
                                        className="px-3 h-9 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    >
                                        {t('common.remove')}
                                    </button>
                                    <button
                                        onClick={() => setMode('change')}
                                        className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                                    >
                                        {t('common.change')}
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => setMode('set')}
                                    disabled={enabled === null}
                                    className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-40"
                                >
                                    {t('settings.lock.setPassword')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {mode && <LockForm mode={mode} onCancel={() => setMode(null)} onDone={finish} />}
            </SettingCard>

            {confirmLock && (
                <ConfirmDialog
                    title={t('settings.lock.confirmTitle')}
                    message={t('settings.lock.confirmMessage')}
                    confirmLabel={t('settings.lock.confirmAction')}
                    onCancel={() => setConfirmLock(false)}
                    onConfirm={() => {
                        setConfirmLock(false);
                        window.api.appLock.lock();
                    }}
                />
            )}
        </>
    );
}
