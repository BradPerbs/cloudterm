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

export const toastOptions = (extra = {}) => ({ style: toastStyle(), ...extra });
