/**
 * The colours the app's own chrome is made of.
 *
 * Every dark surface in the shell is one step of a single ramp, and the Tailwind
 * palette names those steps through CSS variables rather than baking hexes into
 * the utilities (see `tailwind.config.js` and the `:root` block in `input.css`).
 * Setting the six variables here is therefore enough to retint the whole app:
 * `bg-surface-raised`, `dark:bg-neutral-800`, `dark:border-neutral-700` and the
 * rest all follow, without a single class having to change.
 *
 * Only the dark ramp is themeable. It is the one the app was designed on, and
 * light mode is Tailwind's own greys against black text; a palette that had to
 * work as both would be neither.
 */

/** The steps, in the order the editor lists them. */
export const APP_COLOR_FIELDS = [
    { key: 'base', label: 'Window', hint: 'What the whole shell sits on' },
    { key: 'raised', label: 'Panels', hint: 'Cards, dialogs, the sidebar' },
    { key: 'control', label: 'Controls', hint: 'Buttons, inputs and their borders' },
    { key: 'hover', label: 'Hover', hint: 'A control under the pointer' },
    { key: 'active', label: 'Pressed', hint: 'A control being used, and rules' },
    { key: 'muted', label: 'Muted text', hint: 'Secondary labels and placeholders' },
];

/** The variable each step is published as. Read by the Tailwind palette. */
const CSS_VARIABLES = {
    base: '--app-base',
    raised: '--app-raised',
    control: '--app-control',
    hover: '--app-hover',
    active: '--app-active',
    muted: '--app-muted',
};

/**
 * The app's own colours, and what an untouched custom theme starts as.
 *
 * Tokyo Night, the same palette the terminal defaults to (see
 * hooks/useTerminalTheme.js), so the shell and what runs inside it are one
 * scheme out of the box. Keep in step with the `:root` block in input.css.
 */
export const DEFAULT_APP_COLORS = {
    base: '#16161e',
    raised: '#1a1b26',
    control: '#24283b',
    hover: '#2f334d',
    active: '#3b4261',
    muted: '#565f89',
};

/**
 * Palettes to start from. Each is the same six-step ramp as the default, so
 * picking one is a complete theme rather than a hue the rest has to be matched
 * to by hand.
 */
export const APP_COLOR_PRESETS = [
    { id: 'tokyo-night', label: 'Tokyo Night', colors: DEFAULT_APP_COLORS },
    {
        id: 'midnight',
        label: 'Midnight',
        colors: { base: '#111219', raised: '#1a1b26', control: '#24253a', hover: '#2e3049', active: '#3b3d5c', muted: '#565982' },
    },
    {
        id: 'graphite',
        label: 'Graphite',
        colors: { base: '#0d0d0f', raised: '#16161a', control: '#212127', hover: '#2b2b33', active: '#383840', muted: '#6b6b78' },
    },
    {
        id: 'nord',
        label: 'Nord',
        colors: { base: '#232831', raised: '#2e3440', control: '#3b4252', hover: '#434c5e', active: '#4c566a', muted: '#7c89a3' },
    },
    {
        id: 'dracula',
        label: 'Dracula',
        colors: { base: '#1a1b23', raised: '#282a36', control: '#343746', hover: '#414458', active: '#565a72', muted: '#6272a4' },
    },
    {
        id: 'catppuccin',
        label: 'Catppuccin',
        colors: { base: '#181825', raised: '#1e1e2e', control: '#313244', hover: '#45475a', active: '#585b70', muted: '#7f849c' },
    },
    {
        id: 'rose-pine',
        label: 'Rosé Pine',
        colors: { base: '#16141f', raised: '#191724', control: '#26233a', hover: '#322f4a', active: '#403d52', muted: '#6e6a86' },
    },
    {
        id: 'gruvbox',
        label: 'Gruvbox',
        colors: { base: '#1d2021', raised: '#282828', control: '#3c3836', hover: '#504945', active: '#665c54', muted: '#928374' },
    },
    {
        id: 'everforest',
        label: 'Everforest',
        colors: { base: '#232a2e', raised: '#2d353b', control: '#3d484d', hover: '#475258', active: '#56635f', muted: '#859289' },
    },
    {
        id: 'solarized',
        label: 'Solarized',
        colors: { base: '#00212b', raised: '#002b36', control: '#073642', hover: '#0f4a58', active: '#175c6c', muted: '#7d9295' },
    },
    {
        id: 'ocean',
        label: 'Ocean',
        colors: { base: '#08131f', raised: '#0d1b2a', control: '#1b263b', hover: '#24354f', active: '#2e4363', muted: '#6f83a3' },
    },
    {
        id: 'amethyst',
        label: 'Amethyst',
        colors: { base: '#14111f', raised: '#1c1830', control: '#292244', hover: '#362d5a', active: '#443873', muted: '#8478c0' },
    },
    {
        id: 'ember',
        label: 'Ember',
        colors: { base: '#17110f', raised: '#211917', control: '#332624', hover: '#423230', active: '#543f3c', muted: '#96736c' },
    },
];

