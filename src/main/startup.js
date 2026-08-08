const { app } = require('electron');

/**
 * Launching the app when the machine starts.
 *
 * The system is the only store. On Windows that is a value under the current
 * user's Run key, on macOS a login item; either way the user can turn it off
 * somewhere that is not this app. Keeping our own copy of the answer would be a
 * second place holding the same fact, and the two would disagree the first time
 * someone switched it off in Task Manager.
 *
 * So `status()` asks the system every time it is called, and nothing here is
 * written to the store or to a config file.
 */

/** Platforms Electron can register a login item on. Linux has no equivalent. */
const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin']);

/**
 * The executable the system should launch.
 *
 * A portable build runs from a folder unpacked into the temp directory, so
 * `process.execPath` there names a copy that will not exist at the next boot.
 * electron-builder leaves the real .exe in an environment variable, and that is
 * the one worth registering.
 */
function executable() {
    return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/**
 * The same options for the read and the write, so the entry we ask about is the
 * entry we wrote. Windows only: on macOS the login item is the bundle itself,
 * and a path is neither read nor honoured.
 */
function loginItemOptions(extra = {}) {
    if (process.platform !== 'win32') return { ...extra };
    return { path: executable(), args: [], ...extra };
}

/**
 * Why the switch cannot be offered, or '' when it can.
 *
 * A development run is refused rather than registered. `process.execPath` there
 * is the Electron binary inside node_modules, so the boot entry would start a
 * bare Electron with none of this app in it, and would go on doing so long
 * after the checkout had moved.
 */
function unsupportedReason() {
    if (!SUPPORTED_PLATFORMS.has(process.platform)) {
        return 'This system has no login item for the app to add itself to';
    }
    if (!app.isPackaged) {
        return 'Only an installed build can start at boot. This one is running from a checkout';
    }
    return '';
}

/** `{ supported, reason, enabled }`, read from the system each time. */
function status() {
    const reason = unsupportedReason();
    if (reason) return { supported: false, reason, enabled: false };

    try {
        const settings = app.getLoginItemSettings(loginItemOptions());
        return { supported: true, reason: '', enabled: Boolean(settings.openAtLogin) };
    } catch (error) {
        // Nothing here is worth failing a settings page over: an unreadable
        // login item is a switch that cannot be offered, not an error.
        console.error('Could not read the login item:', error.message);
        return { supported: false, reason: error.message, enabled: false };
    }
}

/** Add or remove the login item. Answers `{ success, message, ...status() }`. */
function setEnabled(enabled) {
    const wanted = Boolean(enabled);

    const reason = unsupportedReason();
    if (reason) return { success: false, message: reason, ...status() };

    try {
        app.setLoginItemSettings(loginItemOptions({ openAtLogin: wanted }));
    } catch (error) {
        console.error('Could not change the login item:', error.message);
        return { success: false, message: error.message, ...status() };
    }

    // Read back rather than trusting the write. Windows keeps an "approved"
    // flag beside the Run entry, and an app switched off under Startup apps in
    // Task Manager stays off however many times the entry itself is written.
    // A switch that says it took when the app will not actually start is the
    // one answer worth catching here.
    const current = status();
    if (current.enabled !== wanted) {
        const message = !wanted
            ? 'The system kept the login item'
            : process.platform === 'win32'
                ? 'Windows is blocking this app from starting at boot. It can be turned back on '
                    + 'under Startup apps in Task Manager'
                : 'The system did not accept the login item';
        return { success: false, message, ...current };
    }

    return { success: true, message: '', ...current };
}

module.exports = { status, setEnabled };
