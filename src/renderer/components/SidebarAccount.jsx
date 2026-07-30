import { memo, useCallback, useEffect, useState } from 'react';
import { UserCircleIcon } from 'hugeicons-react';

/**
 * Who is signed in, at the foot of the sidebar.
 *
 * Clicking it goes to Settings → Account rather than opening a menu of its own:
 * everything you would want to do from here already lives on that page, and a
 * second place to disconnect is a second place to keep in step.
 */

const initial = (account) => {
    const source = account?.name || account?.email || '';
    return source.trim().charAt(0).toUpperCase() || '?';
};

function SidebarAccount({ onNavChange }) {
    const [status, setStatus] = useState(null);

    useEffect(() => {
        window.api.account.status().then(setStatus);
    }, []);

    // Signing in happens on the settings page, not here.
    useEffect(() => window.api.account.onState(setStatus), []);

    const open = useCallback(() => {
        // The settings panel picks its page up from here when it mounts.
        localStorage.setItem('settings.category', 'account');
        onNavChange('settings');
    }, [onNavChange]);

    if (!status) return null;

    const label = status.connected
        ? (status.account?.name || status.account?.email || 'CloudBlast account')
        : 'Sign in';

    const sub = status.connected
        ? status.account?.email
        : 'Connect your CloudBlast account';

    return (
        <button
            type="button"
            onClick={open}
            title={status.connected ? `Signed in as ${status.account?.email || label}` : 'Connect CloudBlast'}
            className="mt-auto shrink-0 flex items-center gap-2.5 w-full px-2.5 py-2 rounded-xl text-left
                outline-none transition-colors
                text-gray-600 dark:text-gray-400
                hover:bg-gray-900/[0.04] dark:hover:bg-surface-raised
                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
        >
            {status.connected ? (
                <span
                    aria-hidden="true"
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center
                        text-xs font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                >
                    {initial(status.account)}
                </span>
            ) : (
                <UserCircleIcon size={26} strokeWidth={1.5} className="shrink-0" />
            )}

            <span className="min-w-0 flex-1">
                <span className="block text-sm truncate text-gray-900 dark:text-white">{label}</span>
                {sub && (
                    <span className="block text-[11px] leading-tight truncate text-gray-500 dark:text-gray-500">
                        {sub}
                    </span>
                )}
            </span>
        </button>
    );
}

export default memo(SidebarAccount);
