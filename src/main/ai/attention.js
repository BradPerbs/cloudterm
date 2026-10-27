const { scrub } = require('./pasted-secrets');

/**
 * Saying so outside the app when a conversation needs the person.
 *
 * A turn can run for minutes, and the point of handing work to the assistant
 * is to look at something else meanwhile. So when one finishes, asks a
 * question or stops for an approval while nobody is looking at it, the OS is
 * asked to say so: a desktop notification, with a short chime from the app,
 * and clicking it brings the window forward on that conversation.
 *
 * Looking at it means it is the conversation in front in the window that has
 * the focus. Each window reports which conversation it has in front (see
 * `setInView`); which window has the focus is the OS's to say. A chat on
 * screen in a window behind another app is not being looked at, and neither
 * is one in a tab behind another tab, or in a panel that is shut.
 *
 * One notification per event: a turn ends once, a question is asked once,
 * however many events arrive about it. And one on screen per conversation,
 * the newest, so a busy chat replaces its own rather than stacking them. Each
 * is taken down once it has nothing left to say: the question is answered,
 * the approval settled, the conversation looked at or written to.
 *
 * Whether to interrupt at all is the OS's to decide in the end. The banner
 * goes through Electron's Notification rather than a window of the app's own,
 * so Focus Assist and the per-app switches in the system's settings act on it.
 *
 * The words come from the renderer, which has the translations (see
 * `setText`); English stands in until it has said. What the agent wrote is
 * scrubbed of anything that looks like a key on the way, as the export is:
 * a notification is kept by the system after the app has let go of it.
 *
 * `createAttention` is the whole of it with Electron passed in, which is what
 * the tests drive; `start` builds the one the app uses.
 */

const DEFAULT_TEXT = {
    done: '{title} is done',
    failed: '{title} stopped with a problem',
    question: '{title} has a question',
    approval: '{title} needs your approval',
    untitled: 'The AI agent',
};

const TITLE_MAX = 120;
const BODY_MAX = 200;

/** Events remembered as told, per conversation. Past this the oldest go. */
const TOLD_KEPT = 100;

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const fill = (template, title) => String(template).replace(/\{title\}/g, title);

const cleanIds = (list) => [...new Set((Array.isArray(list) ? list : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))];

/** What a waiting call wants, in a line: the question, the command, or the call and its arguments. */
function describeCall(event) {
    const input = event.input && typeof event.input === 'object' ? event.input : {};
    if (event.question) {
        if (Array.isArray(input.questions)) return oneLine(input.questions[0]?.question);
        return oneLine(input.question);
    }
    if (typeof input.command === 'string' && input.command.trim()) return oneLine(input.command);
    const args = Object.entries(input)
        .filter(([key]) => key !== 'session')
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join(', ');
    return oneLine(args ? `${event.name}: ${args}` : event.name);
}

