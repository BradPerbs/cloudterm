import { useEffect } from 'react';

/**
 * Carries terminal settings in and out of the cloud snapshot.
 *
 * These live in localStorage, which the main process cannot read, so the
 * renderer is the only side that can see them change. This hook reports them
 * up whenever they do, and writes back what a pull brought down from another
 * device.
 *
 * The keys are listed here rather than each hook reporting its own, so adding a
 * setting to the snapshot is one line in one place instead of a change spread
 * across every hook that happens to persist something.
 */
const SYNCED_KEYS = [
    'terminal.appearance',   // useTerminalSettings
    'terminalTheme',         // useTerminalTheme
    'terminalCustomTheme',   // useTerminalTheme, the user's own palette
    'theme',                 // useTheme, light, dark, system or custom
    'appColors',             // useTheme, the user's own app palette
    'titleBarLogo',          // useTheme, whether the title bar shows the mark
    'titleBarLogoImage',     // useTheme, the user's own mark, as a data URL
    'titleBarLogoSide',      // useTheme, which end of the title bar it sits at
    'settings.category',     // which settings page was last open
];

function readSettings() {
    const settings = {};

    for (const key of SYNCED_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) settings[key] = value;
    }

    return settings;
}

export default function useSettingsSnapshot() {
    // Report on mount and whenever anything in this window writes a synced key.
    useEffect(() => {
        const report = () => window.api.cloudSnapshot.reportSettings(readSettings());

        report();

        // localStorage.setItem does not fire an event in the window that made
        // the change, so the setter is wrapped rather than listened for. The
        // 'storage' event only covers *other* windows, which is the case this
        // app never has.
        const original = localStorage.setItem.bind(localStorage);

        localStorage.setItem = (key, value) => {
            original(key, value);
            if (SYNCED_KEYS.includes(key)) report();
        };

        return () => { localStorage.setItem = original; };
    }, []);

    // Settings arriving from another device.
    useEffect(() => window.api.cloudSnapshot.onSettings((settings) => {
        if (!settings || typeof settings !== 'object') return;

        let changed = false;

        for (const key of SYNCED_KEYS) {
            const incoming = settings[key];
            if (typeof incoming !== 'string') continue;
            if (localStorage.getItem(key) === incoming) continue;

            localStorage.setItem(key, incoming);
            changed = true;
        }

        // The hooks that own these read them once, at mount, and hold the value
        // in React state from then on. Rewriting the keys underneath them
        // changes nothing on screen, and there is no way to re-seed every one
        // of them from here; a reload is what actually applies the settings.
        if (changed) window.location.reload();
    }), []);
}
