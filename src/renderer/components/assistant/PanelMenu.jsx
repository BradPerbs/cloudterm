import { useEffect, useRef, useState } from 'react';
import { Delete02Icon, Tick02Icon } from 'hugeicons-react';

/**
 * A labelled dropdown for the assistant panel.
 *
 * `ui/MenuButton` is the app's dropdown and this is not trying to replace it,
 * but its trigger is a fixed 32px icon by design and both of the menus in this
 * panel have to say a word: which host the conversation is about, and which
 * model is answering. So the trigger is a render prop here and the menu itself
 * borrows MenuButton's styling, radius and item shape, so the two never read as
 * different kinds of dropdown.
 *
 * No portal. Everything this opens over belongs to the panel, which is a plain
 * column with nothing clipping it, unlike a menu in a terminal pane header.
 *
 * Sections carry their own value and setter, which is what lets one menu hold
 * two unrelated choices: the composer's chip sets the model and the effort from
 * a single popover, the way one control that reads "Opus 5, High" ought to.
 *
 * A section may bring a control of its own instead of a list of rows, as
 * `content`. Effort is a run along one scale rather than a set of alternatives,
 * and five rows of radio buttons say the opposite: they make "low" and "max"
 * look like different things to pick rather than two ends of the same dial.
 * Such a section can also put its current value in the heading line, as
 * `aside`, since the rows that would otherwise have carried a tick are gone.
 *
 * `note` is a node under the rows, for the state a list of choices cannot show
 * on its own: that it is still being read, or that reading it failed and the
 * offer is to try again.
 *
 * An option may carry a `badge`: a short string that sits beside the label
 * instead of inside it, so it survives a name long enough to be truncated. The
 * scope menu uses it to say which of four sessions on the same host a row is.
 *
 * An option may also carry `onRemove`, which the history menu uses to throw a
 * conversation away. It is drawn beside the row rather than inside it, because
 * a button nested in a button is not a thing, and it only appears on hover: a
 * delete on every row of a list you are scanning is an invitation to misclick.
 *
 * A row is meant to be read, not decoded. Two lines, and the separation between
 * them comes from the title going the whole way to white rather than from the
 * description being dimmed into the background: a description at 11px has to
 * stay comfortably readable, so it cannot be the thing that gives way.
 *
 * The choice you are currently on carries a filled background as well as a
 * tick, because a tick in the corner is not an answer to "which one am I on".
 */

const ITEM = `w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left
    transition-colors`;

/** A row you are not on: nothing at rest, the ramp's first step under the pointer. */
const HOVER = 'hover:bg-gray-100 dark:hover:bg-surface-control';

/**
 * The row you are on.
 *
 * The next step up the same ramp the hover uses, rather than a translucent
 * white laid over the menu. Those are two different systems, and it showed:
 * an overlay does not move when the app is retinted, so the current choice
 * drifted grey against a themed hover sitting right above it.
 *
 * One step, not several. It has a tick as well, so this only has to answer
 * "which one am I on" at a glance, and it has to keep doing that while the
 * pointer is resting on some other row. Its own hover is a step further up
 * again, or the row you are on would be the one row in the menu that does not
 * respond to the pointer.
 */
const SELECTED = `bg-gray-200 dark:bg-surface-hover
    hover:bg-gray-300 dark:hover:bg-surface-active`;

const REMOVE = `absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md
    flex items-center justify-center transition-colors
    opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100
    text-gray-400 dark:text-neutral-500
    hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400`;

export default function PanelMenu({
    trigger,
    sections,
    align = 'left',
    direction = 'down',
    menuClassName = 'w-64',
    className = '',
}) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;

        const onPointerDown = (event) => {
            if (!wrapperRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                // Claimed, or Escape would also blur the composer behind it.
                event.stopPropagation();
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);

    const place = [
        direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
        align === 'right' ? 'right-0' : 'left-0',
    ].join(' ');

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            {trigger({ open, toggle: () => setOpen(value => !value) })}

            {open && (
                <div
                    role="menu"
                    className={`absolute ${place} ${menuClassName} z-40 p-1 rounded-xl
                        max-h-80 overflow-y-auto animate-dialog-in
                        bg-white dark:bg-surface-raised
                        border border-gray-200 dark:border-surface-control
                        shadow-xl shadow-black/10 dark:shadow-black/40`}
                >
                    {sections.map((section, index) => (
                        <div key={section.heading || `section-${index}`}>
                            {index > 0 && (
                                <div className="-mx-1 my-1.5 border-t border-gray-100 dark:border-surface-control" />
                            )}
                            {section.heading && (
                                <div className="px-2.5 pb-1.5 pt-1 flex items-baseline gap-2
                                    text-[11px] font-semibold text-gray-500 dark:text-neutral-400">
                                    <span>{section.heading}</span>
                                    {section.aside && (
                                        <span className="ml-auto text-gray-900 dark:text-white">
                                            {section.aside}
                                        </span>
                                    )}
                                </div>
                            )}
                            {section.content}
                            {(section.content ? [] : section.options).map(option => (

                                <div key={option.value} className="relative group/row">
                                    <button
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={option.value === section.value}
                                        onClick={() => {
                                            setOpen(false);
                                            if (option.value !== section.value) section.onChange(option.value);
                                        }}
                                        className={`${ITEM} ${option.onRemove ? 'pr-8' : ''}
                                            ${option.value === section.value ? SELECTED : HOVER}`}
                                    >
                                        {option.icon && (
                                            <span className={`w-4 h-4 flex items-center justify-center shrink-0
                                                ${option.value === section.value
                                                    ? 'text-gray-900 dark:text-white'
                                                    : 'text-gray-500 dark:text-neutral-400'}`}>
                                                {option.icon}
                                            </span>
                                        )}
                                        <span className="flex-1 min-w-0">
                                            <span className="flex items-baseline gap-1.5">
                                                <span className="min-w-0 text-[13px] font-medium truncate
                                                    text-gray-900 dark:text-white">
                                                    {option.label}
                                                </span>
                                                {/* Beside the name rather than
                                                    part of it, so a label long
                                                    enough to be cut does not
                                                    lose the one thing telling
                                                    it from the row above. */}
                                                {option.badge && (
                                                    <span className="shrink-0 text-[10px] font-semibold
                                                        tabular-nums text-gray-400 dark:text-neutral-500">
                                                        {option.badge}
                                                    </span>
                                                )}
                                            </span>
                                            {option.hint && (
                                                <span className="block text-[11px] leading-snug truncate
                                                    text-gray-500 dark:text-neutral-400">
                                                    {option.hint}
                                                </span>
                                            )}
                                        </span>
                                        {option.value === section.value && (
                                            <Tick02Icon
                                                size={14}
                                                strokeWidth={2.5}
                                                className="shrink-0 text-gray-900 dark:text-white"
                                            />
                                        )}
                                    </button>

                                    {option.onRemove && (
                                        <button
                                            type="button"
                                            aria-label={`Delete ${option.label}`}
                                            title="Delete"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                option.onRemove();
                                            }}
                                            className={REMOVE}
                                        >
                                            <Delete02Icon size={13} strokeWidth={1.5} />
                                        </button>
                                    )}
                                </div>
                            ))}

                            {/* Anything the section wants to say under its
                                rows: that the list is still coming, or that it
                                did not arrive and can be asked for again. */}
                            {section.note}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
