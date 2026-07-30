import { useCallback, useEffect, useState } from 'react';

/**
 * The release notice, read by the bell in the title bar and by the About page.
 *
 * Both are mounted at once and both want the same answer, so both subscribe to
 * the same push from main rather than polling: pressing "Check for updates" in
 * Settings has to clear or light up a dot in a title bar that never asked.
 *
 * `null` means "not read yet" and is distinct from a status saying there is no
 * update, which is what stops the button flashing "Up to date" on first paint.
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
    // is what clears the dot here.
    const open = useCallback(() => window.api.updates.open(), []);

    return { status, check, open };
}
