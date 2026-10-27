const settings = require('./settings');
const startModel = require('./start-model');

/**
 * The agent, model, effort and mode one conversation runs on.
 *
 * These used to be the app's settings and nothing else, so moving the model
 * chip in one tab moved every tab at once, and a read-only chat on a
 * production box could not sit beside an auto-approve one on a test box. Now
 * each conversation carries a pin (`settingsPatch`) over the settings: the
 * composer's chips change the pin, never the settings behind it, and the
 * settings are what a conversation with no pin runs on and what a pin leaves
 * out. The settings page still edits the settings, so a conversation that
 * never picked anything follows it as it always did.
 *
 * The pin is stored with the conversation (see archive.js), so one pinned to
 * a mode comes back in that mode after a restart.
 *
 * A pick is also what the next conversation starts on (see start-model.js),
 * because what somebody is working with in one tab is what they want in the
 * next.
 */

/** As the settings page names them, for the line a switch writes into the chat. */
const AGENT_NAMES = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
    grok: 'Grok Build',
    kimi: 'Kimi Code',
    local: 'Local model',
};

/** As the effort dial names them, in English, for the stored line. */
const EFFORT_NAMES = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max', ultra: 'ultra' };

/**
 * The settings under a pin.
 *
 * A pinned agent counts only while it is switched on. One unticked since
 * takes its model with it, because a model name belongs to one agent, and the
 * conversation goes to the agent the settings name instead. Pinned to another
 * agent than the settings' with no model named, it runs on that agent's own
 * default: the settings' model belongs to the settings' agent.
 *
 * `known(name)` says whether an agent exists in this build, and `readApiKey`
 * hands over the key an older version may have stored for it.
 */
function effective(base, patch, { known = () => true, readApiKey = () => '' } = {}) {
    const pin = patch || {};
    const on = Array.isArray(base.providers) ? base.providers : [];
    const agent = pin.provider && known(pin.provider) && on.includes(pin.provider) ? pin.provider : '';
    const provider = agent || base.provider;
    const out = { ...base, provider, apiKey: readApiKey(provider) };
    if (agent) out.model = pin.model || (agent === base.provider ? base.model : '');
    if (pin.effort) out.effort = pin.effort;
    if (pin.approval) out.approval = pin.approval;
    return out;
}

/**
 * A pin with a pick applied, or null when nothing is left pinned.
 *
 * A field left out of `patch` keeps what was pinned; an empty one hands it
 * back to the settings. A model belongs to one agent, so a model named on its
 * own is pinned with the agent answering now (`answering`), and a change of
 * agent that names no model lets go of the old one.
 */
function merge(current, patch, { answering = '', known = () => true } = {}) {
    const pin = current || {};
    const pick = patch && typeof patch === 'object' ? patch : {};
    const next = {};

    const provider = pick.provider !== undefined ? pick.provider : pin.provider;
    if (typeof provider === 'string' && provider && known(provider)) next.provider = provider;

    const model = pick.model !== undefined
        ? pick.model
        : (next.provider === pin.provider ? pin.model : '');
    if (typeof model === 'string' && model.trim()) {
        next.model = model.trim().slice(0, 160);
        if (!next.provider && answering) next.provider = answering;
    }

    const effort = pick.effort !== undefined ? pick.effort : pin.effort;
    if (settings.EFFORTS.has(effort)) next.effort = effort;

    const approval = pick.approval !== undefined ? pick.approval : pin.approval;
    if (settings.APPROVALS.has(approval)) next.approval = approval;

    return Object.keys(next).length ? next : null;
}

/**
 * What a pick changed, for the line it leaves in the chat, or null when
 * nothing that answers the next message is different. The mode is left out:
 * it decides what stops for a person, not who is answering.
 *
 * `change` is the parts, for the panel to say in the reader's language;
 * `text` is the same in English, for anything reading the log without one.
 * `catalog` is the answering agent's model list, for the model's own name.
 */
function describe(before, after, catalog = []) {
    const change = {};
    const parts = [];
    if (before.provider !== after.provider || (before.model || '') !== (after.model || '')) {
        const row = (Array.isArray(catalog) ? catalog : []).find(entry => entry?.value === after.model);
        const agent = AGENT_NAMES[after.provider] || after.provider;
        change.model = row?.short || row?.label || after.model || '';
        change.agent = agent;
        change.agentChanged = before.provider !== after.provider;
        const name = change.model || `${agent} default`;
        parts.push(change.agentChanged && change.model ? `${name} on ${agent}` : name);
    }
    if ((before.effort || '') !== (after.effort || '') && after.effort) {
        change.effort = after.effort;
        parts.push(`${EFFORT_NAMES[after.effort] || after.effort} effort`);
    }
    return parts.length ? { text: `Switched to ${parts.join(' · ')}`, change } : null;
}

