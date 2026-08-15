import { useState } from 'react';
import { Alert02Icon, Cancel01Icon, Edit02Icon, Tick02Icon } from 'hugeicons-react';
import Button from '../ui/Button';
import CopyButton from '../ui/CopyButton';
import TargetStack from './TargetStack';
import { describeCall } from './ToolCall';
import { approvalMarks, groupTargets } from '../../lib/approvals';
import { useT } from '../../i18n';

/**
 * A tool call stopped in front of the user.
 *
 * The safety story of this whole feature rests on this card, so it shows the
 * thing that is about to happen verbatim rather than a description of it. For
 * a command that means the command exactly as it will be sent, in the terminal
 * font, wrapped rather than truncated: an approval you cannot read to the end
 * of is not an approval.
 *
 * Where it will run is the other half of the question. "Run this?" is a
 * different question depending on whether the answer lands on a staging box or
 * on the machine the business is sitting on, and the panel is often pointed
 * somewhere other than the tab in front. That is drawn rather than spelled out,
 * with the panel header's own tiles: the OS, the name the tab strip uses, and
 * the address on hover. A card is a thing you read in a hurry, and an icon and
 * a short name are read faster than `ubuntu@10.0.14.22`.
 *
 * It takes a group of calls, not one, and usually the group has a single member.
 * The same command sent to three servers is one decision, and the model asks it
 * as three tool calls: as three cards it was the same text three times, told
 * apart only by a hostname, and answering it three times is not more consent
 * than answering it once. `lib/approvals` decides what counts as the same
 * question, including the calls that have been issued but have not asked yet,
 * and every server the answer will reach is named on the card before it is
 * given. `useAssistant` is what carries that answer to the ones still queued.
 *
 * The card is pinned above the composer rather than sitting in the transcript,
 * because the transcript moves: text streaming in underneath a question pushes
 * its buttons out from under the pointer, and the two answers are next to each
 * other. It stays where it is put until it is answered. The transcript keeps
 * nothing in its place meanwhile, so the command is still on screen exactly
 * once, and the answered call takes its row there as usual.
 *
 * No colour wash. This was a yellow box with yellow text on it, which reads as
 * an error rather than a question and, worse, tinted the command itself: the
 * one string on the card that has to be read exactly was the hardest thing on
 * it to read. The card is neutral and simply sits above the tool rows around
 * it, lifted by a ring and a shadow rather than by hue, and the amber is spent
 * on the 6px dot, which is what the transcript already uses to mean "waiting".
 * The shape is the tool row's: a 32px header line with a dot, a title and where
 * it goes, so answering it collapses the card onto a line of that same shape.
 *
 * The answers are a list, one per row, rather than buttons in a line. Three of
 * them do not fit across a 340px panel, and they are not a form's actions:
 * they are the question's answers, so they are drawn the way this panel draws
 * every other set of choices, as menu rows.
 */

const TITLES = {
    run_command: 'assistant.askRunCommand',
    send_input: 'assistant.askSendInput',
    write_file: 'assistant.askWriteFile',
    connect_host: 'assistant.askConnectHost',
    disconnect_session: 'assistant.askDisconnect',
    read_terminal: 'assistant.askReadTerminal',
    read_file: 'assistant.askReadFile',
    list_directory: 'assistant.askListDirectory',
    list_hosts: 'assistant.askListHosts',
    list_sessions: 'assistant.askListSessions',
};

