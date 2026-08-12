import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Cancel01Icon,
    PlusSignIcon,
    ArrowUp01Icon,
    StopCircleIcon,
    Alert02Icon,
} from 'hugeicons-react';
import Tooltip from '../ui/Tooltip';
import AgentMark from './AgentMark';
import Markdown from '../../lib/markdown';
import useAssistant from '../../hooks/useAssistant';
import useTypewriter from '../../hooks/useTypewriter';
import { APP_GUTTER, PANE_HEADER_HEIGHT } from '../../lib/layout';
import ToolCall from './ToolCall';
import ApprovalRequest from './ApprovalRequest';
import ScopeMenu from './ScopeMenu';
import ModelMenu from './ModelMenu';
import ApprovalMenu from './ApprovalMenu';
import HistoryMenu from './HistoryMenu';
import Dialog, { DialogButton } from '../ui/Dialog';
import {
    GLOBAL,
    describe,
    describeSession,
    followScope,
    globalScope,
    prune,
    toWire,
    toggle,
} from '../../lib/assistant-scope';

/**
 * The assistant panel.
 *
 * A column beside the terminal rather than an overlay on top of it, because
 * almost everything it is useful for involves reading the screen it would
 * otherwise be covering. It is one panel for the whole window, not one per
 * pane: a conversation about a server usually turns into a conversation about
 * the one next to it, and a per-pane panel would mean starting again.
 *
 * It is built as its own card, the way `#main-content` is, with the shell's
 * gutter between the two rather than a border against it. Butting a flat
 * panel up against a rounded card leaves a sliver of background trapped in the
 * corner, which is the one arrangement that looks like a mistake rather than a
 * choice.
 *
 * Everything inside is laid out on one spacing step, and the transcript owns
 * the rhythm through a single `space-y` rather than each kind of item carrying
 * its own margins. That is what stops a run of tool calls and replies from
 * drifting into uneven bands.
 */

const MIN_WIDTH = 340;
const MAX_WIDTH = 720;

/** Wide enough to centre a 32px button, and no wider. */
const RAIL_WIDTH = 40;

/**
 * The open and shut motion.
 *
 * The sidebar does the same thing on the other side of the window, so this is
 * its easing (tailwind's `ease-in-out`) at roughly half the duration. The
 * sidebar is a place you go and stay; this is a panel you flick in and out of
 * mid-sentence while reading the terminal, and 300ms of that gets old fast.
 * Short enough to feel like the column simply widened, long enough that the
 * eye follows the edge rather than being handed a new layout.
 */
const REVEAL_MS = 180;
const REVEAL_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * The card, matching `#main-content`'s 16px radius and surface.
 *
 * Deliberately not `overflow-hidden`: nothing inside paints into the corners,
 * and clipping the card would cut the shadow off the scope menu that opens
 * inside it.
 */
const CARD = 'rounded-2xl bg-white/60 dark:bg-surface-raised';

/** The rule inside a card, which is lighter than the one between two cards. */
const HAIRLINE = 'border-black/[0.06] dark:border-white/[0.06]';

/**
 * A button for the header row.
 *
 * Written out rather than reached for from `ui/Button`, because the pane
 * headers in this app use 32px buttons with a 12px radius and `IconButton`'s
 * small size is 8px. `HistoryMenu`'s trigger matches this shape deliberately:
 * three buttons on one row that do not quite agree is worse than any of them
 * being slightly wrong on its own.
 */
function HeaderButton({ title, hint, icon, onClick, placement = 'bottom' }) {
    return (
        <Tooltip label={title} hint={hint} placement={placement}>
            <button
                type="button"
                aria-label={title}
                onClick={onClick}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl transition-colors
                    outline-none text-gray-500 dark:text-gray-400
                    hover:bg-gray-100 hover:text-gray-900
                    dark:hover:bg-surface-control dark:hover:text-white
                    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
            >
                {icon}
            </button>
        </Tooltip>
    );
}

/** The plan windows, shortened to something that fits beside the model chip. */
const WINDOWS = {
    five_hour: '5h',
    seven_day: '7d',
    seven_day_opus: '7d Opus',
    seven_day_sonnet: '7d Sonnet',
    seven_day_overage_included: '7d',
    overage: 'overage',
};

