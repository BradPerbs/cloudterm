/**
 * A numeric setting with a visible value.
 *
 * Every one of these governs the terminal's cell geometry, so the number itself
 * matters: "somewhere near the middle" is not a font size anyone can report or
 * reproduce. The readout is monospaced and tabular so it does not jump about
 * while being dragged.
 */
export default function Slider({
    value,
    min,
    max,
    step,
    onChange,
    format = (number) => String(number),
    ariaLabel,
    id,
}) {
    return (
        <div className="flex items-center gap-3 w-full max-w-xs">
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                aria-label={ariaLabel}
                onChange={(event) => onChange(Number(event.target.value))}
                className="setting-slider flex-1"
            />
            <span
                className="w-14 shrink-0 text-right text-xs font-mono tabular-nums
                    text-gray-600 dark:text-gray-300"
            >
                {format(value)}
            </span>
        </div>
    );
}
