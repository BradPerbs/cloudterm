import { useEffect, useRef, useState } from 'react';
import { Delete02Icon, Tick02Icon } from 'hugeicons-react';
import { useTooltip } from '../ui/Tooltip';
import { useEnterOn } from '../../hooks/useEnter';
import { useT } from '../../i18n';

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
 * A section may instead be `multi`, which turns its rows into checkboxes: it
 * carries `values`, an array, and `onToggle` rather than `onChange`, and a
 * click leaves the menu open. Picking three servers out of ten is three clicks
 * and one glance at what is ticked, not three round trips through a menu that
 * shuts itself each time.
 *
 * `header` is a block above the sections that does not scroll away, for the
 * search field a long list needs. Without one the menu is a single scroller,
 * exactly as it was.
 *
 * An option may carry a `badge`: a short string that sits beside the label
 * instead of inside it, so it survives a name long enough to be truncated. The
 * scope menu uses it to say which of four sessions on the same host a row is.
 *
 * It may also carry a `tooltip`, with `tooltipHint` dimmed beside it, for the
 * detail that would otherwise be a second line. A list of servers reads best as
 * one line each, the way the tab strip does: the name identifies it and the
 * address is what you check when you are unsure, which is a hover rather than
 * something to be read forty times on the way down the list.
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

/**
 * The box on a checkable row.
 *
 * Drawn here rather than reached for from `ui/Checkbox`, which is a `<label>`
 * around a real input: a row is a button, and an input inside a button is not a
 * thing the browser or a screen reader can make sense of. The row carries
 * `role="menuitemcheckbox"` and `aria-checked` instead, so this is decoration,
 * and it borrows the checkbox's own fill and radius so the two do not read as
 * different controls.
 */
function CheckBox({ checked }) {
    return (
        <span
            aria-hidden="true"
            className={`w-4 h-4 shrink-0 rounded-[5px] border-[1.5px] flex items-center justify-center
                transition-colors
                ${checked
                    ? 'bg-gray-900 border-gray-900 dark:bg-white dark:border-white'
                    : 'border-gray-300 dark:border-neutral-600'}`}
        >
            {checked && (
                <Tick02Icon size={11} strokeWidth={3} className="text-white dark:text-black" />
            )}
        </span>
    );
}

/**
 * One row.
 *
 * A component of its own because a tooltip is a hook, and a row inside a
 * `.map` cannot have one. `useTooltip` rather than the `<Tooltip>` wrapper for
 * the same reason the hook exists: the wrapper is an `inline-flex` span, and a
 * full-width row inside a content-sized box is a row that collapses.
 */
function Row({ option, section, checked, onPick }) {
    const t = useT();
    const { triggerProps, tooltip } = useTooltip({
        label: option.tooltip,
        hint: option.tooltipHint,
        placement: 'left',
    });

    return (
        <div className="relative group/row">
            <button
                type="button"
                role={section.multi ? 'menuitemcheckbox' : 'menuitemradio'}
                aria-checked={checked}
                {...triggerProps}
                onClick={onPick}
                className={`${ITEM} ${option.onRemove ? 'pr-8' : ''}
                    ${checked && !section.multi ? SELECTED : HOVER}`}
            >
                {/* The box and the mark are one leading block on a tighter gap
                    than the row's, so a checkable row with an icon does not
                    spend a third of its width getting to the name. */}
                {(section.multi || option.icon) && (
                    <span className="flex items-center gap-2 shrink-0">
                        {section.multi && <CheckBox checked={checked} />}
                        {option.icon && (
                            <span className={`w-4 h-4 flex items-center justify-center
                                ${section.multi || checked
                                    ? 'text-gray-900 dark:text-white'
                                    : 'text-gray-500 dark:text-neutral-400'}
                                ${option.dim ? 'opacity-40' : ''}`}>
                                {option.icon}
                            </span>
                        )}
                    </span>
                )}

                <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 text-[13px] font-medium truncate
                            text-gray-900 dark:text-white">
                            {option.label}
                        </span>
                        {/* Beside the name rather than part of it, so a label
                            long enough to be cut does not lose the one thing
                            telling it from the row above. */}
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

                {/* The tick is the radio's answer to "which one am I on". A
                    checkable row has a box for that already. */}
                {checked && !section.multi && (
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
                    aria-label={t('common.deleteNamed', { name: option.label })}
                    title={t('common.delete')}
                    onClick={(event) => {
                        event.stopPropagation();
                        option.onRemove();
                    }}
                    className={REMOVE}
                >
                    <Delete02Icon size={13} strokeWidth={1.5} />
                </button>
            )}

            {tooltip}
        </div>
    );
}

export default function PanelMenu({
    trigger,
    sections,
    header,
    align = 'left',
    direction = 'down',
    menuClassName = 'w-64',
    className = '',
}) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef(null);
    const menuRef = useRef(null);

    // Rendered on a condition rather than mounted, so the entrance is asked
    // for each time it opens. See lib/enterMotion.
    useEnterOn(menuRef, open && 'dialog');

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
                    ref={menuRef}
                    role="menu"
                    className={`absolute ${place} ${menuClassName} z-40 rounded-xl
                        max-h-80 flex flex-col
                        bg-white dark:bg-surface-raised
                        border border-gray-200 dark:border-surface-control
                        shadow-xl shadow-black/10 dark:shadow-black/40`}
                >
                    {/* Above the scroller rather than inside it, so a search
                        field stays put while the list it filters moves. */}
                    {header && <div className="shrink-0 p-1 pb-0">{header}</div>}

                    <div className="flex-1 min-h-0 overflow-y-auto p-1">
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
                                {(section.content ? [] : section.options).map((option) => {
                                    const checked = section.multi
                                        ? section.values.includes(option.value)
                                        : option.value === section.value;

                                    return (
                                        <Row
                                            key={option.value}
                                            option={option}
                                            section={section}
                                            checked={checked}
                                            onPick={() => {
                                                // A checkable row leaves the menu
                                                // open: picking three servers
                                                // should be three clicks, not
                                                // three trips back through the
                                                // trigger.
                                                if (section.multi) {
                                                    section.onToggle(option.value);
                                                    return;
                                                }
                                                setOpen(false);
                                                if (!checked) section.onChange(option.value);
                                            }}
                                        />
                                    );
                                })}

                                {/* Anything the section wants to say under its
                                    rows: that the list is still coming, or that it
                                    did not arrive and can be asked for again. */}
                                {section.note}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
