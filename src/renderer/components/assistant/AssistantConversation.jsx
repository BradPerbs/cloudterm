import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Cancel01Icon,
    PlusSignIcon,
    ArrowUp01Icon,
    StopCircleIcon,
    Image01Icon,
    ImageAdd01Icon,
    Note01Icon,
} from 'hugeicons-react';
import Tooltip from '../ui/Tooltip';
import AgentMark from './AgentMark';
import Markdown from '../../lib/markdown';
import useAssistant from '../../hooks/useAssistant';
import useTypewriter from '../../hooks/useTypewriter';
import { useSnippets } from '../../hooks/useSnippets';
import { isSpec } from '../../lib/snippets';
import SpecMenu from './SpecMenu';
import ToolCall from './ToolCall';
import ApprovalRequest from './ApprovalRequest';
import ModelMenu from './ModelMenu';
import ApprovalMenu from './ApprovalMenu';
import { useT } from '../../i18n';
import { groupApprovals } from '../../lib/approvals';
import { IMAGE_TYPES, imageFiles, readImage } from '../../lib/images';
import { describe, toWire } from '../../lib/assistant-scope';

/** The rule inside a card, which is lighter than the one between two cards. */
export const HAIRLINE = 'border-black/[0.06] dark:border-white/[0.06]';

/**
 * A button at pane-header size: the rail's button when the panel is shut.
 *
 * Written out rather than reached for from `ui/Button`, because the pane
 * headers in this app use 32px buttons with a 12px radius and `IconButton`'s
 * small size is 8px.
 */
