import { useState } from 'react';
import { Cancel01Icon, Edit02Icon, HelpCircleIcon, Tick02Icon } from 'hugeicons-react';
import Button from '../ui/Button';
import { useT } from '../../i18n';

/**
 * A question the model has put to the user.
 *
 * The other card on this panel asks whether something may happen. This one is
 * the thing happening: `AskUserQuestion` runs nothing and reaches nothing, and
 * the whole of it is a question, its two to four answers, and which of them
 * was picked. The answers go back on the tool's own input, so a card that only
 * offered allow and decline was not a smaller version of this, it was a call
 * that came back saying nobody answered. See the claude-code provider.
 *
 * So there is no Allow here. The options are the answers, one row each, drawn
 * the way this panel draws every other set of choices, and the way out is Skip
 * rather than Decline: turning down a question is not refusing consent to
 * anything, it is saying "ask me another way", and the model is told exactly
 * that.
 *
 * Most questions answer in one click. A card holds the answer back and waits
 * for Send only where clicking is not the whole decision:
 *
 *   - several questions at once, which the tool allows up to four of, since
 *     answering the first should not send the card out from under the second
 *   - a question that takes more than one answer, where every click is a
 *     toggle rather than a decision
 *   - options carrying a preview, which exist to be read side by side, so the
 *     first click shows one rather than ending the question
 *
 * "Something else..." is here for the same reason it is on the approval card:
 * the real answer is often none of the four. What is typed becomes that
 * question's answer rather than a comment on it, which is what the runtime
 * does with the same escape hatch in a terminal.
 */

/** A row the user can pick. Two lines: the answer, then what it means. */
const OPTION = `w-full px-2.5 py-2 flex items-start gap-2.5 rounded-lg text-left
    select-none transition-colors outline-none border
    border-gray-300 dark:border-white/[0.16]
    hover:bg-gray-100 hover:border-gray-400
    dark:hover:bg-white/[0.12] dark:hover:border-white/[0.28]
    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

/** The picked one, held a step brighter so a multi-answer card reads at a glance. */
const PICKED = `bg-gray-100 border-gray-400
    dark:bg-white/[0.12] dark:border-white/[0.28]`;

/** The quiet row: "Something else...", and Skip. Single line, like the approval card's. */
const QUIET = `w-full h-9 px-2.5 flex items-center gap-2.5 rounded-lg text-left
    text-xs font-medium select-none transition-colors outline-none border
    text-gray-800 dark:text-gray-200
    border-gray-300 dark:border-white/[0.16]
    hover:bg-gray-100 hover:border-gray-400
    dark:hover:bg-white/[0.12] dark:hover:border-white/[0.28]
    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

/** What the model is told when the card is skipped. Read by it, not by the user. */
const SKIPPED = 'The user skipped the question. Carry on without that answer, or ask in the '
    + 'conversation instead.';

/** Only the questions that are actually answerable, in the shape this draws. */
function readQuestions(input) {
    const rows = Array.isArray(input?.questions) ? input.questions : [];
    return rows
        .filter(row => row && typeof row.question === 'string' && row.question.trim())
        .map(row => ({
            question: row.question,
            header: typeof row.header === 'string' ? row.header : '',
            multiSelect: row.multiSelect === true,
            options: (Array.isArray(row.options) ? row.options : [])
                .filter(option => option && typeof option.label === 'string' && option.label)
                .map(option => ({
                    label: option.label,
                    description: typeof option.description === 'string' ? option.description : '',
                    preview: typeof option.preview === 'string' ? option.preview : '',
                })),
        }));
}

