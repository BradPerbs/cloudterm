/**
 * A numeric setting with a visible value.
 *
 * The number itself matters: "somewhere near the middle" is not a font size
 * anyone can report or reproduce. The readout is monospaced and tabular so it
 * does not jump about while being dragged.
 *
 * `format` may return a word rather than a number, as the smooth-scroll slider
 * does at zero, so the readout has a floor width rather than a fixed one: "Off"
 * is "Desligado" in Portuguese and "Выключено" in Russian, either of which is
 * wider than the digits every other slider shows. It is one unbreakable word,
 * so a fixed box would not wrap it, it would spill it over the track.
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
    const readout = format(value);

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
                // What is read out, not the raw number behind it. Otherwise a
                // screen reader says "0" where the page says "Off", and "10000"
                // where it says "10k".
                aria-valuetext={readout}
                onChange={(event) => onChange(Number(event.target.value))}
                className="setting-slider flex-1"
            />
            <span
                className="min-w-14 shrink-0 whitespace-nowrap text-right text-xs font-mono
                    tabular-nums text-gray-600 dark:text-gray-300"
            >
                {readout}
            </span>
        </div>
    );
}
