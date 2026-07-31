import { ArrowDown01Icon, ServerStack03Icon, GlobalIcon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';

/**
 * What the assistant is pointed at, and the menu that changes it.
 *
 * This is the panel's title as well as its most important control, so it is
 * one labelled button rather than a heading with a switcher beside it: the
 * thing you read to know which server you are talking about is the thing you
 * click to change it.
 */
export default function ScopeMenu({ pinned, onChange, sessions, followLabel, scopeLabel }) {
    const sections = [
        {
            value: pinned,
            onChange,
            options: [
                {
                    value: 'follow',
                    label: 'Current session',
                    hint: followLabel,
                    icon: <ServerStack03Icon size={14} strokeWidth={1.5} />,
                },
                {
                    value: 'global',
                    label: 'All hosts',
                    hint: 'Every saved host and open session',
                    icon: <GlobalIcon size={14} strokeWidth={1.5} />,
                },
            ],
        },
    ];

    if (sessions.length > 0) {
        sections.push({
            heading: 'Pin to a session',
            value: pinned,
            onChange,
            options: sessions.map(session => ({
                value: session.sessionId,
                label: session.hostName || session.address || session.sessionId,
                hint: session.hostName ? session.address : '',
                icon: <ServerStack03Icon size={14} strokeWidth={1.5} />,
            })),
        });
    }

    return (
        <PanelMenu
            className="min-w-0 flex-1"
            menuClassName="w-full min-w-[240px]"
            sections={sections}
            trigger={({ open, toggle }) => (
                <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={toggle}
                    className={`w-full h-8 pl-2.5 pr-2 rounded-xl flex items-center gap-1.5 transition-colors
                        outline-none focus-visible:ring-2
                        focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                        ${open
                            ? 'bg-gray-100 dark:bg-white/[0.07]'
                            : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]'}`}
                >
                    {/* No mark here. The header's job is to say which server
                        you are talking about; a logo in front of it is one
                        thing to read before the thing you came to read. */}
                    <span className="min-w-0 flex-1 truncate text-left text-xs font-semibold
                        text-gray-800 dark:text-gray-200">
                        {scopeLabel}
                    </span>
                    <ArrowDown01Icon
                        size={12}
                        strokeWidth={2}
                        className={`shrink-0 text-gray-400 dark:text-gray-600 transition-transform
                            ${open ? 'rotate-180' : ''}`}
                    />
                </button>
            )}
        />
    );
}
