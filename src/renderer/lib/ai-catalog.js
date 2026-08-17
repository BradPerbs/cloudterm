/**
 * Which models the assistant offers, and how hard each of them can think.
 *
 * Both of those used to be lists written out by hand, in two files that had to
 * be kept in step with each other and with whatever Anthropic had shipped that
 * month. They were wrong in a way nobody could see: the effort scale offered
 * all five levels for every model, when support for them is per model, so two
 * of the stops quietly did nothing on some of the choices.
 *
 * Each installed agent knows both, and says so when asked. The main process
 * asks and hands the answer to `status()` and to `window.api.ai.onModels`.
 * This file turns that into rows.
 *
 * Nothing here guesses, and nothing here pads. An agent that has not answered
 * yet contributes no rows at all, rather than one standing in for the answer:
 * a menu that looks like it is working is the worst thing to show while it is
 * not, and the note under the rows is what says which of the two it is.
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

/** What each agent is called, for the rows that have to name one. */
export const PROVIDER_NAMES = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
    grok: 'Grok Build',
    kimi: 'Kimi Code',
    local: 'Local model',
};

/**
 * The order agents are drawn in, wherever more than one of them is.
 *
 * Taken from the names above rather than written twice: the settings cards and
 * the composer's model menu are two views of one set, and a list that reordered
 * itself between them would read as two different sets.
 */
export const PROVIDER_ORDER = Object.keys(PROVIDER_NAMES);

/**
 * The rows to offer, which are the ones the runtime reported and nothing else.
 *
 * There is deliberately no built-in list to fall back on. A list written here
 * would be a guess at what the agent on this machine can run, and a wrong guess
 * is worse than a short menu: it offers models the runtime may not have, on an
 * account that may not be entitled to them, and it reads as fact.
 *
 * There is no row for inheriting either, and there used to be: one reading
 * "Claude Code default", offered whenever the agent had not named a default of
 * its own. It said nothing a person could act on, and because an agent that
 * failed to report its models had not named one either, it was also what a
 * failed read looked like. A menu with one row in it that seemed to be working
 * is worse than an empty one that says it is empty, which is what the note
 * under these rows is for.
 *
 * A model the user has pinned that the runtime does not list is kept rather
 * than dropped: a menu that silently loses the setting it is displaying is
 * worse than one showing a row it cannot explain.
 */
function modelRows(catalog, selected = '') {
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

    return rows;
}

/**
 * Every switched-on agent's models, in one list, each row saying whose it is.
 *
 * The menu this feeds is a merged one, so a row needs two things it did not
 * need while there was only ever one agent. `provider` is which agent it
 * belongs to, which is what the mark beside the name is drawn from and what
 * picking the row switches to. `key` is `agent:model`, because the values
 * themselves collide: every agent that keeps its default to itself contributes
 * a row valued `''`, and two agents can perfectly well offer the same alias.
 *
 * Only the agent that is answering is passed the saved model, so exactly one
 * row can come back ticked and the "pinned but not in the runtime's list" row
 * appears once rather than under every agent that has never heard of it.
 *
 * An agent that has reported nothing contributes nothing. The list can come
 * back empty, and the menu says so rather than being padded out.
 */
export function mergedModelRows(catalogs, providers, settings) {
    const on = new Set(providers?.length ? providers : [settings.provider]);

    return PROVIDER_ORDER.filter(provider => on.has(provider)).flatMap((provider) => {
        const answering = provider === settings.provider;
        return modelRows(catalogs?.[provider], answering ? settings.model : '')
            .map(row => ({ ...row, provider, key: `${provider}:${row.value}` }));
    });
}

/**
 * The row the chip is sitting on, or nothing at all.
 *
 * Resolved against the answering agent's rows alone, since a fallback across a
 * merged list would be some other agent's first model and would have the chip
 * naming something that is not going to answer.
 *
 * Undefined is a real answer here, and it means what it says: no model is
 * pinned and the agent has not named a default, so nothing on this machine
 * knows which model the next question will go to until it comes back. The chip
 * names the agent in that case rather than picking a row to look confident
 * with.
 */
export function currentModelRow(rows, settings) {
    const mine = rows.filter(row => row.provider === settings.provider);
    return modelRow(mine, settings.model);
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
 * One row, by value, or nothing when the list has no answer to give.
 *
 * Falls back to matching on the wire id, so a model pinned before the runtime
 * was ever asked shows up as the row that covers it rather than as its own
 * raw string. The setting is not rewritten for this: it changes the next time
 * the user picks something, and until then it works exactly as it did.
 *
 * Nothing pinned means the agent's own default, which is a named row only when
 * the agent was willing to say which one that is. When it was not, there is no
 * row, and none is invented: the first row of a list is not a default, it is
 * whichever model happened to sort first.
 */
function modelRow(rows, value) {
    if (!value) return rows.find(row => row.preferred);
    return rows.find(row => row.value === value)
        || rows.find(row => covers(row, value))
        || rows.find(row => row.preferred);
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
