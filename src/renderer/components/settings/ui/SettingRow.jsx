/**
 * One setting: what it is, what it does, and the control that changes it.
 *
 * A control small enough to sit beside the label goes in `control`; anything
 * that needs the full width (a grid of swatches, a list) goes in `children`
 * and lands underneath. `align="center"` is for a single compact control like a
 * switch, which reads better centred against a two-line description than pinned
 * to its first line.
 */
export default function SettingRow({
    title,
    description,
    control,
    children,
    align = 'start',
    className = '',
}) {
    return (
        <div className={className}>
            <div className={`flex ${align === 'center' ? 'items-center' : 'items-start'} justify-between gap-6`}>
                <div className="min-w-0">
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h4>
                    {description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
                    )}
                </div>
                {control && <div className="shrink-0">{control}</div>}
            </div>

            {children && <div className="mt-6">{children}</div>}
        </div>
    );
}

/**
 * Separator for a second setting inside the same card. The rule is what stops
 * two unrelated controls reading as one group.
 */
export const DIVIDED = 'mt-8 pt-8 border-t border-gray-200 dark:border-neutral-700';
