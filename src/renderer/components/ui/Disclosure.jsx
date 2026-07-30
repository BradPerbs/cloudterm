import { useState } from 'react';
import { ArrowRight01Icon } from 'hugeicons-react';
import SectionBoundary from './SectionBoundary';

/**
 * One optional section of a form, folded away until it is wanted.
 *
 * The host editor grew to around twenty controls, of which four are the ones
 * anybody fills in. Laid out flat, those four read as no more important than
 * the sixteen that do not, and creating a host means scrolling past port
 * forwards and algorithm flags to find the password box.
 *
 * Two rules keep the folding honest:
 *
 *   A section that already holds something opens itself, so editing a host
 *   never buries what is set on it.
 *
 *   A closed section says what is inside it, so folding costs no information.
 *   The whole record stays readable without opening anything.
 *
 * Contents are unmounted while closed rather than hidden with CSS. That keeps
 * `reportValidity` away from fields nobody can see, which would otherwise
 * refuse to submit while being unable to show what the problem was.
 */
export default function Disclosure({ title, summary, defaultOpen = false, children }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="rounded-xl border border-gray-200 dark:border-surface-control">
            {/* `surface-control` is one step up the elevation ramp from the
                sheet's own `surface-raised`, so the row lifts under the pointer.
                `surface-base` sits below it and would darken instead. */}
            <button
                type="button"
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors
                    hover:bg-gray-50 dark:hover:bg-surface-control
                    ${open ? 'rounded-t-xl' : 'rounded-xl'}`}
            >
                <ArrowRight01Icon
                    size={15}
                    strokeWidth={2.5}
                    className={`shrink-0 text-gray-400 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                />
                <span className="shrink-0 text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {title}
                </span>

                {/* Only while closed: open, the contents are saying it better.
                    Present at all only when something is configured, so a plain
                    row is a section with nothing in it. */}
                {summary && !open && (
                    <span className="ml-auto min-w-0 truncate text-[11px] font-medium text-gray-500 dark:text-neutral-400">
                        {summary}
                    </span>
                )}
            </button>

            {/* Ruled off from the header rather than just spaced away from it.
                An open section is a panel with a title on top, and without the
                rule the first field reads as another line of the header. */}
            {open && (
                <div className="flex flex-col gap-4 px-3 pt-3.5 pb-3.5 border-t border-gray-200 dark:border-surface-control">
                    <SectionBoundary name={title}>{children}</SectionBoundary>
                </div>
            )}
        </div>
    );
}
