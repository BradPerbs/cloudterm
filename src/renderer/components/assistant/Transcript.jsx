import { memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image01Icon, Note01Icon } from 'hugeicons-react';
import Markdown from '../../lib/markdown';
import { groupRows } from '../../lib/group-rows';
import ToolCall from './ToolCall';
import ToolGroup, { Thought } from './ToolGroup';
import ApprovalRequest from './ApprovalRequest';
import { useT } from '../../i18n';

/**
 * The conversation so far, as rows.
 *
 * A long conversation is thousands of rows: every message, every tool call
 * and its output. It used to be drawn in one pass inside the panel, which
 * meant each streamed word, each keystroke in the composer and each tool
 * result drew all of it again. Four things keep it flat now, and none of them
 * takes anything away: every row is still in the page, selectable and
 * copyable.
 *
 *   one row, one memo   a row is drawn again only when its own item changes.
 *                       The reducer keeps every other item the same object
 *                       (see lib/transcript-reducer), so a new tool result
 *                       redraws one row, not two thousand. Rows are grouped
 *                       in fixed runs of fifty that check their own items by
 *                       identity, so even looking at the rows that did not
 *                       change costs a comparison per item rather than an
 *                       element per row.
 *   its own component   the composer, its menus and the streaming draft live
 *                       beside this, not inside it, so typing and streaming
 *                       do not reach it at all.
 *   off-screen rows     are left out of layout and paint by the browser
 *                       (`content-visibility`), with their last size kept so
 *                       the scrollbar does not jump. They are still in the
 *                       document: selection and copy work across them.
 *   newest first        a long conversation opens on its last rows, and the
 *                       older ones are added above in the background, a few
 *                       hundred at a time, where they would have been anyway.
 *
 * Where the next things plug in: a footer under each finished turn goes in
 * `Row`, under its content, with the turn's end worked out here and passed
 * through `Segment` (whose comparison would then check it too). What a tool
 * row opens into, a diff included, is `ToolCall`'s.
 */

/** Rows drawn straight away when a conversation opens: more than a screen. */
const FIRST_ROWS = 60;
/** Rows added above per idle moment while the rest are brought in. */
const CHUNK = 150;
/**
 * Rows per segment. Segments start at fixed multiples of this from the
 * first item, so bringing older rows in never moves a boundary.
 */
const SEGMENT = 50;

/**
 * Off-screen rows skip layout and paint. The height is a guess for a row the
 * browser has never drawn; `auto` makes it remember the real one after.
 */
const ROW_STYLE = { contentVisibility: 'auto', containIntrinsicHeight: 'auto 72px' };

