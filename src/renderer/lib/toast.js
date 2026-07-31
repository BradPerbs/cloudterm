import { currentAppColor } from './app-colors';

/**
 * Toast chrome that follows the app theme, resolved at call time.
 *
 * The dark colours are read off the document rather than written here, so a
 * custom palette reaches the toasts too; a bubble in last year's navy over a
 * green app is exactly the sort of thing a themeable shell must not do.
 */
export function toastStyle() {
    const isDark = document.documentElement.classList.contains('dark');
    return {
        borderRadius: '12px',
        padding: '12px 16px',
        // Inherited rather than restated, so the toasts keep whatever stack the
        // shell is set to instead of drifting out of step with it.
        fontFamily: 'inherit',
        fontSize: '14px',
        maxWidth: '32rem',
        background: isDark ? currentAppColor('raised') : '#fff',
        color: isDark ? '#fafafa' : '#111827',
        border: `1px solid ${isDark ? currentAppColor('control') : '#e5e7eb'}`,
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    };
}

/**
 * How long a toast stays up, in milliseconds.
 *
 * DEFAULT is what a call gets when it does not ask for anything: long enough to
 * read "Key saved" and no longer. MAX is the ceiling every explicit duration is
 * clamped to, because call sites had drifted up to eight seconds, which parks a
 * bubble over the bottom-right corner of the app well after the thing it
 * reports is finished with. Tune the two numbers here rather than at the sixty
 * or so call sites.
 */
export const DEFAULT_TOAST_MS = 1000;
export const MAX_TOAST_MS = 1500;

/**
 * How long a dismissed toast stays mounted while it fades out. The library's
 * own default is a second, which holds the corner (and the position of any
 * toast stacked above it) long after the bubble has finished animating away.
 * The exit animation runs for 0.4s, so this is the whole of it and no more.
 */
export const TOAST_EXIT_MS = 400;

export const toastOptions = (extra = {}) => {
    const { duration = DEFAULT_TOAST_MS, ...rest } = extra;
    return {
        style: toastStyle(),
        ...rest,
        duration: typeof duration === 'number' ? Math.min(duration, MAX_TOAST_MS) : duration,
    };
};
