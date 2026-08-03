import { useState } from 'react';
import { Alert02Icon, Cancel01Icon, Edit02Icon, Tick02Icon } from 'hugeicons-react';
import Button from '../ui/Button';
import { describeCall } from './ToolCall';

/**
 * A tool call stopped in front of the user.
 *
 * The safety story of this whole feature rests on this card, so it shows the
 * thing that is about to happen verbatim rather than a description of it. For
 * a command that means the command exactly as it will be sent, in the terminal
 * font, wrapped rather than truncated: an approval you cannot read to the end
 * of is not an approval.
 *
 * The host is named for the same reason. "Run this?" is a different question
 * depending on whether the answer runs on a staging box or on the machine the
 * business is sitting on, and the panel is often pointed somewhere other than
 * the tab in front.
 *
 * There is one card, not two. The transcript already had a row for the call
 * itself, so a question about that call arriving as a second card said the
 * same command twice and left the user comparing them to check they were the
 * same thing. The question lands on the row that is already there, and the
 * row goes back to reporting the call once it is answered. See the
 * `approval-request` case in `useAssistant`.
 *
 * No colour wash. This was a yellow box with yellow text on it, which reads as
 * an error rather than a question and, worse, tinted the command itself: the
 * one string on the card that has to be read exactly was the hardest thing on
 * it to read. The card is neutral and simply sits above the tool rows around
 * it, lifted by a ring and a shadow rather than by hue, and the amber is spent
 * on the 6px dot, which is what the transcript already uses to mean "waiting".
 * The shape is the tool row's: a 32px header line with a dot, a title and the
 * host, so answering it collapses the card onto the line it already had.
 *
 * The answers are a list, one per row, rather than buttons in a line. Three of
 * them do not fit across a 340px panel, and they are not a form's actions:
 * they are the question's answers, so they are drawn the way this panel draws
 * every other set of choices, as menu rows.
 */

const TITLES = {
    run_command: 'Run a command',
    send_input: 'Type into the terminal',
    write_file: 'Overwrite a file',
    connect_host: 'Open a connection',
    disconnect_session: 'Close a session',
    read_terminal: 'Read the terminal',
    read_file: 'Read a file',
    list_directory: 'List a directory',
    list_hosts: 'List saved hosts',
    list_sessions: 'List open sessions',
};

const SETTLED = {
    approved: { label: 'Allowed', dot: 'bg-emerald-500' },
    denied: { label: 'Declined', dot: 'bg-gray-400 dark:bg-gray-600' },
    expired: { label: 'Timed out', dot: 'bg-gray-400 dark:bg-gray-600' },
};

/**
 * The rule for every control on this card, in one place.
 *
 * The card fills at `white/[0.06]` over `surface-raised`, which composites to
 * the same lightness as `surface-control`. That is the step the app's menu
 * rows and quiet buttons use for their dark borders and hovers, because they
 * are normally drawn on a panel rather than on a card sitting at that level.
 * Anything here that reaches for the ramp is therefore invisible: a border the
 * colour of the card, and a hover that repaints it in its own colour.
 *
 * So: overlays, which sit a step off whatever they are drawn on, and a border
 * at rest so a row is a thing you can see before you go looking for it. These
 * are `Button`'s `outline` variant, as a full-width row. Keep them in step.
 */
