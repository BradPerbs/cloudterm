import { EFFORTS, effortLabel } from './ai-catalog';

/**
 * The line a pick on the composer's chips leaves in the chat, in the reader's
 * language: "Switched to Opus on Claude Code · High effort".
 *
 * Main says what moved rather than writing the sentence (see `describe` in
 * ai/conversation-settings.js), so a chat read back in another language
 * reads in that one. `change` is `{ model, agent, agentChanged, effort }`,
 * each there only when it moved; `model` is empty when the agent's own
 * default answers. Empty when there is nothing to say.
 */
export function switchLine(change, t) {
    if (!change) return '';
    const parts = [];
    if (change.agent !== undefined) {
        const name = change.model || t('assistant.switchedAgentDefault', { agent: change.agent });
        parts.push(change.agentChanged && change.model
            ? t('assistant.switchedModelOnAgent', { model: change.model, agent: change.agent })
            : name);
    }
    if (change.effort) {
        const stop = EFFORTS.find(option => option.value === change.effort);
        parts.push(t('assistant.switchedEffort', { effort: stop ? effortLabel(stop) : change.effort }));
    }
    return parts.length ? t('assistant.switchedTo', { what: parts.join(' · ') }) : '';
}
