import { memo, useLayoutEffect, useRef } from 'react';
import {
    ServerStack03Icon,
    SecurityIcon,
    Route02Icon,
    FlashIcon,
    Archive02Icon,
    Settings01Icon,
} from 'hugeicons-react';
import { setSidebar, slideSidebar } from '../lib/panelMotion';
import SidebarAccount from './SidebarAccount';
import { useT } from '../i18n';

const NAV_ITEMS = [
    {
        id: 'hosts',
        icon: <ServerStack03Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'keychain',
        icon: <SecurityIcon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    // Next to the keychain rather than down with Snippets: both are things a
    // host points at in order to connect at all, as opposed to something you
    // reach for once you are in.
    {
        id: 'proxies',
        icon: <Route02Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'snippets',
        icon: <FlashIcon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'logs',
        icon: <Archive02Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'settings',
        icon: <Settings01Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
];

function Sidebar({ activeNav, onNavChange, isTerminalView }) {
    const t = useT();

    const navRef = useRef(null);

    /**
     * The state the sidebar has been drawn in, so the first render lays it out
     * rather than animating it from itself to itself, and so StrictMode's
     * second mount does not read as the sidebar having been asked to move.
     */
    const shown = useRef(!isTerminalView);

    /**
     * Opening and shutting is GSAP's, from `lib/panelMotion`, which also holds
     * the width the sidebar opens to. Nothing is set here in a `style` prop:
     * a re-render mid-slide would write the far end of the movement straight
     * onto the element and the column would jump there.
     */
    useLayoutEffect(() => {
        const node = navRef.current;
        if (!node) return;

        const open = !isTerminalView;
        if (shown.current === open) {
            setSidebar(node, open);
            return;
        }
        shown.current = open;
        slideSidebar(node, open);
    }, [isTerminalView]);

    return (
        <nav
            id="sidebar"
            ref={navRef}
            className="bg-gray-100 dark:bg-surface-base flex flex-col shrink-0 overflow-hidden"
        >
            <div className="flex flex-col gap-1 flex-1 min-h-0">
                {NAV_ITEMS.map((item) => (
                    <div
                        key={item.id}
                        className={`nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                            activeNav === item.id
                                ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-900/[0.04] dark:hover:bg-surface-raised'
                        }`}
                        onClick={() => onNavChange(item.id)}
                    >
                        {item.icon}
                        <span className="text-sm">{t(`nav.${item.id}`)}</span>
                    </div>
                ))}

                <SidebarAccount onNavChange={onNavChange} />
            </div>
        </nav>
    );
}

export default memo(Sidebar);