const CHOICE = `w-full h-9 px-2.5 flex items-center gap-2.5 rounded-lg text-left
    text-xs font-medium select-none transition-colors outline-none border
    text-gray-800 dark:text-gray-200
    border-gray-300 dark:border-white/[0.16]
    hover:bg-gray-100 hover:border-gray-400
    dark:hover:bg-white/[0.12] dark:hover:border-white/[0.28]
    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

function Choice({ icon, label, onClick }) {
    return (
        <button type="button" onClick={onClick} className={CHOICE}>
            <span className="w-4 h-4 shrink-0 flex items-center justify-center
                text-gray-400 dark:text-gray-500">
                {icon}
            </span>
            {label}
        </button>
    );
}

export default function ApprovalRequest({ item, onRespond }) {
    // What to say instead of yes or no. Held here rather than in the hook: it
    // is worth nothing the moment this question is answered, and a card that
    // is one of twenty in a transcript should not be putting anything in the
    // conversation's state to hold a half-typed sentence.
    const [note, setNote] = useState(null);

    const summary = describeCall(item.name, item.input);
    const settled = SETTLED[item.status];
    const title = TITLES[item.name] || (item.local ? `Run ${item.name} locally` : item.title);

    // Once answered it collapses to the same one-line shape as a tool row, so
    // scrolling back through a long run is not a wall of spent dialogs.
    if (settled) {
        return (
            <div className="h-8 px-2.5 flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-white/[0.035]">
                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full shrink-0 ${settled.dot}`} />
                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 shrink-0">
                    {settled.label}
                </span>
                <span
                    className={`min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-500 ${
                        summary.mono ? 'font-jetbrains' : ''
                    }`}
                    title={summary.text}
                >
                    {summary.text || title}
                </span>
            </div>
        );
    }

    const sendNote = () => {
        const text = (note || '').trim();
        if (text) onRespond(item.requestId, false, text);
    };

    return (
        <div className="rounded-xl overflow-hidden shadow-sm
            bg-white dark:bg-white/[0.06]
            ring-1 ring-black/[0.07] dark:ring-white/[0.10]">

            {/* The tool row's header, held still: same height, same dot, same
                title weight. The host is the other half of the question, so it
                takes the rest of the line and truncates from the end. */}
            <div className="h-8 px-2.5 flex items-center gap-2
                border-b border-black/[0.06] dark:border-white/[0.06]">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-500" />
                <span className="text-[11px] font-semibold text-gray-900 dark:text-white shrink-0">
                    {title}
                </span>
                {item.host && (
                    <span className="min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-500">
                        on {item.host}
                    </span>
                )}
            </div>

            <div className="p-2 space-y-2">
                {/* Sunk rather than raised, and in the terminal font: it should
                    look like the thing the terminal is about to be handed, not
                    like another piece of the panel's furniture. */}
                {summary.text && (
                    <div
                        className={`rounded-lg px-2.5 py-2 max-h-36 overflow-auto
                            bg-gray-50 dark:bg-black/30 text-gray-900 dark:text-gray-100 ${
                            summary.mono
                                ? 'font-jetbrains text-[11px] leading-[1.6] whitespace-pre-wrap break-words'
                                : 'text-xs leading-relaxed'
                        }`}
                    >
                        {summary.text}
                    </div>
                )}

                {item.local && (
                    <p className="flex items-start gap-1.5 px-0.5 text-[11px] leading-snug
                        text-gray-600 dark:text-gray-400">
                        <Alert02Icon
                            size={13}
                            strokeWidth={2}
                            className="shrink-0 mt-px text-amber-500"
                        />
                        This runs on your own computer, not on a server.
                    </p>
                )}

                {note === null ? (
                    <div className="space-y-1.5">
                        <Choice
                            icon={<Tick02Icon size={14} strokeWidth={2.5} />}
                            label="Allow"
                            onClick={() => onRespond(item.requestId, true)}
                        />
                        <Choice
                            icon={<Cancel01Icon size={13} strokeWidth={2.5} />}
                            label="Decline"
                            onClick={() => onRespond(item.requestId, false)}
                        />
                        {/* A no with a reason attached. The text goes back as
                            the tool's own result, which is the one thing the
                            model is certain to read before it decides what to
                            try next, so it reads as an answer to this call
                            rather than as a new instruction arriving later. */}
                        <Choice
                            icon={<Edit02Icon size={13} strokeWidth={2} />}
                            label="Something else..."
                            onClick={() => setNote('')}
                        />
                    </div>
                ) : (
                    <div className="rounded-lg transition-colors
                        border border-gray-300 dark:border-white/[0.16]
                        focus-within:border-gray-400 dark:focus-within:border-white/30">
                        <textarea
                            autoFocus
                            rows={2}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    sendNote();
                                }
                                if (event.key === 'Escape') {
                                    // Backs out to the three answers, and
                                    // stops there: the question is still open.
                                    event.stopPropagation();
                                    setNote(null);
                                }
                            }}
                            placeholder="What should it do instead?"
                            className="block w-full max-h-32 px-2.5 pt-2 pb-1 bg-transparent
                                resize-none outline-none
                                text-xs leading-relaxed text-gray-900 dark:text-white
                                placeholder:text-gray-400 dark:placeholder:text-gray-600"
                        />
                        <div className="flex items-center justify-end gap-1.5 px-1.5 pb-1.5">
                            <Button size="sm" variant="outline" onClick={() => setNote(null)}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                variant="primary"
                                disabled={!note.trim()}
                                onClick={sendNote}
                            >
                                Send
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
