import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Delay before each retry. Short at first, since most drops are a blip, then
 * backing off so a server that is genuinely down is not hammered.
 */
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

/** Give up after this many consecutive failures and wait for the user. */
const MAX_ATTEMPTS = 6;

const ANSI = {
    warn: (text) => `\r\n\x1b[1;33m>> ${text}\x1b[0m`,
    error: (text) => `\r\n\x1b[1;31m>> ${text}\x1b[0m`,
    good: (text) => `\r\n\x1b[1;32m>> ${text}\x1b[0m`,
    dim: (text) => `\r\n\x1b[2m>> ${text}\x1b[0m`,
};

/**
 * Owns one tab's SSH session: the initial dial, and getting back on after a
 * drop.
 *
 * Retries only ever follow a session that was actually established. A failed
 * first dial is left alone, since an authentication failure is not worth repeating,
 * and with password auth repeating it can lock the account out.
 *
 *   connecting    first dial in flight
 *   connected     up
 *   reconnecting  retry dial in flight
 *   waiting       counting down to the next retry
 *   failed        out of attempts, or the first dial failed
 *   closed        the user disconnected on purpose
 */
export function useSshConnection({ tabId, hostId, getGeometry, write, onResult }) {
    const [status, setStatus] = useState('connecting');
    const [attempt, setAttempt] = useState(0);
    const [retryIn, setRetryIn] = useState(0);

    /**
     * The phase, readable synchronously. React state lands a render later, and
     * the drop handler below has to make a decision the instant an event
     * arrives. One render of lag is enough to mistake a dial that is already
     * failing for a fresh drop.
     */
    const phaseRef = useRef('connecting');
    const setPhase = useCallback((next) => {
        phaseRef.current = next;
        setStatus(next);
    }, []);

    // Only a session that came up is worth chasing after a wake.
    const establishedRef = useRef(false);
    const attemptRef = useRef(0);
    const disposedRef = useRef(false);

    const retryTimer = useRef(null);
    const countdownTimer = useRef(null);
    // `dial` and `scheduleRetry` call each other; the ref breaks the cycle
    // without either of them having to be rebuilt on every render.
    const dialRef = useRef(null);

    // Kept in refs so the callbacks below never need to be rebuilt.
    const callbacks = useRef({ getGeometry, write, onResult });
    callbacks.current = { getGeometry, write, onResult };

    const clearTimers = useCallback(() => {
        clearTimeout(retryTimer.current);
        clearInterval(countdownTimer.current);
        retryTimer.current = null;
        countdownTimer.current = null;
        setRetryIn(0);
    }, []);

    useEffect(() => {
        // Mounting has to undo a previous unmount's disposal. StrictMode mounts,
        // unmounts and mounts again in development, and a `disposed` flag that
        // only ever latches true would leave the second (real) mount throwing
        // away the result of its own dial: the session comes up, but the status
        // never leaves "connecting" and nothing that waits on it ever unlocks.
        disposedRef.current = false;

        return () => {
            disposedRef.current = true;
            clearTimeout(retryTimer.current);
            clearInterval(countdownTimer.current);
        };
    }, []);

    const scheduleRetry = useCallback((reason) => {
        // Never stack timers: a second one would double the dial rate and the
        // countdown would tick twice as fast.
        clearTimers();

        attemptRef.current += 1;
        setAttempt(attemptRef.current);

        const delay = BACKOFF[Math.min(attemptRef.current - 1, BACKOFF.length - 1)];
        const seconds = Math.round(delay / 1000);

        setPhase('waiting');
        setRetryIn(seconds);

        callbacks.current.write(ANSI.warn(
            `${reason || 'Connection lost'}. Reconnecting in ${seconds}s `
            + `(attempt ${attemptRef.current} of ${MAX_ATTEMPTS})`
        ));

        countdownTimer.current = setInterval(() => {
            setRetryIn(value => (value > 0 ? value - 1 : 0));
        }, 1000);

        retryTimer.current = setTimeout(() => {
            clearInterval(countdownTimer.current);
            dialRef.current?.({ reconnect: true });
        }, delay);
    }, [clearTimers, setPhase]);

    const dial = useCallback(async ({ reconnect }) => {
        clearTimers();
        setPhase(reconnect ? 'reconnecting' : 'connecting');

        const { cols, rows } = callbacks.current.getGeometry() || {};
        const result = await window.api.ssh.connect({ tabId, hostId, cols, rows });

        if (disposedRef.current) return result;

        if (result.success) {
            establishedRef.current = true;
            attemptRef.current = 0;
            setAttempt(0);
            setPhase('connected');
            if (reconnect) callbacks.current.write(ANSI.good('Reconnected'));
            callbacks.current.onResult?.(result, { reconnect });
            return result;
        }

        // A retry that failed goes back on the clock rather than reporting up:
        // one toast per attempt would be six toasts for one dropped link.
        if (reconnect && attemptRef.current < MAX_ATTEMPTS) {
            scheduleRetry(result.message);
            return result;
        }

        setPhase('failed');
        callbacks.current.write(ANSI.error(result.message || 'Connection failed'));
        callbacks.current.onResult?.(result, { reconnect });
        return result;
    }, [tabId, hostId, clearTimers, setPhase, scheduleRetry]);

    dialRef.current = dial;

    /** First dial for this tab. */
    const connect = useCallback(() => dialRef.current?.({ reconnect: false }), []);

    /**
     * The session went away.
     *
     * Only meaningful while we believe we are connected. Everything else that
     * reports a close is noise we already know about: the stream and the client
     * both close on one drop, a dial that fails closes its own client, and
     * reconnecting tears the previous session down on purpose. Each of those
     * would otherwise look like a fresh drop and reset the backoff.
     */
    const handleDropped = useCallback(() => {
        if (disposedRef.current || phaseRef.current !== 'connected') return;

        attemptRef.current = 0;
        scheduleRetry('Connection closed by remote host');
    }, [scheduleRetry]);

    const disconnect = useCallback(() => {
        clearTimers();
        setPhase('closed');
        callbacks.current.write(ANSI.dim('Disconnected'));
        window.api.ssh.disconnect(tabId);
    }, [tabId, clearTimers, setPhase]);

    const reconnectNow = useCallback(() => {
        attemptRef.current = 0;
        setAttempt(0);
        clearTimers();
        dialRef.current?.({ reconnect: true });
    }, [clearTimers]);

    /**
     * Waking from sleep or regaining the network is the moment a retry is most
     * likely to work, so skip the remaining countdown and try immediately.
     */
    useEffect(() => {
        const wake = () => {
            if (!establishedRef.current) return;
            if (phaseRef.current !== 'waiting' && phaseRef.current !== 'failed') return;
            reconnectNow();
        };

        const offResume = window.api.system.onResume(wake);
        window.addEventListener('online', wake);

        return () => {
            offResume();
            window.removeEventListener('online', wake);
        };
    }, [reconnectNow]);

    return {
        status,
        attempt,
        retryIn,
        maxAttempts: MAX_ATTEMPTS,
        connect,
        handleDropped,
        disconnect,
        reconnectNow,
    };
}