function createAttention({
    Notification = null,
    /** The webContents id of the focused window, or null when the app has no focus. */
    focusedId = () => null,
    hasWindow = () => true,
    settings = () => ({}),
    /** Bring the window forward on a conversation: a click on one. */
    open = () => {},
    /** The app's own sound, played by a window. */
    chime = () => {},
} = {}) {
    /** webContents id -> the conversations that window has in front. */
    const inView = new Map();
    /** conversation id -> { turn, busy, reply, asks, told } */
    const states = new Map();
    /**
     * conversation id -> { notification, key }: the one on screen or in the
     * notification centre. Held, not only for closing: a Notification the
     * garbage collector takes loses its click handler, and the toast it left
     * in the notification centre then does nothing when clicked.
     */
    const live = new Map();
    let text = { ...DEFAULT_TEXT };

    function stateOf(conversationId) {
        let state = states.get(conversationId);
        if (!state) {
            state = { turn: 0, busy: false, reply: '', asks: new Set(), told: new Set() };
            states.set(conversationId, state);
        }
        return state;
    }

    /** On screen in the window that has the focus. */
    function seen(conversationId) {
        const focused = focusedId();
        if (focused === null || focused === undefined) return false;
        return (inView.get(focused) || []).includes(conversationId);
    }

    /** Take down what is up for a conversation; only if it is about `key`, when one is named. */
    function dismiss(conversationId, key = '') {
        const entry = live.get(conversationId);
        if (!entry || (key && entry.key !== key)) return;
        live.delete(conversationId);
        try {
            entry.notification.close();
        } catch {
            // Already gone.
        }
    }

    /**
     * Say it, once per `key`. Returns whether a notification went up, which
     * is for the tests: nothing in the app needs to know.
     */
    function announce(conversation, kind, key, body) {
        const state = stateOf(conversation.id);
        // Marked before anything decides against it: an event someone was
        // looking at as it happened is not announced later on, when they have
        // looked away.
        if (state.told.has(key)) return false;
        state.told.add(key);
        if (state.told.size > TOLD_KEPT) state.told.delete(state.told.values().next().value);

        const current = settings() || {};
        if (current.notify === false) return false;
        if (!hasWindow() || seen(conversation.id)) return false;

        try {
            if (!Notification?.isSupported?.()) return false;
            const name = oneLine(scrub(conversation.title || '', conversation.secrets)) || text.untitled;
            const notification = new Notification({
                title: clip(fill(text[kind] || DEFAULT_TEXT[kind], name), TITLE_MAX),
                body: clip(oneLine(scrub(body || '', conversation.secrets)), BODY_MAX),
                // The chime below instead of the system's sound, so it is the
                // same wherever notification sounds are set, and heard once.
                silent: true,
            });

            dismiss(conversation.id);
            live.set(conversation.id, { notification, key });
            const forget = () => {
                if (live.get(conversation.id)?.notification === notification) live.delete(conversation.id);
            };
            notification.on('click', () => {
                forget();
                open(conversation.id);
            });
            notification.on('failed', forget);
            // Only once the system has taken it, so a notification it refused
            // makes no sound either.
            if (current.notifySound !== false) notification.on('show', () => chime());
            notification.show();
            return true;
        } catch (error) {
            console.error('Could not show a notification:', error.message);
            return false;
        }
    }

    /**
     * Every event a conversation records, after masking. Most of them only
     * move what is remembered about the turn; four can be worth a word.
     */
    function observe(conversation, event) {
        if (!conversation?.id || !event?.type) return;
        const state = stateOf(conversation.id);

        switch (event.type) {
            case 'user-message':
                state.turn += 1;
                state.busy = true;
                state.reply = '';
                // Written to, so whatever was waiting to be said about it has
                // been seen.
                dismiss(conversation.id);
                break;

            case 'assistant-text':
                if (String(event.text || '').trim()) state.reply = event.text;
                break;

            case 'approval-request':
                state.asks.add(event.requestId);
                announce(
                    conversation,
                    event.question ? 'question' : 'approval',
                    `ask:${event.requestId}`,
                    describeCall(event),
                );
                break;

            case 'approval-settled':
                state.asks.delete(event.requestId);
                dismiss(conversation.id, `ask:${event.requestId}`);
                break;

            case 'result': {
                state.busy = false;
                const key = `turn:${state.turn}`;
                // A turn that ends on a question still standing (one the agent
                // was told to stop waiting for) leaves that question up: it is
                // what needs an answer, and "done" over it would say otherwise.
                if (state.asks.size > 0) {
                    state.told.add(key);
                    break;
                }
                announce(conversation, event.isError && event.subtype !== 'success' ? 'failed' : 'done', key, state.reply);
                break;
            }

            case 'error':
                // Only an error that ends a turn. One with no turn running is
                // an answer to something the person just did, in front of them.
                if (state.busy) announce(conversation, 'failed', `turn:${state.turn}`, event.message);
                state.busy = false;
                break;

            case 'interrupted':
                // Stopped by the person, who does not need telling.
                state.told.add(`turn:${state.turn}`);
                state.busy = false;
                break;

            case 'closed':
                state.busy = false;
                break;

            default:
                break;
        }
    }

    /**
     * A window saying which conversations it has in front: the active tab,
     * or nothing when its panel is shut. Forgotten with the window.
     */
    function setInView(webContents, conversationIds) {
        const id = webContents?.id;
        if (id === undefined || id === null) return { success: false };
        if (!inView.has(id)) webContents.once?.('destroyed', () => inView.delete(id));
        const ids = cleanIds(conversationIds);
        inView.set(id, ids);
        if (focusedId() === id) for (const conversationId of ids) dismiss(conversationId);
        return { success: true };
    }

    /** A window coming to the front: what it shows has now been seen. */
    function focused(webContentsId) {
        for (const conversationId of inView.get(webContentsId) || []) dismiss(conversationId);
    }

    /** The words, in the language the app is in. See DEFAULT_TEXT for the keys. */
    function setText(next) {
        if (!next || typeof next !== 'object') return { success: false };
        const merged = { ...DEFAULT_TEXT };
        for (const key of Object.keys(DEFAULT_TEXT)) {
            if (typeof next[key] === 'string' && next[key].trim()) merged[key] = next[key].slice(0, 200);
        }
        text = merged;
        return { success: true };
    }

    return { observe, setInView, focused, setText, _live: live };
}

/* ------------------------------------------------------------------ *
 * The app's own
 * ------------------------------------------------------------------ */

let instance = null;

/**
 * Build the one the app uses, with Electron's windows and notifications.
 *
 * `getWindow` is the main window; `windowOf` names the assistant window
 * holding a conversation, if one does (see `ai/windows.js`); `settings` reads
 * the assistant's settings, for the two switches.
 */
function start({ getWindow, windowOf = () => null, settings = () => ({}) }) {
    const { app, BrowserWindow, Notification } = require('electron');

    const alive = (window) => (window && !window.isDestroyed() ? window : null);
    const anyWindow = () => alive(getWindow()) || BrowserWindow.getAllWindows().find(window => !window.isDestroyed()) || null;

    instance = createAttention({
        Notification,
        focusedId: () => alive(BrowserWindow.getFocusedWindow())?.webContents.id ?? null,
        hasWindow: () => Boolean(anyWindow()),
        settings,
        // The window that holds the conversation comes forward and puts it in
        // front: a window of its own if it is in one, else the main window,
        // which opens the panel and a tab for it if it has neither.
        open: (conversationId) => {
            const window = alive(windowOf(conversationId)) || anyWindow();
            if (!window) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            window.webContents.send('ai-tabs-adopt', { conversationIds: [conversationId] });
        },
        // One window plays it, so it is heard once however many are open.
        chime: () => anyWindow()?.webContents.send('ai-chime', {}),
    });

    app.on('browser-window-focus', (event, window) => {
        if (window && !window.isDestroyed()) instance.focused(window.webContents.id);
    });
}

const observe = (conversation, event) => instance?.observe(conversation, event);
const setInView = (webContents, conversationIds) => instance?.setInView(webContents, conversationIds) || { success: false };
const setText = (next) => instance?.setText(next) || { success: false };

module.exports = { createAttention, start, observe, setInView, setText, DEFAULT_TEXT };
