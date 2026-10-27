import { useEffect } from 'react';
import { playChime } from '../lib/chime';
import { useT } from '../i18n';

/**
 * The renderer's half of the assistant's desktop notifications. Main decides
 * when one is worth raising (see main/ai/attention.js); it cannot see which
 * chat is on screen, or speak the app's language, so the windows tell it.
 */

/**
 * Tell main which conversation this window has in front, so a turn ending or
 * a question asked there while the window has the focus raises nothing: the
 * person is already looking at it. Nothing when the panel holding it is shut,
 * which is what unmounting says.
 */
export function useAttentionView(conversationId) {
    useEffect(() => {
        window.api.ai.setInView?.(conversationId ? [conversationId] : [])?.catch?.(() => {});
    }, [conversationId]);

    useEffect(() => () => {
        window.api.ai.setInView?.([])?.catch?.(() => {});
    }, []);
}

/**
 * For the main window, once: the notifications' words, sent again whenever
 * the language changes, and the chime main asks for when one goes up.
 *
 * `ready` is false while the app is locked, when main refuses the call; the
 * words go once it is unlocked, which is before any conversation can run.
 */
export function useAttentionBridge(ready) {
    const t = useT();

    useEffect(() => {
        if (!ready) return;
        window.api.ai.setNotificationText?.({
            done: t('assistant.notify.done'),
            failed: t('assistant.notify.failed'),
            question: t('assistant.notify.question'),
            approval: t('assistant.notify.approval'),
            untitled: t('assistant.notify.untitled'),
        })?.catch?.(() => {});
    }, [ready, t]);

    useEffect(() => window.api.ai.onChime?.(() => playChime()), []);
}
