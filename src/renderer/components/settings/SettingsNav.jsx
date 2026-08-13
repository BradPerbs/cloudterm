import { memo, useCallback, useRef } from 'react';
import {
    SlidersHorizontalIcon,
    PaintBoardIcon,
    CommandLineIcon,
    FileEditIcon,
    ShieldKeyIcon,
    Archive01Icon,
    InformationCircleIcon,
    UserCircleIcon,
    PulseRectangle01Icon,
} from 'hugeicons-react';
import AgentMark from '../assistant/AgentMark';
import { useT } from '../../i18n';

/**
 * The agent's own mark, rather than a generic sparkle.
 *
 * The same cloud that sits on the rail button, in the same `mono` treatment, so
 * the row that configures the agent is recognisably about the thing the button
 * opens. A few pixels larger than its neighbours because the artwork is wider
 * than it is tall and letterboxes inside a square box.
 */
const AgentIcon = ({ size = 17, className = '' }) => (
    <AgentMark size={size + 3} mono className={className} />
);

/**
 * The categories, in the order they are shown. Adding a page means adding an
 * entry here, a matching component in the panel's page map, and a
 * `settings.nav.<id>` string in the catalogs. The nav and the router read from
 * the same list, so the two cannot drift apart.
 */
export const SETTINGS_CATEGORIES = [
    { id: 'general', icon: SlidersHorizontalIcon },
    { id: 'appearance', icon: PaintBoardIcon },
    { id: 'terminal', icon: CommandLineIcon },
    { id: 'assistant', icon: AgentIcon },
    { id: 'monitoring', icon: PulseRectangle01Icon },
    { id: 'logging', icon: FileEditIcon },
    { id: 'security', icon: ShieldKeyIcon },
    { id: 'account', icon: UserCircleIcon },
    { id: 'backup', icon: Archive01Icon },
    { id: 'about', icon: InformationCircleIcon },
];

function SettingsNav({ active, onChange }) {
    const listRef = useRef(null);
    const t = useT();

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
            aria-label={t('settings.nav.aria')}
            onKeyDown={handleKeyDown}
            className="sticky top-0 shrink-0 w-40 flex flex-col gap-0.5"
        >
            {SETTINGS_CATEGORIES.map(({ id, icon: Icon }) => {
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
                        {t(`settings.nav.${id}`)}
                    </button>
                );
            })}
        </nav>
    );
}

export default memo(SettingsNav);
