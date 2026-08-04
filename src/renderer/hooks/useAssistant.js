import { useCallback, useEffect, useRef, useState } from 'react';

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

    const findRunningTool = (name) => {
        for (let index = items.length - 1; index >= 0; index -= 1) {
            const item = items[index];
            if (item.kind === 'tool' && item.name === name && item.status === 'running') return index;
        }
        return -1;
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
                host: event.host,
                status: 'pending',
                feedback: '',
            };

            // The question belongs to the call, so it lands on the row that
            // call already has rather than arriving as a second card printing
            // the same command underneath the first. The row is marked waiting
            // rather than running while it stands, so the panel does not claim
            // work is happening while it is actually stopped on a question.
            const index = findRunningTool(event.name);
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

    /* The live stream. */
    useEffect(() => {
        if (!enabled) return undefined;
        const off = window.api.ai.onEvent(({ conversationId: id, event }) => {
            if (id !== conversationRef.current) return;
            setState(previous => applyEvent(previous, event));
        });
        return off;
    }, [enabled]);

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
     * Answer one approval.
     *
     * `message` is what to do instead, when the user turned the call down with
     * something to say. It goes back as the tool's own result, so the model
     * reads it as the answer to the call it just made rather than as a new
     * instruction that arrived from nowhere.
     */
    const respond = useCallback((requestId, approved, message = '') => {
        // Marked locally straight away. The card is the thing the user just
        // clicked, and waiting for the round trip to grey it out reads as a
        // dropped click.
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
        if (conversationId) await window.api.ai.park(conversationId);
        const created = await window.api.ai.start(targetRef.current);
        setConversationId(created.conversationId);
        window.localStorage.setItem(STORAGE_KEY, created.conversationId);
        setState(INITIAL);
    }, [conversationId]);

    /** Go back to an earlier conversation, replaying it through the reducer. */
    const open = useCallback(async (id) => {
        if (!id || id === conversationId) return;
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
