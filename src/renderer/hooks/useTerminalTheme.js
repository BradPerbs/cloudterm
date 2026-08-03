import { useState, useCallback } from 'react';

/** The one theme whose colours the user picks instead of us. */
export const CUSTOM_THEME_ID = 'custom';

/** What a terminal is drawn in until someone picks something else. Tokyo Night,
 *  the same palette the app's own chrome is tinted with (see lib/app-colors.js),
 *  so a fresh install is one colour scheme rather than two. */
export const DEFAULT_THEME_ID = 'tokyo-night';

export const TERMINAL_THEMES = {
    'default': {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
    },
    'monokai': {
        background: '#272822',
        foreground: '#f8f8f2',
        cursor: '#f8f8f0',
        selectionBackground: 'rgba(73, 72, 62, 0.5)',
        black: '#272822',
        red: '#f92672',
        green: '#a6e22e',
        yellow: '#f4bf75',
        blue: '#66d9ef',
        magenta: '#ae81ff',
        cyan: '#a1efe4',
        white: '#f8f8f2',
    },
    'dracula': {
        background: '#282a36',
        foreground: '#f8f8f2',
        cursor: '#f8f8f2',
        selectionBackground: 'rgba(68, 71, 90, 0.5)',
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
    },
    'nord': {
        background: '#2e3440',
        foreground: '#d8dee9',
        cursor: '#d8dee9',
        selectionBackground: 'rgba(67, 76, 94, 0.5)',
        black: '#3b4252',
        red: '#bf616a',
        green: '#a3be8c',
        yellow: '#ebcb8b',
        blue: '#81a1c1',
        magenta: '#b48ead',
        cyan: '#88c0d0',
        white: '#e5e9f0',
    },
    'solarized': {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#839496',
        selectionBackground: 'rgba(7, 54, 66, 0.5)',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
    },
    'gruvbox': {
        background: '#282828',
        foreground: '#ebdbb2',
        cursor: '#ebdbb2',
        selectionBackground: 'rgba(60, 56, 54, 0.5)',
        black: '#282828',
        red: '#cc241d',
        green: '#98971a',
        yellow: '#d79921',
        blue: '#458588',
        magenta: '#b16286',
        cyan: '#689d6a',
        white: '#a89984',
    },
    'tokyo-night': {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: 'rgba(40, 52, 98, 0.5)',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#c0caf5',
    },
    'light': {
        background: '#ffffff',
        foreground: '#1f2937',
        cursor: '#1f2937',
        selectionBackground: 'rgba(59, 130, 246, 0.2)',
        black: '#000000',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#ca8a04',
        blue: '#2563eb',
        magenta: '#9333ea',
        cyan: '#0891b2',
        white: '#f3f4f6',
    },
    'cyberpunk': {
        background: '#0a0a0f',
        foreground: '#00ff9f',
        cursor: '#ff00ff',
        selectionBackground: 'rgba(255, 0, 255, 0.3)',
        black: '#000000',
        red: '#ff003c',
        green: '#00ff9f',
        yellow: '#fffc00',
        blue: '#00d4ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
    },
    'synthwave': {
        background: '#2b213a',
        foreground: '#ff7edb',
        cursor: '#ff7edb',
        selectionBackground: 'rgba(249, 38, 114, 0.3)',
        black: '#1a1a2e',
        red: '#fe4450',
        green: '#72f1b8',
        yellow: '#fede5d',
        blue: '#36f9f6',
        magenta: '#ff7edb',
        cyan: '#03edf9',
        white: '#ffffff',
    },
    'catppuccin': {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: 'rgba(88, 91, 112, 0.5)',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
    },
    'ocean': {
        background: '#0d1b2a',
        foreground: '#e0e1dd',
        cursor: '#00b4d8',
        selectionBackground: 'rgba(0, 180, 216, 0.3)',
        black: '#1b263b',
        red: '#e63946',
        green: '#2a9d8f',
        yellow: '#e9c46a',
        blue: '#00b4d8',
        magenta: '#9d4edd',
        cyan: '#48cae4',
        white: '#caf0f8',
    },
    'sunset': {
        background: '#1a1423',
        foreground: '#ffd6a5',
        cursor: '#ff6b6b',
        selectionBackground: 'rgba(255, 107, 107, 0.3)',
        black: '#2d1f3d',
        red: '#ff6b6b',
        green: '#6bcb77',
        yellow: '#ffd93d',
        blue: '#4d96ff',
        magenta: '#c9b1ff',
        cyan: '#6ee7b7',
        white: '#ffe8d6',
    },
    'matrix': {
        background: '#0d0d0d',
        foreground: '#00ff41',
        cursor: '#00ff41',
        selectionBackground: 'rgba(0, 255, 65, 0.2)',
        black: '#000000',
        red: '#ff0000',
        green: '#00ff41',
        yellow: '#ccff00',
        blue: '#00ff41',
        magenta: '#00ff41',
        cyan: '#00ff41',
        white: '#00ff41',
    },
    'rose-pine': {
        background: '#191724',
        foreground: '#e0def4',
        cursor: '#524f67',
        selectionBackground: 'rgba(111, 107, 143, 0.4)',
        black: '#26233a',
        red: '#eb6f92',
        green: '#31748f',
        yellow: '#f6c177',
        blue: '#9ccfd8',
        magenta: '#c4a7e7',
        cyan: '#ebbcba',
        white: '#e0def4',
    },
    'ayu-dark': {
        background: '#0b0e14',
        foreground: '#bfbdb6',
        cursor: '#e6b450',
        selectionBackground: 'rgba(39, 82, 107, 0.5)',
        black: '#01060e',
        red: '#ea6c73',
        green: '#91b362',
        yellow: '#f9af4f',
        blue: '#53bdfa',
        magenta: '#fae994',
        cyan: '#90e1c6',
        white: '#c7c7c7',
    },
    'one-dark': {
        background: '#282c34',
        foreground: '#abb2bf',
        cursor: '#528bff',
        selectionBackground: 'rgba(62, 68, 81, 0.5)',
        black: '#5c6370',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
    },
    'night-owl': {
        background: '#011627',
        foreground: '#d6deeb',
        cursor: '#80a4c2',
        selectionBackground: 'rgba(29, 59, 83, 0.9)',
        black: '#011627',
        red: '#ef5350',
        green: '#22da6e',
        yellow: '#addb67',
        blue: '#82aaff',
        magenta: '#c792ea',
        cyan: '#21c7a8',
        white: '#ffffff',
    },
    'palenight': {
        background: '#292d3e',
        foreground: '#a6accd',
        cursor: '#ffcc00',
        selectionBackground: 'rgba(113, 124, 180, 0.3)',
        black: '#292d3e',
        red: '#f07178',
        green: '#c3e88d',
        yellow: '#ffcb6b',
        blue: '#82aaff',
        magenta: '#c792ea',
        cyan: '#89ddff',
        white: '#d0d0d0',
    },
    'aurora': {
        background: '#07090f',
        foreground: '#eceff4',
        cursor: '#88c0d0',
        selectionBackground: 'rgba(136, 192, 208, 0.3)',
        black: '#3b4252',
        red: '#bf616a',
        green: '#a3be8c',
        yellow: '#ebcb8b',
        blue: '#5e81ac',
        magenta: '#b48ead',
        cyan: '#8fbcbb',
        white: '#eceff4',
    },
    'github-dark': {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(56, 139, 253, 0.4)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
    },
    'github-light': {
        background: '#ffffff',
        foreground: '#24292f',
        cursor: '#0969da',
        selectionBackground: 'rgba(84, 174, 255, 0.25)',
        black: '#24292f',
        red: '#cf222e',
        green: '#1a7f37',
        yellow: '#9a6700',
        blue: '#0969da',
        magenta: '#8250df',
        cyan: '#1b7c83',
        white: '#6e7781',
    },
    'everforest': {
        background: '#2d353b',
        foreground: '#d3c6aa',
        cursor: '#d3c6aa',
        selectionBackground: 'rgba(71, 82, 88, 0.7)',
        black: '#475258',
        red: '#e67e80',
        green: '#a7c080',
        yellow: '#dbbc7f',
        blue: '#7fbbb3',
        magenta: '#d699b6',
        cyan: '#83c092',
        white: '#d3c6aa',
    },
    'kanagawa': {
        background: '#1f1f28',
        foreground: '#dcd7ba',
        cursor: '#c8c093',
        selectionBackground: 'rgba(54, 54, 70, 0.7)',
        black: '#16161d',
        red: '#c34043',
        green: '#76946a',
        yellow: '#c0a36e',
        blue: '#7e9cd8',
        magenta: '#957fb8',
        cyan: '#6a9589',
        white: '#c8c093',
    },
    'material-ocean': {
        background: '#0f111a',
        foreground: '#8f93a2',
        cursor: '#ffcc00',
        selectionBackground: 'rgba(113, 124, 180, 0.3)',
        black: '#546e7a',
        red: '#ff5370',
        green: '#c3e88d',
        yellow: '#ffcb6b',
        blue: '#82aaff',
        magenta: '#c792ea',
        cyan: '#89ddff',
        white: '#eeffff',
    },
    'oceanic-next': {
        background: '#1b2b34',
        foreground: '#cdd3de',
        cursor: '#c0c5ce',
        selectionBackground: 'rgba(52, 61, 70, 0.7)',
        black: '#343d46',
        red: '#ec5f67',
        green: '#99c794',
        yellow: '#fac863',
        blue: '#6699cc',
        magenta: '#c594c5',
        cyan: '#5fb3b3',
        white: '#d8dee9',
    },
    'horizon': {
        background: '#1c1e26',
        foreground: '#d5d8da',
        cursor: '#e95678',
        selectionBackground: 'rgba(43, 46, 59, 0.8)',
        black: '#16161c',
        red: '#e95678',
        green: '#29d398',
        yellow: '#fab795',
        blue: '#26bbd9',
        magenta: '#ee64ac',
        cyan: '#59e1e3',
        white: '#d5d8da',
    },
    'solarized-light': {
        background: '#fdf6e3',
        foreground: '#657b83',
        cursor: '#586e75',
        selectionBackground: 'rgba(147, 161, 161, 0.3)',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#93a1a1',
    },
    'gruvbox-light': {
        background: '#fbf1c7',
        foreground: '#3c3836',
        cursor: '#3c3836',
        selectionBackground: 'rgba(189, 174, 147, 0.4)',
        black: '#3c3836',
        red: '#9d0006',
        green: '#79740e',
        yellow: '#b57614',
        blue: '#076678',
        magenta: '#8f3f71',
        cyan: '#427b58',
        white: '#7c6f64',
    },
    'tomorrow-night': {
        background: '#1d1f21',
        foreground: '#c5c8c6',
        cursor: '#c5c8c6',
        selectionBackground: 'rgba(55, 59, 65, 0.7)',
        black: '#1d1f21',
        red: '#cc6666',
        green: '#b5bd68',
        yellow: '#f0c674',
        blue: '#81a2be',
        magenta: '#b294bb',
        cyan: '#8abeb7',
        white: '#c5c8c6',
    },
    'monokai-pro': {
        background: '#2d2a2e',
        foreground: '#fcfcfa',
        cursor: '#fcfcfa',
        selectionBackground: 'rgba(64, 62, 65, 0.8)',
        black: '#403e41',
        red: '#ff6188',
        green: '#a9dc76',
        yellow: '#ffd866',
        blue: '#fc9867',
        magenta: '#ab9df2',
        cyan: '#78dce8',
        white: '#fcfcfa',
    },
    'andromeda': {
        background: '#23262e',
        foreground: '#d5ced9',
        cursor: '#f39c12',
        selectionBackground: 'rgba(60, 63, 74, 0.7)',
        black: '#2b2f38',
        red: '#ee5d43',
        green: '#96e072',
        yellow: '#ffe66d',
        blue: '#7cb7ff',
        magenta: '#c74ded',
        cyan: '#00e8c6',
        white: '#d5ced9',
    },
    'iceberg': {
        background: '#161821',
        foreground: '#c6c8d1',
        cursor: '#c6c8d1',
        selectionBackground: 'rgba(39, 44, 62, 0.8)',
        black: '#1e2132',
        red: '#e27878',
        green: '#b4be82',
        yellow: '#e2a478',
        blue: '#84a0c6',
        magenta: '#a093c7',
        cyan: '#89b8c2',
        white: '#c6c8d1',
    },
    'cobalt2': {
        background: '#193549',
        foreground: '#ffffff',
        cursor: '#ffc600',
        selectionBackground: 'rgba(28, 79, 110, 0.7)',
        black: '#0d3a58',
        red: '#ff628c',
        green: '#3ad900',
        yellow: '#ffc600',
        blue: '#0088ff',
        magenta: '#fb94ff',
        cyan: '#80fcff',
        white: '#ffffff',
    },
    'zenburn': {
        background: '#3f3f3f',
        foreground: '#dcdccc',
        cursor: '#dcdccc',
        selectionBackground: 'rgba(90, 90, 90, 0.7)',
        black: '#4d4d4d',
        red: '#cc9393',
        green: '#7f9f7f',
        yellow: '#f0dfaf',
        blue: '#8cd0d3',
        magenta: '#dc8cc3',
        cyan: '#93e0e3',
        white: '#dcdccc',
    },
    'moonlight': {
        background: '#212337',
        foreground: '#c8d3f5',
        cursor: '#c8d3f5',
        selectionBackground: 'rgba(63, 68, 96, 0.7)',
        black: '#444a73',
        red: '#ff757f',
        green: '#c3e88d',
        yellow: '#ffc777',
        blue: '#82aaff',
        magenta: '#c099ff',
        cyan: '#86e1fc',
        white: '#c8d3f5',
    },
};

