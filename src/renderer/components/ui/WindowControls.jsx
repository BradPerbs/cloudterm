/**
 * The window's own three buttons: minimize, maximize, close.
 *
 * One component for every frameless window the app draws, so the assistant's
 * own window and the main window cannot drift apart by a pixel or a hover
 * colour. Not drawn on macOS, which puts its own three on the left; callers
 * make that decision, since it is also where they leave room for them.
 *
 * Each acts on the window the click came from: the IPC handlers behind these
 * resolve the sender rather than assuming the main window.
 */
export default function WindowControls() {
    return (
        <>
            <button
                className="app-no-drag w-8 h-8 flex items-center justify-center rounded-xl bg-transparent hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                onClick={() => window.api.window.minimize()}
            >
                <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12">
                    <rect y="5" width="12" height="1" fill="currentColor" />
                </svg>
            </button>
            <button
                className="app-no-drag w-8 h-8 flex items-center justify-center rounded-xl bg-transparent hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                onClick={() => window.api.window.maximize()}
            >
                <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12">
                    <rect width="10" height="10" x="1" y="1" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
            </button>
            <button
                className="app-no-drag w-8 h-8 flex items-center justify-center rounded-xl bg-transparent hover:bg-red-500 hover:text-white transition-colors group"
                onClick={() => window.api.window.close()}
            >
                <svg className="w-3 h-3 text-gray-500 dark:text-gray-400 group-hover:text-white" viewBox="0 0 12 12">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.2" />
                </svg>
            </button>
        </>
    );
}