const SETTLED = {
    approved: { labelKey: 'assistant.allowed', dot: 'bg-emerald-500' },
    denied: { labelKey: 'assistant.declined', dot: 'bg-gray-400 dark:bg-gray-600' },
    expired: { labelKey: 'assistant.timedOut', dot: 'bg-gray-400 dark:bg-gray-600' },
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

export default function ApprovalRequest({ group, sessions = [], onRespond }) {
    const t = useT();
    // What to say instead of yes or no. Held here rather than in the hook: it
    // is worth nothing the moment this question is answered, and a card that
    // is one of twenty in a transcript should not be putting anything in the
    // conversation's state to hold a half-typed sentence.
    const [note, setNote] = useState(null);

    // Every call in the group is the same call bar its session, so the one at
    // the front speaks for all of them everywhere except the header.
    const item = group.items[0];
    if (!item) return null;

    const summary = describeCall(item.name, item.input);
    const settled = SETTLED[item.status];
    const title = TITLES[item.name]
        ? t(TITLES[item.name])
        : (item.local ? t('assistant.askRunLocally', { tool: item.name }) : item.title);

    // Once answered it collapses to the same one-line shape as a tool row, so
    // scrolling back through a long run is not a wall of spent dialogs.
    if (settled) {
        return (
            <div className="h-8 px-2.5 flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-white/[0.035]">
                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full shrink-0 ${settled.dot}`} />
                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 shrink-0">
                    {t(settled.labelKey)}
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

    // Where this is going, as the tab strip would draw it. Not memoised: it is
    // a handful of lookups over the open sessions, and the names it builds are
    // translated, so a cached list would go stale on a change of language.
    const marks = approvalMarks(groupTargets(group), sessions);

    /**
     * The answer covers exactly what the card showed.
     *
     * A queued call whose session could not be resolved draws no tile, so it is
     * dropped from the answer and asks for itself when its turn comes. Nothing
     * this card could not name is consented to on it. The calls already asking
     * are never dropped: they have to be answered either way.
     */
    const drawn = new Set(marks.map(mark => mark.key));
    const answering = {
        ...group,
        queued: group.queued.filter(entry => drawn.has(entry.id)),
    };

    // One answer for the whole card. They are the same question, so a partial
    // answer is not a state this card can leave the conversation in.
    const answer = (approved, message = '') => onRespond(answering, approved, message);

    const sendNote = () => {
        const text = (note || '').trim();
        if (text) answer(false, text);
    };

    return (
        <div className="rounded-xl overflow-hidden shadow-sm
            bg-white dark:bg-white/[0.06]
            ring-1 ring-black/[0.07] dark:ring-white/[0.10]">

            {/* The tool row's header, held still: same height, same dot, same
                title weight. Where the call is going is the other half of the
                question, so it takes the rest of the line and truncates from
                the end.

                Tiles first, then a name for one server or a count for several,
                which is the panel header's own arrangement. The names live on
                the tiles rather than in the text, which is what lets one card
                say "3 servers" and still answer "which three" without growing a
                second line. The tooltip opens upwards: this card is pinned near
                the bottom of the panel, and a label dropping out of the header
                would land on the command underneath it. */}
            <div className="h-8 px-2.5 flex items-center gap-2
                border-b border-black/[0.06] dark:border-white/[0.06]">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-500" />
                <span className="text-[11px] font-semibold text-gray-900 dark:text-white shrink-0">
                    {title}
                </span>
                {marks.length > 0 ? (
                    <span className="min-w-0 flex items-center gap-1.5">
                        <TargetStack marks={marks} placement="top" />
                        <span className="min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-500">
                            {marks.length === 1
                                ? marks[0].name
                                : t('assistant.serverCount', { count: marks.length })}
                        </span>
                    </span>
                ) : item.host ? (
                    <span className="min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-500">
                        {t('assistant.onHost', { host: item.host })}
                    </span>
                ) : null}
            </div>

            <div className="p-2 space-y-2">
                {/* Sunk rather than raised, and in the terminal font: it should
                    look like the thing the terminal is about to be handed, not
                    like another piece of the panel's furniture. */}
                {summary.text && (
                    // Copyable, because "not like that" is a common answer to
                    // this card and the next thing you do is run a version of
                    // it yourself. The button sits outside the scroller for
                    // the reason it does on a tool row: inside, a long command
                    // would carry it off the top.
                    <div className="group relative">
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
                        <CopyButton
                            text={summary.text}
                            label={summary.mono ? t('assistant.copyCommand') : t('common.copy')}
                            className="absolute right-1 top-1"
                        />
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
                        {t('assistant.localWarning')}
                    </p>
                )}

                {note === null ? (
                    <div className="space-y-1.5">
                        <Choice
                            icon={<Tick02Icon size={14} strokeWidth={2.5} />}
                            label={t('assistant.allow')}
                            onClick={() => answer(true)}
                        />
                        <Choice
                            icon={<Cancel01Icon size={13} strokeWidth={2.5} />}
                            label={t('assistant.decline')}
                            onClick={() => answer(false)}
                        />
                        {/* A no with a reason attached. The text goes back as
                            the tool's own result, which is the one thing the
                            model is certain to read before it decides what to
                            try next, so it reads as an answer to this call
                            rather than as a new instruction arriving later. */}
                        <Choice
                            icon={<Edit02Icon size={13} strokeWidth={2} />}
                            label={t('assistant.somethingElse')}
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
                            placeholder={t('assistant.insteadPlaceholder')}
                            className="block w-full max-h-32 px-2.5 pt-2 pb-1 bg-transparent
                                resize-none outline-none
                                text-xs leading-relaxed text-gray-900 dark:text-white
                                placeholder:text-gray-400 dark:placeholder:text-gray-600"
                        />
                        <div className="flex items-center justify-end gap-1.5 px-1.5 pb-1.5">
                            <Button size="sm" variant="outline" onClick={() => setNote(null)}>
                                {t('common.cancel')}
                            </Button>
                            <Button
                                size="sm"
                                variant="primary"
                                disabled={!note.trim()}
                                onClick={sendNote}
                            >
                                {t('assistant.send')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