/**
 * Display order and names for the built-ins. Kept next to the palettes so the
 * picker grid and the custom editor's "start from" list cannot drift apart.
 */
export const TERMINAL_THEME_PRESETS = [
    { id: 'tokyo-night', label: 'Tokyo Night' },
    // Stored as `default` since before it was one, and still the id in anyone's
    // settings who picked it. The name is what it has always been made of.
    { id: 'default', label: 'VS Code Dark' },
    { id: 'monokai', label: 'Monokai' },
    { id: 'monokai-pro', label: 'Monokai Pro' },
    { id: 'dracula', label: 'Dracula' },
    { id: 'nord', label: 'Nord' },
    { id: 'aurora', label: 'Aurora' },
    { id: 'solarized', label: 'Solarized' },
    { id: 'solarized-light', label: 'Solarized Light' },
    { id: 'gruvbox', label: 'Gruvbox' },
    { id: 'gruvbox-light', label: 'Gruvbox Light' },
    { id: 'everforest', label: 'Everforest' },
    { id: 'kanagawa', label: 'Kanagawa' },
    { id: 'moonlight', label: 'Moonlight' },
    { id: 'night-owl', label: 'Night Owl' },
    { id: 'palenight', label: 'Palenight' },
    { id: 'material-ocean', label: 'Material Ocean' },
    { id: 'oceanic-next', label: 'Oceanic Next' },
    { id: 'one-dark', label: 'One Dark' },
    { id: 'tomorrow-night', label: 'Tomorrow Night' },
    { id: 'github-dark', label: 'GitHub Dark' },
    { id: 'github-light', label: 'GitHub Light' },
    { id: 'ayu-dark', label: 'Ayu Dark' },
    { id: 'catppuccin', label: 'Catppuccin' },
    { id: 'rose-pine', label: 'Rosé Pine' },
    { id: 'iceberg', label: 'Iceberg' },
    { id: 'zenburn', label: 'Zenburn' },
    { id: 'cobalt2', label: 'Cobalt2' },
    { id: 'horizon', label: 'Horizon' },
    { id: 'andromeda', label: 'Andromeda' },
    { id: 'ocean', label: 'Ocean' },
    { id: 'sunset', label: 'Sunset' },
    { id: 'cyberpunk', label: 'Cyberpunk' },
    { id: 'synthwave', label: 'Synthwave' },
    { id: 'matrix', label: 'Matrix' },
    { id: 'light', label: 'Light' },
];

