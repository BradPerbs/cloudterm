import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown01Icon, Tick02Icon } from 'hugeicons-react';
import { useEnterOn } from '../../hooks/useEnter';

/** How tall the list may get before it starts scrolling. */
const MAX_MENU_HEIGHT = 288;

/** The gap between the field and its list, matching ui/MenuButton.jsx. */
const GAP = 6;

/** Keystrokes this close together are one word being typed, not two. */
const TYPEAHEAD_RESET = 700;

/**
 * A dropdown field.
 *
 * A native `select` is the one control in the app the browser insists on
 * drawing itself, and it cannot be talked out of it: the closed box takes CSS,
 * but the list it opens is the platform's, square-cornered and grey, in the
 * middle of a shell that is neither. So the list is drawn here instead, out of
 * the same parts as every other menu in the app (see ui/MenuButton.jsx): a
 * rounded panel on the raised surface, rows that light under the pointer, and a
 * tick against the row that is the current answer.
 *
 * The closed control keeps whatever class the field already passed, so a select
 * swapped for this one looks exactly as it did shut and only opens differently.
 *
 * `options` are `{ value, label, disabled? }`. Values are compared as strings,
 * so a numeric field (the baud rate, the data bits) can keep its numbers.
 *
 * `required` is honoured through a mirrored native select, laid out behind the
 * button rather than hidden, so a form calling `reportValidity()` still gets
 * the browser's own bubble pointing at this field. HostModal does exactly that.
 */
