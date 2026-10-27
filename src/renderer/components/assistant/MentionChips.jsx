import { Cancel01Icon } from 'hugeicons-react';
import { MentionIcon } from './MentionPicker';
import { useT } from '../../i18n';

/**
 * What a message tags, as chips: in the composer, where each can be taken
 * back until it is sent, and on the sent message, by name.
 *
 * Only `{ kind, id, name }` is held for each. What the thing actually is (a
 * host's address, a runbook's text) is read by main from the store when the
 * message goes, so neither of these ever has more than a name to show.
 */

/** How a tag reads: a skill as the command that invoked it, anything else as a mention. */
const label = entry => (entry.kind === 'skill' ? `/${entry.name}` : entry.name);

/** The composer's chips, each with a way to take it back. */
export default function MentionChips({ mentions, onRemove }) {
    const t = useT();
    if (!mentions?.length) return null;

    return (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {mentions.map(entry => (
                <span
                    key={`${entry.kind}:${entry.id}`}
                    className="inline-flex items-center gap-1 pl-2 pr-1 h-6 rounded-md
                        text-xs font-medium select-none
                        bg-gray-100 dark:bg-surface-control
                        text-gray-700 dark:text-gray-200"
                >
                    <MentionIcon item={entry} size={12} />
                    <span className="max-w-[12rem] truncate">{label(entry)}</span>
                    <button
                        type="button"
                        aria-label={t('assistant.removeTag', { name: entry.name })}
                        onClick={() => onRemove(entry.kind, entry.id)}
                        className="w-4 h-4 flex items-center justify-center rounded
                            text-gray-500 dark:text-gray-400
                            hover:text-gray-900 dark:hover:text-white
                            hover:bg-black/[0.06] dark:hover:bg-white/10 transition-colors"
                    >
                        <Cancel01Icon size={10} strokeWidth={2.5} />
                    </button>
                </span>
            ))}
        </div>
    );
}

/**
 * The same tags on the message that carried them. `spaced` puts room under
 * them when something else in the bubble follows.
 */
export function SentMentions({ mentions, spaced }) {
    if (!mentions?.length) return null;

    return (
        <div className={`flex flex-wrap gap-1.5 ${spaced ? 'mb-1.5' : ''}`}>
            {mentions.map((entry, index) => (
                <span
                    key={`${entry.kind}:${entry.id || index}`}
                    title={entry.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                        text-xs bg-white/15 dark:bg-black/10"
                >
                    <span className="max-w-[14rem] truncate">
                        {entry.kind === 'skill' ? label(entry) : `@${entry.name}`}
                    </span>
                </span>
            ))}
        </div>
    );
}
