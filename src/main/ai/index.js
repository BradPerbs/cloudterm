const settings = require('./settings');
const prompt = require('./prompt');
const catalog = require('./tools');
const transcript = require('../transcript');
const activity = require('../activity');

/**
 * The assistant, from the app's point of view.
 *
 * Owns conversations and the two things a conversation needs that a provider
 * cannot do for itself: putting a tool call in front of a person and waiting
 * for an answer, and asking the renderer to do something only it can, like
 * open a tab.
 *
 * Everything the renderer sees is one event stream per conversation. That is
 * also what makes a window reload survivable: the events are kept here, and a
 * panel that comes back asks for them and rebuilds itself. The conversation
 * itself never lived in the window.
 */

const PROVIDERS = {
    'claude-code': require('./providers/claude-code'),
    codex: require('./providers/codex'),
};

/** Kept per conversation, so a long session cannot grow without bound. */
const MAX_EVENTS = 4000;

/**
 * How many conversations stay reachable from the history menu.
 *
 * They cost a page of events each once parked, not a process, so this is a
 * generous number. It exists because a Map that only ever grows is a leak with
 * a nice name.
 */
const MAX_CONVERSATIONS = 20;

/** How long a tool call waits for a person before it gives up. */
const APPROVAL_TIMEOUT = 10 * 60 * 1000;

/** How long the renderer gets to open or close a session. */
const ACTION_TIMEOUT = 90 * 1000;

// conversationId -> conversation
const conversations = new Map();
// requestId -> { resolve, timer }
const pendingApprovals = new Map();
const pendingActions = new Map();

let counter = 0;
let notify = () => {};

/**
 * How the runtime last reported it was authenticating: a plan, a key, or a
 * third-party provider. Kept at module level rather than per conversation
 * because it describes the machine, not the chat, and the settings page needs
 * to be able to say so without one being open.
 */
let lastAccount = null;

/**
 * What an agent said it can run: `{ provider, rows }`, one row per model, each
 * carrying the effort levels that model actually takes.
 *
 * Keyed by provider, and that is the whole point. This used to be a bare list
 * plus a "forget it" message sent when the agent changed, and the two of them
 * raced: reading a catalog means starting a runtime, which takes seconds, so
 * an answer for the agent you just left could arrive after the switch, and a
 * clearing message could arrive after a fresh answer. Both were seen. Keyed,
 * a list for the wrong agent is not stale data to be cleared in time, it is
 * simply not an answer to the question being asked.
 *
 * One entry per agent rather than one slot, so switching back and forth asks
 * each of them once. A `null` value is an answer too: that agent was asked and
 * publishes nothing.
 */
const modelCatalogs = new Map();

/** The in-flight ask, so ten panels opening at once do not start ten of them. */
let modelsPending = null;

function setNotifier(fn) {
    notify = fn;
}