/**
 * How much lighter each step is than the window behind it, in HSL lightness
 * points. Measured off the default palette, so a ramp derived from one colour
 * has the same spacing the app was drawn with.
 */
const LIGHTNESS_STEPS = [0, 4.5, 10, 15, 21, 34];

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Anything a colour input or a hand-edited store might hold, as `#rrggbb`. */
export function normalizeHex(value, fallback = '#000000') {
    if (typeof value !== 'string') return fallback;

    const match = HEX_PATTERN.exec(value.trim());
    if (!match) return fallback;

    const digits = match[1];
    const full = digits.length === 3
        ? digits.split('').map(digit => digit + digit).join('')
        : digits;

    return `#${full.toLowerCase()}`;
}

function hexToRgb(hex) {
    const value = normalizeHex(hex);
    return [
        parseInt(value.slice(1, 3), 16),
        parseInt(value.slice(3, 5), 16),
        parseInt(value.slice(5, 7), 16),
    ];
}

function rgbToHsl([red, green, blue]) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;

    if (delta === 0) return [0, 0, lightness * 100];

    const saturation = delta / (1 - Math.abs(2 * lightness - 1));

    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;

    hue *= 60;
    if (hue < 0) hue += 360;

    return [hue, saturation * 100, lightness * 100];
}

function hslToHex(hue, saturation, lightness) {
    const s = Math.max(0, Math.min(100, saturation)) / 100;
    const l = Math.max(0, Math.min(100, lightness)) / 100;

    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = l - chroma / 2;

    const sector = Math.floor(((hue % 360) + 360) % 360 / 60);
    const [r, g, b] = [
        [chroma, second, 0],
        [second, chroma, 0],
        [0, chroma, second],
        [0, second, chroma],
        [second, 0, chroma],
        [chroma, 0, second],
    ][sector];

    return `#${[r, g, b]
        .map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
        .join('')}`;
}

/**
 * A whole ramp from one colour: the window keeps the hue and saturation it was
 * given, and every surface above it is the same colour lifted. One picker is
 * how most people want to say "make the app green", and each step stays
 * editable afterwards.
 */
export function derivePalette(baseHex) {
    const [hue, saturation, lightness] = rgbToHsl(hexToRgb(baseHex));

    return APP_COLOR_FIELDS.reduce((colors, field, index) => {
        colors[field.key] = hslToHex(hue, saturation, lightness + LIGHTNESS_STEPS[index]);
        return colors;
    }, {});
}

/** Fill the gaps and drop anything unreadable, so a half-written store still
 *  produces an app you can see. */
export function sanitizeAppColors(colors) {
    const source = colors || {};
    return APP_COLOR_FIELDS.reduce((result, field) => {
        result[field.key] = normalizeHex(source[field.key], DEFAULT_APP_COLORS[field.key]);
        return result;
    }, {});
}

/** The preset these colours are, if they are still exactly one of them. */
export function matchPreset(colors) {
    const candidate = sanitizeAppColors(colors);
    return APP_COLOR_PRESETS.find(preset =>
        APP_COLOR_FIELDS.every(field => preset.colors[field.key] === candidate[field.key])
    )?.id || null;
}

/**
 * Publish a palette to the document.
 *
 * Written as bare `r g b` channels, which is the form Tailwind's opacity
 * modifiers need: `bg-surface-control/60` becomes `rgb(var(--app-control) / 0.6)`
 * and a `#rrggbb` in there would not parse.
 */
export function applyAppColors(colors) {
    const palette = sanitizeAppColors(colors);
    const root = document.documentElement;

    for (const field of APP_COLOR_FIELDS) {
        root.style.setProperty(CSS_VARIABLES[field.key], hexToRgb(palette[field.key]).join(' '));
    }
}

/** Hand the app back its own colours, the ones `:root` states in input.css. */
export function clearAppColors() {
    const root = document.documentElement;
    for (const field of APP_COLOR_FIELDS) {
        root.style.removeProperty(CSS_VARIABLES[field.key]);
    }
}

/** What one of these colours currently resolves to, custom palette or not. */
export function currentAppColor(key) {
    const variable = CSS_VARIABLES[key];
    if (!variable) return DEFAULT_APP_COLORS.base;

    const channels = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return channels ? `rgb(${channels})` : DEFAULT_APP_COLORS[key];
}
