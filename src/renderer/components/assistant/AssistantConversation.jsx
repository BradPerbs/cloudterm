import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Cancel01Icon,
    PlusSignIcon,
    ArrowUp01Icon,
    StopCircleIcon,
    ImageAdd01Icon,
    Attachment01Icon,
} from 'hugeicons-react';
import Tooltip from '../ui/Tooltip';
import AgentMark from './AgentMark';
import Markdown from '../../lib/markdown';
import useAssistant from '../../hooks/useAssistant';
import useTypewriter from '../../hooks/useTypewriter';
import useGroupToolCalls from '../../hooks/useGroupToolCalls';
import useMentionables from '../../hooks/useMentionables';
import useMentions from '../../hooks/useMentions';
import useSlashSkills, { typedSkill } from '../../hooks/useSlashSkills';
import MentionPicker from './MentionPicker';
import SlashPicker from './SlashPicker';
import MentionChips from './MentionChips';
import ComposerButton from './ComposerButton';
import Transcript, { Notice } from './Transcript';
import { Thought } from './ToolGroup';
import WorkingIndicator from './WorkingIndicator';
import ApprovalRequest from './ApprovalRequest';
import QuestionRequest from './QuestionRequest';
import ModelMenu from './ModelMenu';
import ApprovalMenu from './ApprovalMenu';
import AttachmentChips from './AttachmentChips';
import DropOverlay, { useFileDrop } from './DropZone';
import useComposerFiles from '../../hooks/useComposerFiles';
import { useT } from '../../i18n';
import { groupApprovals } from '../../lib/approvals';
import { IMAGE_TYPES, imageFiles, readImage } from '../../lib/images';
import { canReadImages } from '../../lib/image-gate';
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
 *
 * Typed out only in the tab in front. Behind another, the text is simply set.
 */
function StreamingText({ text, onReveal, active = true }) {
    const shown = useTypewriter(text, active);

    useLayoutEffect(() => {
        onReveal();
    }, [shown, onReveal]);

    return <Markdown text={shown} />;
}

/**
 * How long streamed text can sit still, in ms, before the working line comes
 * back under it. The model often writes a sentence and then spends a long
 * while composing the call that follows, a big file most of all, and in that
 * gap the draft is on screen, not growing, and nothing says the turn is alive.
 */
const QUIET_AFTER = 1200;