function nextId(prefix) {
    counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

function create({ scope = 'session', sessionId = '' } = {}) {
    const id = nextId('conv');
    conversations.set(id, {
        id,
        scope,
        boundSessionId: sessionId,
        session: null,
        starting: null,
        events: [],
        busy: false,
        lastContext: '',
        providerSessionId: '',
        needsRestart: false,
        costUsd: 0,
        // Taken from the first thing the user says, which is what the history
        // menu has to label the entry with. Nothing else here knows what a
        // conversation was about.
        title: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
    trim();
    return { conversationId: id, scope, sessionId };
}

/**
 * Forget the oldest parked conversations, once there are more than the cap.
 *
 * Only ones that are properly asleep are candidates: a conversation with a
 * running query, or one waiting on an approval, is in use whatever its age.
 */
function trim() {
    let excess = conversations.size - MAX_CONVERSATIONS;
    if (excess <= 0) return;

    const parked = [...conversations.values()]
        .filter(conversation => !conversation.session && !conversation.starting && !conversation.busy)
        .sort((a, b) => a.updatedAt - b.updatedAt);

    for (const conversation of parked) {
        if (excess <= 0) break;
        conversations.delete(conversation.id);
        excess -= 1;
    }
}

function get(conversationId) {
    return conversations.get(conversationId);
}

/**
 * Record an event and pass it on.
 *
 * Everything the panel renders goes through here, which is why the log and the
 * push cannot drift apart: a panel restoring after a reload replays exactly
 * what a panel that stayed open received.
 */
function emit(conversation, event) {
    const stamped = { ...event, at: Date.now() };
    conversation.updatedAt = stamped.at;
    conversation.events.push(stamped);
    if (conversation.events.length > MAX_EVENTS) {
        conversation.events.splice(0, conversation.events.length - MAX_EVENTS);
    }
    notify('ai-event', { conversationId: conversation.id, event: stamped });
}

/** Point an existing conversation at a different session, or at all of them. */
function setScope(conversationId, { scope, sessionId = '' }) {
    const conversation = conversations.get(conversationId);
    if (!conversation) return { success: false, message: 'That conversation is gone' };
    conversation.scope = scope === 'global' ? 'global' : 'session';
    conversation.boundSessionId = conversation.scope === 'session' ? sessionId : '';
    return { success: true, scope: conversation.scope, sessionId: conversation.boundSessionId };
}

function resolved() {
    return { ...settings.get(), apiKey: settings.readApiKey() };
}

/**
 * Settings the SDK bakes into a running query and cannot be told about later.
 * Changing one of these means the query has to be started again.
 */
const RESTART_ON = ['provider', 'maxTurns', 'allowLocalTools'];

/**
 * Note that the configuration moved.
 *
 * Three kinds of setting, three answers. The approval policy and the safe
 * command list are read live on every tool call, so they need nothing here.
 * The model and the effort are live control requests, so they are pushed at
 * the running session and take effect on its next response. Only the handful
 * the SDK fixes when a query starts need the query started again, and that is
 * deferred to the next message: doing it here would kill a turn halfway
 * through a command on a live server because someone touched a dropdown while
 * watching it run.
 */
function reconfigure(before, after) {
    // The account describes a runtime rather than the app, so it does not
    // survive a change of agent. The model catalog needs no clearing: it is
    // keyed by provider, so the one held for the agent just left simply stops
    // matching, and switching back finds it still there.
    //
    // What is sent is the new agent's catalog if it has already been read, and
    // otherwise nothing, so a panel drops the old list at once rather than
    // showing it until the first ask comes back.
    if (before.provider !== after.provider) {
        lastAccount = null;
        notify('ai-models', {
            provider: after.provider,
            models: modelCatalogs.get(after.provider) ?? null,
        });
    }

    for (const conversation of conversations.values()) {
        const session = conversation.session;
        if (session) {
            if (before.model !== after.model) session.setModel?.(after.model);
            if (before.effort !== after.effort) session.setEffort?.(after.effort);
        }
        if (RESTART_ON.some(field => before[field] !== after[field])) {
            if (session || conversation.starting) conversation.needsRestart = true;
        }
    }
}

/** Drop the running query, keeping the id that lets the next one resume it. */
async function restart(conversation) {
    // A query that is still coming up is waited for rather than ignored.
    // Otherwise it finishes after this returns, hands itself to a conversation
    // nobody is looking at any more, and stays open until the app quits.
    if (conversation.starting) await conversation.starting.catch(() => {});

    const session = conversation.session;
    conversation.session = null;
    conversation.needsRestart = false;
    // The situational block goes again with the first message on the new
    // query, which has never been told where the user is.
    conversation.lastContext = '';
    try {
        await session?.close();
    } catch {
        // Already gone.
    }
}

/**
 * Ask the user about one tool call.
 *
 * Resolves rather than rejects on a timeout or a missing window, because the
 * answer to "may I restart this service" when nobody is there to say yes is
 * no, not an exception somewhere up the stack.
 */
function requestApproval(conversation, { toolName, name, input, local }) {
    return new Promise((resolve) => {
        const definition = catalog.BY_NAME.get(name);
        const requestId = nextId('approve');

        const settle = (verdict, status) => {
            const entry = pendingApprovals.get(requestId);
            if (!entry) return;
            clearTimeout(entry.timer);
            pendingApprovals.delete(requestId);
            // Recorded, not just sent. The request itself is in the event log,
            // so without this a window that reloads after answering replays the
            // card as though it were still waiting, and clicking it does
            // nothing because the id it names is long gone.
            emit(conversation, { type: 'approval-settled', requestId, status });
            resolve(verdict);
        };

        const timer = setTimeout(() => {
            settle({ approved: false, message: 'That request timed out waiting for an answer.' }, 'expired');
        }, APPROVAL_TIMEOUT);

        pendingApprovals.set(requestId, { resolve: settle, timer, conversationId: conversation.id });

        const target = input?.session || conversation.boundSessionId || '';
        const info = target ? transcript.info(target) : null;

        emit(conversation, {
            type: 'approval-request',
            requestId,
            name,
            rawName: toolName,
            title: definition?.title || (local ? `Local: ${toolName}` : toolName),
            local: Boolean(local),
            readOnly: Boolean(definition?.readOnly),
            input,
            host: info ? (info.hostName || info.address) : '',
        });
    });
}

/**
 * Ask the renderer to do something only it can.
 *
 * Opening a session means creating a tab, and tabs live in the pane tree in
 * the window. So the main process asks, the same way it asks about an unknown
 * host key, and waits for the window to report back.
 */
function requestAction(conversation, payload) {
    return new Promise((resolve) => {
        const requestId = nextId('action');

        const settle = (result) => {
            const entry = pendingActions.get(requestId);
            if (!entry) return;
            clearTimeout(entry.timer);
            pendingActions.delete(requestId);
            resolve(result);
        };

        const timer = setTimeout(() => {
            settle({ success: false, message: 'The app did not finish that in time.' });
        }, ACTION_TIMEOUT);

        pendingActions.set(requestId, { resolve: settle, timer });
        notify('ai-action', { conversationId: conversation.id, requestId, ...payload });
    });
}

function respondToApproval({ requestId, approved, message }) {
    const entry = pendingApprovals.get(requestId);
    if (!entry) return false;
    entry.resolve(
        { approved: Boolean(approved), message: message || '' },
        approved ? 'approved' : 'denied'
    );
    return true;
}

function respondToAction({ requestId, success, sessionId, message }) {
    const entry = pendingActions.get(requestId);
    if (!entry) return false;
    entry.resolve({ success: Boolean(success), sessionId: sessionId || '', message: message || '' });
    return true;
}

/** Start the provider for a conversation, once, on the first message. */
function ensureProvider(conversation) {
    if (conversation.session) return Promise.resolve(conversation.session);
    if (conversation.starting) return conversation.starting;

    const current = resolved();
    const provider = PROVIDERS[current.provider];
    if (!provider) {
        return Promise.reject(new Error(`No provider named "${current.provider}" is available`));
    }

    const context = () => ({
        scope: conversation.scope,
        boundSessionId: conversation.boundSessionId,
        commandMode: resolved().commandMode,
    });

    conversation.starting = provider.start({
        settings: current,
        // Read again on every tool call, so tightening the approval policy
        // mid-run takes effect on the next call rather than the next
        // conversation. The snapshot above is only for the options the SDK
        // fixes when the query starts.
        getSettings: resolved,
        systemPrompt: prompt.build(context()),
        toolContext: () => ({
            scope: conversation.scope,
            boundSessionId: conversation.boundSessionId,
            settings: resolved(),
            sessionAction: (payload) => requestAction(conversation, payload),
        }),
        requestApproval: (request) => requestApproval(conversation, request),
        onEvent: (event) => handleProviderEvent(conversation, event),
        // Continues the same SDK session after a restart, which is what lets
        // the model be switched without losing the conversation.
        resumeSessionId: conversation.providerSessionId,
    }).then((session) => {
        conversation.session = session;
        conversation.starting = null;
        return session;
    }).catch((error) => {
        conversation.starting = null;
        throw error;
    });

    return conversation.starting;
}

function handleProviderEvent(conversation, event) {
    // Not a transcript item: it says what this machine can run, not what
    // happened in this chat. Held here and pushed on its own channel rather
    // than emitted, so it is not replayed into a panel as a message and does
    // not spend a slot in the conversation's event log.
    if (event.type === 'models') {
        if (event.models?.length) {
            const provider = resolved().provider;
            modelCatalogs.set(provider, event.models);
            notify('ai-models', { provider, models: event.models });
        }
        return;
    }

    if (event.type === 'session') {
        conversation.providerSessionId = event.sessionId;
    }
    // Held so a panel can be told how this conversation is being paid for
    // without waiting for the next turn to say so again.
    if (event.type === 'account') {
        conversation.account = event;
        lastAccount = event;
    }
    if (event.type === 'rate-limit') conversation.rateLimit = event;
    if (event.type === 'result') {
        conversation.busy = false;
        conversation.costUsd += event.costUsd || 0;
    }
    if (event.type === 'error' || event.type === 'closed') {
        conversation.busy = false;
    }
    if (event.type === 'tool-call' && !event.local) {
        recordToolActivity(conversation, event);
    }
    emit(conversation, event);
}

/**
 * Log the calls that change something, in the app's own activity log.
 *
 * The chat transcript is not an audit trail: it lives in a window and it is
 * the model's account of events. A command the assistant ran on a server
 * belongs in the same log as one the user ran, next to the connection it
 * happened on.
 */
function recordToolActivity(conversation, event) {
    const definition = catalog.BY_NAME.get(event.name);
    if (!definition || definition.readOnly) return;

    const target = event.input?.session || conversation.boundSessionId || '';
    const info = target ? transcript.info(target) : null;
    const summary = event.name === 'run_command'
        ? String(event.input?.command || '').slice(0, 300)
        : summarise(event.input);

    activity.record({
        category: 'connection',
        action: `assistant.${event.name}`,
        outcome: 'info',
        target: info?.hostName || '',
        subject: info?.address || '',
        detail: summary,
        hostId: info?.hostId || '',
        hostName: info?.hostName || '',
    });
}

function summarise(input) {
    if (!input || typeof input !== 'object') return '';
    return Object.entries(input)
        .filter(([key]) => key !== 'session')
        .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`)
        .join(', ')
        .slice(0, 300);
}

/**
 * Send a message.
 *
 * The situational block goes in front of the user's text, and only when it has
 * changed since the last turn. It cannot live in the system prompt: that is
 * fixed when the conversation starts, and which session is in front of the
 * user is exactly the thing that moves while they work. Sending it only on
 * change keeps the cached prefix intact for the turns where nothing moved.
 */
async function send(conversationId, text) {
    const conversation = conversations.get(conversationId);
    if (!conversation) return { success: false, message: 'That conversation is gone' };

    const body = String(text || '').trim();
    if (!body) return { success: false, message: 'Nothing to send' };

    if (!conversation.title) conversation.title = body.replace(/\s+/g, ' ').slice(0, 80);

    emit(conversation, { type: 'user-message', text: body });
    conversation.busy = true;

    try {
        // A model or effort change since the last message. Restarting here,
        // rather than when the setting changed, means it lands between turns
        // instead of on top of one.
        if (conversation.needsRestart) await restart(conversation);

        const session = await ensureProvider(conversation);

        const context = prompt.situation({
            scope: conversation.scope,
            boundSessionId: conversation.boundSessionId,
            commandMode: resolved().commandMode,
        });

        let payload = body;
        if (context !== conversation.lastContext) {
            conversation.lastContext = context;
            payload = `<app-context>\n${context}\n</app-context>\n\n${body}`;
        }

        session.send(payload);
        return { success: true };
    } catch (error) {
        conversation.busy = false;
        emit(conversation, { type: 'error', message: error.message });
        return { success: false, message: error.message };
    }
}

async function interrupt(conversationId) {
    const conversation = conversations.get(conversationId);
    if (!conversation?.session) return { success: false };

    // Anything this conversation is waiting on a person for is refused first.
    // Otherwise "stop" leaves a card on screen whose approval would start work
    // the user just cancelled. Scoped by conversation: a second panel's pending
    // question is not this one's to answer.
    for (const entry of [...pendingApprovals.values()]) {
        if (entry.conversationId !== conversationId) continue;
        entry.resolve({ approved: false, message: 'The user stopped the run.' }, 'denied');
    }

    await conversation.session.interrupt();
    conversation.busy = false;
    emit(conversation, { type: 'interrupted' });
    return { success: true };
}

/**
 * Put a conversation down without ending it.
 *
 * Starting a new chat used to close the old one, which is why there was nothing
 * to go back to. Parking releases the expensive half, the provider session and
 * the process behind it, and keeps the cheap half: the event log the panel
 * rebuilds itself from, and the provider's own session id. Sending into a
 * parked conversation resumes it where it stopped, because `ensureProvider`
 * already passes that id back as `resumeSessionId`.
 */
async function park(conversationId) {
    const conversation = conversations.get(conversationId);
    if (!conversation) return { success: true };

    // A turn still running is stopped first, and anything it has left waiting
    // for an answer is refused. Walking away from a question is a no.
    if (conversation.busy && conversation.session) await interrupt(conversationId);

    await restart(conversation);
    return { success: true };
}

async function close(conversationId) {
    const conversation = conversations.get(conversationId);
    if (!conversation) return { success: true };
    conversations.delete(conversationId);
    try {
        // As in `restart`: a query still coming up has to be waited for, or it
        // outlives the conversation it belonged to.
        if (conversation.starting) await conversation.starting.catch(() => {});
        await conversation.session?.close();
    } catch {
        // Already gone.
    }
    return { success: true };
}

/** Everything a panel needs to rebuild itself after a window reload. */
function history(conversationId) {
    const conversation = conversations.get(conversationId);
    if (!conversation) return { found: false, events: [] };
    return {
        found: true,
        events: conversation.events,
        scope: conversation.scope,
        sessionId: conversation.boundSessionId,
        busy: conversation.busy,
        costUsd: conversation.costUsd,
        title: conversation.title,
    };
}

/**
 * Every conversation this run of the app still holds, newest first.
 *
 * Both the ones with a query running and the ones parked, because from the
 * panel's side that difference is invisible: picking either reads the same
 * event log back, and only sending into it starts anything.
 */
function list() {
    return [...conversations.values()]
        .map(conversation => ({
            conversationId: conversation.id,
            title: conversation.title,
            scope: conversation.scope,
            sessionId: conversation.boundSessionId,
            busy: conversation.busy,
            live: Boolean(conversation.session || conversation.starting),
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messages: conversation.events.filter(event => event.type === 'user-message').length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The models this machine can run, asked for rather than waited for.
 *
 * Cached until the agent changes, which `reconfigure` clears. A conversation
 * reports the same list when it starts, which is free and keeps this honest
 * if someone changes their agent's own setup while the app is open.
 */
function models({ refresh = false } = {}) {
    const asked = resolved().provider;

    // A forced ask drops what is held for this agent and starts again. The
    // menu offers it when a read came back with nothing, which is usually a
    // runtime that was not up yet rather than an agent with no models.
    if (refresh) modelCatalogs.delete(asked);

    if (modelCatalogs.has(asked)) return Promise.resolve(modelCatalogs.get(asked));
    if (modelsPending?.provider === asked && !refresh) return modelsPending.promise;

    const provider = PROVIDERS[asked];
    if (!provider?.listModels) return Promise.resolve(null);

    const promise = provider.listModels({ settings: resolved() })
        .then((rows) => {
            const list = rows?.length ? rows : null;
            // Stored against the agent that answered, whether or not that is
            // still the one selected. A later ask for a different agent reads
            // its own entry, and a switch back does not have to ask again.
            modelCatalogs.set(asked, list);
            notify('ai-models', { provider: asked, models: list });
            return list;
        })
        .catch((error) => {
            // Said out loud rather than swallowed: an empty model menu with no
            // reason anywhere is the kind of thing that gets blamed on the
            // menu. Not cached either, so the next ask tries again rather than
            // inheriting one bad start for the life of the app.
            console.error(`Could not read the model list from ${asked}:`, error.message);
            return null;
        })
        .finally(() => {
            if (modelsPending?.promise === promise) modelsPending = null;
        });

    modelsPending = { provider: asked, promise };
    return promise;
}

function status() {
    const current = settings.get();
    return {
        ready: Boolean(PROVIDERS[current.provider]),
        provider: current.provider,
        providers: Object.keys(PROVIDERS),
        settings: current,
        // Null until a conversation has run once. The settings page says so
        // rather than guessing, because "no plan found" and "not asked yet"
        // are different answers.
        account: lastAccount,
        // Only if it belongs to the agent currently selected. Null otherwise,
        // which reads as "not asked yet" and is exactly what it is.
        models: modelCatalogs.get(current.provider) ?? null,
        tools: catalog.TOOLS.map(tool => ({
            name: tool.name,
            title: tool.title,
            readOnly: tool.readOnly,
        })),
    };
}

/** Tear every conversation down, for a lock or a quit. */
async function shutdown() {
    const ids = [...conversations.keys()];
    await Promise.all(ids.map(id => close(id)));
    for (const entry of [...pendingApprovals.values()]) {
        entry.resolve({ approved: false, message: 'The app closed the conversation.' }, 'denied');
    }
    for (const [requestId, entry] of [...pendingActions]) {
        entry.resolve({ success: false, message: 'The app closed the conversation.' });
        pendingActions.delete(requestId);
    }
}

module.exports = {
    setNotifier,
    reconfigure,
    create,
    get,
    send,
    interrupt,
    park,
    close,
    setScope,
    history,
    list,
    status,
    models,
    shutdown,
    respondToApproval,
    respondToAction,
    settings,
};
