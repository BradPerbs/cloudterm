import Tooltip from './Tooltip';

/**
 * The app's button.
 *
 * Every panel header, sheet footer and dialog action goes through here, so the
 * height, radius, weight and press feedback are decided once. They used to be
 * written out at each call site, which is why the same "new thing" button was
 * 36px on one page and 40px on the next.
 *
 * Sizes are fixed heights rather than padding, because a row of buttons only
 * looks aligned if they agree on a height regardless of whether they hold an
 * icon, a label, or both.
 */

const SIZES = {
    sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
    md: 'h-9 px-4 text-sm gap-2 rounded-xl',
    lg: 'h-10 px-5 text-sm gap-2 rounded-xl',
};

const ICON_SIZES = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-9 h-9 rounded-xl',
    lg: 'w-10 h-10 rounded-xl',
};

const VARIANTS = {
    // The one action a screen is really offering.
    primary: 'bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90 shadow-md',
    // Sits beside a primary without competing with it.
    secondary: 'border border-gray-300 dark:border-surface-control text-gray-700 dark:text-gray-300 '
        + 'hover:bg-gray-50 dark:hover:bg-surface-control',
    // Filled but quiet, for the icon buttons that flank a primary.
    subtle: 'bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-400 '
        + 'hover:bg-gray-200 dark:hover:bg-surface-hover hover:text-gray-900 dark:hover:text-white shadow-sm',
    // No chrome until you touch it.
    ghost: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-control '
        + 'hover:text-gray-900 dark:hover:text-white',
    danger: 'bg-red-600 text-white hover:bg-red-500 shadow-md',
    dangerOutline: 'border border-red-300 dark:border-red-900/80 text-red-600 dark:text-red-400 '
        + 'hover:bg-red-600 hover:text-white hover:border-red-600 dark:hover:bg-red-600 dark:hover:text-white',
    // A destructive action among quiet ones: the same no-chrome-until-you-touch-it
    // as `ghost`, coloured, which is how the menus mark their delete rows too. An
    // outline here would be a third border in a row that is meant to have none.
    dangerGhost: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
};

const BASE = 'inline-flex items-center justify-center font-semibold whitespace-nowrap '
    + 'transition-all active:scale-95 outline-none '
    + 'focus-visible:ring-2 focus-visible:ring-gray-900/25 dark:focus-visible:ring-white/30 '
    + 'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100';

export default function Button({
    variant = 'secondary',
    size = 'md',
    icon,
    type = 'button',
    fullWidth = false,
    className = '',
    children,
    ...rest
}) {
    return (
        <button
            type={type}
            className={[
                BASE,
                SIZES[size] || SIZES.md,
                VARIANTS[variant] || VARIANTS.secondary,
                fullWidth ? 'w-full' : '',
                className,
            ].join(' ')}
            {...rest}
        >
            {icon}
            {children}
        </button>
    );
}

/**
 * Square, label-free, and the same height as a `Button` of the same size.
 *
 * `title` becomes the app's tooltip rather than the browser's. It used to be
 * spread straight onto the element, which is the one thing `ui/Tooltip` exists
 * to replace: the native bubble waits a second, draws in the OS font, and shows
 * nothing at all on a disabled control, which is exactly the button whose
 * label is worth reading, since it also has to say why it is off. A row of bare
 * glyphs was unlabelled for that whole second.
 *
 * `hint` puts a shortcut beside the label, the way the menus show theirs.
 */
export function IconButton({
    variant = 'subtle',
    size = 'md',
    icon,
    title,
    hint,
    tooltipPlacement = 'bottom',
    type = 'button',
    className = '',
    ...rest
}) {
    const button = (
        <button
            type={type}
            className={[
                BASE,
                ICON_SIZES[size] || ICON_SIZES.md,
                VARIANTS[variant] || VARIANTS.subtle,
                // Only when there is no wrapper to carry it, see below.
                title ? '' : className,
            ].join(' ')}
            {...rest}
        >
            {icon}
        </button>
    );

    // Unlabelled and unexplained is a real state: a button whose glyph says it
    // all. It just does not get a bubble, and Tooltip would name it '' anyway.
    if (!title) return button;

    /**
     * `className` goes on the wrapper rather than the button.
     *
     * Every caller uses it to place the button in its parent (a negative
     * margin in the breadcrumb, `absolute` for the reveal button inside a
     * field), and with a wrapper in between, that is the wrapper's job. Left on
     * the button, an `absolute` would take it out of flow and leave the wrapper
     * zero-sized: nothing to hover, and a bubble measured against an empty box
     * and drawn in the corner of the window.
     */
    return (
        <Tooltip label={title} hint={hint} placement={tooltipPlacement} className={className}>
            {button}
        </Tooltip>
    );
}
