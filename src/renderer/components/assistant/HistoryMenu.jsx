import { Clock01Icon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';

/**
 * The conversations this run of the app still has, and the way back into one.
 *
 * Starting a new chat parks the old one rather than ending it, so everything
 * listed here can be reopened and carried on: the provider is handed back the
 * session it was using and picks up where it stopped.
 *
 * The list is per run of the app. Nothing is written to disk, which is the
 * honest position for a transcript full of command output from production
 * boxes until there is a retention setting saying otherwise.
 */

/** Ages in this list are minutes and hours, not dates. */
function when(timestamp) {
    const age = Date.now() - timestamp;
    if (!timestamp || age < 60_000) return 'just now';

    const minutes = Math.floor(age / 60_000);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;

    return `${Math.floor(hours / 24)} d ago`;
}

export default function HistoryMenu({ conversations, currentId, onOpen, onRemove, onRefresh }) {
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
                    heading: 'Chats',
                    value: currentId,
                    onChange: onOpen,
                    // No icon and no message count. Every row here is the same
                    // kind of thing, so an icon on each says nothing, and what
                    // tells one chat from another is what was asked and when.
                    options: rows.map(conversation => ({
                        value: conversation.conversationId,
                        label: conversation.title || 'New conversation',
                        hint: when(conversation.updatedAt),
                        onRemove: () => onRemove(conversation.conversationId),
                    })),
                },
            ]}
            trigger={({ open, toggle }) => (
                <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label="Chat history"
                    title="Chat history"
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