/**
 * The colours the custom theme is made of, in the order the editor lists them.
 * Everything here is plain `#rrggbb` so a single `<input type="color">` can edit
 * any of them; the translation into what xterm wants happens on the way out.
 */
export const TERMINAL_COLOR_FIELDS = [
    { key: 'background', label: 'Background', group: 'base' },
    { key: 'foreground', label: 'Text', group: 'base' },
    { key: 'cursor', label: 'Cursor', group: 'base' },
    { key: 'selectionBackground', label: 'Selection', group: 'base' },
    { key: 'black', label: 'Black', group: 'ansi' },
    { key: 'red', label: 'Red', group: 'ansi' },
    { key: 'green', label: 'Green', group: 'ansi' },
    { key: 'yellow', label: 'Yellow', group: 'ansi' },
    { key: 'blue', label: 'Blue', group: 'ansi' },
    { key: 'magenta', label: 'Magenta', group: 'ansi' },
    { key: 'cyan', label: 'Cyan', group: 'ansi' },
    { key: 'white', label: 'White', group: 'ansi' },
];

export const DEFAULT_CUSTOM_THEME = {
    background: '#101016',
    foreground: '#e6e6e6',
    cursor: '#7dd3fc',
    selectionBackground: '#7dd3fc',
    black: '#1c1c24',
    red: '#ff6b81',
    green: '#7bd88f',
    yellow: '#ffd866',
    blue: '#7dcfff',
    magenta: '#c792ea',
    cyan: '#5ad1c2',
    white: '#e6e6e6',
};

