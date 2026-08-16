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
import Tooltip from '../ui/Tooltip';
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

/**
 * The category list, or the same list as a rail of icons.
 *
 * `collapsed` is the panel saying the page is short of width. 160px of names
 * beside a card whose rows have stopped fitting is the easiest 124px on the
 * screen to give back: the icons are the part people navigate by once they know
 * the list, and the names come back as tooltips for the times they do not.
 *
 * The names are tooltips rather than nothing, and the buttons keep their
 * `aria-current` and their place in the arrow-key walk, so the only thing that
 * changes is how much of it is drawn.
 */
function SettingsNav({ active, onChange, collapsed = false }) {
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
            className={`sticky top-0 shrink-0 flex flex-col gap-0.5 ${collapsed ? 'w-9' : 'w-40'}`}
        >
            {SETTINGS_CATEGORIES.map(({ id, icon: Icon }) => {
                const isActive = id === active;
                const label = t(`settings.nav.${id}`);

                const button = (
                    <button
                        key={id}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={collapsed ? label : undefined}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onChange(id)}
                        className={`flex items-center h-9 rounded-xl text-left outline-none
                            text-sm transition-colors
                            focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                            ${collapsed ? 'w-9 justify-center' : 'gap-2.5 px-3'}
                            ${isActive
                                ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white font-semibold'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-900/[0.04] dark:hover:bg-surface-raised'
                            }`}
                    >
                        <Icon size={17} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
                        {!collapsed && label}
                    </button>
                );

                // To the side rather than below: a rail is a column of ten of
                // these, and a bubble under one covers the next.
                return collapsed
                    ? <Tooltip key={id} label={label} placement="right">{button}</Tooltip>
                    : button;
            })}
        </nav>
    );
}

export default memo(SettingsNav);
