import { useEffect, useState } from 'react';

/**
 * One colour: a swatch that opens the OS picker, plus the hex so a value can be
 * typed or copied out. The text is held locally because a half-typed hex is not
 * a colour yet, and pushing it up would blank the swatch mid-keystroke.
 *
 * `hint` is for editors where the name alone does not say what the colour is
 * used for; without one the row is just the label.
 */
export default function ColorField({ label, hint, value, onChange }) {
    const [text, setText] = useState(value);

    useEffect(() => setText(value), [value]);

    const handleText = (raw) => {
        setText(raw);
        const candidate = raw.startsWith('#') ? raw : `#${raw}`;
        if (/^#[0-9a-f]{6}$/i.test(candidate)) onChange(candidate.toLowerCase());
    };

    return (
        <div className="flex items-center gap-2.5 min-w-0">
            {/* The swatch's own border and radius come from the color-input
                rules in input.css, so the colour reaches the edges. */}
            <input
                type="color"
                value={value}
                onChange={(event) => onChange(event.target.value.toLowerCase())}
                aria-label={label}
                className="w-9 h-9 shrink-0 rounded-[0.625rem] transition-transform hover:scale-[1.06]"
            />
            <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                    {label}
                </div>
                {hint && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{hint}</div>
                )}
                <input
                    type="text"
                    value={text}
                    spellCheck={false}
                    onChange={(event) => handleText(event.target.value)}
                    onBlur={() => setText(value)}
                    className="w-full bg-transparent font-mono text-[11px] text-gray-500 dark:text-gray-400
                        outline-none focus:text-gray-900 dark:focus:text-white"
                />
            </div>
        </div>
    );
}
