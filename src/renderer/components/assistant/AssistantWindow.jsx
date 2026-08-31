import { useCallback, useEffect, useState } from 'react';
import AgentMark from './AgentMark';
import AssistantWorkspace from './AssistantWorkspace';
import WindowControls from '../ui/WindowControls';
import { APP_GUTTER, TITLE_BAR_HEIGHT } from '../../lib/layout';
import { useT } from '../../i18n';

/**
 * The assistant in a window of its own.
 *
 * The same bundle as the main window, told by its URL hash to draw only this.
 * Everything the panel needed from the main window's tab tree, which
 * terminals are open and which one is in front, arrives from main instead:
 * the main window publishes it whenever it changes, and this asks for the
 * current answer once on the way up.
 *
 * Drawn to the same plan as the main window: a gutter around a card, and a
 * bar across the top that is the frame. The bar is a drag region with the
 * three window buttons on it, since the window is frameless everywhere but
 * macOS, where the system draws its own on the left and the bar leaves them
 * room.
 */

/** Theme changes made in the main window, followed here. */
function useFollowTheme() {
    useEffect(() => {
        const apply = () => {
            const stored = localStorage.getItem('theme') || 'system';
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.classList.toggle(
                'dark',
                stored === 'dark' || stored === 'custom' || (stored === 'system' && prefersDark),
            );
        };
        const onStorage = (event) => {
            if (event.key === 'theme' || event.key === null) apply();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);
}

export default function AssistantWindow() {
    const t = useT();
    useFollowTheme();

    const [context, setContext] = useState({ sessions: [], hosts: [], activeSessionId: '' });

    useEffect(() => {
        window.api.ai.context().then(next => { if (next) setContext(next); }).catch(() => {});
        return window.api.ai.onContext(next => { if (next) setContext(next); });
    }, []);

    // The pages the panel can send you to live in the main window, so it is
    // asked to go there and brought forward.
    const openSettings = useCallback(() => window.api.ai.navigateMain('settings'), []);
    const openSnippets = useCallback(() => window.api.ai.navigateMain('snippets'), []);

    const mac = window.api.platform === 'darwin';

    return (
        <div
            className="h-full flex flex-col bg-gray-100 dark:bg-surface-base text-gray-900 dark:text-gray-100 font-inter overflow-hidden app-drag"
            style={{ padding: APP_GUTTER, gap: APP_GUTTER }}
        >
            <header
                className="shrink-0 flex items-center gap-2 -m-1 px-1"
                style={{ height: TITLE_BAR_HEIGHT, paddingLeft: mac ? 80 : 4 }}
            >
                <AgentMark size={20} mono />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 select-none">
                    {t('assistant.title')}
                </span>

                {/* The same three as the main window's title bar, from the
                    same component, at the same end. */}
                {!mac && (
                    <div className="ml-auto flex items-center">
                        <WindowControls />
                    </div>
                )}
            </header>

            <div className="app-no-drag flex-1 min-h-0 flex flex-col rounded-2xl bg-white/60 dark:bg-surface-raised">
                <AssistantWorkspace
                    detached
                    sessions={context.sessions}
                    hosts={context.hosts}
                    activeSessionId={context.activeSessionId}
                    onOpenSettings={openSettings}
                    onOpenSnippets={openSnippets}
                />
            </div>
        </div>
    );
}
