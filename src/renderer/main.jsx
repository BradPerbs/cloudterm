import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import LockScreen from './components/LockScreen';
import ScreenshotView from './components/ScreenshotView';
import { applyAppColors } from './lib/app-colors';

// Self-hosted fonts, no CDN, so the app works offline and the CSP can stay closed.
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// Every weight the terminal's font-weight setting can be set to. A weight with
// no face behind it is synthesised by the browser, which on a monospaced font
// means smeared stems and a cell that no longer measures the same as its
// neighbours, so the range offered in Settings and the faces bundled here have
// to agree. See LIMITS.fontWeight in useTerminalSettings.
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';

import './input.css';

// Resolve the theme before React's first render. useTheme applies it from an
// effect, which lands *after* the first paint. Anything reading the class
// during render would otherwise see light mode and bake in the wrong colours.
(() => {
    const stored = localStorage.getItem('theme') || 'system';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle(
        'dark',
        stored === 'dark' || stored === 'custom' || (stored === 'system' && prefersDark)
    );

    // The custom theme's colours too, and for the same reason: they are what
    // that theme *is*, so the first paint has to already be in them.
    if (stored !== 'custom') return;
    try {
        applyAppColors(JSON.parse(localStorage.getItem('appColors') || 'null'));
    } catch {
        // An unreadable palette leaves the variables at the app's own colours,
        // which is a working app rather than a half-painted one.
    }
})();

// Screenshot viewers are separate BrowserWindows loading this same bundle;
// the hash tells us which capture to show instead of the main app.
const screenshotId = new URLSearchParams(window.location.hash.slice(1)).get('screenshot');

/**
 * Holds the app behind the lock screen.
 *
 * App is not merely hidden while locked, it is not mounted: mounting it would
 * load hosts and keys and reconnect the previous run's sessions, which is the
 * work the password exists to hold back. Main would refuse those calls anyway,
 * so this keeps the renderer from firing a burst of rejected ones.
 */
function Root() {
    const [locked, setLocked] = useState(null); // null while the status is unknown

    useEffect(() => {
        window.api.appLock.status()
            .then(status => setLocked(Boolean(status?.locked)))
            // No status means no lock to satisfy; failing open here matches the
            // module, which treats an unreadable lock file as unset.
            .catch(() => setLocked(false));
    }, []);

    // Re-locking from Settings unmounts App, dropping its tabs with it. The
    // sessions behind them are already torn down in main.
    useEffect(() => window.api.appLock.onLocked?.(() => setLocked(true)), []);

    const unlock = useCallback(() => setLocked(false), []);

    // Nothing until the answer is in, so the lock screen never flashes for
    // someone who has not set a password.
    if (locked === null) return null;
    if (locked) return <LockScreen onUnlocked={unlock} />;

    return (
        <>
            <App />
            <Toaster position="bottom-right" toastOptions={{ duration: 3000 }} />
        </>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        {/* Outside Root, so a throw in the lock screen is caught too. Without
            this a render error takes the whole window down to the body colour
            and says nothing about why. */}
        <ErrorBoundary>
            {screenshotId ? <ScreenshotView id={screenshotId} /> : <Root />}
        </ErrorBoundary>
    </React.StrictMode>
);
