import { memo, useCallback, useRef } from 'react';
import {
    SlidersHorizontalIcon,
    PaintBoardIcon,
    CommandLineIcon,
    ShieldKeyIcon,
    Archive01Icon,
    InformationCircleIcon,
    UserCircleIcon,
} from 'hugeicons-react';

/**
 * The categories, in the order they are shown. Adding a page means adding an
 * entry here and a matching component in the panel's page map. The nav and the
 * router read from the same list, so the two cannot drift apart.
 */
export const SETTINGS_CATEGORIES = [
    { id: 'general', label: 'General', icon: SlidersHorizontalIcon },
    { id: 'appearance', label: 'Appearance', icon: PaintBoardIcon },
    { id: 'terminal', label: 'Terminal', icon: CommandLineIcon },
    { id: 'security', label: 'Security', icon: ShieldKeyIcon },
    { id: 'account', label: 'Account', icon: UserCircleIcon },
    { id: 'backup', label: 'Backup', icon: Archive01Icon },
    { id: 'about', label: 'About', icon: InformationCircleIcon },
];

function SettingsNav({ active, onChange }) {
    const listRef = useRef(null);

    /**
     * Arrow keys walk the list and wrap, with only the active item in the tab
     * order. Tab therefore steps past the whole nav into the page, rather than
     * through six stops before reaching the setting you came for.
     */
    const handleKeyDown = useCallback((event) => {
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;

        event.preventDefault();

        const total = SETTINGS_CATEGORIES.length;
        const current = SETTINGS_CATEGORIES.findIndex(category => category.id === active);
        const next = (current + step + total) % total;

        onChange(SETTINGS_CATEGORIES[next].id);
        listRef.current?.querySelectorAll('button')[next]?.focus();
    }, [active, onChange]);

    return (
        <nav
            ref={listRef}
            aria-label="Settings categories"
            onKeyDown={handleKeyDown}
            className="sticky top-0 shrink-0 w-40 flex flex-col gap-0.5"
        >
            {SETTINGS_CATEGORIES.map(({ id, label, icon: Icon }) => {
                const isActive = id === active;

                return (
                    <button
                        key={id}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onChange(id)}
                        className={`flex items-center gap-2.5 px-3 h-9 rounded-xl text-left outline-none
                            text-sm transition-colors
                            focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                            ${isActive
                                ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white font-semibold'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-900/[0.04] dark:hover:bg-surface-raised'
                            }`}
                    >
                        <Icon size={17} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
                        {label}
                    </button>
                );
            })}
        </nav>
    );
}

export default memo(SettingsNav);
