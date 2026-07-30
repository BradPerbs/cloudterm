import { useMemo, useRef, useState } from 'react';
import { PlusSignIcon } from 'hugeicons-react';
import Tag from './Tag';
import { MAX_TAGS, normalizeTag, normalizeTags } from '../../lib/tags';

/**
 * How many of the collection's tags the panel will show at once.
 *
 * It sits inside a form, and a collection with sixty tags in it would push the
 * rest of the sheet off the screen. The cap is only reached when nothing is
 * typed; a draft of even one letter cuts the list down far faster than this
 * does, and whatever the cap hides is counted out loud rather than dropped in
 * silence.
 */
const SUGGESTION_LIMIT = 12;

/**
 * The field tags are typed into.
 *
 * A plain comma-separated text box was the other option, and is what the
 * snippet editor still uses. It is worse here for one reason: a host's tags are
 * shared with every other host, and a text box gives you no way to see that
 * "staging" already exists before you type "stage" and create a second tag that
 * means the same thing. So the tags that are already in use sit under the
 * field, and picking one is a click.
 *
 * That list is a panel of its own rather than a run of chips behind the words
 * "In use:". Two rows of pills with a label wedged into the start of the first
 * one read as an overflowing field — as though the tags were somehow half
 * applied — when they are the opposite: a menu of what you have not picked. So
 * it gets a border, a heading that says which of the two things it is currently
 * showing (everything, or what matches what you are typing), and a `+` on every
 * chip, because a chip that adds and a chip that reports are otherwise the same
 * chip.
 *
 * Committing:
 *
 *   Enter, Tab, comma   take what is typed
 *   Backspace on empty  take back the last chip, into the field, so a typo is
 *                       corrected rather than retyped
 *   blur                take what is typed, because a half-entered tag left
 *                       behind on save is a tag the user believes they added
 *
 * The chips are normalised exactly as the store will normalise them, so what
 * you see here is what ends up on the record.
 */
export default function TagInput({
    value = [],
    onChange,
    suggestions = [],
    placeholder = 'Add a tag…',
    id,
}) {
    const [draft, setDraft] = useState('');
    const inputRef = useRef(null);

    const tags = normalizeTags(value);
    const full = tags.length >= MAX_TAGS;
    const typed = normalizeTag(draft);

    /** What is left to offer: tags in use elsewhere that this host has not got. */
    const { offered, hidden } = useMemo(() => {
        const have = new Set(tags);
        const matching = suggestions.filter(tag => !have.has(tag) && (!typed || tag.includes(typed)));

        return {
            offered: matching.slice(0, SUGGESTION_LIMIT),
            hidden: Math.max(0, matching.length - SUGGESTION_LIMIT),
        };
    }, [suggestions, tags, typed]);

    const commit = (text) => {
        const tag = normalizeTag(text);
        setDraft('');
        if (!tag || tags.includes(tag) || full) return;
        onChange(normalizeTags([...tags, tag]));
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            // Enter inside a form submits it, and the sheet's own save is not
            // what "I have finished typing this tag" means.
            event.preventDefault();
            commit(draft);
            return;
        }

        // Tab commits and then moves on, so tabbing out of the field never
        // silently drops what is in it.
        if (event.key === 'Tab' && draft.trim()) {
            commit(draft);
            return;
        }

        if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            event.preventDefault();
            const last = tags[tags.length - 1];
            onChange(tags.slice(0, -1));
            setDraft(last);
            return;
        }

        // Escape clears the draft rather than closing the sheet around it.
        if (event.key === 'Escape' && draft) {
            event.stopPropagation();
            setDraft('');
        }
    };

    return (
        <div className="flex flex-col gap-2 min-w-0">
            {/* One box holding the chips and the input, so it reads as a single
                field rather than a list with a text box under it. Clicking any
                of the empty space in it puts the cursor where you expect. */}
            <div
                onClick={() => inputRef.current?.focus()}
                className="flex flex-wrap items-center gap-1.5 w-full min-h-[38px] px-2 py-1.5 rounded-xl
                    border border-gray-300 dark:border-surface-control bg-white dark:bg-surface-base
                    transition-colors focus-within:border-gray-400 dark:focus-within:border-neutral-600
                    cursor-text"
            >
                {tags.map(tag => (
                    <Tag
                        key={tag}
                        tag={tag}
                        onRemove={() => onChange(tags.filter(entry => entry !== tag))}
                    />
                ))}

                <input
                    ref={inputRef}
                    id={id}
                    type="text"
                    value={draft}
                    onChange={(event) => {
                        // Typing the separator is the same as pressing Enter,
                        // which is what makes pasting "a, b, c" work.
                        if (event.target.value.includes(',')) commit(event.target.value);
                        else setDraft(event.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={() => commit(draft)}
                    disabled={full}
                    spellCheck={false}
                    aria-label="Add a tag"
                    placeholder={full ? `${MAX_TAGS} tags is the limit` : (tags.length === 0 ? placeholder : '')}
                    className="flex-1 min-w-[7rem] bg-transparent outline-none border-none px-1 py-0.5
                        text-sm text-gray-900 dark:text-white placeholder:text-gray-400 disabled:opacity-50"
                />
            </div>

            {/* Nothing to show on a collection whose only tags are this host's
                own, and nothing to show once the limit is reached, where every
                chip in it would be a chip that refuses to be clicked. */}
            {!full && suggestions.length > 0 && (
                <div className="flex flex-col gap-2 p-2 rounded-xl
                    bg-gray-50 dark:bg-surface-base/60
                    border border-gray-200/70 dark:border-surface-control">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-neutral-500">
                            {typed ? `Matching “${typed}”` : 'Tags already in use'}
                        </span>

                        {/* What the cap is holding back, so a list that stops at
                            twelve is plainly a list that stops at twelve. */}
                        {hidden > 0 && (
                            <span className="text-[10px] tabular-nums text-gray-400 dark:text-neutral-500 shrink-0">
                                +{hidden} more · keep typing
                            </span>
                        )}
                    </div>

                    {offered.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {offered.map(tag => (
                                <Tag
                                    key={tag}
                                    tag={tag}
                                    icon={<PlusSignIcon size={9} strokeWidth={3} />}
                                    // Without this the field blurs first, and the
                                    // blur commits whatever was half-typed:
                                    // clicking "production" after typing "pro"
                                    // would add both.
                                    onMouseDown={(event) => event.preventDefault()}
                                    // `commit` rather than a bare add: it is the
                                    // one path that clears the draft and honours
                                    // the limit, and a suggestion is a tag being
                                    // entered like any other.
                                    onClick={() => commit(tag)}
                                    title={`Add “${tag}”`}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11px] text-gray-400 dark:text-neutral-500">
                            {typed
                                ? <>No tag matches. Press Enter to make “{typed}” a new one.</>
                                : 'Every tag in the collection is already on this host.'}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
