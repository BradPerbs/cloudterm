import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { LockPasswordIcon } from 'hugeicons-react';
import SettingCard from './ui/SettingCard';
import Checkbox from '../ui/Checkbox';
import ConfirmDialog from '../ui/ConfirmDialog';
import { toastOptions } from '../../lib/toast';

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
            setError('The two passwords do not match');
            return;
        }

        setBusy(true);
        setError('');
        try {
            const result = mode === 'set' ? await window.api.appLock.set(next)
                : mode === 'change' ? await window.api.appLock.change(current, next)
                : await window.api.appLock.disable(current);

            if (!result?.success) {
                setError(result?.message || 'That did not work');
                return;
            }

            toast.success(
                mode === 'set' ? 'Opening password set'
                    : mode === 'change' ? 'Password changed'
                    : 'Opening password removed',
                toastOptions()
            );
            onDone();
        } catch {
            setError('That did not work');
        } finally {
            setBusy(false);
        }
    }, [busy, mode, current, next, confirm, needsNext, onDone]);

    const label = mode === 'set' ? 'Set password' : mode === 'change' ? 'Change password' : 'Remove password';

    return (
        <form onSubmit={submit} className="mt-5 pt-5 border-t border-gray-200 dark:border-neutral-700 flex flex-col gap-3">
            {needsCurrent && (
                <Field
                    label="Current password"
                    value={current}
                    onChange={setCurrent}
                    autoFocus
                    autoComplete="current-password"
                />
            )}
            {needsNext && (
                <>
                    <Field
                        label={mode === 'set' ? 'Password' : 'New password'}
                        value={next}
                        onChange={setNext}
                        autoFocus={!needsCurrent}
                        autoComplete="new-password"
                    />
                    <Field
                        label="Confirm password"
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
                    label="I understand this password cannot be recovered"
                    description="Your saved passwords, keys and passphrases are encrypted with it. Forget it and they cannot be read back, by this app or anything else."
                />
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 h-9 rounded-xl border border-gray-300 dark:border-surface-control text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                >
                    Cancel
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
                    {busy ? 'Working…' : label}
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
                            Opening password
                            {enabled && (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                                    on
                                </span>
                            )}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {enabled
                                ? 'Asked for every time the app opens. Your saved passwords, keys and passphrases are encrypted with it, so the stored file is unreadable without it.'
                                : 'Require a password to open the app, and encrypt your saved passwords, keys and passphrases with it.'}
                        </p>
                        <p className={`text-xs mt-2 ${enabled
                            ? 'text-gray-500 dark:text-gray-400'
                            : 'text-amber-600 dark:text-amber-500'}`}>
                            {enabled
                                ? 'There is no recovery. If you forget this password the saved credentials cannot be read back.'
                                : 'Without it, credentials are protected only by the OS keystore, which means anyone signed in as you can read them.'}
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
                                        Lock now
                                    </button>
                                    <button
                                        onClick={() => setMode('disable')}
                                        className="px-3 h-9 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    >
                                        Remove
                                    </button>
                                    <button
                                        onClick={() => setMode('change')}
                                        className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                                    >
                                        Change
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => setMode('set')}
                                    disabled={enabled === null}
                                    className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-40"
                                >
                                    Set password
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {mode && <LockForm mode={mode} onCancel={() => setMode(null)} onDone={finish} />}
            </SettingCard>

            {confirmLock && (
                <ConfirmDialog
                    title="Lock the app now?"
                    message="Every open session will be disconnected, and the password will be needed to get back in."
                    confirmLabel="Lock"
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
