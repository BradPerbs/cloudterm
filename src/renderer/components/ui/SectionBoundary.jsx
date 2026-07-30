import { Component } from 'react';

/**
 * A boundary around one section of a form.
 *
 * The app-level ErrorBoundary in main.jsx is the right net for a broken view,
 * but it is the wrong one for a broken *field*: it replaces the entire window,
 * so a settings section that throws takes the host list, the open sessions and
 * whatever was being typed with it. Which is also, from the outside, hard to
 * tell apart from the app simply going blank.
 *
 * This keeps the failure where it happened. The rest of the form stays usable,
 * and the error says what it was rather than leaving someone to guess.
 */
class SectionBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Still worth the console: the stack is the useful half and there is
        // nowhere sensible to put it on screen.
        console.error(`Section "${this.props.name || 'unknown'}" failed:`, error, info);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 p-3">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                    {this.props.name ? `${this.props.name} could not be shown` : 'This section could not be shown'}
                </p>
                <p className="mt-1 text-[11px] font-mono text-red-600/80 dark:text-red-400/70 break-words">
                    {String(error.message || error)}
                </p>
                <button
                    type="button"
                    onClick={() => this.setState({ error: null })}
                    className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-400 hover:underline"
                >
                    Try again
                </button>
            </div>
        );
    }
}

export default SectionBoundary;
