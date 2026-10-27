import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the transcript folds back-to-back tool calls into one row.
 *
 * A setting of how the chat is drawn, not of how the assistant behaves, so it
 * lives with the app's other display choices in localStorage rather than with
 * the agent's settings in the main process. That also lets it carry between
 * devices with the rest of them (see useSettingsSnapshot).
 *
 * Read through a store rather than once at mount, because the switch is on
 * the settings page while the chat it changes is open beside it, or in a
 * window of its own. The page announces a change in its own window; another
 * window hears of it through the `storage` event, which the browser fires
 * everywhere except where the write was made.
 */

export const GROUP_TOOL_CALLS_KEY = 'assistant.groupToolCalls';

/** Said in this window when the switch moves, since `storage` is not. */
const CHANGED = 'assistant-group-tool-calls';

/** On unless it has been switched off. */
const read = () => localStorage.getItem(GROUP_TOOL_CALLS_KEY) !== 'false';

function subscribe(listener) {
    const onStorage = (event) => {
        if (event.key === null || event.key === GROUP_TOOL_CALLS_KEY) listener();
    };
    window.addEventListener(CHANGED, listener);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(CHANGED, listener);
        window.removeEventListener('storage', onStorage);
    };
}

/** `[grouped, setGrouped]`, the way a piece of state would be. */
export default function useGroupToolCalls() {
    const grouped = useSyncExternalStore(subscribe, read);
    const setGrouped = useCallback((value) => {
        localStorage.setItem(GROUP_TOOL_CALLS_KEY, value ? 'true' : 'false');
        window.dispatchEvent(new Event(CHANGED));
    }, []);
    return [grouped, setGrouped];
}
