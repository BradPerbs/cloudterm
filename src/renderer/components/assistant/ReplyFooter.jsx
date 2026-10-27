import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy01Icon, Tick01Icon } from 'hugeicons-react';
import Tooltip from '../ui/Tooltip';
import { localeTag, useT } from '../../i18n';

/**
 * The row under a finished reply.
 *
 * Copy takes the reply as the agent wrote it, Markdown and all, so it pastes
 * into a ticket or a doc the way it reads here. The reply is the last thing
 * the agent wrote in the turn, which is the answer; what it said on the way
 * there, between tool calls, is narration. Any key the user pasted into the
 * chat is already masked in it: that happens in the main process before the
 * text ever reaches a window.
 *
 * The number is how fast the turn wrote its answer, in output tokens per
 * second of the model's own time: tool runs and time spent waiting on an
 * approval card are taken out (see ai/turn-rate.js). A runtime that reports
 * no usage gets no number rather than a made-up one.
 */

/** How long the tick stays up after a copy. */
const CONFIRM_MS = 1400;

/** An icon button for the row, quiet until it is pointed at. */
export function FooterButton({ label, hint, onClick, disabled = false, children }) {
    return (
        <Tooltip label={label} hint={hint} placement="bottom">
            <button
                type="button"
                aria-label={label}
                onClick={onClick}
                disabled={disabled}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors outline-none
                    text-gray-400 dark:text-gray-500
                    hover:bg-gray-100 hover:text-gray-900
                    dark:hover:bg-surface-control dark:hover:text-white
                    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                    disabled:opacity-50 disabled:cursor-default"
            >
                {children}
            </button>
        </Tooltip>
    );
}

/** Whole numbers past twenty, one decimal below, so a slow turn still says something. */
function formatRate(tps) {
    return new Intl.NumberFormat(localeTag(), { maximumFractionDigits: tps >= 20 ? 0 : 1 }).format(tps);
}

export default function ReplyFooter({ text = '', rate = null, children = null }) {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const timer = useRef(0);
    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = useCallback(async () => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            try {
                await window.api?.clipboard?.writeText?.(text);
            } catch {
                // Nothing to say that the tick not appearing does not say.
                return;
            }
        }
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
    }, [text]);

    // The wall time alongside when the turn spent meaningfully longer than
    // generating: the model wrote at this pace, the turn took that long.
    const showWall = Boolean(rate?.wall && rate.wall > rate.seconds + 1);

    return (
        <div data-find-skip="" className="flex items-center gap-0.5 select-none">
            {text && (
                <FooterButton label={copied ? t('assistant.copiedReply') : t('assistant.copyReply')} onClick={copy}>
                    {copied
                        ? <Tick01Icon size={14} strokeWidth={2.25} className="text-emerald-600 dark:text-emerald-400" />
                        : <Copy01Icon size={14} strokeWidth={1.75} />}
                </FooterButton>
            )}
            {children}
            {rate && (
                <Tooltip
                    label={showWall
                        ? t('assistant.turnRateHintWall', { tokens: rate.tokens, seconds: rate.seconds, wall: rate.wall })
                        : t('assistant.turnRateHint', { tokens: rate.tokens, seconds: rate.seconds })}
                    placement="bottom"
                >
                    <span className="px-1.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                        {t('assistant.tokensPerSecond', { rate: formatRate(rate.tps) })}
                    </span>
                </Tooltip>
            )}
        </div>
    );
}
