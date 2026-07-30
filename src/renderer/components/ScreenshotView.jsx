import { useCallback, useEffect, useState } from 'react';
import { Copy01Icon, Download01Icon, Cancel01Icon, Tick01Icon } from 'hugeicons-react';

/**
 * Standalone viewer window for a captured terminal region, the snipping-tool
 * step after the capture. Runs in its own BrowserWindow off the same bundle,
 * routed by the `#screenshot=<id>` hash.
 */
export default function ScreenshotView({ id }) {
    const [shot, setShot] = useState(null);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);
    const [savedPath, setSavedPath] = useState(null);

    useEffect(() => {
        window.api.screenshot.get(id)
            .then((data) => {
                if (data) setShot(data);
                else setError('This screenshot is no longer available.');
            })
            .catch((err) => setError(err.message));
    }, [id]);

    const close = useCallback(() => window.api.screenshot.close(), []);

    const handleCopy = useCallback(async () => {
        const result = await window.api.screenshot.copy(id);
        if (!result?.success) {
            setError(result?.message || 'Copy failed');
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    }, [id]);

    const handleSave = useCallback(async () => {
        const result = await window.api.screenshot.save(id);
        if (result?.canceled) return;
        if (!result?.success) {
            setError(result?.message || 'Save failed');
            return;
        }
        setSavedPath(result.filePath);
    }, [id]);

    // Escape closes, Ctrl/Cmd+C copies, Ctrl/Cmd+S saves.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') { close(); return; }
            if (!(event.ctrlKey || event.metaKey)) return;
            if (event.key.toLowerCase() === 'c') { event.preventDefault(); handleCopy(); }
            if (event.key.toLowerCase() === 's') { event.preventDefault(); handleSave(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [close, handleCopy, handleSave]);

    return (
        <div className="h-full flex flex-col bg-gray-100 dark:bg-surface-base text-gray-900 dark:text-gray-100 font-inter overflow-hidden">
            <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-3 app-drag border-b border-gray-200 dark:border-surface-control">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold truncate">Screenshot</span>
                    {shot?.title && (
                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                            {shot.title}
                        </span>
                    )}
                    {shot && (
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500 tabular-nums shrink-0">
                            {shot.width}×{shot.height}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0 app-no-drag">
                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={!shot}
                        title="Copy to clipboard (Ctrl+C)"
                        className="flex items-center gap-1.5 px-3 h-8 rounded-xl text-xs font-semibold bg-gray-200 dark:bg-surface-control text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-surface-hover disabled:opacity-40 transition-colors"
                    >
                        {copied ? <Tick01Icon size={14} strokeWidth={2.5} /> : <Copy01Icon size={14} strokeWidth={2} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!shot}
                        title="Save as PNG (Ctrl+S)"
                        className="flex items-center gap-1.5 px-3 h-8 rounded-xl text-xs font-semibold bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                        <Download01Icon size={14} strokeWidth={2} />
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={close}
                        title="Close (Esc)"
                        className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                    >
                        <Cancel01Icon size={16} strokeWidth={2} />
                    </button>
                </div>
            </header>

            <main className="flex-1 min-h-0 overflow-auto p-6 flex items-center justify-center">
                {error ? (
                    <p className="text-sm text-red-500">{error}</p>
                ) : shot ? (
                    <img
                        src={shot.dataUrl}
                        alt="Terminal screenshot"
                        className="max-w-full rounded-xl shadow-2xl"
                        style={{ imageRendering: 'auto' }}
                    />
                ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Preparing screenshot…</p>
                )}
            </main>

            {savedPath && (
                <footer className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-200 dark:border-surface-control text-xs">
                    <span className="text-gray-500 dark:text-gray-400 truncate">
                        Saved to <span className="font-mono">{savedPath}</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => window.api.screenshot.reveal(savedPath)}
                        className="shrink-0 font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        Show in folder
                    </button>
                </footer>
            )}
        </div>
    );
}