/** Whether `text` is there and has not changed for `QUIET_AFTER`. */
function useQuiet(text) {
    const [quiet, setQuiet] = useState(false);
    useEffect(() => {
        setQuiet(false);
        if (!text) return undefined;
        const timer = setTimeout(() => setQuiet(true), QUIET_AFTER);
        return () => clearTimeout(timer);
    }, [text]);
    return quiet;
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
    /** Which of those open a picture as a file, and so need the local tools on. */
    const [localImageProviders, setLocalImageProviders] = useState([]);
    /** Why the last file did not make it in, shown under the thumbnails. */
    const [imageNotice, setImageNotice] = useState('');

    /**
     * Everything a message can tag with `@`: saved hosts, specs and the other
     * snippets, proxies and keys. Specs used to have a menu of their own; a
     * spec is now one more thing to tag, and reads to the model exactly as an
     * attached one did.
     */
    const mentionables = useMentionables({ hosts });

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    /** What the message tags, and the `@` picker. See `useMentions`. */
    const tags = useMentions({ text, setText, inputRef, mentionables });
    /** The `/` picker; a picked skill joins the tags as a chip. See `useSlashSkills`. */
    const slash = useSlashSkills({ text, setText, inputRef, onPick: tags.add });
    const fileRef = useRef(null);
    const docRef = useRef(null);
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
        || first?.mentions?.[0]?.name
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
                setLocalImageProviders(status?.localImageProviders || []);
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
     *
     * Read from which way the view moved, not only from where it ended up.
     * A wheel scroll is animated in small steps, and while a reply streams
     * the bottom is pinned again every frame; judged on distance alone, each
     * step is still "near the bottom", gets snapped back, and the user can
     * never get away from it. So any move up lets go at once, and only
     * coming back down to the bottom takes hold again.
     */
    const lastTop = useRef(0);
    const onScroll = useCallback(() => {
        const node = scrollRef.current;
        if (!node) return;
        const top = node.scrollTop;
        const gap = node.scrollHeight - top - node.clientHeight;
        // Content shrinking under a pinned view also lowers scrollTop, but
        // leaves it on the bottom: that is not the user leaving.
        if (top < lastTop.current - 1 && gap > 1) stickToBottom.current = false;
        else if (gap < 60) stickToBottom.current = true;
        lastTop.current = top;
    }, []);

    // The wheel and the keys say where the user is going before the view
    // has moved at all, so a frame of streaming in between cannot undo it.
    const onWheel = useCallback((event) => {
        if (event.deltaY < 0) stickToBottom.current = false;
    }, []);
    const onScrollKey = useCallback((event) => {
        if (['PageUp', 'ArrowUp', 'Home'].includes(event.key)) stickToBottom.current = false;
    }, []);

    const keepAtBottom = useCallback(() => {
        const node = scrollRef.current;
        if (!node || !stickToBottom.current) return;
        node.scrollTop = node.scrollHeight;
        lastTop.current = node.scrollTop;
    }, []);

    const draftQuiet = useQuiet(assistant.draft.text);

    // `busy` too, since the working line comes and goes with it, and the
    // draft falling quiet, which is when that line comes back.
    useLayoutEffect(() => {
        keepAtBottom();
    }, [assistant.items, assistant.draft.text, assistant.draft.thinking, assistant.busy, draftQuiet, keepAtBottom]);

    const [groupTools] = useGroupToolCalls();

    /**
     * Whether the agent answering, on the model it is set to, can be sent a
     * picture. See `lib/image-gate`.
     */
    const canAttach = canReadImages(settings, { imageProviders, localImageProviders, catalogs });

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

    /**
     * Documents waiting in the composer, and the one road every file takes
     * in, picked, dropped or pasted: pictures to `addFiles` above when the
     * agent can read them, everything else read into words. See
     * `useComposerFiles`.
     */
    const focusInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);
    const attachments = useComposerFiles({ canAttachImages: canAttach, addImages: addFiles, onSettled: focusInput });
    const { dragging, dropProps } = useFileDrop(attachments.add);

    const submit = useCallback(() => {
        let body = text.trim();
        const files = attachments.files;
        let tagged = tags.mentions;
        // `/name request` typed straight out, without taking the skill from
        // the list, invokes it all the same.
        const typed = typedSkill(body, slash.skills);
        if (typed && !tagged.some(entry => entry.kind === 'skill' && entry.id === typed.skill.id)) {
            body = typed.rest.trim();
            tagged = [...tagged, { kind: 'skill', id: typed.skill.id, name: typed.skill.name || typed.skill.id }];
        }
        if ((!body && images.length === 0 && tagged.length === 0 && files.length === 0) || assistant.busy) return;
        setText('');
        setImages([]);
        setImageNotice('');
        tags.clear();
        attachments.clear();
        stickToBottom.current = true;
        if (inputRef.current) inputRef.current.style.height = 'auto';
        assistant.send(
            body,
            images.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
            tagged.map(({ kind, id }) => ({ kind, id })),
            files.map(({ name, mediaType, text: words }) => ({ name, mediaType, text: words })),
        );
    }, [text, images, tags, slash.skills, attachments, assistant]);

    // Ctrl+V with a file on the clipboard: a screenshot nine times out of ten,
    // or a file copied in the file manager. A text paste is left to the
    // textarea, and so is a picture that came with text, which is what
    // copying cells out of a spreadsheet puts there.
    const onPaste = (event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return;
        const pictures = imageFiles(event.clipboardData);
        if (pictures.length === files.length && event.clipboardData.getData('text/plain')) return;
        event.preventDefault();
        attachments.add(files);
    };

    const onKeyDown = (event) => {
        // An open picker takes the arrows, Enter, Tab and Escape first, so the
        // caret never has to leave the field to choose from it.
        if (slash.onKeyDown(event) || tags.onKeyDown(event)) return;
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
    /** Whether there is anything to send: words, or something going with them. */
    const hasDraft = Boolean(text.trim() || images.length > 0 || tags.mentions.length > 0 || attachments.files.length > 0);
    const quickPrompts = settings?.quickPrompts || [];

    /**
     * The questions waiting on an answer, folded so that one command sent to
     * several servers is one card. See `lib/approvals`. These are drawn in the
     * dock above the composer rather than in the transcript, so the transcript
     * skips them where they would otherwise fall.
     */
    const asking = useMemo(() => groupApprovals(assistant.items), [assistant.items]);

    return (
        // The whole conversation takes a dropped file, not only the box: a
        // file is dropped wherever the pointer happens to be over the panel.
        // Laid out exactly as the column it sits in, which it replaces as the
        // frame of the three parts below.
        <div className="relative flex-1 min-h-0 flex flex-col" {...dropProps}>
            {dragging && <DropOverlay />}

            {/* No header of its own: the tab strip above is the one row of
                chrome, and which servers this tab is about is a chip on the
                composer, beside the other things that shape the next
                message. History and closing live in the strip's menu. */}

            {/* Transcript. One spacing step, owned here, not by the items.

                A flex column's gap rather than `space-y-3`. That utility is a
                sibling selector, `> :not([hidden]) ~ :not([hidden])`, which
                the browser cannot narrow: every row, draft or working line
                put into the column restyled everything already in it, which
                in a long conversation is thousands of elements a time. A gap
                is no selector at all.

                `assistant-prose` opts the whole column back into text
                selection, which the shell turns off everywhere else, and
                repaints the highlight in the app's own colours. See the note
                on it in input.css. The controls inside opt back out
                individually: dragging across a transcript should pick up the
                reply, not the label on the button next to it. */}
            <div
                ref={scrollRef}
                onScroll={onScroll}
                onWheel={onWheel}
                onKeyDown={onScrollKey}
                className={`assistant-prose flex-1 min-h-0 overflow-y-auto px-3 flex flex-col gap-3
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

                {/* Everything said so far. Its own component, so the composer
                    below and the draft streaming in under it never draw it
                    again; see Transcript. Keyed by the conversation, so one
                    opened from the history starts on its newest rows. */}
                <Transcript
                    key={assistant.conversationId || 'new'}
                    items={assistant.items}
                    onRespond={assistant.respond}
                    onLayout={keepAtBottom}
                    groupTools={groupTools}
                />

                {/* The turn in progress. Replaced by a finished block the
                    moment the model closes it, so both are never shown. The
                    thinking is shown open while it arrives, then folds into
                    a row of its own once the turn moves on. */}
                {assistant.busy && assistant.draft.thinking.trim() && !assistant.draft.text && (
                    <Thought item={{ text: '', thinking: assistant.draft.thinking }} live />
                )}
                {assistant.draft.text && (
                    <StreamingText text={assistant.draft.text} onReveal={keepAtBottom} active={active} />
                )}

                {/* Not while a question is standing: the turn is still open, so
                    `busy` is true, but nothing is happening and the thing to
                    look at is the card below. Not while words are arriving
                    either, since they say it well enough, but back as soon as
                    they stop and the turn has not. */}
                {assistant.busy && asking.length === 0 && (!assistant.draft.text || draftQuiet) && (
                    <WorkingIndicator items={assistant.items} />
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
                        // A question is not an approval, and its card is not a
                        // variant of one: there is nothing to allow, the
                        // options are the answer, and no server is named. See
                        // `QuestionRequest`.
                        group.items[0]?.question ? (
                            <QuestionRequest
                                key={group.key}
                                group={group}
                                onRespond={assistant.respond}
                            />
                        ) : (
                            <ApprovalRequest
                                key={group.key}
                                group={group}
                                sessions={sessions}
                                onRespond={assistant.respond}
                            />
                        )
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
                    className="relative rounded-2xl transition-colors
                        border border-gray-300 dark:border-surface-control
                        focus-within:border-gray-400 dark:focus-within:border-neutral-600"
                >
                    {/* What `/` opened, over the composer rather than in it. */}
                    {slash.picker && (
                        <SlashPicker
                            items={slash.matches}
                            query={slash.picker.query}
                            active={slash.row}
                            onPick={slash.pick}
                            onHover={slash.setRow}
                        />
                    )}
                    {/* What `@` opened, over the composer rather than in it. */}
                    {tags.picker && !slash.picker && (
                        <MentionPicker
                            items={tags.matches}
                            query={tags.picker.query}
                            active={tags.row}
                            onPick={tags.pick}
                            onHover={tags.setRow}
                        />
                    )}

                    {/* What the message tags, as chips. Each can be taken back
                        until it is sent; the words in the field are the
                        user's own and are left alone. */}
                    <MentionChips mentions={tags.mentions} onRemove={tags.remove} />

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
                    {/* Documents going with the message, as words. */}
                    <AttachmentChips files={attachments.files} onRemove={attachments.remove} />
                    {attachments.notice && (
                        <div className="px-3 pt-2 text-xs text-amber-600 dark:text-amber-400">
                            {attachments.notice}
                        </div>
                    )}
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={text}
                        onChange={(event) => {
                            setText(event.target.value);
                            tags.follow(event.target.value, event.target.selectionStart);
                            slash.follow(event.target.value, event.target.selectionStart);
                        }}
                        onClick={(event) => {
                            tags.follow(event.target.value, event.target.selectionStart);
                            slash.follow(event.target.value, event.target.selectionStart);
                        }}
                        onBlur={() => {
                            tags.close();
                            slash.close();
                        }}
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

                        {/* A skill from ~/.claude/skills or ~/.agents/skills,
                            sent with the message as its instructions. The
                            same thing typing `/` first does, for a pointer. */}
                        <ComposerButton
                            label={t('assistant.runSkill')}
                            hint="/"
                            active={Boolean(slash.picker) || tags.mentions.some(entry => entry.kind === 'skill')}
                            onClick={slash.open}
                        >
                            /
                        </ComposerButton>

                        {/* Anything saved can be named in a message: a host,
                            a spec or another snippet, a proxy, a key. The
                            same thing typing `@` does, for a pointer. */}
                        <ComposerButton
                            label={t('assistant.tag')}
                            hint="@"
                            active={Boolean(tags.picker) || tags.mentions.length > 0}
                            onClick={tags.open}
                        >
                            @
                        </ComposerButton>

                        {/* Any file off the disk: pictures go as pictures where
                            the agent reads them, everything else as words,
                            which every agent reads. Drop and paste take the
                            same road. */}
                        <input
                            ref={docRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                attachments.add(Array.from(event.target.files || []));
                                event.target.value = '';
                            }}
                        />
                        <Tooltip label={t('assistant.attachFile')} hint={t('assistant.attachFileHint')} placement="top">
                            <button
                                type="button"
                                aria-label={t('assistant.attachFile')}
                                onClick={() => docRef.current?.click()}
                                className={`w-7 h-7 shrink-0 flex items-center justify-center
                                    rounded-full transition-colors
                                    ${attachments.files.length > 0
                                        ? 'bg-gray-100 dark:bg-surface-control text-gray-700 dark:text-gray-200'
                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-control '
                                            + 'hover:text-gray-700 dark:hover:text-gray-200'}`}
                            >
                                <Attachment01Icon size={15} strokeWidth={2} />
                            </button>
                        </Tooltip>

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
                            ) : hasDraft ? (
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
        </div>
    );
}
