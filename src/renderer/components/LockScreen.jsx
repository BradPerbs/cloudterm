import { useCallback, useEffect, useRef, useState } from 'react';
import { LockPasswordIcon, ViewIcon, ViewOffSlashIcon } from 'hugeicons-react';
import useEnter from '../hooks/useEnter';
import { APP_GUTTER } from '../lib/layout';

/**
 * Shown instead of the app when an opening password is set.
 *
 * This is the visible half of the lock; the enforcing half is in the main
 * process, which refuses every host, key and session channel until `unlock`
 * succeeds. So this screen cannot be stepped around to reach anything, it can
 * only be stepped around to reach an app with no data in it.
 */
export default function LockScreen({ onUnlocked }) {
    const [password, setPassword] = useState('');
    const [reveal, setReveal] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);

    /** The card fades up rather than being there. See lib/enterMotion. */
    const formRef = useEnter('fade');

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const submit = useCallback(async (event) => {
        event.preventDefault();
        if (busy || !password) return;

        setBusy(true);
        setError('');
        try {
            const result = await window.api.appLock.unlock(password);
            if (result?.success) {
                setPassword('');
                onUnlocked();
                return;
            }
            setError(result?.message || 'Incorrect password');
            setPassword('');
            inputRef.current?.focus();
        } catch {
            setError('Could not check the password');
        } finally {
            setBusy(false);
        }
    }, [busy, password, onUnlocked]);

    return (
        // The gutter is draggable so the frameless window can still be moved
        // while locked; there is no title bar on this screen to grab.
        <div
            className="h-full flex items-center justify-center bg-gray-100 dark:bg-surface-base app-drag"
            style={{ padding: APP_GUTTER }}
        >
            <form ref={formRef} onSubmit={submit} className="app-no-drag w-full max-w-[16rem] flex flex-col items-center">
                {/* The whole heading is this mark: no app name, no instruction. */}
                <LockPasswordIcon size={30} strokeWidth={1.5} className="text-gray-900 dark:text-white" />

                <div className="relative w-full mt-8">
                    <input
                        ref={inputRef}
                        type={reveal ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => {
                            setPassword(event.target.value);
                            if (error) setError('');
                        }}
                        disabled={busy}
                        autoComplete="current-password"
                        spellCheck={false}
                        placeholder="Password"
                        aria-label="Password"
                        aria-invalid={Boolean(error)}
                        // Padded equally on both sides so the text stays centred
                        // under the icon despite the reveal button on the right.
                        className={`w-full h-11 px-11 text-center rounded-xl border bg-white dark:bg-surface-raised
                            text-gray-900 dark:text-white text-sm tracking-wide outline-none
                            transition-colors duration-150
                            placeholder:tracking-normal placeholder:text-gray-400 dark:placeholder:text-neutral-500
                            disabled:opacity-60
                            ${error
                                ? 'border-red-400/80 dark:border-red-500/60'
                                : 'border-gray-200 dark:border-surface-control'
                            }`}
                    />
                    <button
                        type="button"
                        onClick={() => setReveal(value => !value)}
                        tabIndex={-1}
                        aria-label={reveal ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-white transition-colors"
                    >
                        {reveal
                            ? <ViewOffSlashIcon size={15} strokeWidth={1.8} />
                            : <ViewIcon size={15} strokeWidth={1.8} />}
                    </button>
                </div>

                {/* Reserved height, so a wrong answer does not shift the form. */}
                <p
                    role="alert"
                    className={`w-full mt-2.5 min-h-[1rem] text-center text-[11px] ${error ? 'text-red-500' : 'text-transparent'}`}
                >
                    {error || 'placeholder'}
                </p>

                <button
                    type="submit"
                    disabled={busy || !password}
                    className="w-full mt-1.5 h-11 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-medium text-sm tracking-wide hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                    {busy ? 'Checking…' : 'Unlock'}
                </button>

                <p className="mt-10 text-[10.5px] leading-relaxed text-gray-400/90 dark:text-neutral-500 text-center text-balance">
                    There is no way to recover this password. Without it the app cannot be opened.
                </p>
            </form>
        </div>
    );
}
