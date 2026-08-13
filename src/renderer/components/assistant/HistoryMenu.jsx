import { Clock01Icon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';
import { useT } from '../../i18n';

/**
 * The conversations the app still has, and the way back into one.
 *
 * Starting a new chat parks the old one rather than ending it, so everything
 * listed here can be reopened and carried on: the provider is handed back the
 * session it was using and picks up where it stopped.
 *
 * The list outlives the app now, not just the window: the last twenty are
 * written to the userData directory and read back at launch (see
 * `main/ai/archive.js`). Removing a row here is what deletes one for good.
 */

/** Ages in this list are minutes and hours, not dates. */
function when(t, timestamp) {
    const age = Date.now() - timestamp;
    if (!timestamp || age < 60_000) return t('monitor.justNow');

    const minutes = Math.floor(age / 60_000);
    if (minutes < 60) return t('monitor.minutesAgo', { count: minutes });

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('monitor.hoursAgo', { count: hours });

    return t('monitor.daysAgo', { count: Math.floor(hours / 24) });
}

export default function HistoryMenu({ conversations, currentId, onOpen, onRemove, onRefresh }) {
    const t = useT();

    // The current conversation is always in the list the main process keeps, so
    // the only way this is empty is a lookup that has not answered yet. A row
    // for what is on screen beats an empty popover.
    const rows = conversations.length > 0
        ? conversations
        : [{ conversationId: currentId, title: '', updatedAt: Date.now() }];

    return (
        <PanelMenu
            align="right"
            menuClassName="w-72"
            sections={[
                {
                    heading: t('assistant.chats'),
                    value: currentId,
                    onChange: onOpen,
                    // No icon and no message count. Every row here is the same
                    // kind of thing, so an icon on each says nothing, and what
                    // tells one chat from another is what was asked and when.
                    options: rows.map(conversation => ({
                        value: conversation.conversationId,
                        label: conversation.title || t('assistant.newConversation'),
                        hint: when(t, conversation.updatedAt),
                        onRemove: () => onRemove(conversation.conversationId),
                    })),
                },
            ]}
            trigger={({ open, toggle }) => (
                <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label={t('assistant.chatHistory')}
                    title={t('assistant.chatHistory')}
                    onClick={() => {
                        if (!open) onRefresh?.();
                        toggle();
                    }}
                    className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl transition-colors
                        outline-none focus-visible:ring-2
                        focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                        ${open
                            ? 'bg-gray-100 dark:bg-surface-control text-gray-900 dark:text-white'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 '
                                + 'dark:hover:bg-surface-control dark:hover:text-white'}`}
                >
                    <Clock01Icon size={16} strokeWidth={1.5} />
                </button>
            )}
        />
    );
}
