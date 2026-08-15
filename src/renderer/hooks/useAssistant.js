import { useCallback, useEffect, useRef, useState } from 'react';
import { questionKey } from '../lib/approvals';

/**
 * One assistant conversation, as the panel sees it.
 *
 * The conversation itself lives in the main process. This hook holds an id, a
 * subscription to its event stream, and the reduction of that stream into
 * something renderable. Nothing here is the source of truth, which is what
 * makes a window reload survivable: on mount it asks for the events it missed
 * and replays them through the same reducer the live stream uses, so a
 * restored panel and one that never closed cannot disagree.
 */

const STORAGE_KEY = 'assistant.conversation';

/** A blank turn-in-progress, for the streaming text bubble. */
function emptyDraft() {
    return { text: '', thinking: '' };
}

/**
 * Fold one event into the transcript.
 *
 * Pure, and the only place the shape of an item is decided, so replaying
 * history and receiving live events cannot drift.
 */
function applyEvent(state, event) {
    const items = state.items.slice();
    let draft = state.draft;
    let busy = state.busy;
    let costUsd = state.costUsd;

    /**
     * The row a question belongs to.
     *
     * By session first, because the same command sent to three servers is three
     * rows of the same tool with the same title, and the last one started is not
     * the one being asked about. A row carrying a question already is not
     * running, so no two questions can land on the same row. The last row of
     * that tool is the fallback for a call that named no session, which is the
     * ordinary single-server case.
     */
    const findRunningTool = (name, session) => {
        let fallback = -1;
        for (let index = items.length - 1; index >= 0; index -= 1) {
            const item = items[index];
            if (item.kind !== 'tool' || item.name !== name || item.status !== 'running') continue;
            if (session && item.input?.session === session) return index;
            if (fallback < 0) fallback = index;
        }
        return fallback;
    };

    switch (event.type) {
        case 'user-message':
            items.push({ kind: 'user', id: event.at, text: event.text });
            busy = true;
            draft = emptyDraft();
            break;

        case 'thinking-start':
            draft = { ...draft, thinking: draft.thinking || '' };
            break;

        case 'thinking-delta':
            draft = { ...draft, thinking: draft.thinking + (event.text || '') };
            break;

        case 'text-delta':
            draft = { ...draft, text: draft.text + (event.text || '') };
            break;

        case 'assistant-text':
            // The finished block replaces whatever streamed into the draft.
            // Deltas are a preview; this is the authoritative text.
            items.push({
                kind: 'assistant',
                id: `a-${event.at}-${items.length}`,
                text: event.text,
                thinking: draft.thinking,
            });
            draft = emptyDraft();
            break;

        case 'tool-call':
            items.push({
                kind: 'tool',
                id: event.id,
                name: event.name,
                local: event.local,
                input: event.input || {},
                status: 'running',
                result: '',
                isError: false,
            });
            // Any text that streamed before the call belongs above it.
            if (draft.text.trim()) {
                items.splice(items.length - 1, 0, {
                    kind: 'assistant',
                    id: `a-${event.at}-pre`,
                    text: draft.text,
                    thinking: draft.thinking,
                });
            }
            draft = emptyDraft();
            break;

        case 'tool-result': {
            const index = items.findIndex(item => item.kind === 'tool' && item.id === event.id);
            if (index >= 0) {
                items[index] = {
                    ...items[index],
                    status: event.isError ? 'error' : 'done',
                    result: event.text || '',
                    isError: Boolean(event.isError),
                };
            }
            break;
        }

        case 'approval-request': {
            const approval = {
                requestId: event.requestId,
                name: event.name,
                title: event.title,
                input: event.input || {},
                local: event.local,
                readOnly: event.readOnly,
                sessionId: event.sessionId || '',
                host: event.host,
                status: 'pending',
                feedback: '',
            };

            // The question belongs to the call, so it is attached to the row
            // that call already has rather than living beside it. The panel
            // draws its card from this and holds the row back while it stands,
            // so the command is on screen once; answering it puts the row back
            // with the answer recorded on it. The row is marked waiting rather
            // than running meanwhile, so nothing claims work is happening while
            // it is actually stopped on a question.
            const index = findRunningTool(event.name, event.input?.session);
            if (index >= 0) {
                items[index] = { ...items[index], status: 'waiting', approval };
            } else {
                // No row to land on: a call the transcript never saw start.
                // Rare, and a card of its own is better than a lost question.
                items.push({ kind: 'approval', id: event.requestId, ...approval });
            }
            break;
        }

        case 'approval-settled': {
            const index = items.findIndex(item => (
                item.kind === 'approval'
                    ? item.requestId === event.requestId
                    : item.kind === 'tool' && item.approval?.requestId === event.requestId
            ));
            if (index >= 0) {
                const item = items[index];
                // The answer may be applied twice: once by the click, which is
                // what makes the card settle without waiting for a round trip,
                // and once by the main process when it resolves. Only the
                // first carries what the user typed, so it is kept.
                const feedback = event.feedback || item.approval?.feedback || item.feedback || '';
                items[index] = item.kind === 'approval'
                    ? { ...item, status: event.status, feedback }
                    : {
                        ...item,
                        // Answered, so the row goes back to reporting the call.
                        // A refused one never runs, and `tool-result` closes it
                        // out either way.
                        status: event.status === 'approved' ? 'running' : item.status,
                        approval: { ...item.approval, status: event.status, feedback },
                    };
            }
            break;
        }

        case 'account':
            return { ...state, account: event };

        case 'rate-limit':
            return { ...state, rateLimit: event };

        case 'result':
            busy = false;
            costUsd += event.costUsd || 0;
            if (event.isError && event.subtype !== 'success') {
                items.push({
                    kind: 'notice',
                    id: `n-${event.at}`,
                    tone: 'warn',
                    text: event.subtype === 'error_max_turns'
                        ? 'The assistant reached its step limit for this turn. Ask it to continue if it was on the right track.'
                        : `The run ended early (${event.subtype}).`,
                });
            }
            break;

        case 'error':
            busy = false;
            items.push({ kind: 'notice', id: `e-${event.at}`, tone: 'error', text: event.message });
            draft = emptyDraft();
            break;

        // A line the app wrote into the transcript itself, rather than anything
        // the model said. The main process uses it to close out a conversation
        // read back from disk whose last turn never finished, because the
        // process running it went away.
        case 'notice':
            busy = false;
            items.push({
                kind: 'notice',
                id: `nx-${event.at}-${items.length}`,
                tone: event.tone || 'info',
                text: event.text,
            });
            draft = emptyDraft();
            break;

        case 'tool-failed':
            items.push({
                kind: 'notice',
                id: `tf-${event.at}`,
                tone: 'warn',
                text: `${event.name} failed: ${event.message}`,
            });
            break;

        case 'interrupted':
            busy = false;
            items.push({ kind: 'notice', id: `i-${event.at}`, tone: 'info', text: 'Stopped.' });
            draft = emptyDraft();
            break;

        case 'closed':
            busy = false;
            break;

        default:
            break;
    }

    return { ...state, items, draft, busy, costUsd };
}

