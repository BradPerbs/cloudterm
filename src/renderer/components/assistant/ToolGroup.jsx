import { useState } from 'react';
import {
    ArrowDown01Icon,
    BrainIcon,
    CommandLineIcon,
    Edit02Icon,
    EyeIcon,
    Plug01Icon,
    Search01Icon,
} from 'hugeicons-react';
import Markdown from '../../lib/markdown';
import { toolBucket } from '../../lib/tool-bucket';
import Reveal from '../ui/Reveal';
import ToolCall, { DOTS } from './ToolCall';
import { useT } from '../../i18n';

/**
 * Back-to-back tool calls as one row: "8 reads · 3 commands", opening into
 * the calls themselves, laid out as a timeline.
 *
 * Only calls are in here. A thought (the narration or the thinking between
 * calls) stands in the transcript on its own and ends the group above it, so
 * the calls after it start a new one: thought, calls, thought, calls, reply.
 *
 * Folded in the transcript (see lib/group-rows), not in the reducer, so every
 * result still finds its call where it always did. A group is the same object
 * for as long as its members are, which lets the segment it sits in tell
 * nothing has changed.
 */

/** The order the buckets are said in, with the icon each is said with. */
const BUCKETS = [
    ['views', EyeIcon, 'assistant.toolGroup.views'],
    ['commands', CommandLineIcon, 'assistant.toolGroup.commands'],
    ['edits', Edit02Icon, 'assistant.toolGroup.edits'],
    ['searches', Search01Icon, 'assistant.toolGroup.searches'],
    ['connections', Plug01Icon, 'assistant.toolGroup.connections'],
    ['other', null, 'assistant.toolGroup.other'],
];

/** How many of the calls are still at work, and how many went wrong. */
function tally(items) {
    let running = 0;
    let failed = 0;
    for (const item of items) {
        if (item.status === 'running' || item.status === 'waiting') running += 1;
        else if (item.status === 'error') failed += 1;
    }
    return { running, failed };
}

/** The first readable line, for a collapsed thought. */
function previewOf(item) {
    const text = String(item.text || '').trim();
    const thinking = String(item.thinking || '').trim();
    const first = (text || thinking).split('\n').map(line => line.trim()).filter(Boolean)[0] || '';
    return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}

/** Thinking is read less closely than a reply, so it is set smaller and quieter. */
const QUIET = 'text-[12px] leading-relaxed text-gray-600 dark:text-gray-400';

/** The thinking, in a well of its own, and any words under it. */
function ThoughtBody({ thinking, text, labelled }) {
    const t = useT();
    return (
        <div className="pl-6 pr-2.5 pb-2.5 space-y-2">
            {thinking && (
                <div className="rounded-lg px-2.5 py-2 bg-gray-100/70 dark:bg-white/[0.04]">
                    {labelled && (
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase
                            tracking-wide text-gray-400 dark:text-gray-500 select-none">
                            <BrainIcon size={11} strokeWidth={2} />
                            {t('assistant.thoughtThinking')}
                        </div>
                    )}
                    <Markdown text={thinking} className={QUIET} />
                </div>
            )}
            {text && (
                <div className="px-2.5">
                    <Markdown text={text} />
                </div>
            )}
        </div>
    );
}

/**
 * One thought: the model's thinking, standing in the transcript between
 * groups, or above the reply it led to.
 *
 * Collapsed to one line with a brain, like a call. Opens into the full text.
 * `live` is the thought still arriving, which is shown open, since it is the
 * one thing on screen saying what the model is doing; it collapses on its own
 * the moment the turn moves on and it lands in the transcript as a row.
 */
