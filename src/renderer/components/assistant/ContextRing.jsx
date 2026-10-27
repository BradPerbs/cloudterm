import Tooltip from '../ui/Tooltip';
import { localeTag, useT } from '../../i18n';

/**
 * How full the model's context is, as a small ring beside the model chip.
 *
 * The latest reply's tokens (what went in, cached or not, and what came back)
 * over the model's context window, the figure OpenCode Desktop draws beside
 * its composer. It moves once per step of a turn, and says on hover the
 * tokens, the window and the cache hits behind the percentage. Grey while
 * there is room, amber from 70%, red from 90%, where the runtime is about to
 * compact the conversation or refuse it.
 *
 * Drawn only where the runtime reports a reading: Claude Code, OpenCode and
 * Grok Build do, and a ring that never fills on the others would be a meter
 * that is broken rather than one that is empty. Nothing is drawn for a
 * reading from another agent than the one now answering either: after a
 * switch it describes a model that is no longer in the conversation.
 */

const SIZE = 16;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Grey while there is room, amber as it fills, red when a compaction is near. */
function toneOf(percent) {
    if (percent >= 90) return 'text-red-500 dark:text-red-400';
    if (percent >= 70) return 'text-amber-500 dark:text-amber-400';
    return 'text-gray-400 dark:text-gray-500';
}

function Row({ name, value }) {
    return (
        <span className="flex items-center justify-between gap-4 tabular-nums">
            <span className="opacity-70">{name}</span>
            <span>{value}</span>
        </span>
    );
}

export default function ContextRing({ context, provider }) {
    const t = useT();
    if (!context || !(Number(context.used) > 0)) return null;
    if (context.provider && provider && context.provider !== provider) return null;

    const number = new Intl.NumberFormat(localeTag());
    const used = Number(context.used);
    const limit = Number(context.limit) || 0;
    const percent = Number.isFinite(context.percent) && limit > 0
        ? Math.max(0, Math.min(100, context.percent))
        : null;
    const filled = percent === null ? 0 : (percent / 100) * CIRCUMFERENCE;
    const tokens = limit
        ? t('assistant.contextTokensOf', { used: number.format(used), limit: number.format(limit) })
        : number.format(used);
    // Cache-read tokens behind the reading, when the runtime reports them:
    // hits as tokens and as a share of what the reply carried.
    const cached = Number(context.cached) > 0 ? Number(context.cached) : 0;
    const hitRate = cached > 0 ? Math.max(0, Math.min(100, Math.round((cached / used) * 100))) : null;
    const spoken = percent === null
        ? t('assistant.contextUnknownLimit', { tokens })
        : t('assistant.contextLabel', { percent, tokens });

    const label = (
        <span className="flex flex-col gap-1 min-w-[11rem]">
            {percent !== null && <Row name={t('assistant.contextUsage')} value={`${percent}%`} />}
            <Row name={t('assistant.contextTokens')} value={tokens} />
            {cached > 0 && (
                <Row name={t('assistant.contextCached')} value={`${number.format(cached)} · ${hitRate}%`} />
            )}
        </span>
    );

    return (
        <Tooltip label={label} placement="top">
            <span
                role="img"
                aria-label={spoken}
                className={`w-7 h-7 shrink-0 flex items-center justify-center transition-colors ${toneOf(percent ?? 0)}`}
            >
                <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
                    <circle
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.25"
                        strokeWidth={STROKE}
                    />
                    <circle
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={STROKE}
                        strokeLinecap="round"
                        strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
                        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                        style={{ transition: 'stroke-dasharray 600ms ease' }}
                    />
                </svg>
            </span>
        </Tooltip>
    );
}