export default function Select({
    value,
    onChange,
    options,
    className = '',
    containerClassName = '',
    menuClassName = '',
    placeholder = '',
    disabled = false,
    required = false,
    name,
    id,
    title,
    'aria-label': ariaLabel,
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const [active, setActive] = useState(-1);

    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const rowsRef = useRef([]);
    const typed = useRef({ term: '', at: 0 });

    // The list is rendered on a condition rather than mounted, so the entrance
    // is asked for each time it opens. See lib/enterMotion.
    useEnterOn(menuRef, open && 'dialog');

    const selectedIndex = useMemo(
        () => options.findIndex(option => String(option.value) === String(value ?? '')),
        [options, value],
    );
    const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

    const close = useCallback(({ focus = true } = {}) => {
        setOpen(false);
        setPosition(null);
        if (focus) triggerRef.current?.focus();
    }, []);

    const pick = useCallback((option) => {
        if (option.disabled) return;
        close();
        onChange(option.value);
    }, [close, onChange]);

    /**
     * Where the list goes: under the field by preference, over it when the
     * field sits low enough that the list would run off the bottom. Fixed
     * rather than absolute, because the panes and sheets it opens inside are
     * `overflow: hidden` and would clip it.
     */
    useLayoutEffect(() => {
        if (!open) return undefined;

        const place = (event) => {
            const trigger = triggerRef.current;
            if (!trigger) return;

            // The list scrolling inside itself has not moved the field, and
            // re-placing it on every wheel event would only cost renders.
            if (event && menuRef.current?.contains(event.target)) return;

            const rect = trigger.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom - GAP - 8;
            const above = rect.top - GAP - 8;
            const flip = below < Math.min(MAX_MENU_HEIGHT, 160) && above > below;

            setPosition({
                left: rect.left,
                width: rect.width,
                top: flip ? undefined : rect.bottom + GAP,
                bottom: flip ? window.innerHeight - rect.top + GAP : undefined,
                maxHeight: Math.max(120, Math.min(MAX_MENU_HEIGHT, flip ? above : below)),
            });
        };

        place();

        // Anything that moves the field moves the list with it: settings pages
        // scroll, and so does the inside of the host sheet.
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);

        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    // The arrow keys and typeahead belong to the panel while it is up, which
    // saves making every row a tab stop.
    useEffect(() => {
        if (open) menuRef.current?.focus();
    }, [open]);

    // Opening lands on the current answer, so the first arrow key steps off it
    // rather than off the top of the list.
    useEffect(() => {
        if (!open) return;
        setActive(selectedIndex >= 0 ? selectedIndex : 0);
    }, [open, selectedIndex]);

    useEffect(() => {
        if (!open || !position) return;
        rowsRef.current[active]?.scrollIntoView({ block: 'nearest' });
    }, [open, position, active]);

    useEffect(() => {
        if (!open) return undefined;

        const handlePointerDown = (event) => {
            if (menuRef.current?.contains(event.target)) return;
            if (triggerRef.current?.contains(event.target)) return;
            close({ focus: false });
        };
        const handleBlur = () => close({ focus: false });

        document.addEventListener('mousedown', handlePointerDown, true);
        window.addEventListener('blur', handleBlur);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown, true);
            window.removeEventListener('blur', handleBlur);
        };
    }, [open, close]);

    /**
     * The keys a native select answers to, since this one has to answer too.
     *
     * On `window` and in the capture phase, which is not fussiness: the sheet
     * and the dialog this field opens inside both trap Escape and Tab on
     * `document`, and a listener there would run before anything of ours
     * bubbled. Escape has to shut the list without taking the sheet down with
     * it, so it is stopped here, one step above where the sheet is listening.
     *
     * Tab is the exception that is deliberately let through: the list closes,
     * focus goes back to the field, and the sheet's own trap then moves it on
     * to the next control from there.
     */
    const handleKeyDown = useCallback((event) => {
        const step = (delta) => {
            event.preventDefault();
            setActive((current) => {
                let next = current;
                for (let i = 0; i < options.length; i += 1) {
                    next = (next + delta + options.length) % options.length;
                    if (!options[next].disabled) return next;
                }
                return current;
            });
        };

        switch (event.key) {
            case 'ArrowDown': event.stopPropagation(); step(1); return;
            case 'ArrowUp': event.stopPropagation(); step(-1); return;
            case 'Home': event.preventDefault(); event.stopPropagation(); setActive(0); return;
            case 'End':
                event.preventDefault();
                event.stopPropagation();
                setActive(options.length - 1);
                return;
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
            case 'Tab':
                // Left to carry on to the sheet, from the field rather than
                // from a list that is about to stop existing.
                close();
                return;
            case 'Enter':
            case ' ':
                event.preventDefault();
                event.stopPropagation();
                if (options[active]) pick(options[active]);
                return;
            default:
                break;
        }

        // Typeahead: the one thing a native select does that is easy to miss
        // once it is gone. With thirty serial ports listed, "c" should reach
        // COM3 without thirty presses of the arrow key.
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;

        const now = event.timeStamp;
        const term = (now - typed.current.at < TYPEAHEAD_RESET ? typed.current.term : '')
            + event.key.toLowerCase();
        typed.current = { term, at: now };

        // `search` is for the rows whose label is a node rather than a string,
        // which is the only way one of them can carry markup of its own.
        const starts = (option) => {
            const text = option.search ?? (typeof option.label === 'string' ? option.label : '');
            return text.toLowerCase().startsWith(term);
        };
        const ahead = options.findIndex((option, index) => index > active && starts(option));
        const match = ahead >= 0 ? ahead : options.findIndex(starts);

        if (match >= 0) setActive(match);
    }, [options, active, close, pick]);

    useEffect(() => {
        if (!open) return undefined;

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [open, handleKeyDown]);

    return (
        <div className={`relative min-w-0 ${containerClassName}`}>
            <button
                ref={triggerRef}
                type="button"
                id={id}
                title={title}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => (open ? close() : setOpen(true))}
                onKeyDown={(event) => {
                    if (open) return;
                    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
                className={`flex items-center justify-between gap-2 text-left
                    disabled:cursor-not-allowed ${className}`}
            >
                <span className={`flex-1 min-w-0 truncate ${
                    selected ? '' : 'text-gray-400 dark:text-neutral-500'
                }`}>
                    {selected ? selected.label : placeholder}
                </span>
                <ArrowDown01Icon
                    size={16}
                    strokeWidth={2}
                    className={`shrink-0 text-gray-400 dark:text-neutral-500 transition-transform duration-150 ${
                        open ? 'rotate-180' : ''
                    }`}
                />
            </button>

            {/* The browser's own `required` handling, kept alive under the
                button. It has to be laid out rather than hidden, or Chromium
                refuses to point a validation bubble at it. */}
            {required && (
                <select
                    tabIndex={-1}
                    aria-hidden="true"
                    required
                    name={name}
                    value={value ?? ''}
                    onChange={() => {}}
                    className="absolute left-3 bottom-0 w-px h-px p-0 border-0 opacity-0 pointer-events-none"
                >
                    {/* An empty entry has to exist for the blank state to be
                        representable, but only where the field has not already
                        offered one of its own. */}
                    {options.every(option => String(option.value) !== '') && <option value="" />}
                    {options.map(option => (
                        <option key={String(option.value)} value={option.value} />
                    ))}
                </select>
            )}

            {open && createPortal(
                <div
                    ref={menuRef}
                    role="listbox"
                    tabIndex={-1}
                    aria-activedescendant={options[active] ? `${id || 'select'}-option-${active}` : undefined}
                    className={`fixed z-[9999] p-1 rounded-xl overflow-y-auto outline-none
                        bg-white dark:bg-surface-raised
                        border border-gray-200 dark:border-surface-control
                        shadow-xl shadow-black/10 dark:shadow-black/40
                        ${menuClassName}`}
                    style={{
                        left: position?.left ?? -9999,
                        top: position?.top,
                        bottom: position?.bottom,
                        width: position?.width,
                        maxHeight: position?.maxHeight,
                        // Placed before it is measured, so it does not flash in
                        // the wrong corner for a frame.
                        visibility: position ? 'visible' : 'hidden',
                    }}
                >
                    {options.map((option, index) => {
                        const isSelected = index === selectedIndex;

                        return (
                            <button
                                key={String(option.value)}
                                ref={(node) => { rowsRef.current[index] = node; }}
                                id={`${id || 'select'}-option-${index}`}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled={option.disabled}
                                onClick={() => pick(option)}
                                onMouseMove={() => setActive(index)}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                                    text-sm text-left transition-colors
                                    disabled:opacity-40 disabled:cursor-not-allowed ${
                                    index === active
                                        ? 'bg-gray-100 dark:bg-surface-control text-gray-900 dark:text-white'
                                        : 'text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                <span className="flex-1 min-w-0 truncate">{option.label}</span>
                                <span className="shrink-0 w-3.5 flex items-center justify-center
                                    text-gray-900 dark:text-white">
                                    {isSelected && <Tick02Icon size={13} strokeWidth={2.5} />}
                                </span>
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </div>
    );
}
