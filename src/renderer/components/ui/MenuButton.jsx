import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTooltip } from './Tooltip';
import { useEnterOn } from '../../hooks/useEnter';

/**
 * A `ContextMenu` item list, in the shape this dropdown takes.
 *
 * A card's menu is described once and offered twice, from a button and from a
 * right-click on the card, and the two components were written with slightly
 * different item objects. This is the translation, kept beside the component
 * that needs it, so that a card's two menus cannot drift into disagreeing about
 * what it can do. Headings and custom rows have no dropdown equivalent and are
 * dropped.
 */
export function dropdownItems(items) {
    return items
        .filter(item => item && item.type !== 'heading' && item.type !== 'custom')
        .map(item => (item.type === 'separator' ? { separator: true } : {
            label: item.label,
            icon: item.icon,
            hint: item.shortcut,
            danger: item.danger,
            disabled: item.disabled,
            onSelect: item.onClick,
        }));
}

/**
 * An icon button with a dropdown.
 *
 * The menu is portalled to the body and positioned from the button's rectangle,
 * so it is never clipped by the panel it was opened from. Panes in particular
 * are `overflow: hidden`, which an in-flow menu would be cut off by.
 *
 * Items are `{ label, hint?, icon?, onSelect, danger?, disabled? }`, or
 * `{ separator: true }`.
 *
 * A dropdown that is not a list of one-shot commands passes `children` instead:
 * either a node or a `(close) => node`, rendered in place of the items with the
 * portal, the placement and the dismissal handling unchanged. That is what the
 * Hosts page's sort menu is — a panel with checkboxes in it, which has to
 * survive being clicked rather than close on the first press. One popover
 * implementation, because there is only one popover.
 *
 * `badge` puts a count on the closed button. A dropdown that is quietly holding
 * a filter needs to say so from the outside, or the page is narrowed for a
 * reason that is two clicks out of sight.
 */
export default function MenuButton({
    icon,
    title,
    items,
    children,
    badge = 0,
    menuClassName = '',
    align = 'right',
    disabled = false,
    active = false,
    className = '',
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const buttonRef = useRef(null);
    const menuRef = useRef(null);

    // The menu is rendered on a condition rather than mounted, so the entrance
    // is asked for each time it opens. See lib/enterMotion.
    useEnterOn(menuRef, open && 'dialog');

    // Nothing to explain once the menu is showing, and a bubble over its first
    // item would be covering the answer.
    const { triggerProps, tooltip } = useTooltip({ label: title, enabled: !open });

    const close = useCallback(() => setOpen(false), []);

    useLayoutEffect(() => {
        if (!open || !buttonRef.current) return;

        const rect = buttonRef.current.getBoundingClientRect();
        const width = menuRef.current?.offsetWidth || 224;
        const left = align === 'right' ? rect.right - width : rect.left;

        setPosition({
            top: rect.bottom + 6,
            // Never off the edge of the window, whichever side it opens from.
            left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        });
    }, [open, align]);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event) => {
            if (menuRef.current?.contains(event.target)) return;
            if (buttonRef.current?.contains(event.target)) return;
            close();
        };
        const handleKey = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
                buttonRef.current?.focus();
            }
        };

        document.addEventListener('mousedown', handlePointerDown, true);
        document.addEventListener('keydown', handleKey, true);
        window.addEventListener('blur', close);
        window.addEventListener('resize', close);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKey, true);
            window.removeEventListener('blur', close);
            window.removeEventListener('resize', close);
        };
    }, [open, close]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-label={title}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpen(value => !value)}
                {...triggerProps}
                className={`relative w-8 h-8 flex items-center justify-center rounded-xl transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed ${
                    open || active
                        ? 'bg-gray-100 text-gray-900 dark:bg-surface-control dark:text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-surface-control dark:hover:text-white'
                } ${className}`}
            >
                {icon}

                {/* Out of flow, so the button neither resizes nor shifts the
                    row it sits in when a count appears. */}
                {badge > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1
                            rounded-full bg-blue-500 text-white
                            text-[9px] font-bold leading-none tabular-nums
                            flex items-center justify-center
                            ring-2 ring-white dark:ring-surface-raised"
                    >
                        {badge > 9 ? '9+' : badge}
                    </span>
                )}
            </button>

            {tooltip}

            {open && createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    className={`fixed rounded-xl z-[9999]
                        bg-white dark:bg-surface-raised
                        border border-gray-200 dark:border-surface-control
                        shadow-xl shadow-black/10 dark:shadow-black/40
                        ${children ? menuClassName : `min-w-[220px] p-1 ${menuClassName}`}`}
                    style={{
                        top: position?.top ?? -9999,
                        left: position?.left ?? -9999,
                        // Placed before it is measured, so hold it back for one
                        // frame rather than letting it flash in the wrong spot.
                        visibility: position ? 'visible' : 'hidden',
                    }}
                >
                    {children ? (
                        typeof children === 'function' ? children(close) : children
                    ) : items.map((item, index) => (
                        item.separator ? (
                            <div
                                key={`separator-${index}`}
                                className="-mx-1 my-1.5 border-t border-gray-100 dark:border-surface-control"
                            />
                        ) : (
                            <button
                                key={item.label}
                                type="button"
                                role="menuitem"
                                disabled={item.disabled}
                                onClick={() => { close(); item.onSelect?.(); }}
                                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors
                                    disabled:opacity-40 disabled:cursor-not-allowed ${
                                    item.danger
                                        ? 'text-red-600 dark:text-red-400 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-900/20'
                                        : 'text-gray-700 dark:text-gray-300 enabled:hover:bg-gray-100 dark:enabled:hover:bg-surface-control'
                                }`}
                            >
                                {item.icon && (
                                    <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-70">
                                        {item.icon}
                                    </span>
                                )}
                                <span className="font-medium flex-1 truncate">{item.label}</span>
                                {item.hint && (
                                    <span className="text-[10px] tabular-nums text-gray-400 dark:text-neutral-500 shrink-0">
                                        {item.hint}
                                    </span>
                                )}
                            </button>
                        )
                    ))}
                </div>,
                document.body
            )}
        </>
    );
}