export function HeaderButton({ title, hint, icon, onClick, placement = 'bottom' }) {
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
    const t = useT();

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
        <Tooltip label={t('assistant.costHint')} placement="top">
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
export default function AssistantConversation({
    /** The tab this is drawn in, for what it reports back about itself. */
    tabId,
    /** The conversation the tab was left holding, if any. */
    conversationId,
    /** Whether this tab is the one in front. The others stay mounted. */
    active = true,
    /**
     * Which servers this tab is about: the session in front, every host, or
     * an explicit set. Owned by the tab, since the strip draws the control
     * that changes it; see `lib/assistant-scope` for the shape.
     */
    scope,
    sessions,
    hosts = [],
    activeSessionId,
    onConversationChange,
    onStatus,
    onOpenSettings,
    onOpenSnippets,
}) {
    const t = useT();
    const [settings, setSettings] = useState(null);
    /**
     * The model lists, keyed by the agent each came from.
     *
     * Kept with the agent it came from rather than on its own, so that a list
     * arriving for an agent that has since been switched off cannot be shown as
     * though it belonged to another. Reading a catalog means starting a
     * runtime, so those answers can arrive seconds late, in any order, and with
     * several agents switched on there are several of them in flight at once.
     *
     * An agent that is absent has not been asked. One with `null` was asked and
     * publishes nothing, which is a different answer and reads differently in
     * the menu.
     */
    const [catalogs, setCatalogs] = useState({});

    /** Whether a read is in flight, so the menu can say so rather than look empty. */
    const [readingModels, setReadingModels] = useState(false);
    const [text, setText] = useState('');

    /**
     * Pictures waiting in the composer, `{ id, name, mediaType, data, dataUrl }`.
     * Pasted, dropped or picked, and shown as thumbnails until they are sent.
     */
    const [images, setImages] = useState([]);
    /** Which agents can be sent one, from main. The button shows only for those. */
    const [imageProviders, setImageProviders] = useState([]);
    /** Why the last file did not make it in, shown under the thumbnails. */
    const [imageNotice, setImageNotice] = useState('');

    /**
     * The specs going with the message, by id. Ids rather than records, so a
     * spec edited in the library while it sits in the composer is sent as it
     * now reads; main looks each one up when the message goes.
     */
    const [specIds, setSpecIds] = useState([]);
    const { snippets } = useSnippets();
    const specs = useMemo(() => snippets.filter(isSpec), [snippets]);

    // Resolved against the live library, so a spec deleted while attached
    // falls off the message rather than being sent as an id nothing answers.
    const attached = useMemo(
        () => specIds.map(id => specs.find(spec => spec.id === id)).filter(Boolean),
        [specIds, specs],
    );

    const toggleSpec = useCallback((id) => {
        setSpecIds(current => (
            current.includes(id) ? current.filter(entry => entry !== id) : [...current, id]
        ));
    }, []);

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const fileRef = useRef(null);
    const stickToBottom = useRef(true);

    // `follow` is resolved against the pane in front here, so what goes over
    // IPC is always a concrete answer. A pinned set stays put while the user
    // moves around the app, which is the whole point of pinning it.
    const target = useMemo(() => toWire(scope, activeSessionId), [scope, activeSessionId]);

    const assistant = useAssistant({ ...target, conversationId, onConversationChange });

    /**
     * What the tab strip says about this tab: what it is about, and whether it
     * is working. The first thing the user said is the title, as it is in the
     * history menu; a message that was only a picture or a spec is named by
     * that.
     */
    const first = assistant.items.find(item => item.kind === 'user');
    const title = String(
        first?.text
        || first?.specs?.[0]?.name
        || (first?.images?.length ? t('assistant.image') : ''),
    ).replace(/\s+/g, ' ').trim().slice(0, 60);

    useEffect(() => {
        onStatus?.(tabId, { title, busy: assistant.busy });
    }, [onStatus, tabId, title, assistant.busy]);

    // The model, the effort and the approval mode are all shown in the
    // composer, so the panel holds the settings rather than one field of them.
    // The settings page is still where they are explained.
    useEffect(() => {
        window.api.ai.status()
            .then((status) => {
                setSettings(status?.settings || null);
                setCatalogs(status?.catalogs || {});
                setImageProviders(status?.imageProviders || []);
            })
            .catch(() => {});
    }, []);

    /**
     * Which agents are switched on, as one array that keeps its identity.
     *
     * Rebuilt from a string rather than read straight off the settings,
     * because main sends a fresh object every time anything at all changes and
     * a new array each render would put the read below into a loop.
     */
    const activeKey = settings ? (settings.providers || [settings.provider]).join(' ') : '';
    const providers = useMemo(() => (activeKey ? activeKey.split(' ') : []), [activeKey]);

    // Asked for rather than waited for: reading one means bringing that agent's
    // runtime up, and a chip that fills itself in only after the first message
    // is a chip nobody can use to choose the first message. Every switched-on
    // agent is asked, since the menu offers all of them together; main holds
    // each answer, so this costs one start per agent per run of the app.
    const readModels = useCallback((wanted, { refresh = false } = {}) => {
        const asking = (wanted || []).filter(Boolean);
        if (asking.length === 0) return;

        setReadingModels(true);
        Promise.all(asking.map(provider => window.api.ai.models({ provider, refresh })
            .then(rows => [provider, rows || null])
            .catch(() => [provider, null])))
            .then((answers) => {
                setCatalogs(held => ({ ...held, ...Object.fromEntries(answers) }));
            })
            .finally(() => setReadingModels(false));
    }, []);

    useEffect(() => {
        readModels(providers);
    }, [providers, readModels]);

    // Main announces a catalog whenever one is read or the agent changes. It
    // carries the agent it belongs to, so it is filed under that agent rather
    // than replacing what is held, and nothing here has to reason about what
    // arrived when.
    useEffect(() => window.api.ai.onModels(({ provider, models }) => {
        if (!provider) return;
        setCatalogs(held => ({ ...held, [provider]: models || null }));
    }), []);

    // Quick prompts are written on the settings page, which is open beside this
    // panel rather than instead of it, so the panel is told when they change.
    useEffect(() => window.api.ai.onSettings(setSettings), []);

    const changeSettings = useCallback(async (patch) => {
        const next = await window.api.ai.setSettings(patch);
        setSettings(next);
    }, []);

    // `preventScroll` because the card is mounted at its full width inside a
    // column that is still only a rail wide, and clipped to it. Focusing the
    // composer without it makes the browser scroll the clip box sideways to
    // bring the field into view, and the panel arrives already shoved off its
    // own left edge.
    //
    // On arrival, and again each time this tab comes to the front: a tab
    // brought forward is one about to be typed into.
    useEffect(() => {
        if (active) inputRef.current?.focus({ preventScroll: true });
    }, [active]);

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

    /** Whether the agent answering can be sent a picture. */
    const canAttach = Boolean(settings && imageProviders.includes(settings.provider));

    const submit = useCallback(() => {
        const body = text.trim();
        if ((!body && images.length === 0 && attached.length === 0) || assistant.busy) return;
        setText('');
        setImages([]);
        setImageNotice('');
        setSpecIds([]);
        stickToBottom.current = true;
        if (inputRef.current) inputRef.current.style.height = 'auto';
        assistant.send(
            body,
            images.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
            attached.map(spec => spec.id),
        );
    }, [text, images, attached, assistant]);

    /**
     * Take in image files, however they arrived. One at a time, so a handful
     * of screenshots land in the order they were given; a file that cannot be
     * used says so under the thumbnails rather than vanishing.
     */
    const addFiles = useCallback(async (files) => {
        if (!canAttach) return;
        for (const file of files) {
            try {
                const image = await readImage(file);
                setImages(current => [...current, { id: `${Date.now()}-${current.length}`, ...image }]);
            } catch {
                setImageNotice(t('assistant.imageDropped', { name: file.name || 'image' }));
            }
        }
        inputRef.current?.focus({ preventScroll: true });
    }, [canAttach, t]);

    const removeImage = useCallback((id) => {
        setImages(current => current.filter(image => image.id !== id));
    }, []);

    // Ctrl+V with a picture on the clipboard, which is how a screenshot
    // arrives nine times out of ten. A text paste is left to the textarea.
    const onPaste = (event) => {
        const files = imageFiles(event.clipboardData);
        if (!files.length || !canAttach) return;
        event.preventDefault();
        addFiles(files);
    };

    const onDrop = (event) => {
        const files = imageFiles(event.dataTransfer);
        if (!files.length || !canAttach) return;
        event.preventDefault();
        addFiles(files);
    };

    const onDragOver = (event) => {
        if (canAttach && event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    };

    const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
        }
    };

    /** What the tab is actually pointed at, for the placeholder. */
    const described = useMemo(
        () => describe(scope, { sessions, hosts, activeSessionId }),
        [scope, sessions, hosts, activeSessionId],
    );

    const empty = assistant.items.length === 0 && !assistant.starting && !assistant.failure;
    const quickPrompts = settings?.quickPrompts || [];

    /**
     * The questions waiting on an answer, folded so that one command sent to
     * several servers is one card. See `lib/approvals`. These are drawn in the
     * dock above the composer rather than in the transcript, so the transcript
     * skips them where they would otherwise fall.
     */
    const asking = useMemo(() => groupApprovals(assistant.items), [assistant.items]);

    return (
        <>
            {/* No header of its own: the tab strip above is the one row of
                chrome, and which servers this tab is about is a chip on the
                composer, beside the other things that shape the next
                message. History and closing live in the strip's menu. */}

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
                                {t('assistant.welcome')}
                            </h2>
                            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
                                {t('assistant.welcomeNote')}
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
                                    {t('assistant.createQuickPrompts')}
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
                                    {/* The pictures, or a chip naming each one for a
                                        message read back from disk, which keeps the
                                        name and not the bytes. */}
                                    {/* The documents that went with it, by
                                        name. The text is in the library, and
                                        a bubble holding a runbook would be
                                        the whole panel. */}
                                    {item.specs?.length > 0 && (
                                        <div className={`flex flex-wrap gap-1.5 ${item.text || item.images?.length ? 'mb-1.5' : ''}`}>
                                            {item.specs.map((spec, index) => (
                                                <span
                                                    key={spec.id || index}
                                                    title={t('assistant.spec')}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                                                        text-xs bg-white/15 dark:bg-black/10"
                                                >
                                                    <Note01Icon size={12} strokeWidth={2} />
                                                    {spec.name || t('assistant.spec')}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {item.images?.length > 0 && (
                                        <div className={`flex flex-wrap gap-1.5 ${item.text ? 'mb-1.5' : ''}`}>
                                            {item.images.map((image, index) => (image.data ? (
                                                <img
                                                    key={index}
                                                    src={`data:${image.mediaType};base64,${image.data}`}
                                                    alt={image.name}
                                                    className="max-h-40 max-w-full rounded-lg object-contain"
                                                />
                                            ) : (
                                                <span
                                                    key={index}
                                                    title={image.name}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                                                        text-xs bg-white/15 dark:bg-black/10"
                                                >
                                                    <Image01Icon size={12} strokeWidth={2} />
                                                    {image.name || t('assistant.image')}
                                                </span>
                                            )))}
                                        </div>
                                    )}
                                    {item.text}
                                </div>
                            </div>
                        );
                    }
                    if (item.kind === 'assistant') {
                        return <Markdown key={item.id} text={item.text} />;
                    }
                    if (item.kind === 'tool') {
                        // A call waiting on an answer is not here at all: it
                        // is the card pinned above the composer, and drawing
                        // the row as well would put the same command on
                        // screen twice. It takes its place in the transcript
                        // the moment it is answered.
                        if (item.approval?.status === 'pending') return null;
                        return <ToolCall key={item.id} item={item} />;
                    }
                    if (item.kind === 'approval') {
                        if (item.status === 'pending') return null;
                        return (
                            <ApprovalRequest
                                key={item.id}
                                group={{ key: item.id, items: [item], queued: [] }}
                                onRespond={assistant.respond}
                            />
                        );
                    }
                    return <Notice key={item.id} item={item} />;
                })}

                {/* The turn in progress. Replaced by a finished block the
                    moment the model closes it, so both are never shown. */}
                {assistant.draft.text && (
                    <StreamingText text={assistant.draft.text} onReveal={keepAtBottom} />
                )}

                {/* Not while a question is standing: the turn is still open, so
                    `busy` is true, but nothing is happening and the thing to
                    look at is the card below. */}
                {assistant.busy && !assistant.draft.text && asking.length === 0 && (
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
                        {t('assistant.working')}
                    </div>
                )}
            </div>

            {/* The questions, pinned.
                Out of the transcript and held against the composer, because a
                card in the flow moves: the model goes on writing underneath it,
                a tool row lands, the scroller follows the bottom, and Allow
                arrives where Decline was half a second ago. These two buttons
                are 6px apart and one of them runs something on a server, so the
                card does not get to move while it is being read.

                Above the composer rather than below it: the composer is the one
                thing on the panel whose position people learn, and a card that
                pushes it down the moment a question arrives moves the target
                they are already typing at.

                Its own scroller, with a hairline above it that says the
                transcript ends there. Several questions can stand at once, and
                the panel is not allowed to lose its reply and its composer to a
                stack of them. */}
            {asking.length > 0 && (
                <div className={`shrink-0 max-h-[55%] overflow-y-auto px-3 pt-3 pb-1 space-y-2
                    border-t ${HAIRLINE}`}>
                    {asking.map(group => (
                        <ApprovalRequest
                            key={group.key}
                            group={group}
                            sessions={sessions}
                            onRespond={assistant.respond}
                        />
                    ))}
                </div>
            )}

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
                <div
                    className="rounded-2xl transition-colors
                        border border-gray-300 dark:border-surface-control
                        focus-within:border-gray-400 dark:focus-within:border-neutral-600"
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                >
                    {/* The specs going with the message, as chips. Each can be
                        taken back until it is sent; the menu below toggles the
                        same set. */}
                    {attached.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                            {attached.map(spec => (
                                <span
                                    key={spec.id}
                                    className="inline-flex items-center gap-1 pl-2 pr-1 h-6 rounded-md
                                        text-xs font-medium select-none
                                        bg-gray-100 dark:bg-surface-control
                                        text-gray-700 dark:text-gray-200"
                                >
                                    <Note01Icon size={12} strokeWidth={2} className="shrink-0 opacity-70" />
                                    <span className="max-w-[12rem] truncate">{spec.name}</span>
                                    <button
                                        type="button"
                                        aria-label={t('assistant.removeSpec')}
                                        onClick={() => toggleSpec(spec.id)}
                                        className="w-4 h-4 flex items-center justify-center rounded
                                            text-gray-500 dark:text-gray-400
                                            hover:text-gray-900 dark:hover:text-white
                                            hover:bg-black/[0.06] dark:hover:bg-white/10 transition-colors"
                                    >
                                        <Cancel01Icon size={10} strokeWidth={2.5} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* What is going with the message, above the words about
                        it. Each thumbnail can be taken back until it is sent. */}
                    {images.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-3 pt-2.5">
                            {images.map(image => (
                                <div key={image.id} className="relative group">
                                    <img
                                        src={image.dataUrl}
                                        alt={image.name}
                                        className="h-14 w-14 rounded-lg object-cover
                                            border border-gray-200 dark:border-surface-control"
                                    />
                                    <button
                                        type="button"
                                        aria-label={t('assistant.removeImage')}
                                        onClick={() => removeImage(image.id)}
                                        className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center
                                            rounded-full shadow transition-opacity
                                            bg-gray-900 dark:bg-white text-white dark:text-black
                                            opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    >
                                        <Cancel01Icon size={10} strokeWidth={2.5} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    {imageNotice && (
                        <div className="px-3 pt-2 text-xs text-amber-600 dark:text-amber-400">
                            {imageNotice}
                        </div>
                    )}
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={onKeyDown}
                        onPaste={onPaste}
                        placeholder={t('assistant.askAbout', { about: described.sentence })}
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

                        {/* The documents from the library that go with the
                            message. Every agent can read text, so this is
                            there whichever one is answering. */}
                        <SpecMenu
                            specs={specs}
                            selected={specIds}
                            onToggle={toggleSpec}
                            onCreate={onOpenSnippets}
                        />

                        {/* The picker, for the agents that can read a picture.
                            Paste and drop work without it; this is for the
                            file that is not already on the clipboard. */}
                        {canAttach && (
                            <>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept={IMAGE_TYPES.join(',')}
                                    multiple
                                    className="hidden"
                                    onChange={(event) => {
                                        addFiles(Array.from(event.target.files || []));
                                        event.target.value = '';
                                    }}
                                />
                                <Tooltip label={t('assistant.attachImage')} placement="top">
                                    <button
                                        type="button"
                                        aria-label={t('assistant.attachImage')}
                                        onClick={() => fileRef.current?.click()}
                                        className="w-7 h-7 shrink-0 flex items-center justify-center
                                            rounded-full transition-colors
                                            text-gray-500 dark:text-gray-400
                                            hover:bg-gray-100 dark:hover:bg-surface-control
                                            hover:text-gray-700 dark:hover:text-gray-200"
                                    >
                                        <ImageAdd01Icon size={15} strokeWidth={2} />
                                    </button>
                                </Tooltip>
                            </>
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
                                    catalogs={catalogs}
                                    providers={providers}
                                    loading={readingModels}
                                    onRefresh={() => readModels(providers, { refresh: true })}
                                    onChange={changeSettings}
                                />
                            )}

                            {/* Nothing to press until there is something to
                                send, so the button is absent rather than
                                disabled: a permanently greyed control is
                                just clutter with a hover state. */}
                            {assistant.busy ? (
                                <Tooltip label={t('assistant.stop')} placement="top">
                                    <button
                                        type="button"
                                        aria-label={t('assistant.stop')}
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
                            ) : (text.trim() || images.length > 0 || attached.length > 0) ? (
                                <Tooltip label={t('assistant.send')} hint="Enter" placement="top">
                                    <button
                                        type="button"
                                        aria-label={t('assistant.send')}
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
        </>
    );
}
