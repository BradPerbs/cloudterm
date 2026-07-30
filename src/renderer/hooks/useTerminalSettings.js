import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * How the terminal is typeset: the face, its size and weight, the space around
 * it, and the cursor drawn in it.
 *
 * One record rather than a setting apiece, because these are read together:
 * every one of them changes the cell geometry, so a change to any of them has
 * to refit the terminal and tell the remote its new window size. Keeping them
 * in one object means one effect does that, once, however many moved.
 *
 * Colours are not here: a theme is a palette and is chosen from a gallery, which
 * is a different enough job to be worth its own hook (see useTerminalTheme).
 */

const STORAGE_KEY = 'terminal.appearance';

/** What the old three-preset setting meant, so an existing choice survives. */
const LEGACY_SIZES = { small: 12, medium: 14, large: 18 };

/**
 * Faces offered, in the order they are shown.
 *
 * Only JetBrains Mono ships with the app. The rest are offered when the machine
 * already has them, checked at startup rather than assumed: a list that offers
 * Cascadia Code on a machine without it produces a terminal in Consolas and no
 * explanation. `ligatures` marks the faces where the toggle does anything.
 */
export const TERMINAL_FONTS = [
    { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono', bundled: true, ligatures: true },
    { id: 'cascadia-code', label: 'Cascadia Code', family: 'Cascadia Code', ligatures: true },
    { id: 'cascadia-mono', label: 'Cascadia Mono', family: 'Cascadia Mono' },
    { id: 'fira-code', label: 'Fira Code', family: 'Fira Code', ligatures: true },
    { id: 'jetbrains-mono-nl', label: 'JetBrains Mono NL', family: 'JetBrains Mono NL' },
    { id: 'source-code-pro', label: 'Source Code Pro', family: 'Source Code Pro' },
    { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: 'IBM Plex Mono' },
    { id: 'consolas', label: 'Consolas', family: 'Consolas' },
    { id: 'lucida-console', label: 'Lucida Console', family: 'Lucida Console' },
    { id: 'courier-new', label: 'Courier New', family: 'Courier New' },
    { id: 'system', label: 'System monospace', family: '', system: true },
];

const FONTS_BY_ID = Object.fromEntries(TERMINAL_FONTS.map(font => [font.id, font]));

/**
 * The fallbacks every choice ends with, so a face that has been uninstalled
 * since it was chosen degrades to something monospaced rather than to the
 * proportional default, which would not just look wrong: it would break the
 * column arithmetic the whole terminal depends on.
 */
const FALLBACKS = '"JetBrains Mono", Consolas, "Courier New", monospace';

/** The CSS font stack for a saved choice. */
export function resolveFontFamily(fontId) {
    const font = FONTS_BY_ID[fontId];
    if (!font || font.system) return FALLBACKS;
    return `"${font.family}", ${FALLBACKS}`;
}

/** The stack the app's own chrome uses when it shows a sample of terminal text. */
export const TERMINAL_FONT_FAMILY = resolveFontFamily('jetbrains-mono');

export const DEFAULT_TERMINAL_SETTINGS = {
    fontFamily: 'jetbrains-mono',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    ligatures: false,
    cursorStyle: 'bar',
    cursorBlink: true,
    scrollback: 10000,
};

/**
 * Bounds, and the reason for each.
 *
 * Every one of these is a number a person can type, so none of them may be a
 * number that breaks the terminal: a font size of 0 measures a cell as zero
 * pixels wide and the column count goes to infinity.
 */
export const LIMITS = {
    fontSize: { min: 8, max: 32, step: 1 },
    // Only the weights JetBrains Mono actually ships with (see main.jsx). A
    // weight with no face behind it is synthesised, and a synthesised weight on
    // a monospaced font measures differently from the real one, which puts the
    // column count out.
    fontWeight: { min: 300, max: 700, step: 100 },
    lineHeight: { min: 1, max: 2, step: 0.05 },
    letterSpacing: { min: -2, max: 4, step: 0.5 },
    // 200k lines of an 80-column buffer is on the order of 100 MB per session,
    // which is the point past which the tab is the problem rather than the fix.
    scrollback: { min: 500, max: 200000, step: 500 },
};

export const CURSOR_STYLES = [
    { id: 'bar', label: 'Bar' },
    { id: 'block', label: 'Block' },
    { id: 'underline', label: 'Underline' },
];

const clamp = (value, { min, max }, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
};

/** Rounded to the nearest step, so a stored value is always one the UI can show. */
const quantize = (value, { step }) => Math.round(value / step) * step;

export function sanitizeTerminalSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = { ...DEFAULT_TERMINAL_SETTINGS };

    if (FONTS_BY_ID[source.fontFamily]) next.fontFamily = source.fontFamily;

    next.fontSize = Math.round(clamp(source.fontSize, LIMITS.fontSize, next.fontSize));
    next.fontWeight = quantize(
        clamp(source.fontWeight, LIMITS.fontWeight, next.fontWeight),
        LIMITS.fontWeight
    );
    // Two decimals: a line height carrying floating-point noise would be
    // written back to storage differently every time it was read.
    next.lineHeight = Number(
        quantize(clamp(source.lineHeight, LIMITS.lineHeight, next.lineHeight), LIMITS.lineHeight)
            .toFixed(2)
    );
    next.letterSpacing = Number(
        quantize(clamp(source.letterSpacing, LIMITS.letterSpacing, next.letterSpacing), LIMITS.letterSpacing)
            .toFixed(1)
    );
    next.scrollback = Math.round(
        quantize(clamp(source.scrollback, LIMITS.scrollback, next.scrollback), LIMITS.scrollback)
    );

    if (typeof source.ligatures === 'boolean') next.ligatures = source.ligatures;
    if (CURSOR_STYLES.some(style => style.id === source.cursorStyle)) {
        next.cursorStyle = source.cursorStyle;
    }
    if (typeof source.cursorBlink === 'boolean') next.cursorBlink = source.cursorBlink;

    return next;
}