/**
 * What ends a turn, and with it any answer being held for calls that were
 * emitted but never asked. Consent does not cross a turn: whatever the model
 * was doing when it was told yes is over, and the next thing it tries is a new
 * question even if it is spelled the same way.
 */
const ENDS_TURN = new Set(['result', 'error', 'interrupted', 'closed', 'user-message']);

const INITIAL = {
    items: [],
    draft: emptyDraft(),
    busy: false,
    costUsd: 0,
    // How this conversation is paid for, and where the plan's window stands.
    // Both arrive from the runtime rather than being configured here.
    account: null,
    rateLimit: null,
};

/**
 * The panel's target, as the main process takes it: a mode, the session a tool
 * call falls back to when it names none, and the explicit set a pinned scope
 * fences the conversation to. Built by `lib/assistant-scope`.
 */
export default function useAssistant({
    scope,
    sessionId,
    sessionIds = [],
    hostIds = [],
    enabled = true,
}) {
    const [state, setState] = useState(INITIAL);
    const [conversationId, setConversationId] = useState('');
    const [starting, setStarting] = useState(true);
    const [failure, setFailure] = useState('');
    const [conversations, setConversations] = useState([]);
    const conversationRef = useRef('');

    /**
     * Answers given for calls that have not asked yet.
     *
     * A card covers every call the model has already emitted asking the same
     * thing, and names each of their servers on it, because "run this on those
     * three" is one decision. An agent that runs its tool calls one at a time
     * only asks about the second once the first has been answered, so the
     * answer waits here for it: question key -> the verdict and the exact set of
     * sessions it was given for.
     *
     * Deliberately narrow. It matches only a call whose tool, arguments and
     * target were all on the card that was answered, and it is dropped the
     * moment the turn ends. Anything else asks.
     */
    const held = useRef(new Map());

    // Kept in a ref as well so the event subscription, which is set up once,
    // can filter on the current id without being torn down and rebuilt every
    // time the id changes.
    conversationRef.current = conversationId;

    /**
     * The target, as one value and as one dependency.
     *
     * Two arrays in a dependency list are two new identities on every render,
     * which would push the scope over IPC on each one. The key is what the
     * effect watches; the ref is what it sends, so a caller that does not
     * memoise its arrays still gets exactly one call per real change.
     */
    const targetKey = `${scope}|${sessionId}|${sessionIds.join(',')}|${hostIds.join(',')}`;
    const targetRef = useRef(null);
    targetRef.current = { scope, sessionId, sessionIds, hostIds };

    /* Adopt the conversation from before a reload, or open a new one. */
    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;

        (async () => {
            try {
                const remembered = window.localStorage.getItem(STORAGE_KEY) || '';
                if (remembered) {
                    const past = await window.api.ai.history(remembered);
                    if (cancelled) return;
                    if (past?.found) {
                        setConversationId(remembered);
                        setState(past.events.reduce(applyEvent, INITIAL));
                        setStarting(false);
                        return;
                    }
                }

                const created = await window.api.ai.start(targetRef.current);
                if (cancelled) return;
                setConversationId(created.conversationId);
                window.localStorage.setItem(STORAGE_KEY, created.conversationId);
                setStarting(false);
            } catch (error) {
                if (!cancelled) {
                    setFailure(error.message || 'The assistant could not be started');
                    setStarting(false);
                }
            }
        })();

        return () => { cancelled = true; };
        // Deliberately once: a scope change moves the existing conversation
        // rather than starting a new one, which is handled below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    /**
     * Answer one approval, in the transcript and over IPC.
     *
     * The card is marked locally straight away. It is the thing the user just
     * clicked, and waiting for the round trip to grey it out reads as a dropped
     * click.
     */
    const settle = useCallback((requestId, approved, message) => {
        setState(previous => applyEvent(previous, {
            type: 'approval-settled',
            requestId,
            status: approved ? 'approved' : 'denied',
            feedback: approved ? '' : message,
            at: Date.now(),
        }));
        window.api.ai.approve(
            requestId,
            approved,
            approved ? '' : (message || 'The user declined that.')
        );
    }, []);

    /* The live stream. */
    useEffect(() => {
        if (!enabled) return undefined;
        const off = window.api.ai.onEvent(({ conversationId: id, event }) => {
            if (id !== conversationRef.current) return;
            setState(previous => applyEvent(previous, event));

            if (ENDS_TURN.has(event.type)) {
                held.current.clear();
                return;
            }

            // A question already answered on a card that named this server.
            // Applied after the event above, so the transcript has the row
            // before it is told the row has been answered.
            if (event.type === 'approval-request') {
                const answer = held.current.get(questionKey(event));
                if (answer && event.sessionId && answer.sessions.has(event.sessionId)) {
                    settle(event.requestId, answer.approved, answer.message);
                }
            }
        });
        return off;
    }, [enabled, settle]);

    /* Follow the pane the panel is pointed at, or the set it is pinned to. */
    useEffect(() => {
        if (!conversationId) return;
        window.api.ai.setScope(conversationId, targetRef.current);
        // `targetKey` is the target, flattened to something a dependency list
        // can compare. See the note where it is built.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId, targetKey]);

    const send = useCallback(async (text) => {
        if (!conversationId) return;
        const result = await window.api.ai.send(conversationId, text);
        if (!result?.success && result?.message) {
            setState(previous => applyEvent(previous, {
                type: 'error', message: result.message, at: Date.now(),
            }));
        }
    }, [conversationId]);

    const interrupt = useCallback(() => {
        if (conversationId) window.api.ai.interrupt(conversationId);
    }, [conversationId]);

    /**
     * Answer one card, which is one question however many calls it covers.
     *
     * `message` is what to do instead, when the user turned the call down with
     * something to say. It goes back as the tool's own result, so the model
     * reads it as the answer to the call it just made rather than as a new
     * instruction that arrived from nowhere.
     *
     * The calls still queued behind this question are not answered here, since
     * they have not asked yet. The verdict is held for them under the servers
     * the card named, and applied as each one arrives. See `held`.
     */
    const respond = useCallback((group, approved, message = '') => {
        if (group.queued.length > 0) {
            held.current.set(group.key, {
                approved,
                message,
                sessions: new Set(group.queued.map(entry => entry.sessionId)),
            });
        }
        for (const approval of group.items) settle(approval.requestId, approved, message);
    }, [settle]);

    /** What the history menu lists. Asked for rather than pushed. */
    const refreshConversations = useCallback(async () => {
        try {
            setConversations(await window.api.ai.list() || []);
        } catch {
            // The menu just shows what it had.
        }
    }, []);

    useEffect(() => {
        if (enabled && conversationId) refreshConversations();
    }, [enabled, conversationId, refreshConversations]);

    /**
     * Start a new conversation, parking the one on screen.
     *
     * Parked, not closed: the transcript stays reachable from the history menu
     * and can be resumed. Only the running query is given up.
     */
    const reset = useCallback(async () => {
        // Whatever was being held for the old conversation's last turn belongs
        // to a conversation nobody is looking at any more.
        held.current.clear();
        if (conversationId) await window.api.ai.park(conversationId);
        const created = await window.api.ai.start(targetRef.current);
        setConversationId(created.conversationId);
        window.localStorage.setItem(STORAGE_KEY, created.conversationId);
        setState(INITIAL);
    }, [conversationId]);

    /** Go back to an earlier conversation, replaying it through the reducer. */
    const open = useCallback(async (id) => {
        if (!id || id === conversationId) return;
        held.current.clear();
        const past = await window.api.ai.history(id);
        if (!past?.found) {
            await refreshConversations();
            return;
        }
        if (conversationId) await window.api.ai.park(conversationId);
        setConversationId(id);
        window.localStorage.setItem(STORAGE_KEY, id);
        setState(past.events.reduce(applyEvent, INITIAL));
    }, [conversationId, refreshConversations]);

    /**
     * Throw one away for good. Deleting the conversation being read leaves the
     * panel pointed at nothing, so it opens a fresh one in its place.
     */
    const remove = useCallback(async (id) => {
        if (!id) return;
        held.current.clear();
        await window.api.ai.close(id);
        if (id === conversationId) {
            const created = await window.api.ai.start(targetRef.current);
            setConversationId(created.conversationId);
            window.localStorage.setItem(STORAGE_KEY, created.conversationId);
            setState(INITIAL);
        }
        await refreshConversations();
    }, [conversationId, refreshConversations]);

    return {
        items: state.items,
        draft: state.draft,
        busy: state.busy,
        costUsd: state.costUsd,
        account: state.account,
        rateLimit: state.rateLimit,
        conversationId,
        conversations,
        starting,
        failure,
        send,
        interrupt,
        respond,
        reset,
        open,
        remove,
        refreshConversations,
    };
}

export { applyEvent };
