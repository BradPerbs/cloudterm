/**
 * What one conversation runs on, as its composer's chips show it: the app's
 * settings with the conversation's own pin on top.
 *
 * The rule is main's (`ai/conversation-settings.js`), repeated here so the
 * chips follow the settings page live for whatever the pin leaves out, rather
 * than holding a copy main sent once. A test holds the two to the same answer.
 *
 * A pinned agent counts only while it is switched on: one unticked since
 * takes its model with it, and the chips show the settings' agent instead.
 * Pinned to another agent than the settings' with no model named, the
 * conversation runs on that agent's own default, since the settings' model
 * belongs to the settings' agent.
 */
export function shownSettings(settings, pinned) {
    if (!settings) return settings;
    if (!pinned) return settings;
    const on = Array.isArray(settings.providers) ? settings.providers : [];
    const agent = pinned.provider && on.includes(pinned.provider) ? pinned.provider : '';
    const out = { ...settings, provider: agent || settings.provider };
    if (agent) out.model = pinned.model || (agent === settings.provider ? settings.model : '');
    if (pinned.effort) out.effort = pinned.effort;
    if (pinned.approval) out.approval = pinned.approval;
    return out;
}