/**
 * Read what is on disk, taking the old font-size preset with it.
 *
 * The legacy key is left in place rather than deleted. It costs nothing, and it
 * means a user who downgrades finds the size they chose still set.
 */
function readSettings() {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
        // Hand-edited or truncated; the defaults are a fine answer.
    }

    if (stored) return sanitizeTerminalSettings(stored);

    const legacy = localStorage.getItem('terminalFontSize');
    return sanitizeTerminalSettings(
        legacy && LEGACY_SIZES[legacy] ? { fontSize: LEGACY_SIZES[legacy] } : null
    );
}

/**
 * Text whose width varies as much as possible between faces: repeated wide and
 * narrow glyphs, plus digits, so two different fonts are very unlikely to
 * measure the same.
 */
const PROBE_TEXT = 'mmmmmwwwwwiiiii0123';

/**
 * The two generics a missing family falls back to.
 *
 * Both are needed, not one. Consolas *is* the default monospace on Windows, so
 * measured against `monospace` it looks identical to the fallback and would be
 * reported missing; measured against `serif` it plainly is not. A face is taken
 * as present if it differs from either.
 */
const PROBE_BASELINES = ['serif', 'monospace'];

/**
 * Which of the offered faces this machine can actually render.
 *
 * By measurement, not by `document.fonts.check`: that method answers `true` for
 * every family name in Chromium, including ones that do not exist, so it cannot
 * tell an installed font from a fallback. Rendering the same string in
 * `"Name", serif` and in `serif` and comparing widths can: if the name resolved
 * to something, the width moves.
 *
 * Run after `fonts.ready`, since the bundled faces have to have loaded before
 * they can be measured, and until it answers every face is offered: showing one
 * that turns out to be missing is a smaller failure than hiding one that is there.
 */
function useAvailableFonts() {
    const [available, setAvailable] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const probe = () => {
            if (cancelled) return;

            const context = document.createElement('canvas').getContext('2d');
            if (!context) return; // No 2D context: offer everything.

            const width = (family) => {
                context.font = `32px ${family}`;
                return context.measureText(PROBE_TEXT).width;
            };

            const baselines = PROBE_BASELINES.map(generic => [generic, width(generic)]);
            const found = new Set();

            for (const font of TERMINAL_FONTS) {
                // Neither needs probing: one ships with the app, the other *is*
                // whatever the platform's monospace happens to be.
                if (font.system || font.bundled) {
                    found.add(font.id);
                    continue;
                }
                const differs = baselines.some(([generic, base]) =>
                    Math.abs(width(`"${font.family}", ${generic}`) - base) > 0.5);
                if (differs) found.add(font.id);
            }

            setAvailable(found);
        };

        Promise.resolve(document.fonts?.ready).then(probe).catch(probe);
        return () => { cancelled = true; };
    }, []);

    return available;
}

export function useTerminalSettings() {
    const [terminalSettings, setState] = useState(readSettings);
    const availableFonts = useAvailableFonts();

    const setTerminalSettings = useCallback((patch) => {
        setState((previous) => {
            const next = sanitizeTerminalSettings({
                ...previous,
                ...(typeof patch === 'function' ? patch(previous) : patch),
            });
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Storage full or blocked; the setting still applies this run.
            }
            return next;
        });
    }, []);

    const resetTerminalSettings = useCallback(() => {
        setState(DEFAULT_TERMINAL_SETTINGS);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_TERMINAL_SETTINGS));
        } catch {
            // As above.
        }
    }, []);

    /**
     * The faces to offer. Until the probe has answered, all of them; after, the
     * ones that are there plus whichever one is currently chosen; a face that
     * has since been uninstalled stays visible so the setting explains itself
     * rather than appearing to have reset on its own.
     */
    const fonts = useMemo(() => {
        if (!availableFonts) return TERMINAL_FONTS.map(font => ({ ...font, available: true }));
        return TERMINAL_FONTS
            .filter(font => availableFonts.has(font.id) || font.id === terminalSettings.fontFamily)
            .map(font => ({ ...font, available: availableFonts.has(font.id) }));
    }, [availableFonts, terminalSettings.fontFamily]);

    return {
        terminalSettings,
        setTerminalSettings,
        resetTerminalSettings,
        fonts,
    };
}