export default function QuestionRequest({ group, onRespond }) {
    const t = useT();
    // Both die with the card, so neither belongs in the conversation's state:
    // a half-made choice on a question that has been answered is nothing.
    const [picked, setPicked] = useState({});
    const [typing, setTyping] = useState(null);
    const [note, setNote] = useState('');

    const item = group.items[0];
    const questions = readQuestions(item?.input);

    // Nothing answerable came through, so there is no card to draw and the
    // call should not sit there waiting on one. Never seen in practice; the
    // runtime validates the shape before the call leaves it.
    if (!item || questions.length === 0) return null;

    const send = (answers) => onRespond(group, true, '', { answers });
    const skip = () => onRespond(group, false, SKIPPED);

    // See the note at the top: one click is the whole answer only where there
    // is one question, one answer to give, and nothing to read first.
    const confirms = questions.length > 1
        || questions.some(row => row.multiSelect || row.options.some(option => option.preview));

    /** Fold a pick into the answers, and send if that was the last of them. */
    const choose = (row, label) => {
        const current = picked[row.question] || [];
        const next = row.multiSelect
            ? (current.includes(label)
                ? current.filter(entry => entry !== label)
                : [...current, label])
            : [label];

        const answers = { ...picked, [row.question]: next };
        setPicked(answers);
        if (!confirms) submit(answers);
    };

    /** What the runtime takes: one string per question, several answers comma separated. */
    const collect = (answers) => {
        const out = {};
        for (const row of questions) {
            const chosen = answers[row.question] || [];
            if (chosen.length > 0) out[row.question] = chosen.join(', ');
        }
        return out;
    };

    const submit = (answers = picked) => {
        const out = collect(answers);
        if (Object.keys(out).length === questions.length) send(out);
    };

    const ready = Object.keys(collect(picked)).length === questions.length;

    /** A typed answer replaces whatever was picked for that question. */
    const sendNote = () => {
        const text = note.trim();
        if (!text || !typing) return;
        const answers = { ...picked, [typing]: [text] };
        setPicked(answers);
        setTyping(null);
        setNote('');
        if (!confirms) submit(answers);
    };

    return (
        <div className="rounded-xl overflow-hidden shadow-sm
            bg-white dark:bg-white/[0.06]
            ring-1 ring-black/[0.07] dark:ring-white/[0.10]">

            {/* The approval card's header, held to the same shape: same height,
                same dot, same title weight. Nothing names a server, because
                nothing here is going to one. */}
            <div className="h-8 px-2.5 flex items-center gap-2
                border-b border-black/[0.06] dark:border-white/[0.06]">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-500" />
                <HelpCircleIcon
                    size={13}
                    strokeWidth={2}
                    className="shrink-0 text-gray-400 dark:text-gray-500"
                />
                <span className="text-[11px] font-semibold text-gray-900 dark:text-white shrink-0">
                    {t('assistant.askQuestion')}
                </span>
            </div>

            <div className="p-2 space-y-3">
                {questions.map((row) => {
                    const chosen = picked[row.question] || [];
                    const writing = typing === row.question;

                    return (
                        <div key={row.question} className="space-y-1.5">
                            {/* The question, in the panel's reading size rather
                                than the label size around it: it is the one
                                thing on this card that has to be read in full
                                before anything is clicked, so it wraps. */}
                            <p className="px-0.5 text-xs leading-relaxed text-gray-900 dark:text-white">
                                {row.question}
                            </p>

                            {/* The chip the tool asks for, kept only where it
                                says something the question does not: several
                                questions on one card need telling apart at a
                                glance. */}
                            {questions.length > 1 && row.header && (
                                <p className="px-0.5 text-[10px] font-medium uppercase tracking-wide
                                    text-gray-400 dark:text-gray-600">
                                    {row.header}
                                </p>
                            )}

                            {row.options.map((option) => {
                                const on = chosen.includes(option.label);
                                return (
                                    <div key={option.label}>
                                        <button
                                            type="button"
                                            onClick={() => choose(row, option.label)}
                                            className={`${OPTION} ${on ? PICKED : ''}`}
                                        >
                                            <span className="w-4 h-4 shrink-0 mt-px flex items-center
                                                justify-center text-gray-400 dark:text-gray-500">
                                                {on && <Tick02Icon size={14} strokeWidth={2.5} />}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-xs font-medium
                                                    text-gray-800 dark:text-gray-200">
                                                    {option.label}
                                                </span>
                                                {option.description && (
                                                    <span className="block mt-0.5 text-[11px] leading-snug
                                                        text-gray-500 dark:text-gray-500">
                                                        {option.description}
                                                    </span>
                                                )}
                                            </span>
                                        </button>

                                        {/* Previews exist to be compared, so
                                            one opens on the pick rather than on
                                            a hover nobody finds. Sunk and in
                                            the terminal font, as the approval
                                            card draws a command. */}
                                        {option.preview && on && (
                                            <pre className="mt-1 mx-0.5 rounded-lg px-2.5 py-2 max-h-40
                                                overflow-auto bg-gray-50 dark:bg-black/30
                                                font-jetbrains text-[11px] leading-[1.6]
                                                whitespace-pre-wrap break-words
                                                text-gray-700 dark:text-gray-300">
                                                {option.preview}
                                            </pre>
                                        )}
                                    </div>
                                );
                            })}

                            {writing ? (
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
                                                // Back to the options. The
                                                // question is still open.
                                                event.stopPropagation();
                                                setTyping(null);
                                                setNote('');
                                            }
                                        }}
                                        placeholder={t('assistant.answerPlaceholder')}
                                        className="block w-full max-h-32 px-2.5 pt-2 pb-1 bg-transparent
                                            resize-none outline-none
                                            text-xs leading-relaxed text-gray-900 dark:text-white
                                            placeholder:text-gray-400 dark:placeholder:text-gray-600"
                                    />
                                    <div className="flex items-center justify-end gap-1.5 px-1.5 pb-1.5">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => { setTyping(null); setNote(''); }}
                                        >
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
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { setTyping(row.question); setNote(''); }}
                                    className={QUIET}
                                >
                                    <span className="w-4 h-4 shrink-0 flex items-center justify-center
                                        text-gray-400 dark:text-gray-500">
                                        <Edit02Icon size={13} strokeWidth={2} />
                                    </span>
                                    {t('assistant.somethingElse')}
                                </button>
                            )}
                        </div>
                    );
                })}

                {/* Skip sits under the answers, away from them, because it is
                    not one of them. Send only appears on the cards that hold
                    their answer back; the one-click ones have already gone. */}
                <div className="space-y-1.5 pt-0.5">
                    {confirms && (
                        <Button
                            size="sm"
                            variant="primary"
                            fullWidth
                            disabled={!ready}
                            onClick={() => submit()}
                        >
                            {t('assistant.send')}
                        </Button>
                    )}
                    <button type="button" onClick={skip} className={QUIET}>
                        <span className="w-4 h-4 shrink-0 flex items-center justify-center
                            text-gray-400 dark:text-gray-500">
                            <Cancel01Icon size={13} strokeWidth={2.5} />
                        </span>
                        {t('assistant.skipQuestion')}
                    </button>
                </div>
            </div>
        </div>
    );
}