export function Thought({ item, live = false }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const preview = previewOf(item);
    const thinking = String(item.thinking || '').trim();
    const text = String(item.text || '').trim();

    if (live) {
        return (
            <div className="overflow-hidden" role="status" aria-label={t('assistant.thought')}>
                <div className="h-8 px-2.5 flex items-center gap-2 select-none">
                    <BrainIcon
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="shrink-0 text-gray-400 dark:text-gray-500 motion-safe:animate-pulse"
                    />
                    <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                        {t('assistant.thought')}
                    </span>
                </div>
                <ThoughtBody thinking={thinking} text={text} />
            </div>
        );
    }

    return (
        <div className="overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                className="w-full min-w-0 h-8 px-2.5 flex items-center gap-2 text-left select-none rounded-lg
                    transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]"
            >
                <BrainIcon size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 shrink-0">
                    {t('assistant.thought')}
                </span>
                {preview && (
                    <span
                        className="min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-500"
                        title={preview}
                    >
                        {preview}
                    </span>
                )}
                <ArrowDown01Icon
                    size={13}
                    strokeWidth={2}
                    className={`shrink-0 ml-auto text-gray-400 dark:text-gray-600 transition-transform
                        ${open ? 'rotate-180' : ''}`}
                />
            </button>

            <Reveal open={open}>
                <ThoughtBody thinking={thinking} text={text} labelled />
            </Reveal>
        </div>
    );
}

export default function ToolGroup({ group }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const items = group.items || [];
    const { running, failed } = tally(items);

    const counts = {};
    for (const item of items) {
        const bucket = toolBucket(item.name);
        counts[bucket] = (counts[bucket] || 0) + 1;
    }

    const parts = BUCKETS
        .filter(([bucket]) => counts[bucket] > 0)
        .map(([bucket, Icon, key]) => ({ key: bucket, Icon, text: t(key, { count: counts[bucket] }) }));
    if (running > 0) parts.unshift({ key: 'running', Icon: null, text: t('assistant.toolGroup.running', { count: running }) });
    if (failed > 0 && running === 0) parts.push({ key: 'failed', Icon: null, text: t('assistant.toolGroup.failed', { count: failed }) });

    // At work while any call is, then red if any went wrong, grey after.
    const dot = running > 0 ? DOTS.running : failed > 0 ? DOTS.error : DOTS.done;

    return (
        <div className="rounded-lg bg-gray-50 dark:bg-white/[0.035] overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                className="w-full min-w-0 h-8 px-2.5 flex items-center gap-2 text-left select-none
                    transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]"
            >
                <span aria-hidden="true" className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                </span>
                <span className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden
                    text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    {parts.map((part, index) => (
                        <span key={part.key} className="shrink-0 flex items-center gap-1">
                            {part.Icon && (
                                <part.Icon size={12} strokeWidth={2} aria-hidden="true"
                                    className="shrink-0 text-gray-400 dark:text-gray-600" />
                            )}
                            <span>{part.text}</span>
                            {index < parts.length - 1 && (
                                <span aria-hidden="true" className="ml-1 text-gray-300 dark:text-gray-700">·</span>
                            )}
                        </span>
                    ))}
                </span>
                <span className="shrink-0 ml-auto flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-600">
                    {open ? t('assistant.toolGroup.showLess') : t('assistant.toolGroup.showAll')}
                    <ArrowDown01Icon
                        size={13}
                        strokeWidth={2}
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                </span>
            </button>

            <Reveal open={open}>
                <div className="border-t border-black/[0.06] dark:border-white/[0.06] py-1">
                    {/* One rail for the whole burst, with an elbow per row:
                        the burst reads as a timeline rather than a stack of
                        boxes. The tick sits at the row's middle (h-8). */}
                    <div className="ml-[17px] border-l border-black/10 dark:border-white/10 pl-1 space-y-0.5">
                        {items.map(item => (
                            <div
                                key={item.id}
                                className="relative before:absolute before:-left-[5px] before:top-4
                                    before:w-[5px] before:border-t
                                    before:border-black/10 dark:before:border-white/10"
                            >
                                <ToolCall item={item} bare />
                            </div>
                        ))}
                    </div>
                </div>
            </Reveal>
        </div>
    );
}
