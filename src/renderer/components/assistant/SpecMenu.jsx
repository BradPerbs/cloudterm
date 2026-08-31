import { useMemo, useState } from 'react';
import { Note01Icon, PlusSignIcon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';
import SearchField from '../ui/SearchField';
import { useTooltip } from '../ui/Tooltip';
import { useT } from '../../i18n';

/**
 * Attach specs to the message being written.
 *
 * A spec is a snippet of kind `spec`: a document written for the agent rather
 * than for a shell. A runbook, the house rules for a fleet, a brief for a
 * piece of work. It is kept in the Snippets library with everything else the
 * user reaches for, and this is where it is reached for from the chat.
 *
 * Checkboxes rather than a pick-one list, because "follow the deploy checklist
 * and the on-call rules" is two documents on one question, and a menu that
 * shut itself after the first would make the second a second trip.
 *
 * The button is drawn to the same 28px circle as the image picker beside it,
 * and carries a count when something is attached: the chips above the field
 * say what, but the row the button sits on should say *that* without looking
 * up.
 */

/** More than this and a search field earns its place above the list. */
const SEARCH_FROM = 6;

/** The first line of a document, for the row's second line. */
const firstLine = (text) => String(text || '').split('\n').find(line => line.trim()) || '';

export default function SpecMenu({ specs, selected, onToggle, onCreate }) {
    const t = useT();
    const [query, setQuery] = useState('');

    const { triggerProps, tooltip } = useTooltip({
        label: t('assistant.attachSpec'),
        hint: t('assistant.attachSpecHint'),
        placement: 'top',
    });

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return specs;
        return specs.filter(spec => (
            spec.name.toLowerCase().includes(needle)
            || (spec.description || '').toLowerCase().includes(needle)
            || spec.tags?.some(tag => tag.includes(needle))
        ));
    }, [specs, query]);

    const count = selected.length;

    const sections = specs.length === 0
        ? [{
            heading: t('assistant.specs'),
            content: (
                <div className="px-2.5 pt-1 pb-2 flex flex-col gap-2.5">
                    <p className="text-[11px] leading-snug text-gray-500 dark:text-neutral-400">
                        {t('assistant.noSpecsNote')}
                    </p>
                    <button
                        type="button"
                        onClick={onCreate}
                        className="h-8 px-3 rounded-lg flex items-center justify-center gap-1.5
                            text-xs font-medium select-none transition-colors
                            border border-dashed
                            border-gray-300 dark:border-white/[0.14]
                            text-gray-600 dark:text-gray-400
                            hover:border-gray-400 dark:hover:border-white/25
                            hover:bg-gray-50 dark:hover:bg-white/[0.03]
                            hover:text-gray-900 dark:hover:text-gray-200"
                    >
                        <PlusSignIcon size={13} strokeWidth={2} />
                        {t('assistant.createSpec')}
                    </button>
                </div>
            ),
        }]
        : [{
            heading: t('assistant.specs'),
            aside: count > 0 ? String(count) : '',
            multi: true,
            values: selected,
            onToggle,
            options: shown.map(spec => ({
                value: spec.id,
                label: spec.name,
                hint: spec.description || firstLine(spec.command),
                icon: <Note01Icon size={14} strokeWidth={1.5} />,
            })),
            note: shown.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-gray-500 dark:text-neutral-400">
                    {t('common.noMatchesTitle')}
                </p>
            ) : null,
        }];

    return (
        <PanelMenu
            direction="up"
            menuClassName="w-64"
            sections={sections}
            header={specs.length >= SEARCH_FROM ? (
                <SearchField
                    value={query}
                    onChange={setQuery}
                    ariaLabel={t('assistant.searchSpecs')}
                />
            ) : null}
            trigger={({ open, toggle }) => (
                <>
                    <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label={t('assistant.attachSpec')}
                        onClick={toggle}
                        {...triggerProps}
                        className={`relative w-7 h-7 shrink-0 flex items-center justify-center
                            rounded-full transition-colors
                            ${open || count > 0
                                ? 'bg-gray-100 dark:bg-surface-control text-gray-700 dark:text-gray-200'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-control '
                                    + 'hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        <Note01Icon size={15} strokeWidth={2} />
                        {count > 0 && (
                            <span
                                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1
                                    rounded-full bg-gray-900 dark:bg-white text-white dark:text-black
                                    text-[9px] font-bold leading-none tabular-nums
                                    flex items-center justify-center"
                            >
                                {count}
                            </span>
                        )}
                    </button>
                    {tooltip}
                </>
            )}
        />
    );
}