export function Notice({ item }) {
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

/** A thin rule with a few words on it: the chat moved to another model or effort. */
function Divider({ item }) {
    return (
        <div
            role="separator"
            className="flex items-center gap-2 py-0.5 text-[10.5px] select-none
                text-gray-400 dark:text-neutral-500"
        >
            <span className="h-px flex-1 bg-gray-200 dark:bg-white/[0.08]" />
            <span className="shrink-0 max-w-[80%] truncate" title={item.text}>{item.text}</span>
            <span className="h-px flex-1 bg-gray-200 dark:bg-white/[0.08]" />
        </div>
    );
}

function UserMessage({ item }) {
    const t = useT();
    return (
        <div className="flex justify-end">
            <div className="assistant-bubble max-w-[88%] px-3 py-2 rounded-2xl rounded-br-md
                bg-gray-900 dark:bg-white text-white dark:text-black
                text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                {/* The documents that went with it, by name. The text is in
                    the library, and a bubble holding a runbook would be the
                    whole panel. */}
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
                {/* The pictures, or a chip naming each one for a message read
                    back from disk, which keeps the name and not the bytes. */}
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

/** What one row draws as. */
function RowContent({ item, onRespond }) {
    switch (item.kind) {
        case 'user':
            return <UserMessage item={item} />;
        case 'assistant': {
            // The thinking as a collapsed thought, the words under it as they
            // always drew. Thinking with no words is the thought alone.
            const thinking = String(item.thinking || '').trim();
            const text = String(item.text || '').trim();
            if (!text) return thinking ? <Thought item={item} /> : null;
            if (!thinking) return <Markdown text={item.text} />;
            return (
                <div className="space-y-1.5">
                    <Thought item={{ id: item.id, thinking: item.thinking }} />
                    <Markdown text={item.text} />
                </div>
            );
        }
        case 'tool':
            return <ToolCall item={item} />;
        case 'tools':
            return <ToolGroup group={item} />;
        case 'approval':
            return (
                <ApprovalRequest
                    group={{ key: item.id, items: [item], queued: [] }}
                    onRespond={onRespond}
                />
            );
        case 'divider':
            return <Divider item={item} />;
        default:
            return <Notice item={item} />;
    }
}

/**
 * Whether a row draws nothing here. A question standing is the card pinned
 * above the composer instead, and a row drawing that as well would put the
 * same command on screen twice; it takes its place here the moment it is
 * answered. An assistant block with nothing in it has nothing to draw. Either
 * way the row is left out entirely, since an empty one would still take a gap
 * in the column.
 */
function isBlank(item) {
    if (item.kind === 'tool') return item.approval?.status === 'pending';
    if (item.kind === 'approval') return item.status === 'pending';
    if (item.kind === 'assistant') return !String(item.text || '').trim() && !String(item.thinking || '').trim();
    return false;
}

/**
 * One item. Its props are all values or stable callbacks, so it is drawn
 * again only when its own item changes.
 */
const Row = memo(function Row({ item, onRespond }) {
    if (isBlank(item)) return null;

    return (
        // Never squeezed by the column it sits in: a flex column would
        // otherwise shrink its rows to fit rather than scroll.
        <div className="shrink-0" style={ROW_STYLE}>
            <RowContent item={item} onRespond={onRespond} />
        </div>
    );
});

/**
 * A row's key: the item's own id, made unique if two items share one. Two
 * events stamped in the same millisecond can, and React would then hand one
 * row's state to the other.
 */
function rowKeys(items) {
    const keys = new Array(items.length);
    const seen = new Set();
    for (let index = 0; index < items.length; index += 1) {
        let key = String(items[index].id);
        if (seen.has(key)) key = `${key}~${index}`;
        seen.add(key);
        keys[index] = key;
    }
    return keys;
}

/**
 * A fixed run of rows. Skipped outright when every item in it is the same
 * object as last time, which is every segment but the last while a turn is
 * streaming in.
 */
const Segment = memo(function Segment({ items, keys, from, to, rowProps }) {
    const rows = [];
    for (let index = from; index < to; index += 1) {
        rows.push(<Row key={keys[index]} item={items[index]} {...rowProps} />);
    }
    return rows;
}, (previous, next) => {
    if (previous.from !== next.from || previous.to !== next.to || previous.rowProps !== next.rowProps) return false;
    for (let index = next.from; index < next.to; index += 1) {
        if (previous.items[index] !== next.items[index] || previous.keys[index] !== next.keys[index]) return false;
    }
    return true;
});

/**
 * The rows as drawn: back-to-back tool calls folded into one group, with the
 * thoughts between them left standing outside (see lib/group-rows). The last
 * pass's groups are handed back in, so a group whose calls have not changed
 * is the same object and its segment is skipped.
 */
function useGrouped(items, enabled) {
    const cache = useRef(new Map());
    return useMemo(() => {
        const { rows, kept } = groupRows(items, { enabled, previous: cache.current });
        cache.current = kept;
        return rows;
    }, [items, enabled]);
}

function Transcript({
    items: allItems,
    /** Answer a card that is drawn in the transcript rather than the dock. */
    onRespond,
    /** Told after every change to what is drawn, so the panel can follow the bottom. */
    onLayout,
    /** Fold consecutive tool calls into one summary row. On unless switched off in settings. */
    groupTools = true,
}) {
    const t = useT();
    const items = useGrouped(allItems, groupTools);

    // Newest first: the last rows are drawn straight away. The rest come in
    // above them while the browser is idle, as a transition, so a key pressed
    // meanwhile is never kept waiting behind them.
    const [from, setFrom] = useState(() => Math.max(0, items.length - FIRST_ROWS));
    useEffect(() => {
        if (from <= 0) return undefined;
        const idle = window.requestIdleCallback
            ? callback => window.requestIdleCallback(callback, { timeout: 300 })
            : callback => setTimeout(callback, 30);
        const cancel = window.cancelIdleCallback || clearTimeout;
        const handle = idle(() => {
            startTransition(() => setFrom(current => Math.max(0, current - CHUNK)));
        });
        return () => cancel(handle);
    }, [from]);

    useLayoutEffect(() => {
        onLayout?.();
    }, [items, from, onLayout]);

    const keys = useMemo(() => rowKeys(items), [items]);
    // One object for the props every row shares, so a segment can tell they
    // have not changed with one comparison.
    const rowProps = useMemo(() => ({ onRespond }), [onRespond]);

    const start = Math.min(from, items.length);
    const segments = [];
    for (let first = Math.floor(start / SEGMENT) * SEGMENT; first < items.length; first += SEGMENT) {
        segments.push(
            <Segment
                key={first}
                items={items}
                keys={keys}
                from={Math.max(first, start)}
                to={Math.min(first + SEGMENT, items.length)}
                rowProps={rowProps}
            />,
        );
    }

    return (
        <>
            {start > 0 && (
                <div className="shrink-0 h-8 flex items-center justify-center text-[11px] select-none
                    text-gray-400 dark:text-gray-600">
                    {t('assistant.loadingEarlier', { count: start })}
                </div>
            )}
            {segments}
        </>
    );
}

export default memo(Transcript);