/**
 * What this conversation is costing, in the currency the user actually pays in.
 *
 * Three states, and the third one matters most: confirmed subscription,
 * confirmed metered billing, and not known. Nothing is shown in the third.
 *
 * The runtime always reports a `total_cost_usd`, but on a plan it is the price
 * those tokens *would* have cost on the API, not a bill anyone is sending. The
 * absence of a subscription is not evidence of an API key either: the account
 * lookup has not answered yet during the first turn, and an older Claude Code
 * cannot answer it at all. Treating "no subscription found" as "billed to your
 * API key" tells someone with no key that they are paying per token, which is
 * both wrong and alarming.
 *
 * So a dollar figure appears only where we can name the thing paying it: a key
 * this app was given, or a key the runtime says it is using.
 */
function Usage({ account, rateLimit, costUsd, hasStoredKey }) {
    if (account?.subscriptionType) {
        if (rateLimit?.utilization === null || rateLimit?.utilization === undefined) return null;

        const percent = Math.round(rateLimit.utilization);
        const window = WINDOWS[rateLimit.window] || 'plan';
        const tone = rateLimit.status === 'rejected'
            ? 'text-red-500 dark:text-red-400'
            : rateLimit.status === 'allowed_warning'
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-gray-400 dark:text-gray-600';

        return (
            <Tooltip
                label={`${percent}% of your ${account.subscriptionType} plan's ${window} limit used`}
                placement="top"
            >
                <span className={`px-1 text-[10px] tabular-nums ${tone}`}>
                    {window} {percent}%
                </span>
            </Tooltip>
        );
    }

    const metered = hasStoredKey
        || Boolean(account?.apiKeySource && account.apiKeySource !== 'none');

    if (!metered || !costUsd) return null;

    return (
        <Tooltip label="Estimated cost of this conversation, charged per token" placement="top">
            <span className="px-1 text-[10px] tabular-nums text-gray-400 dark:text-gray-600">
                ${costUsd.toFixed(3)}
            </span>
        </Tooltip>
    );
}

function Notice({ item }) {
    const tone = item.tone === 'error'
        ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300'
        : item.tone === 'warn'
            ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300'
            : 'bg-gray-50 dark:bg-white/[0.035] text-gray-500 dark:text-gray-400';

    return (
        <div className={`rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${tone}`}>
            {item.text}
        </div>
    );
}

/**
 * The turn in progress.
 *
 * A component of its own because the reveal sets state on every frame, and
 * that repaint should cost this block rather than the whole transcript sitting
 * above it. It also means the panel's own render is still driven by arriving
 * text and not by the animation.
 *
 * The scroller cannot see the reveal either: the text it is following only
 * changes when a chunk lands, while the block underneath it goes on growing
 * for a few frames afterwards. So each step says so, and the panel keeps the
 * bottom in view on its own terms.
 */
function StreamingText({ text, onReveal }) {
    const shown = useTypewriter(text);

    useLayoutEffect(() => {
        onReveal();
    }, [shown, onReveal]);

    return <Markdown text={shown} />;
}

/**
 * The conversation itself: everything inside the card.
 *
 * Split from the column around it because the column is what animates, and it
 * has to stay in the layout while shut. This is mounted only while the panel is
 * open or on its way out, so closing it still drops the transcript, the draft
 * and the subscription behind it exactly as unmounting always did.
 */
