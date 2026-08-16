import { useStacked } from './stacked';

/**
 * One setting: what it is, what it does, and the control that changes it.
 *
 * A control small enough to sit beside the label goes in `control`; anything
 * that needs the full width (a grid of swatches, a list) goes in `children`
 * and lands underneath. `align="center"` is for a single compact control like a
 * switch, which reads better centred against a two-line description than pinned
 * to its first line.
 *
 * Side by side is the shape this wants, but it is not a shape that survives at
 * any width. The control is the fixed half of it (a slider is 320px, a segmented
 * control not much less) and it is `shrink-0`, so every pixel the row loses came
 * out of the label. Squeezed far enough, the title breaks a word per line and
 * the description stops being readable at all, which is where a settings page
 * with the assistant open beside it used to end up.
 *
 * So past a point the row stacks: label on one line, control across the card
 * under it. Everything is still there and nothing is truncated. The page just
 * gets taller, which is the one thing a settings page can spend freely, since it
 * scrolls anyway. The panel decides when, so a card cannot come out half in one
 * shape and half in the other; see ui/stacked.
 */
export default function SettingRow({
    title,
    description,
    control,
    children,
    align = 'start',
    className = '',
}) {
    const stacked = useStacked();

    return (
        <div className={className}>
            <div className={stacked
                ? 'flex flex-col gap-3'
                : `flex ${align === 'center' ? 'items-center' : 'items-start'} justify-between gap-6`}
            >
                <div className="min-w-0">
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h4>
                    {description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
                    )}
                </div>
                {/* Stacked, it is on its own line with the whole card to use, so
                    holding it to the size it asked for would only pin it to the
                    left of a gap. */}
                {control && <div className={stacked ? 'min-w-0' : 'shrink-0'}>{control}</div>}
            </div>

            {children && <div className={stacked ? 'mt-4' : 'mt-6'}>{children}</div>}
        </div>
    );
}

/**
 * Separator for a second setting inside the same card. The rule is what stops
 * two unrelated controls reading as one group.
 */
export const DIVIDED = 'mt-8 pt-8 border-t border-gray-200 dark:border-neutral-700';
