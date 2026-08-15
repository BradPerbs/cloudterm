/**
 * Which models the assistant offers, and how hard each of them can think.
 *
 * Both of those used to be lists written out by hand, in two files that had to
 * be kept in step with each other and with whatever Anthropic had shipped that
 * month. They were wrong in a way nobody could see: the effort scale offered
 * all five levels for every model, when support for them is per model, so two
 * of the stops quietly did nothing on some of the choices.
 *
 * The installed Claude Code knows both, and says so when asked. The main
 * process asks once its runtime is up and hands the answer to `status()` and
 * to `window.api.ai.onModels`. This file turns that into rows.
 *
 * Nothing here guesses. The question can only be put to a process that is
 * already running, so until the assistant has run once there is exactly one
 * row: whatever Claude Code is already set to use.
 */

import { translate } from '../i18n';

/**
 * The scale itself, low to high.
 *
 * These names are the one thing here that is written by hand, and not for want
 * of trying: a model row reports which levels it takes (`low`, `xhigh`) and
 * nothing anywhere in the SDK reports what to call them. So they are copied
 * from what Claude Code itself calls them, which is the only thing that makes
 * a name right. `xhigh` is "Extra high" there, not "Very high".
 *
 * Which of them are offered is never decided here. That comes from the model.
 */
export const EFFORTS = [
    { value: 'low', labelKey: 'assistant.effortLow' },
    { value: 'medium', labelKey: 'assistant.effortMedium' },
    { value: 'high', labelKey: 'assistant.effortHigh' },
    { value: 'xhigh', labelKey: 'assistant.effortXHigh' },
    { value: 'max', labelKey: 'assistant.effortMax' },
    // Codex only, and only on its newest models. It appears when a model says
    // it has it, which is the same rule every other stop follows.
    { value: 'ultra', labelKey: 'assistant.effortUltra' },
];

/** An effort stop with its name filled in, for the two places that draw one. */
export const effortLabel = (stop) => (stop ? translate(stop.labelKey) : '');

/** What each agent is called, for the one row that has to name it. */
export const PROVIDER_NAMES = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
    grok: 'Grok Build',
    kimi: 'Kimi Code',
    local: 'Local model',
};

/**
 * Inheriting is not a model, so no runtime lists it. It is always the first
 * row and it is the default, which is the whole proposition of driving the
 * user's own agent: pinning a model here would override the choice they
 * already made there.
 */
function inheritRow(provider) {
    const name = PROVIDER_NAMES[provider] || translate('settings.assistant.theAgent');
    return {
        value: '',
        short: name,
        label: translate('assistant.agentDefault', { agent: name }),
        hint: translate('assistant.agentDefaultHint', { agent: name }),
        effort: null,
    };
}

/**
 * The rows to offer, which are the ones the runtime reported and nothing else.
 *
 * There is deliberately no built-in list to fall back on. A list written here
 * would be a guess at what the Claude Code on this machine can run, and a
 * wrong guess is worse than a short menu: it offers models the runtime may not
 * have, on an account that may not be entitled to them, and it reads as fact.
 * Until the runtime has answered there is one row, which is the one that is
 * true whatever it turns out to have: use whatever it is already set to.
 *
 * A model the user has pinned that the runtime does not list is kept rather
 * than dropped: a menu that silently loses the setting it is displaying is
 * worse than one showing a row it cannot explain.
 */
export function modelRows(catalog, selected = '', provider = 'claude-code') {
    const known = Array.isArray(catalog) && catalog.length > 0;

    const rows = (known ? catalog : []).map(row => ({
        value: row.value,
        resolved: row.resolved || row.value,
        short: row.short || row.label || row.value,
        label: row.label || row.value,
        hint: row.hint || row.description || '',
        effort: Array.isArray(row.effort) ? row.effort : null,
        preferred: Boolean(row.preferred),
    }));

    if (selected && !rows.some(row => covers(row, selected))) {
        rows.push({
            value: selected,
            resolved: selected,
            short: selected,
            label: selected,
            hint: known ? translate('assistant.notInRuntimeList') : '',
            effort: null,
        });
    }

    // An agent that names its own default does not need a row saying "use the
    // default": that row is in the list already, under the name of the model
    // it actually is. Only agents that keep their choice to themselves get the
    // inherit row, where it is the one honest thing to offer.
    return rows.some(row => row.preferred) ? rows : [inheritRow(provider), ...rows];
}

/** An alias with its context window dropped: `opus[1m]` is `opus`. */
const bare = (id) => String(id || '').replace(/\[[^\]]*\]/g, '');

/**
 * Whether a row is the one a saved model id names.
 *
 * The rows are aliases (`sonnet`, `opus[1m]`) and each carries the wire id it
 * stands for, so a setting saved as `claude-sonnet-5` finds its row. The
 * prefix case is for the dated ones: `haiku` resolves to
 * `claude-haiku-4-5-20251001`, which is the same model as `claude-haiku-4-5`.
 */
function covers(row, value) {
    if (row.value === value) return true;
    const target = bare(value);
    if (!target) return false;
    const resolved = bare(row.resolved);
    return resolved === target || resolved.startsWith(`${target}-`);
}

/** Whether the runtime has told us anything yet. */
export function isDiscovered(catalog) {
    return Array.isArray(catalog) && catalog.length > 0;
}

/**
 * One row, by value, with the inherit row as the answer to anything unknown.
 *
 * Falls back to matching on the wire id, so a model pinned before the runtime
 * was ever asked shows up as the row that covers it rather than as its own
 * raw string. The setting is not rewritten for this: it changes the next time
 * the user picks something, and until then it works exactly as it did.
 */
export function modelRow(rows, value) {
    // Nothing pinned means the agent's own default, which is a named row when
    // the agent was willing to say which one it is.
    if (!value) return rows.find(row => row.preferred) || rows[0];
    return rows.find(row => row.value === value)
        || rows.find(row => covers(row, value))
        || rows.find(row => row.preferred)
        || rows[0];
}

/**
 * The stops to draw for a model.
 *
 * An empty list means the model takes no effort setting at all, and the caller
 * should leave the control out rather than draw a dial that does nothing.
 */
export function effortStops(model) {
    if (!model || !Array.isArray(model.effort)) return EFFORTS;
    return EFFORTS.filter(option => model.effort.includes(option.value));
}

/**
 * The stop to show when the saved one is not on this model's scale.
 *
 * Rounds down rather than resetting, which is what the runtime does with a
 * level it cannot honour: `xhigh` on a model without it runs as `high`. The
 * saved setting is left alone, so switching back to a model that has the stop
 * shows the choice again rather than the compromise.
 */
export function nearestEffort(stops, value) {
    if (stops.length === 0) return value;
    if (stops.some(option => option.value === value)) return value;

    const wanted = EFFORTS.findIndex(option => option.value === value);
    const target = wanted < 0 ? EFFORTS.length - 1 : wanted;

    for (let index = stops.length - 1; index >= 0; index -= 1) {
        if (EFFORTS.findIndex(option => option.value === stops[index].value) <= target) {
            return stops[index].value;
        }
    }
    return stops[0].value;
}
