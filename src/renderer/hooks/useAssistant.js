import { useCallback, useEffect, useRef, useState } from 'react';
import { questionKey } from '../lib/approvals';
import { INITIAL, applyBatch, applyEvent, replay } from '../lib/transcript-reducer';

/**
 * One assistant conversation, as the panel sees it.
 *
 * The conversation itself lives in the main process. This hook holds an id, a
 * subscription to its event stream, and the reduction of that stream into
 * something renderable. Nothing here is the source of truth, which is what
 * makes a window reload survivable: on mount it asks for the events it missed
 * and replays them through the same reducer the live stream uses, so a
 * restored panel and one that never closed cannot disagree. The reducer is
 * `lib/transcript-reducer`, which is where the shape of every item is decided.
 *
 * Which conversation it is on is the caller's to remember: the tab that owns
 * this hook hands in the id it was left with and is told whenever the hook
 * moves to another one. The hook used to keep that in localStorage itself,
 * which was fine for one conversation and wrong for several.
 */

/**
 * What ends a turn, and with it any answer being held for calls that were
 * emitted but never asked. Consent does not cross a turn: whatever the model
 * was doing when it was told yes is over, and the next thing it tries is a new
 * question even if it is spelled the same way.
 */
const ENDS_TURN = new Set(['result', 'error', 'interrupted', 'closed', 'user-message']);

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
    /** The conversation to pick up, if the caller was left holding one. */
    conversationId: given = '',
    /** Told the id whenever this hook starts or switches to a conversation. */
    onConversationChange,
}) {
    const [state, setState] = useState(INITIAL);

    /**
     * Events in, one render per frame out.
     *
     * A runtime streams a reply a few words at a time, and a busy turn lands a
     * tool call and its result in the same breath, dozens a second. Each used
     * to be a render of its own. They are queued here and folded in together
     * on the next frame, in the order they came, so a burst of forty is one
     * render and a quiet trickle is no slower than before. The timeout is for
     * a minimised window, where frames stop coming.
     *
     * Everything that changes the transcript goes through the same queue, the
     * user's own clicks included, so an answer cannot overtake the question
     * it answers.
     */
    const pending = useRef([]);
    const scheduled = useRef({ frame: 0, timeout: 0 });
    const flush = useCallback(() => {
        cancelAnimationFrame(scheduled.current.frame);
        clearTimeout(scheduled.current.timeout);
        scheduled.current = { frame: 0, timeout: 0 };
        const batch = pending.current;
        if (batch.length === 0) return;
        pending.current = [];
        setState(previous => applyBatch(previous, batch));
    }, []);
    const dispatch = useCallback((event) => {
        pending.current.push(event);
        if (scheduled.current.frame || scheduled.current.timeout) return;
        scheduled.current = {
            frame: requestAnimationFrame(flush),
            timeout: setTimeout(flush, 100),
        };
    }, [flush]);

    /** A whole transcript in place of this one: whatever was queued for the old one goes. */
    const replaceState = useCallback((next) => {
        pending.current = [];
        setState(next);
    }, []);

    useEffect(() => () => {
        cancelAnimationFrame(scheduled.current.frame);
        clearTimeout(scheduled.current.timeout);
    }, []);

    const [conversationId, setConversationId] = useState('');
    /**
     * The agent, model, effort and mode this conversation is pinned to on its
     * composer's chips, over the app's settings, or null for the settings
     * throughout. Main owns it; this is the copy the chips draw, refreshed by
     * every answer that carries it and by a `pinned` event when it moved
     * somewhere else.
     */
    const [pinned, setPinned] = useState(null);
    const [starting, setStarting] = useState(true);
    const [failure, setFailure] = useState('');
    const [conversations, setConversations] = useState([]);
    const conversationRef = useRef('');

    // The callback as it stands, so the effects below need not be rebuilt for
    // a caller that passes a new function each render.
    const onChangeRef = useRef(onConversationChange);
    onChangeRef.current = onConversationChange;

    /** Adopt an id: locally, and by telling whoever remembers it. */
    const adopt = useCallback((id) => {
        setConversationId(id);
        onChangeRef.current?.(id);
    }, []);

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
                if (given) {
                    const past = await window.api.ai.history(given);
                    if (cancelled) return;
                    if (past?.found) {
                        adopt(given);
                        replaceState(replay(past.events));
                        setPinned(past.pinned || null);
                        setStarting(false);
                        return;
                    }
                }

                const created = await window.api.ai.start(targetRef.current);
                if (cancelled) return;
                adopt(created.conversationId);
                // Main has put it on what new chats start on already.
                setPinned(created.pinned || null);
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
     * click. Through the same queue as the stream, so it lands after the
     * question it answers even when both arrive in one frame.
     */
    const settle = useCallback((requestId, approved, message, input = null) => {
        dispatch({
            type: 'approval-settled',
            requestId,
            status: approved ? 'approved' : 'denied',
            feedback: approved ? '' : message,
            at: Date.now(),
        });
        window.api.ai.approve(
            requestId,
            approved,
            approved ? '' : (message || 'The user declined that.'),
            input
        );
    }, [dispatch]);

    /* The live stream. */
    useEffect(() => {
        if (!enabled) return undefined;
        const off = window.api.ai.onEvent(({ conversationId: id, event }) => {
            if (id !== conversationRef.current) return;
            // The pin moved, from this window or another one showing the same
            // conversation: the chips follow. Not part of the transcript.
            if (event.type === 'pinned') {
                setPinned(event.pinned || null);
                return;
            }
            dispatch(event);

            if (ENDS_TURN.has(event.type)) {
                held.current.clear();
                return;
            }

            // A question already answered on a card that named this server.
            // Queued after the event above, so the transcript has the row
            // before it is told the row has been answered.
            if (event.type === 'approval-request') {
                const answer = held.current.get(questionKey(event));
                if (answer && event.sessionId && answer.sessions.has(event.sessionId)) {
                    settle(event.requestId, answer.approved, answer.message);
                }
            }
        });
        return off;
    }, [enabled, settle, dispatch]);

    /**
     * Follow the pane the panel is pointed at, or the set it is pinned to.
     *
     * Not on the turn a conversation is adopted: main already holds that
     * conversation's selection, and it is the one the tab is about to read
     * back and show. Pushing the tab's own starting point first would
     * overwrite the stored selection with "follow" before it was read, which
     * is how a pinned set used to be lost on the way to another window.
     */
    const scopedFor = useRef('');
    useEffect(() => {
        if (!conversationId) return;
        if (scopedFor.current !== conversationId) {
            scopedFor.current = conversationId;
            return;
        }
        window.api.ai.setScope(conversationId, targetRef.current);
        // `targetKey` is the target, flattened to something a dependency list
        // can compare. See the note where it is built.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId, targetKey]);

    /**
     * `mentions` are `{ kind, id }` for what the message tagged; main reads
     * each record itself. `files` are documents already read into words,
     * `{ name, mediaType, text }`.
     */
    const send = useCallback(async (text, images = [], mentions = [], files = []) => {
        if (!conversationId) return;
        const result = await window.api.ai.send(conversationId, text, images, mentions, files);
        if (!result?.success && result?.message) {
            dispatch({ type: 'error', message: result.message, at: Date.now() });
        }
    }, [conversationId, dispatch]);

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
     * `input` is what the card collected, for the one card that collects
     * anything: a question's answers. Main decides what a call may keep of it.
     *
     * The calls still queued behind this question are not answered here, since
     * they have not asked yet. The verdict is held for them under the servers
     * the card named, and applied as each one arrives. See `held`.
     */
    const respond = useCallback((group, approved, message = '', input = null) => {
        if (group.queued.length > 0) {
            held.current.set(group.key, {
                approved,
                message,
                sessions: new Set(group.queued.map(entry => entry.sessionId)),
            });
        }
        for (const approval of group.items) settle(approval.requestId, approved, message, input);
    }, [settle]);

    /**
     * A new conversation holding this one up to the end of a turn, named by
     * its message's id. Answers its id, or null with the reason said in the
     * transcript, the way a send that failed says so.
     */
    const branch = useCallback(async (turnId) => {
        if (!conversationId) return null;
        const result = await window.api.ai.branch(conversationId, turnId).catch(error => ({ message: error.message }));
        if (result?.success) return result.conversationId;
        if (result?.message) dispatch({ type: 'warning', message: result.message, at: Date.now() });
        return null;
    }, [conversationId, dispatch]);

    /**
     * Put back the files a turn changed. The card hears how it went from the
     * `turn-reverted` event main records, like every other window does, and
     * from the answer here for what only it asked.
     */
    const revertTurn = useCallback(async (turnId) => {
        if (!conversationId) return { success: false, message: '' };
        return window.api.ai.revertTurn(conversationId, turnId)
            .catch(error => ({ success: false, message: error.message }));
    }, [conversationId]);

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
        adopt(created.conversationId);
        replaceState(INITIAL);
        setPinned(created.pinned || null);
    }, [conversationId, adopt, replaceState]);

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
        adopt(id);
        replaceState(replay(past.events));
        setPinned(past.pinned || null);
    }, [conversationId, refreshConversations, adopt, replaceState]);

    /**
     * Pin this conversation to an agent, model, effort or mode, over the
     * settings: what the composer's chips do. Only this conversation moves,
     * and the pick is what the next new chat starts on. Main answers with the
     * pin as it now stands, which is what the chips are set to.
     */
    const pinModel = useCallback(async (patch) => {
        if (!conversationId) return;
        const result = await window.api.ai.setModel(conversationId, patch);
        if (result && !result.error) setPinned(result.pinned || null);
    }, [conversationId]);

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
            adopt(created.conversationId);
            replaceState(INITIAL);
            setPinned(created.pinned || null);
        }
        await refreshConversations();
    }, [conversationId, refreshConversations, adopt, replaceState]);

    return {
        items: state.items,
        draft: state.draft,
        busy: state.busy,
        costUsd: state.costUsd,
        account: state.account,
        rateLimit: state.rateLimit,
        turnRates: state.turnRates,
        // How full the model's context is, for the ring by the model chip.
        context: state.context,
        // The agent's own short name for the chat, once it has given one.
        title: state.title,
        // The conversation's own agent, model, effort and mode over the
        // settings, and the way to change them.
        pinned,
        pinModel,
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
        branch,
        revertTurn,
    };
}

export { applyEvent };
