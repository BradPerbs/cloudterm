import { useEffect, useRef } from 'react';

const SIZES = {
    sm: { box: 'w-4 h-4 rounded-[5px]', stroke: 3 },
    md: { box: 'w-[18px] h-[18px] rounded-md', stroke: 2.75 },
};

/**
 * The app's checkbox.
 *
 * A native input drives it: it stays keyboard- and screen-reader-correct, and
 * space still toggles, but it is visually hidden and the `peer` variants below
 * paint a box that matches the rest of the chrome: the same near-black/white
 * fill as the primary buttons, the same radii, the same easing.
 *
 *   variant="card"  wraps the whole row in a bordered, clickable panel, which
 *                   is how the settings-style options with a description read.
 */
export default function Checkbox({
    checked,
    onChange,
    label,
    description,
    disabled = false,
    indeterminate = false,
    size = 'md',
    variant = 'inline',
    className = '',
    ...rest
}) {
    const inputRef = useRef(null);
    const { box, stroke } = SIZES[size] || SIZES.md;

    // Indeterminate is a DOM property, not an attribute, so React cannot set it.
    useEffect(() => {
        if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate) && !checked;
    }, [indeterminate, checked]);

    const wrapper = variant === 'card'
        ? 'flex items-start gap-3 rounded-xl border p-3 transition-colors '
          + 'border-gray-200 dark:border-surface-control '
          + 'hover:border-gray-300 dark:hover:border-neutral-600 '
          + 'has-[:checked]:border-gray-900/25 dark:has-[:checked]:border-white/25 '
          + 'has-[:checked]:bg-gray-50 dark:has-[:checked]:bg-surface-control/40 '
          + 'has-[:disabled]:opacity-50 has-[:disabled]:pointer-events-none'
        : `inline-flex items-start gap-2.5 ${label || description ? '' : 'align-middle'}`;

    return (
        <label
            className={`group select-none ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${wrapper} ${className}`}
        >
            <input
                ref={inputRef}
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                className="cb-input peer sr-only"
                {...rest}
            />

            <span
                aria-hidden="true"
                className={[
                    'cb-box relative shrink-0 flex items-center justify-center border-[1.5px]',
                    box,
                    label || description ? 'mt-[1px]' : '',
                    'border-gray-300 dark:border-neutral-600 bg-white dark:bg-surface-base',
                    'transition-[background-color,border-color,transform] duration-150',
                    'peer-checked:bg-gray-900 peer-checked:border-gray-900',
                    'dark:peer-checked:bg-white dark:peer-checked:border-white',
                    'peer-indeterminate:bg-gray-900 peer-indeterminate:border-gray-900',
                    'dark:peer-indeterminate:bg-white dark:peer-indeterminate:border-white',
                    'peer-focus-visible:ring-[3px] peer-focus-visible:ring-gray-900/20',
                    'dark:peer-focus-visible:ring-white/25',
                    // Hover and press are dropped outright when disabled: the
                    // `group` is an ancestor and the `peer` a sibling, so
                    // stacking those two variants yields a selector that can
                    // never match.
                    disabled
                        ? 'opacity-40'
                        : 'group-hover:border-gray-400 dark:group-hover:border-neutral-500 group-active:scale-90',
                ].join(' ')}
            >
                {/* The tick draws itself in rather than popping. */}
                <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="w-full h-full text-white dark:text-black"
                >
                    <path
                        className="cb-mark"
                        d="M5 10.4l3.4 3.4L15.2 7"
                        stroke="currentColor"
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>

                <span className="cb-dash absolute w-[9px] h-[2px] rounded-full bg-white dark:bg-black" />
            </span>

            {(label || description) && (
                <span className="flex flex-col gap-0.5 min-w-0">
                    {label && (
                        <span className={`text-sm ${
                            description
                                ? 'font-semibold text-gray-700 dark:text-gray-300'
                                : 'text-gray-700 dark:text-gray-300'
                        }`}>
                            {label}
                        </span>
                    )}
                    {description && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            {description}
                        </span>
                    )}
                </span>
            )}
        </label>
    );
}
