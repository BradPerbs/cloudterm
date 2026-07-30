import { Component } from 'react';

/**
 * The last thing standing between a render error and a blank window.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * which in a full-window app means the page goes to the body colour and every
 * trace of what happened is in a console nobody has open. That failure mode is
 * indistinguishable from a dozen others: "it went blank" is not a bug report
 * anyone can act on, least of all the person who hit it.
 *
 * So the error is caught and shown: the message, where it came from, and a
 * reload. The stack is here rather than only in the console because the console
 * is not open when the thing you needed to see happened.
 */
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, info: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Still logged: a stack in the console can be clicked through to source,
        // which the text below cannot.
        console.error('Unhandled render error:', error, info?.componentStack);
        this.setState({ info });
    }

    render() {
        const { error, info } = this.state;
        if (!error) return this.props.children;

        // The component that threw, which is the one line most likely to say
        // where to look.
        const origin = (info?.componentStack || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)[0] || '';

        return (
            <div className="fixed inset-0 overflow-auto bg-white dark:bg-surface-base p-8">
                <div className="max-w-2xl mx-auto flex flex-col gap-4">
                    <div>
                        <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                            Something in the interface crashed
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Your hosts, keys and sessions are held in the main process and are
                            unaffected. Reloading rebuilds the window from them.
                        </p>
                    </div>

                    <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 p-4">
                        <p className="text-sm font-semibold text-red-700 dark:text-red-400 break-words">
                            {String(error.message || error)}
                        </p>
                        {origin && (
                            <p className="mt-1 text-[11px] font-mono text-red-600/80 dark:text-red-400/70 break-words">
                                {origin}
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => window.api?.window?.reload?.() ?? window.location.reload()}
                            className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                        >
                            Reload
                        </button>
                        <button
                            type="button"
                            onClick={() => window.api?.clipboard?.writeText?.(
                                `${error.stack || error.message || error}\n\nComponent stack:${info?.componentStack || ''}`
                            )}
                            className="px-4 h-9 rounded-xl border border-gray-300 dark:border-surface-control text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                        >
                            Copy details
                        </button>
                    </div>

                    {(error.stack || info?.componentStack) && (
                        <details className="rounded-xl border border-gray-200 dark:border-surface-control p-3">
                            <summary className="text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer">
                                Stack
                            </summary>
                            <pre className="mt-2 text-[11px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                                {error.stack || ''}
                                {info?.componentStack || ''}
                            </pre>
                        </details>
                    )}
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
