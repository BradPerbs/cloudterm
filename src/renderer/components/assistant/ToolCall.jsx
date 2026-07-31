import { useState } from 'react';
import { ArrowDown01Icon } from 'hugeicons-react';

/**
 * One tool call, as a row in the transcript.
 *
 * This is the honest record of what happened on the server, as opposed to the
 * assistant's account of it in prose above. That is why the output is here at
 * all and why it opens: when the summary says a service came back up, this is
 * where you check.
 *
 * Collapsed by default and kept to a single line, because a working answer is
 * usually several calls and nobody wants to scroll past a full `systemctl
 * status` to reach the conclusion. A failure opens itself, since that is the
 * one people always go looking for.
 */

const TITLES = {
    list_hosts: 'Listed hosts',
    list_sessions: 'Listed sessions',
    read_terminal: 'Read the terminal',
    run_command: 'Ran',
    send_input: 'Typed',
    list_directory: 'Listed',
    read_file: 'Read',
    write_file: 'Wrote',
    connect_host: 'Connected to',
    disconnect_session: 'Closed the session',
};

/** The dot carries the status, so the row height never changes with it. */
const DOTS = {
    running: 'bg-blue-500 animate-pulse',
    waiting: 'bg-amber-500',
    error: 'bg-red-500',
    done: 'bg-emerald-500',
};

/**
 * A call that was put to the user and turned down.
 *
 * It never ran, so the row does not get to say "Ran". This is also the state
 * the approval card collapses into once it is answered, which is why the shape
 * is identical: the same row, still naming the same command.
 */
const REFUSED = {
    denied: 'Declined',
    expired: 'Timed out',
};

/** The one line that says what this call actually was. */
export function describeCall(name, input = {}) {
    switch (name) {
        case 'run_command':
            return { mono: true, text: input.command || '' };
        case 'send_input':
            return { mono: true, text: input.text || '' };
        case 'read_file':
        case 'write_file':
        case 'list_directory':
            return { mono: true, text: input.path || '' };
        case 'read_terminal':
            return { mono: false, text: input.lines ? `last ${input.lines} lines` : 'recent output' };
        case 'list_hosts':
            return { mono: false, text: input.query ? `matching "${input.query}"` : '' };
        case 'connect_host':
            return { mono: false, text: input.hostId || '' };
        default: {
            const entries = Object.entries(input).filter(([key]) => key !== 'session');
            if (entries.length === 0) return { mono: false, text: '' };
            return { mono: false, text: entries.map(([key, value]) => `${key}: ${value}`).join(', ') };
        }
    }
}

export default function ToolCall({ item }) {
    const [open, setOpen] = useState(item.status === 'error');
    const summary = describeCall(item.name, item.input);
    const refused = REFUSED[item.approval?.status];
    const title = refused || TITLES[item.name] || (item.local ? item.name : item.name.replace(/_/g, ' '));
    const expandable = Boolean(item.result);

    return (
        <div className="rounded-lg bg-gray-50 dark:bg-white/[0.035] overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                disabled={!expandable}
                className="w-full h-8 px-2.5 flex items-center gap-2 text-left transition-colors
                    hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:hover:bg-transparent
                    disabled:cursor-default"
            >
                <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${refused
                        ? 'bg-gray-400 dark:bg-gray-600'
                        : DOTS[item.status] || DOTS.done}`}
                />

                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 shrink-0">
                    {title}
                </span>

                {summary.text && (
                    <span
                        className={`min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-500 ${
                            summary.mono ? 'font-jetbrains' : ''
                        }`}
                        title={summary.text}
                    >
                        {summary.text}
                    </span>
                )}

                {expandable && (
                    <ArrowDown01Icon
                        size={13}
                        strokeWidth={2}
                        className={`shrink-0 ml-auto text-gray-400 dark:text-gray-600 transition-transform
                            ${open ? 'rotate-180' : ''}`}
                    />
                )}
            </button>

            {open && expandable && (
                // Scrolls in both directions on its own: a wide log line must not
                // stretch the panel, and a long one must not bury the reply under it.
                <pre className="px-2.5 py-2 max-h-64 overflow-auto border-t border-black/[0.06] dark:border-white/[0.06]
                    font-jetbrains text-[11px] leading-[1.6] whitespace-pre
                    text-gray-600 dark:text-gray-400">
                    {item.result}
                </pre>
            )}
        </div>
    );
}
