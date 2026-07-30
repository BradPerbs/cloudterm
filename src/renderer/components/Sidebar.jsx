import { memo } from 'react';
import {
    ServerStack03Icon,
    SecurityIcon,
    Route02Icon,
    FlashIcon,
    Archive02Icon,
    Settings01Icon,
} from 'hugeicons-react';
import { APP_GUTTER, SIDEBAR_WIDTH } from '../lib/layout';
import SidebarAccount from './SidebarAccount';

const NAV_ITEMS = [
    {
        id: 'hosts',
        label: 'Hosts',
        icon: <ServerStack03Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'keychain',
        label: 'Keychain',
        icon: <SecurityIcon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    // Next to the keychain rather than down with Snippets: both are things a
    // host points at in order to connect at all, as opposed to something you
    // reach for once you are in.
    {
        id: 'proxies',
        label: 'Proxies',
        icon: <Route02Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'snippets',
        label: 'Snippets',
        icon: <FlashIcon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'logs',
        label: 'Logs',
        icon: <Archive02Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
    {
        id: 'settings',
        label: 'Settings',
        icon: <Settings01Icon className="w-5 h-5" size={20} strokeWidth={1.5} />,
    },
];

function Sidebar({ activeNav, onNavChange, isTerminalView }) {
    // The shell supplies the left gutter, so the nav items line up with the
    // burger button above them. The sidebar only owns the gap to the content
    // panel, which collapses with it, keeping the terminal flush with the bar.
    const sidebarStyle = isTerminalView
        ? {
            width: '0px',
            paddingRight: '0',
            opacity: '0',
            overflow: 'hidden'
        }
        : {
            width: `${SIDEBAR_WIDTH}px`,
            paddingRight: `${APP_GUTTER}px`,
            opacity: '1'
        };

    return (
        <nav
            id="sidebar"
            className="bg-gray-100 dark:bg-surface-base flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden"
            style={sidebarStyle}
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
                        <span className="text-sm">{item.label}</span>
                    </div>
                ))}

                <SidebarAccount onNavChange={onNavChange} />
            </div>
        </nav>
    );
}

export default memo(Sidebar);
