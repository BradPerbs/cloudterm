import Tooltip from '../ui/Tooltip';

/**
 * One of the round buttons on the composer's lower row, drawn to the same
 * 28px circle as the picture button beside it. `active` holds it lit while
 * what it opened is open, or while the message carries what it adds, so the
 * row says that much without looking up at the chips.
 */
export default function ComposerButton({ label, hint, active = false, onClick, children }) {
    return (
        <Tooltip label={label} hint={hint} placement="top">
            <button
                type="button"
                aria-label={label}
                // The field keeps the focus, and the caret where it was, so
                // what the button puts in lands where the user was typing.
                onMouseDown={event => event.preventDefault()}
                onClick={onClick}
                className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-full
                    text-sm font-semibold select-none transition-colors
                    ${active
                        ? 'bg-gray-100 dark:bg-surface-control text-gray-700 dark:text-gray-200'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-control '
                            + 'hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
                {children}
            </button>
        </Tooltip>
    );
}
