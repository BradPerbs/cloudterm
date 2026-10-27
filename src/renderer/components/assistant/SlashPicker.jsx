import { memo, useEffect, useRef } from 'react';
import { CommandLineIcon } from 'hugeicons-react';
import useEnter from '../../hooks/useEnter';
import { useT } from '../../i18n';

/**
 * What a leading `/` opens: the skills on this machine, filtered by the
 * command typed after it.
 *
 * Drawn over the composer like the `@` picker, and driven the same way from
 * the textarea: the arrows move the highlight, Enter and Tab take the
 * highlighted row, Escape puts the list away. Picking a skill does not paste
 * its instructions into the box. It goes with the message as a chip, and main
 * reads its SKILL.md when the message is sent.
 */
function SlashPicker({ items, query, active, onPick, onHover }) {
    const t = useT();
    const listRef = useRef(null);
    const ref = useEnter('dialog');

    useEffect(() => {
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label={t('assistant.skills')}
            className="absolute bottom-full left-0 right-0 mb-2 z-40 rounded-xl overflow-hidden
                bg-white dark:bg-surface-raised
                border border-gray-200 dark:border-surface-control
                shadow-xl shadow-black/10 dark:shadow-black/40"
        >
            <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
                {items.length === 0 ? (
                    <p className="px-2.5 py-3 text-center text-[11px] leading-relaxed text-gray-500 dark:text-neutral-400">
                        {query ? t('assistant.skillNoMatches', { query }) : t('assistant.skillsEmpty')}
                    </p>
                ) : (
                    <>
                        <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold text-gray-500 dark:text-neutral-400">
                            {t('assistant.skills')}
                        </div>
                        {items.map((skill, index) => (
                            <button
                                key={skill.id}
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                data-active={index === active ? 'true' : 'false'}
                                onMouseMove={() => onHover(index)}
                                // The pointer must not take the caret out of the
                                // textarea before the click lands on the row.
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => onPick(skill)}
                                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left
                                    transition-colors
                                    ${index === active
                                        ? 'bg-gray-100 dark:bg-surface-control'
                                        : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
                            >
                                <CommandLineIcon
                                    size={14}
                                    strokeWidth={1.75}
                                    className="shrink-0 text-violet-600 dark:text-violet-300"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-medium truncate text-gray-900 dark:text-white">
                                        /{skill.name || skill.id}
                                        {skill.hint && (
                                            <span className="ml-1.5 font-normal text-[11px] text-gray-400 dark:text-neutral-500">
                                                {skill.hint}
                                            </span>
                                        )}
                                    </span>
                                    {skill.description && (
                                        <span className="block text-[11px] truncate text-gray-500 dark:text-neutral-400">
                                            {skill.description}
                                        </span>
                                    )}
                                </span>
                            </button>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}

export default memo(SlashPicker);
