/**
 * Form field chrome, in one place.
 *
 * The inputs across the host, key, folder and snippet forms had drifted into
 * three different heights, two radii and two focus treatments. They all read as
 * the same kind of control, so they are all styled from here.
 *
 * `rounded-xl` because that is what every full-height control in the app is:
 * `Button` and `IconButton` at `md` and `lg`, the menus, the sheet's close. A
 * field at `rounded-lg` was the odd one out, and it showed most in the sheets,
 * where a stack of them sits directly above a footer of buttons. The smaller
 * `rounded-lg` is not wrong, it is just the radius the same components use at
 * `sm`: it belongs to h-8 controls, and these are h-9 and taller.
 */

export const FIELD_CLASS = 'w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-surface-control '
    + 'bg-white dark:bg-surface-base text-gray-900 dark:text-white text-sm outline-none '
    + 'transition-colors focus:border-gray-400 dark:focus:border-neutral-600 '
    + 'placeholder:text-gray-400 disabled:opacity-50';

/** Same box, for anything the user reads as code: paths, keys, commands. */
export const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono text-xs leading-relaxed`;

export default function Field({ label, hint, error, children, className = '' }) {
    return (
        <label className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
            {label && (
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</span>
            )}
            {children}
            {error
                ? <span className="text-[11px] text-red-500 font-medium">{error}</span>
                : hint && <span className="text-[11px] text-gray-500 dark:text-neutral-500">{hint}</span>}
        </label>
    );
}