// Selection is picked as a solid colour but has to sit *behind* text, so it goes
// to xterm translucent, the same thing every built-in theme does by hand.
const SELECTION_ALPHA = 0.3;

const CUSTOM_STORAGE_KEY = 'terminalCustomTheme';
const THEME_STORAGE_KEY = 'terminalTheme';

/**
 * Coerce any CSS colour a theme might carry into `#rrggbb`, which is the only
 * form a colour input accepts. Needed because presets state their selection as
 * `rgba(...)` and copying one into the editor has to survive that.
 */
export function toHexColor(value, fallback = '#000000') {
    if (typeof value !== 'string') return fallback;

    const trimmed = value.trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
    if (hex) {
        const digits = hex[1];
        if (digits.length === 3) {
            return `#${digits.split('').map(digit => digit + digit).join('')}`.toLowerCase();
        }
        return `#${digits.slice(0, 6)}`.toLowerCase();
    }

    const rgb = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
    if (rgb) {
        const channels = rgb[1].split(',').slice(0, 3).map(part => Number(part.trim()));
        if (channels.length === 3 && channels.every(Number.isFinite)) {
            return `#${channels
                .map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
                .join('')}`;
        }
    }

    return fallback;
}

function hexToRgba(hex, alpha) {
    const value = toHexColor(hex, '#000000');
    const red = parseInt(value.slice(1, 3), 16);
    const green = parseInt(value.slice(3, 5), 16);
    const blue = parseInt(value.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Drop anything unrecognised and fill the gaps, so a hand-edited or half-written
 *  stored theme still produces a terminal you can read. */
export function sanitizeCustomTheme(colors) {
    const source = colors || {};
    return TERMINAL_COLOR_FIELDS.reduce((result, field) => {
        result[field.key] = toHexColor(source[field.key], DEFAULT_CUSTOM_THEME[field.key]);
        return result;
    }, {});
}

/** Seed the editor from a built-in theme, so "start from Dracula" is one click. */
export function themeToCustomColors(themeId) {
    return sanitizeCustomTheme(TERMINAL_THEMES[themeId] || DEFAULT_CUSTOM_THEME);
}

/** The theme object xterm is handed for whatever is currently selected. */
export function resolveTerminalTheme(themeId, customColors) {
    if (themeId !== CUSTOM_THEME_ID) {
        return TERMINAL_THEMES[themeId] || TERMINAL_THEMES[DEFAULT_THEME_ID];
    }

    const colors = sanitizeCustomTheme(customColors);
    return {
        ...colors,
        cursorAccent: colors.background,
        selectionBackground: hexToRgba(colors.selectionBackground, SELECTION_ALPHA),
    };
}

function readStoredTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === CUSTOM_THEME_ID || (saved && TERMINAL_THEMES[saved])) return saved;
    return DEFAULT_THEME_ID;
}

function readStoredCustomTheme() {
    try {
        const saved = localStorage.getItem(CUSTOM_STORAGE_KEY);
        return sanitizeCustomTheme(saved ? JSON.parse(saved) : null);
    } catch {
        return { ...DEFAULT_CUSTOM_THEME };
    }
}

export function useTerminalTheme() {
    const [terminalTheme, setTerminalThemeState] = useState(readStoredTheme);
    const [customTerminalTheme, setCustomTerminalThemeState] = useState(readStoredCustomTheme);

    const setTerminalTheme = useCallback((themeName) => {
        setTerminalThemeState(themeName);
        localStorage.setItem(THEME_STORAGE_KEY, themeName);
    }, []);

    const setCustomTerminalTheme = useCallback((colors) => {
        const next = sanitizeCustomTheme(colors);
        setCustomTerminalThemeState(next);
        localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(next));
        return next;
    }, []);

    const getThemeConfig = useCallback(() => {
        return resolveTerminalTheme(terminalTheme, customTerminalTheme);
    }, [terminalTheme, customTerminalTheme]);

    return {
        terminalTheme,
        setTerminalTheme,
        customTerminalTheme,
        setCustomTerminalTheme,
        getThemeConfig,
        TERMINAL_THEMES,
    };
}
