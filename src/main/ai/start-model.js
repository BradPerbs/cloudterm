const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * What a new conversation starts on: the model, the effort and the mode.
 *
 * Kept apart from the assistant's settings, in a file of its own:
 *
 *   starred  the model someone pinned with the star in the model menu
 *   last     the model last picked in a composer or on the settings page,
 *            or last sent with
 *   effort   the effort last picked or sent with, on any model
 *   mode     the approval mode last picked, sent in, or chosen on the
 *            settings page
 *
 * A conversation someone opens (a new tab, a fresh chat in a tab) starts on
 * the starred model, else the last one, else the settings' own default; at
 * the last effort and in the last mode, else the settings'. What somebody is
 * working with in one tab is what they want in the next. The effort is the
 * last one used even under a star: the star names a model, and the effort is
 * how hard it is asked to think today. A level the model does not take is
 * rounded down by the runtime, as the chip shows it.
 *
 * A model pick whose agent has been switched off since is passed over. Only a
 * named model is kept as a pick: a pin with no model would take the agent's
 * own default, which belongs to whichever agent is answering by then.
 */

const FIELDS = ['provider', 'model'];
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const MODES = new Set(['always', 'writes', 'never']);
const file = () => path.join(app.getPath('userData'), 'start-model.json');

let held = null;
const listeners = new Set();

/** `{ provider, model }`, or null when it does not name a model. */
function clean(pin) {
    if (!pin || typeof pin !== 'object') return null;
    const out = {};
    for (const field of FIELDS) {
        const value = pin[field];
        if (typeof value === 'string' && value.trim()) out[field] = value.trim().slice(0, field === 'model' ? 160 : 40);
    }
    return out.provider && out.model ? out : null;
}

const effortOf = value => (EFFORTS.has(value) ? value : '');
const modeOf = value => (MODES.has(value) ? value : '');

function load() {
    if (held) return held;
    held = { starred: null, last: null, effort: '', mode: '' };
    try {
        const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
        held = {
            starred: clean(raw?.starred),
            last: clean(raw?.last),
            effort: effortOf(raw?.effort),
            mode: modeOf(raw?.mode),
        };
    } catch {
        // Nothing yet, or unreadable: new chats start on the settings.
    }
    return held;
}

function persist() {
    const target = file();
    const tmp = `${target}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(held, null, 2), 'utf8');
        fs.renameSync(tmp, target);
    } catch (error) {
        console.error('Could not save the start model:', error.message);
    }
}

const same = (a, b) => FIELDS.every(field => (a?.[field] || '') === (b?.[field] || ''));

/** Keep `next` and tell the listeners, unless it is what is held already. */
function commit(next) {
    load();
    const moved = !same(held.starred, next.starred) || !same(held.last, next.last)
        || held.effort !== next.effort || held.mode !== next.mode;
    if (!moved) return false;
    held = next;
    persist();
    for (const listener of listeners) {
        try { listener(get()); } catch { /* a listener never fails the write */ }
    }
    return true;
}

/** Everything held, as stored. */
function get() {
    const current = load();
    return {
        starred: current.starred ? { ...current.starred } : null,
        last: current.last ? { ...current.last } : null,
        effort: current.effort || '',
        mode: current.mode || '',
    };
}

/**
 * What was just picked or sent with: `{ provider, model, effort, approval }`,
 * any of them. A named model becomes the last model; an effort and a mode are
 * kept on their own, so a pick of either alone counts too.
 */
function remember(pin) {
    load();
    const next = { ...held };
    const model = clean(pin);
    if (model) next.last = model;
    const effort = effortOf(pin?.effort);
    if (effort) next.effort = effort;
    const mode = modeOf(pin?.approval);
    if (mode) next.mode = mode;
    return commit(next);
}

/**
 * A change made on the settings page, from `before` to `after`.
 *
 * The settings page is a choice like a chip is, and the later one wins: a
 * model, effort or mode chosen there is what new chats start on from then on,
 * where otherwise the last chip pick would go on beating it and the page
 * would seem to do nothing. An agent switched there with no model named lets
 * go of the last model, so new chats take that agent's own default. A star
 * still wins over both, since starring is choosing a default on purpose.
 */
function follow(before = {}, after = {}) {
    load();
    const next = { ...held };
    if (before.provider !== after.provider || (before.model || '') !== (after.model || '')) {
        next.last = clean({ provider: after.provider, model: after.model });
    }
    if (before.effort !== after.effort && effortOf(after.effort)) next.effort = after.effort;
    if (before.approval !== after.approval && modeOf(after.approval)) next.mode = after.approval;
    return commit(next);
}

/** Pin a default model for every new conversation, or let go of it with null. */
function star(pin) {
    load();
    return commit({ ...held, starred: pin ? clean(pin) : null });
}

/**
 * What a new conversation starts on under these settings, as a pin for
 * `setConversationModel` (`{ provider?, model?, effort?, approval? }`), or
 * null for the settings throughout.
 */
function pickFor(current) {
    // An empty list is nothing switched on, not "fall back to the selected one".
    const on = Array.isArray(current?.providers) ? current.providers : [current?.provider].filter(Boolean);
    const { starred, last, effort, mode } = load();
    const out = {};
    for (const pin of [starred, last]) {
        if (!pin || !on.includes(pin.provider)) continue;
        out.provider = pin.provider;
        out.model = pin.model;
        break;
    }
    if (effort) out.effort = effort;
    if (mode) out.approval = mode;
    return Object.keys(out).length ? out : null;
}

/** Told what `get` says whenever any of it changes. Returns the way to stop. */
function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

module.exports = {
    get,
    remember,
    follow,
    star,
    pickFor,
    onChange,
    _test: { reset: () => { held = null; } },
};
