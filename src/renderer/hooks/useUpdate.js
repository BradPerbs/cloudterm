import { useCallback, useEffect, useState } from 'react';

/**
 * The release state, read by the bell in the title bar and by the About page.
 *
 * Both are mounted at once and both want the same answer, so both subscribe to
 * the same push from main rather than polling: pressing "Check for updates" in
 * Settings has to clear or light up a dot in a title bar that never asked, and
 * a download nobody started has to reach both without either having asked.
 *
 * `null` means "not read yet" and is distinct from a status saying there is no
 * update, which is what stops the button flashing "Up to date" on first paint.
 *
 * `status.mode` is the thing every caller has to read before wording anything.
 * In `install` an update is fetched and applied by a restart; in `notify` the
 * app can only point at a file in a browser. Labelling the second like the
 * first would promise an install that never happens.
 */
export default function useUpdate() {
    const [status, setStatus] = useState(null);

    useEffect(() => {
        let alive = true;

        window.api.updates.status()
            .then(next => {
                if (alive) setStatus(next);
            })
            .catch(() => {
                // Main answers with a status even when the check failed, so the
                // only way here is the app going away mid-call.
            });

        const off = window.api.updates.onState(next => setStatus(next));

        return () => {
            alive = false;
            off();
        };
    }, []);

    /**
     * Resolves with `{ success, message, status }`. The message is the half the
     * subscription cannot carry: "try again in 12 minutes" belongs to the
     * person who pressed the button, not to every window watching the state.
     */
    const check = useCallback(async () => {
        const result = await window.api.updates.check();
        setStatus(result.status);
        return result;
    }, []);

    // Main dismisses the version as it opens the link, and the resulting push
    // is what clears the dot here. Only in notify mode: an install still owed a
    // restart keeps its dot.
    const open = useCallback(() => window.api.updates.open(), []);

    /** The retry, for a download that failed. Same shape as `check`. */
    const download = useCallback(async () => {
        const result = await window.api.updates.download();
        setStatus(result.status);
        return result;
    }, []);

    /**
     * Deliberately not awaited anywhere useful. Main closes the app a tick
     * after answering, so the only thing past this point is the installer.
     */
    const install = useCallback(() => window.api.updates.install(), []);

    return { status, check, open, download, install };
}