function AssistantConversation({
    sessions,
    hosts = [],
    activeSessionId,
    onOpenSettings,
    onClose,
}) {
    /**
     * Which servers this conversation is about: the session in front, every
     * host, or an explicit set of sessions and saved hosts. See
     * `lib/assistant-scope`, which owns the shape and the transitions.
     */
    const [scope, setScope] = useState(followScope);
    const [settings, setSettings] = useState(null);
    /**
     * The model list, as `{ provider, rows }`.
     *
     * Kept with the agent it came from rather than on its own, so that a list
     * arriving for the agent you just switched away from cannot be shown as
     * though it belonged to the new one. Reading a catalog means starting a
     * runtime, so those answers can arrive seconds late, in any order.
     */
    const [catalog, setCatalog] = useState(null);

    /** Whether a read is in flight, so the menu can say so rather than look empty. */
    const [readingModels, setReadingModels] = useState(false);
    const [text, setText] = useState('');

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const stickToBottom = useRef(true);

    // `follow` is resolved against the pane in front here, so what goes over
    // IPC is always a concrete answer. A pinned set stays put while the user
    // moves around the app, which is the whole point of pinning it.
    const target = useMemo(() => toWire(scope, activeSessionId), [scope, activeSessionId]);

    const assistant = useAssistant(target);

    // The model, the effort and the approval mode are all shown in the
    // composer, so the panel holds the settings rather than one field of them.
    // The settings page is still where they are explained.
    useEffect(() => {
        window.api.ai.status()
            .then((status) => {
                setSettings(status?.settings || null);
                if (status?.settings) {
                    setCatalog({ provider: status.settings.provider, models: status.models || null });
                }
            })
            .catch(() => {});
    }, []);

    // Asked for rather than waited for: reading it means bringing the runtime
    // up, and a chip that fills itself in only after the first message is a
    // chip nobody can use to choose the first message. Asked again when the
    // agent changes, since the answer belongs to the agent.
    const readModels = useCallback((provider, { refresh = false } = {}) => {
        if (!provider) return;
        setReadingModels(true);
        window.api.ai.models({ refresh })
            .then(rows => setCatalog({ provider, models: rows || null }))
            .catch(() => setCatalog({ provider, models: null }))
            .finally(() => setReadingModels(false));
    }, []);

    useEffect(() => {
        readModels(settings?.provider);
    }, [settings?.provider, readModels]);

    // Main announces a catalog whenever one is read or the agent changes. It
    // carries the agent it belongs to, and so does what is stored, so nothing
    // here has to reason about what arrived when.
    useEffect(() => window.api.ai.onModels(setCatalog), []);

    // Both sides have to exist before they can agree. Optional chaining alone
    // is not enough here: before either has loaded, `undefined === undefined`
    // is true and this would read through a null.
    const models = settings && catalog?.provider === settings.provider
        ? catalog.models
        : null;

    // Quick prompts are written on the settings page, which is open beside this
    // panel rather than instead of it, so the panel is told when they change.
    useEffect(() => window.api.ai.onSettings(setSettings), []);

    const changeSettings = useCallback(async (patch) => {
        const next = await window.api.ai.setSettings(patch);
        setSettings(next);
    }, []);

    // A session the panel was pinned to can be closed underneath it, which
    // would otherwise leave it pointed at nothing with no sign of why. Pinned
    // hosts survive: an unconnected host is still somewhere to work, and a
    // session closing is often how one gets there.
    useEffect(() => {
        setScope(current => prune(current, sessions.map(session => session.sessionId)));
    }, [sessions]);

    // `preventScroll` because the card is mounted at its full width inside a
    // column that is still only a rail wide, and clipped to it. Focusing the
    // composer without it makes the browser scroll the clip box sideways to
    // bring the field into view, and the panel arrives already shoved off its
    // own left edge.
    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);

    /**
     * Follow the bottom, unless the user has scrolled up to read something.
     * Yanking the view back down while they are reading output from three tool
     * calls ago is what makes a streaming panel unusable.
     */
    const onScroll = useCallback(() => {
        const node = scrollRef.current;
        if (!node) return;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
    }, []);

    const keepAtBottom = useCallback(() => {
        const node = scrollRef.current;
        if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
    }, []);

    useLayoutEffect(() => {
        keepAtBottom();
    }, [assistant.items, assistant.draft.text, keepAtBottom]);

    const submit = useCallback(() => {
        const body = text.trim();
        if (!body || assistant.busy) return;
        setText('');
        stickToBottom.current = true;
        if (inputRef.current) inputRef.current.style.height = 'auto';
        assistant.send(body);
    }, [text, assistant]);

    const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
        }
    };

    /**
     * What the "current session" option names. Derived from the active session
     * rather than from the current scope: read off the scope it would relabel
     * itself the moment "All hosts" was picked, and the menu would describe the
     * same choice twice.
     */
    const followLabel = useMemo(() => describeSession(
        sessions.find(session => session.sessionId === activeSessionId),
        'Nothing connected',
    ), [sessions, activeSessionId]);

    /** What the panel is actually pointed at, for the title and placeholder. */
    const described = useMemo(
        () => describe(scope, { sessions, hosts, activeSessionId }),
        [scope, sessions, hosts, activeSessionId],
    );

    const setMode = useCallback(
        mode => setScope(mode === GLOBAL ? globalScope() : followScope()),
        [],
    );

    const toggleTarget = useCallback(
        (kind, id) => setScope(current => toggle(current, kind, id)),
        [],
    );

    const empty = assistant.items.length === 0 && !assistant.starting && !assistant.failure;
    const quickPrompts = settings?.quickPrompts || [];

    return (
        <>
            {/* Header. The scope is the title, so the thing you read to know
                which server you are talking about is what you click to
                change it. */}
            <header
                className={`shrink-0 pl-1.5 pr-1.5 flex items-center gap-1 border-b ${HAIRLINE}`}
                style={{ height: PANE_HEADER_HEIGHT }}
            >
                {/* The scope takes what is left after the buttons, so
                    promoting one out of a menu narrows the title rather
                    than crowding the row. */}
                <ScopeMenu
                    scope={scope}
                    onSetMode={setMode}
                    onToggle={toggleTarget}
                    sessions={sessions}
                    hosts={hosts}
                    activeSessionId={activeSessionId}
                    followLabel={followLabel}
                    scopeLabel={described.label}
                />

                {/* Starting again is the thing people do most often in a
                    panel like this, so it is one click and not two. */}
                <HeaderButton
                    title="New conversation"
                    icon={<PlusSignIcon size={16} strokeWidth={1.5} />}
                    onClick={assistant.reset}
                />
                <HistoryMenu
                    conversations={assistant.conversations}
                    currentId={assistant.conversationId}
                    onOpen={assistant.open}
                    onRemove={assistant.remove}
                    onRefresh={assistant.refreshConversations}
                />
                <HeaderButton
                    title="Close"
                    hint="Ctrl+Shift+A"
                    icon={<Cancel01Icon size={16} strokeWidth={1.5} />}
                    onClick={onClose}
                />
            </header>

            {/* Transcript. One spacing step, owned here, not by the items.

                `assistant-prose` opts the whole column back into text
                selection, which the shell turns off everywhere else, and
                repaints the highlight in the app's own colours. See the note
                on it in input.css. The controls inside opt back out
                individually: dragging across a transcript should pick up the
                reply, not the label on the button next to it. */}
            <div
                ref={scrollRef}
                onScroll={onScroll}
                className={`assistant-prose flex-1 min-h-0 overflow-y-auto px-3 space-y-3
                    ${empty ? '' : 'py-3'}`}
            >
                {assistant.failure && <Notice item={{ tone: 'error', text: assistant.failure }} />}

                {/* Centred on the panel, but by growing a full-height block
                    rather than by centring inside the scroller. The latter
                    puts the top of anything taller than the panel out of
                    reach: overflow spills both ways and only one of them
                    can be scrolled back to.

                    Capped and centred horizontally. The composer is a field
                    and should take whatever width it is given, but this is
                    prose and a row of buttons: dragged out to 720px the
                    sentence turns into one long line and the prompts become
                    strips of mostly empty background. The measure stays put
                    and the extra width goes to the margins. */}
                {empty && (
                    <div className="min-h-full w-full max-w-sm mx-auto py-6 px-1
                        flex flex-col justify-center">
                        <div className="flex flex-col items-center text-center">
                            {/* No tile behind it. The mark brings its own
                                colour, and a grey square around a logo is
                                a frame around a frame. */}
                            <AgentMark size={64} animated className="mb-3" />
                            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                                Let's work on your servers
                            </h2>
                            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
                                It reads this terminal, runs commands on their own channel, and can work
                                across every host you have saved. Approvals default to ask-before-changes;
                                switch modes from the composer chip or Settings.
                            </p>
                        </div>

                        {/* Nothing canned. Until someone has written their
                            own, this is an offer to write one rather than
                            four guesses about what they might want to ask.

                            Held back until the settings have actually
                            loaded, or someone who has prompts saved sees
                            the invitation to create them flash past
                            first. */}
                        <div className={`mt-6 space-y-1.5 ${settings ? '' : 'invisible'}`}>
                            {quickPrompts.length > 0 ? quickPrompts.map(prompt => (
                                <button
                                    key={prompt}
                                    type="button"
                                    className="w-full min-h-9 px-3 py-2 rounded-lg text-xs text-left
                                        select-none transition-colors
                                        text-gray-600 dark:text-gray-400
                                        bg-gray-50 dark:bg-white/[0.035]
                                        hover:bg-gray-100 dark:hover:bg-white/[0.06]
                                        hover:text-gray-900 dark:hover:text-gray-200"
                                    onClick={() => { setText(prompt); inputRef.current?.focus(); }}
                                >
                                    {prompt}
                                </button>
                            )) : (
                                <button
                                    type="button"
                                    onClick={onOpenSettings}
                                    className="w-full h-12 px-3 rounded-xl flex items-center
                                        justify-center gap-1.5 text-xs font-medium
                                        select-none transition-colors
                                        border border-dashed
                                        border-gray-300 dark:border-white/[0.14]
                                        text-gray-500 dark:text-gray-500
                                        hover:border-gray-400 dark:hover:border-white/25
                                        hover:bg-gray-50 dark:hover:bg-white/[0.03]
                                        hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                    <PlusSignIcon size={13} strokeWidth={2} />
                                    Create quick prompts
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {assistant.items.map((item) => {
                    if (item.kind === 'user') {
                        return (
                            <div key={item.id} className="flex justify-end">
                                <div className="assistant-bubble max-w-[88%] px-3 py-2 rounded-2xl rounded-br-md
                                    bg-gray-900 dark:bg-white text-white dark:text-black
                                    text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                                    {item.text}
                                </div>
                            </div>
                        );
                    }
                    if (item.kind === 'assistant') {
                        return <Markdown key={item.id} text={item.text} />;
                    }
                    if (item.kind === 'tool') {
                        // A call waiting on an answer is the same row,
                        // opened up into the question. One card, not a row
                        // and a card repeating each other.
                        if (item.approval?.status === 'pending') {
                            return (
                                <ApprovalRequest
                                    key={item.id}
                                    item={item.approval}
                                    onRespond={assistant.respond}
                                />
                            );
                        }
                        return <ToolCall key={item.id} item={item} />;
                    }
                    if (item.kind === 'approval') {
                        return <ApprovalRequest key={item.id} item={item} onRespond={assistant.respond} />;
                    }
                    return <Notice key={item.id} item={item} />;
                })}

                {/* The turn in progress. Replaced by a finished block the
                    moment the model closes it, so both are never shown. */}
                {assistant.draft.text && (
                    <StreamingText text={assistant.draft.text} onReveal={keepAtBottom} />
                )}

                {assistant.busy && !assistant.draft.text && (
                    <div className="flex items-center gap-2 h-8 px-2.5 text-[11px]
                        text-gray-500 dark:text-gray-500">
                        <span className="flex gap-1" aria-hidden="true">
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                                style={{ animationDelay: '0ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                                style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                                style={{ animationDelay: '300ms' }} />
                        </span>
                        Working
                    </div>
                )}
            </div>

            {/* Composer.
                The input takes the whole width and its controls sit on a
                row underneath, rather than crowding into the line being
                typed on. That is what lets the model chip carry a real
                label instead of an icon, and it keeps a long question from
                squeezing the buttons.

                No rule above it, and no surface of its own: the outline is
                what says "type here", and a divider as well would cut the
                card in two for no gain. Transparent rather than a colour
                matching the card, because the card is translucent and
                painting the same wash twice makes a pale rectangle of the
                one part of the panel that should sit flat.

                Focus lifts the border's colour and nothing else, as every
                other input in the app does. A ring would add two pixels
                outside the box and nudge the whole composer as you click
                into it. */}
            <div className="shrink-0 p-3">
                <div className="rounded-2xl transition-colors
                    border border-gray-300 dark:border-surface-control
                    focus-within:border-gray-400 dark:focus-within:border-neutral-600">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={`Ask about ${described.sentence}`}
                        className="block w-full max-h-40 px-3 pt-2.5 pb-1 bg-transparent
                            resize-none outline-none
                            text-[13px] leading-relaxed text-gray-900 dark:text-white
                            placeholder:text-gray-400 dark:placeholder:text-gray-600"
                        onInput={(event) => {
                            event.target.style.height = 'auto';
                            event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
                        }}
                    />

                    <div className="flex items-center gap-1 pl-2 pr-2 pb-2">
                        {/* The standing state of the panel: what it will do
                            before asking, and where it is changed. */}
                        {settings && (
                            <ApprovalMenu settings={settings} onChange={changeSettings} />
                        )}

                        <div className="ml-auto flex items-center gap-1">
                            <Usage
                                account={assistant.account}
                                rateLimit={assistant.rateLimit}
                                costUsd={assistant.costUsd}
                                hasStoredKey={Boolean(settings?.hasApiKey)}
                            />

                            {settings && (
                                <ModelMenu
                                    settings={settings}
                                    models={models}
                                    loading={readingModels}
                                    onRefresh={() => readModels(settings.provider, { refresh: true })}
                                    onChange={changeSettings}
                                />
                            )}

                            {/* Nothing to press until there is something to
                                send, so the button is absent rather than
                                disabled: a permanently greyed control is
                                just clutter with a hover state. */}
                            {assistant.busy ? (
                                <Tooltip label="Stop" placement="top">
                                    <button
                                        type="button"
                                        aria-label="Stop"
                                        onClick={assistant.interrupt}
                                        className="w-7 h-7 shrink-0 flex items-center justify-center
                                            rounded-full transition-colors
                                            bg-gray-100 dark:bg-surface-control
                                            text-gray-600 dark:text-gray-300
                                            hover:bg-gray-200 dark:hover:bg-surface-hover"
                                    >
                                        <StopCircleIcon size={15} strokeWidth={2} />
                                    </button>
                                </Tooltip>
                            ) : text.trim() ? (
                                <Tooltip label="Send" hint="Enter" placement="top">
                                    <button
                                        type="button"
                                        aria-label="Send"
                                        onClick={submit}
                                        className="w-7 h-7 shrink-0 flex items-center justify-center
                                            rounded-full transition-all active:scale-95
                                            bg-gray-900 dark:bg-white
                                            text-white dark:text-black hover:opacity-90"
                                    >
                                        <ArrowUp01Icon size={15} strokeWidth={2.5} />
                                    </button>
                                </Tooltip>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>

            {settings && !settings.acknowledgedApprovalWarning && (
                <Dialog
                    title="How approvals work"
                    subtitle="The assistant can read live terminals and run commands on your hosts. By default it asks before anything that changes a system. Ask every time stops on reads too. Never ask runs tools without prompts (blocked commands are still refused)."
                    onClose={() => changeSettings({ acknowledgedApprovalWarning: true })}
                    icon={
                        <span className="w-9 h-9 rounded-xl flex items-center justify-center
                            bg-amber-50 dark:bg-amber-900/20 text-amber-500">
                            <Alert02Icon size={20} strokeWidth={2} />
                        </span>
                    }
                    footer={
                        <DialogButton
                            variant="primary"
                            data-autofocus
                            onClick={() => changeSettings({ acknowledgedApprovalWarning: true })}
                        >
                            Got it
                        </DialogButton>
                    }
                />
            )}
        </>
    );
}
 *
 * One element that changes width, not two swapped for each other: a swap has
 * nothing to animate between, and the rail is the same column with everything
 * but the button clipped off. That is how the sidebar opens on the other side
 * of the window, and this is the same motion mirrored and shortened.
 *
 * The card keeps its full width the whole way and the column clips it, rather
 * than the card being squeezed and stretched. Reflowing a transcript, a
 * markdown block and a growing textarea on every frame of a 180ms slide is
 * both expensive and ugly: the text rewraps four times on the way in. Clipped,
 * the panel is laid out once and then revealed.
 *
 * It is pinned to the right edge for the same reason the sidebar's items are
 * pinned to the left: whatever is already on screen should stay where it is
 * while the rest arrives beside it.
 */
export default function AssistantPanel({
    open,
    sessions,
    hosts,
    activeSessionId,
    width,
    onWidthChange,
    onOpenSettings,
    onOpen,
    onClose,
}) {
    // The width the column is actually drawn at. It lags `open` by a couple of
    // frames on the way in, which is what gives the transition an old value to
    // start from.
    const [wide, setWide] = useState(open);

    // The card, which outlives `open` by the length of the slide so there is
    // something to collapse. Everything in it is dropped at the end, exactly as
    // it was when the panel was mounted and unmounted outright.
    const [mounted, setMounted] = useState(open);

    // True from the moment `open` changes until the column has arrived. It
    // carries the transition and the clip, and a settled column has neither:
    // the resize handle has to move the edge on the frame it is dragged, and
    // the menus inside the card have to be able to cast a shadow past it.
    const [sliding, setSliding] = useState(false);

    // The state the column has been told about, so the first render does not
    // animate from itself to itself.
    const drawn = useRef(open);

    useEffect(() => {
        if (drawn.current === open) return undefined;
        drawn.current = open;

        setSliding(true);
        if (open) setMounted(true);

        /**
         * Two frames: one to paint the column where it is now, one to send it
         * where it is going. Both in the same paint and it jumps instead of
         * sliding. Both handles are cancelled, because StrictMode's second
         * mount would otherwise leave the first one's inner frame running.
         */
        let inner = 0;
        const outer = requestAnimationFrame(() => {
            inner = requestAnimationFrame(() => setWide(open));
        });

        // The two frames plus the slide, with a frame in hand.
        const landed = setTimeout(() => {
            setSliding(false);
            if (!open) setMounted(false);
        }, REVEAL_MS + 50);

        return () => {
            cancelAnimationFrame(outer);
            cancelAnimationFrame(inner);
            clearTimeout(landed);
        };
    }, [open]);

    /** The grab strip, which lives in the gutter between the two cards. */
    const startResize = useCallback((event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;

        const onMove = (move) => {
            // Dragging left widens, so the delta is inverted.
            const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - move.clientX)));
            onWidthChange(next);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [width, onWidthChange]);

    return (
        <div
            className="relative shrink-0 bg-gray-100 dark:bg-surface-base"
            style={{
                width: (wide ? width : RAIL_WIDTH) + APP_GUTTER,
                paddingLeft: APP_GUTTER,
                transition: sliding ? `width ${REVEAL_MS}ms ${REVEAL_EASE}` : undefined,
                overflow: sliding ? 'hidden' : 'visible',
            }}
        >
            {/* In the gutter, over the gap rather than over either card. Not
                there mid-slide, where it would only offer to resize a panel
                that has not finished arriving. */}
            {wide && !sliding && (
                <div
                    className="absolute left-0 inset-y-0 z-10 cursor-col-resize group"
                    style={{ width: APP_GUTTER }}
                    onMouseDown={startResize}
                >
                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 rounded-full
                        bg-transparent group-hover:bg-gray-900/15 dark:group-hover:bg-white/15 transition-colors" />
                </div>
            )}

            {/* The button that is there when the panel is not. Drawn on the
                shell background rather than as a card, exactly as the sidebar
                is on the other side: it is chrome holding a gutter, not a
                surface. It sits in a block the height of a pane header, on the
                edge the card's own header buttons land on, so the two cross
                fade in place instead of one sliding out from under the other. */}
            {(!wide || sliding) && (
                <div
                    className="absolute right-0 top-0 flex items-center justify-center"
                    style={{
                        width: RAIL_WIDTH,
                        height: PANE_HEADER_HEIGHT,
                        opacity: wide ? 0 : 1,
                        pointerEvents: wide ? 'none' : 'auto',
                        transition: `opacity ${REVEAL_MS}ms ${REVEAL_EASE}`,
                    }}
                >
                    <HeaderButton
                        title="AI Agent"
                        hint="Ctrl+Shift+A"
                        placement="left"
                        icon={<AgentMark size={20} mono />}
                        onClick={onOpen}
                    />
                </div>
            )}

            {mounted && (
                <aside
                    className={`absolute inset-y-0 right-0 flex flex-col ${CARD}`}
                    style={{
                        width,
                        opacity: wide ? 1 : 0,
                        // Nothing to click on a panel that is on its way in or
                        // out, and the half of it hanging outside the clip is
                        // not there to be aimed at.
                        pointerEvents: wide ? 'auto' : 'none',
                        transition: `opacity ${REVEAL_MS}ms ${REVEAL_EASE}`,
                    }}
                >
                    <AssistantConversation
                        sessions={sessions}
                        hosts={hosts}
                        activeSessionId={activeSessionId}
                        onOpenSettings={onOpenSettings}
                        onClose={onClose}
                    />
                </aside>
            )}
        </div>
    );
}
