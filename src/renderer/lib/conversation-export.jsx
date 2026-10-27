import toast from 'react-hot-toast';
import { Copy01Icon, Download04Icon } from 'hugeicons-react';
import { PROVIDER_NAMES } from './ai-catalog';
import { toastOptions } from './toast';

/**
 * Taking a conversation out of the app: as Markdown on the clipboard, or in a
 * file. Main builds the document from the stored events (see main/ai/export.js),
 * so what is masked in the history stays masked here; this side has the words,
 * in the app's language, and the menu rows that ask for it.
 */

/** The document's own words, for main to write it in. */
function labels(t) {
    return {
        untitled: t('assistant.newConversation'),
        when: t('assistant.export.when'),
        setup: t('assistant.export.setup'),
        defaultModel: t('assistant.export.defaultModel'),
        id: t('assistant.export.id'),
        you: t('assistant.export.you'),
        agent: t('assistant.title'),
        asked: t('assistant.didAsk'),
        error: t('assistant.export.error'),
        warning: t('assistant.export.warning'),
        approved: t('assistant.allowed'),
        denied: t('assistant.declined'),
        expired: t('assistant.timedOut'),
        stopped: t('assistant.export.stopped'),
        image: t('assistant.export.image'),
        spec: t('assistant.export.spec'),
        more: t('assistant.export.more'),
    };
}

/**
 * The whole conversation on the clipboard, in the full cut: every tool input
 * as it was sent and every result as it came back, because the reason to copy
 * a chat rather than save it is to paste it into a bug report or another chat
 * and say "look at this". The browser's clipboard first, which a click is
 * allowed to use; main's when it is not.
 */
export async function copyConversation(conversationId, t) {
    try {
        const text = await window.api.ai.markdown(conversationId, {
            full: true,
            labels: labels(t),
            agents: PROVIDER_NAMES,
        });
        if (!text) throw new Error('empty');
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            await window.api.clipboard.writeText(text);
        }
        toast.success(t('assistant.conversationCopied'), toastOptions());
    } catch {
        toast.error(t('assistant.copyFailed'), toastOptions());
    }
}

/** The plain cut, in a file main asks where to put. Saying nothing when the dialog is cancelled. */
export async function saveConversation(conversationId, t) {
    try {
        const result = await window.api.ai.exportMarkdown(conversationId, {
            labels: labels(t),
            agents: PROVIDER_NAMES,
            dialogTitle: t('assistant.exportDialogTitle'),
        });
        if (result?.success) toast.success(t('assistant.conversationSaved'), toastOptions());
        else if (!result?.canceled) toast.error(t('assistant.exportFailed', { message: result?.message || '' }), toastOptions());
    } catch (error) {
        toast.error(t('assistant.exportFailed', { message: error.message }), toastOptions());
    }
}

/**
 * The menu's section for the chat in front: copy it, or save it. Nothing for a
 * tab that has no conversation behind it yet, since there is nothing to take.
 * Rows of a section with no current value, so picking one runs it and nothing
 * is left ticked, as the rest of the strip's menu does.
 */
export function conversationSections(conversationId, t) {
    if (!conversationId) return [];
    return [{
        heading: t('assistant.thisChat'),
        value: '',
        onChange: (value) => {
            if (value === 'copy') copyConversation(conversationId, t);
            if (value === 'save') saveConversation(conversationId, t);
        },
        options: [
            {
                value: 'copy',
                label: t('assistant.copyConversation'),
                hint: t('assistant.copyConversationHint'),
                icon: <Copy01Icon size={14} strokeWidth={1.5} />,
            },
            {
                value: 'save',
                label: t('assistant.exportConversation'),
                hint: t('assistant.exportConversationHint'),
                icon: <Download04Icon size={14} strokeWidth={1.5} />,
            },
        ],
    }];
}
