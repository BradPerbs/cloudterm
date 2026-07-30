import { forwardRef } from 'react';
import { Cancel01Icon, Search01Icon } from 'hugeicons-react';
import { FIELD_CLASS } from './Field';

/**
 * The search field at the head of a collection page.
 *
 * Hosts, Snippets and the keychain all lead with the same control, and they had
 * three copies of it that had already drifted — one was mono, which made its
 * placeholder read as a different kind of field from the other two. One copy
 * now, so that cannot happen again.
 *
 * The width lives on the wrapper: `FIELD_CLASS` carries `w-full`, which
 * Tailwind emits after the fixed widths and would win over one set on the input
 * itself. `flex-1` with a floor rather than a fixed width, so the field runs to
 * whatever controls sit on its right and yields instead of collapsing when the
 * window gets narrow.
 *
 * The ref is the input, because every page that mounts this focuses it from a
 * keystroke: it is the control people reach for first, and hunting for it with
 * the mouse is exactly what the shortcut exists to avoid.
 */
const SearchField = forwardRef(function SearchField({
    value,
    onChange,
    onKeyDown,
    ariaLabel,
    placeholder = 'Search…',
}, ref) {
    return (
        <div className="relative flex-1 min-w-[180px]">
            <Search01Icon
                size={15}
                strokeWidth={2}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
                ref={ref}
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                spellCheck={false}
                aria-label={ariaLabel}
                className={`${FIELD_CLASS} h-9 pl-9 pr-8`}
            />
            {value && (
                <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center
                        rounded-md text-gray-400 hover:text-gray-900 dark:hover:text-white
                        hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                >
                    <Cancel01Icon size={12} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
});

export default SearchField;