/**
 * The pin-keeping half, bound to the assistant's own state.
 *
 *   providers  the agents this build has, by name
 *   catalogs   each agent's model list, for naming a model in the chat
 *   find       the conversation with an id, or nothing
 *   emit       record an event in a conversation and pass it on
 *   notify     tell every window something that is not part of a chat
 *   save       write the conversations out
 */
function create({ providers, catalogs, find, emit, notify, save }) {
    const known = name => Boolean(providers[name]);

    /** The settings one conversation runs under: the app's, with its pin on top. */
    function effectiveFor(conversation) {
        return effective(settings.get(), conversation?.settingsPatch, { known, readApiKey: settings.readApiKey });
    }

    /**
     * Pin a conversation to an agent, a model, an effort and a mode, or change
     * the pin it has.
     *
     * A running query is told what it can be told live: a new model or effort
     * on the same agent is pushed at the session and lands on its next
     * response. A new agent restarts the query on the next message, resuming
     * nothing, since one agent's session id means nothing to another. A mode
     * needs neither: it is read on every tool call.
     *
     * `remember` is for a person's own pick, which is also what the next new
     * chat starts on. A mode that moved is returned as `mode`, so whoever made
     * the change can log it the way the settings page's approvals are logged.
     */
    function set(conversationId, patch = {}, { remember = false } = {}) {
        const conversation = find(conversationId);
        if (!conversation) return { error: 'That conversation is gone' };
        const pick = patch && typeof patch === 'object' ? patch : {};

        const before = effectiveFor(conversation);
        conversation.settingsPatch = merge(conversation.settingsPatch, pick, { answering: before.provider, known });
        save();
        // Told to whichever window is showing it, so its chips follow a pick
        // made somewhere else. Not recorded: it is not something that was
        // said, and the line below is what the transcript keeps.
        notify('ai-event', {
            conversationId: conversation.id,
            event: { type: 'pinned', pinned: conversation.settingsPatch, at: Date.now() },
        });

        const after = effectiveFor(conversation);

        // A line in the chat saying what moved, so the turns after it read as
        // the new model's. Only once something has been said: an empty chat
        // has no "before" for the line to divide it from.
        const said = describe(before, after, catalogs.get(after.provider));
        if (said && conversation.events.some(event => event.type === 'user-message')) {
            emit(conversation, { type: 'model-changed', text: said.text, change: said.change });
        }

        const session = conversation.session;
        if (before.provider !== after.provider) {
            if (session || conversation.starting) conversation.needsRestart = true;
        } else if (session || conversation.starting) {
            const apply = (running) => {
                if ((before.model || '') !== (after.model || '')) running?.setModel?.(after.model);
                if (before.effort !== after.effort) running?.setEffort?.(after.effort);
            };
            // A query still coming up was started on the pin before, so it is
            // told as soon as it is there to be told.
            if (session) apply(session);
            else conversation.starting.then(apply, () => {});
        }

        if (remember) {
            startModel.remember({
                ...('provider' in pick || 'model' in pick ? { provider: after.provider, model: after.model } : {}),
                ...('effort' in pick ? { effort: after.effort } : {}),
                ...('approval' in pick ? { approval: after.approval } : {}),
            });
        }

        return {
            pinned: conversation.settingsPatch,
            ...(before.approval !== after.approval ? { mode: { from: before.approval, to: after.approval } } : {}),
        };
    }

    /**
     * Put a conversation someone just opened on what new chats start on: the
     * starred or last model, the last effort and the last mode. Returns the
     * pin it ends up with.
     */
    function startOnPick(conversationId) {
        const conversation = find(conversationId);
        if (!conversation) return null;
        const pick = startModel.pickFor(settings.get());
        if (!pick) return conversation.settingsPatch || null;
        return set(conversationId, pick).pinned || null;
    }

    /** What a message was just sent with is what the next new chat starts on. */
    function rememberUsed(conversation) {
        const current = effectiveFor(conversation);
        startModel.remember({
            provider: current.provider,
            model: current.model,
            effort: current.effort,
            approval: current.approval,
        });
    }

    /**
     * What new chats start on, for the model menu's star: what is held (see
     * start-model.js), and the pick that makes under the settings as they are.
     */
    function startState() {
        return { ...startModel.get(), pick: startModel.pickFor(settings.get()) };
    }

    /** Star a model for every new chat (`{ provider, model }`), or let go with null. */
    function star(pin) {
        startModel.star(pin && typeof pin === 'object' ? pin : null);
        return startState();
    }

    return { effective: effectiveFor, set, startOnPick, rememberUsed, startState, star };
}

module.exports = {
    create,
    effective,
    merge,
    describe,
};
