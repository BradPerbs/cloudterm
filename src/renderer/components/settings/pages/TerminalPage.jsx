import { useState } from 'react';
import toast from 'react-hot-toast';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow, { DIVIDED } from '../ui/SettingRow';
import Slider from '../ui/Slider';
import Toggle from '../ui/Toggle';
import SegmentedControl from '../../ui/SegmentedControl';
import CustomThemeDialog from '../CustomThemeDialog';
import {
    CUSTOM_THEME_ID,
    TERMINAL_THEMES,
    TERMINAL_THEME_PRESETS,
    sanitizeCustomTheme,
} from '../../../hooks/useTerminalTheme';
import {
    CURSOR_STYLES,
    DEFAULT_TERMINAL_SETTINGS,
    LIMITS,
    LINK_ACTIVATIONS,
    resolveFontFamily,
} from '../../../hooks/useTerminalSettings';
import { MODIFIER_KEY } from '../../../lib/platform';
import { toastOptions } from '../../../lib/toast';

const TERMINAL_THEME_OPTIONS = TERMINAL_THEME_PRESETS.map(option => ({
    ...option,
    ...TERMINAL_THEMES[option.id],
}));

// Themes light enough to vanish against the card need an outline of their own.
const LIGHT_THEMES = new Set(['light', 'github-light', 'solarized-light', 'gruvbox-light']);

/** The fake terminal on each tile: three lines of text over the background. */
function ThemeSwatch({ background, foreground, bordered, children }) {
    return (
        <div
            className={`w-full h-14 rounded-lg border overflow-hidden ${bordered ? 'border-gray-200' : 'border-transparent'}`}
            style={{ backgroundColor: background }}
        >
            <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{ height: '6px', width: '32px', borderRadius: '2px', backgroundColor: foreground }} />
                    <div style={{ height: '6px', width: '16px', borderRadius: '2px', backgroundColor: foreground }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{ height: '6px', width: '20px', borderRadius: '2px', backgroundColor: foreground }} />
                    <div style={{ height: '6px', width: '24px', borderRadius: '2px', backgroundColor: foreground }} />
                </div>
                {children || (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ height: '6px', width: '40px', borderRadius: '2px', backgroundColor: foreground }} />
                    </div>
                )}
            </div>
        </div>
    );
}

const TILE_BASE = 'terminal-theme-option group flex flex-col items-center gap-2 p-2 rounded-xl border transition-all cursor-pointer';

const tileClass = (selected) => `${TILE_BASE} ${selected
    ? 'border-gray-900 dark:border-white ring-1 ring-gray-900 dark:ring-white'
    : 'border-gray-200 dark:border-neutral-700 hover:border-gray-300 dark:hover:border-neutral-600'}`;

const labelClass = (selected) => `text-xs text-center leading-tight ${selected
    ? 'font-bold text-gray-900 dark:text-white'
    : 'font-medium text-gray-600 dark:text-gray-400'}`;

/**
 * What the sample renders, chosen so that every setting on this page shows up
 * in it: a ligature pair, a zero to tell apart from an O, and enough
 * punctuation for letter spacing to be visible.
 */
const SAMPLE = 'if (x != 0) => ~/.ssh/config';

export default function TerminalPage({
    terminalTheme,
    customTerminalTheme,
    terminalSettings = DEFAULT_TERMINAL_SETTINGS,
    terminalFonts = [],
    onTerminalThemeChange,
    onCustomTerminalThemeChange,
    onTerminalSettingsChange,
    onTerminalSettingsReset,
}) {
    const [editorOpen, setEditorOpen] = useState(false);

    const customColors = sanitizeCustomTheme(customTerminalTheme);
    const customSelected = terminalTheme === CUSTOM_THEME_ID;

    // The sample is drawn on the scheme the terminal is actually using, so the
    // weight and spacing are judged against the background they will sit on.
    const themeColors = customSelected
        ? customColors
        : (TERMINAL_THEMES[terminalTheme] || TERMINAL_THEMES.dark || {});

    const chosenFont = terminalFonts.find(font => font.id === terminalSettings.fontFamily);
    const set = (patch) => onTerminalSettingsChange?.(patch);

    const isDefault = Object.keys(DEFAULT_TERMINAL_SETTINGS)
        .every(key => terminalSettings[key] === DEFAULT_TERMINAL_SETTINGS[key]);

    const applyCustomTheme = (colors) => {
        onCustomTerminalThemeChange(colors);
        setEditorOpen(false);
        if (!customSelected) onTerminalThemeChange(CUSTOM_THEME_ID);
        toast.success('Custom terminal theme applied', toastOptions());
    };

    return (
        <SettingsPage
            title="Terminal"
            description="How the shell looks inside a session, and what is kept of it."
        >
            {/* ---------------- Type ---------------- */}
            <SettingCard>
                <SettingRow
                    title="Font"
                    description={chosenFont?.available === false
                        ? 'This font is no longer installed on this machine, so the terminal has fallen back to JetBrains Mono.'
                        : 'Only faces this machine actually has are listed. JetBrains Mono ships with the app.'}
                >
                    {/* The sample sits above the picker rather than beside it:
                        every control in this card changes how this line renders,
                        so it wants the full width and a fixed place on the page. */}
                    <div className="flex flex-col gap-3">
                        <div
                            className="rounded-xl px-4 py-3 overflow-x-auto border border-gray-200 dark:border-neutral-700"
                            style={{ backgroundColor: themeColors.background }}
                        >
                            <div
                                style={{
                                    color: themeColors.foreground,
                                    fontFamily: resolveFontFamily(terminalSettings.fontFamily),
                                    fontSize: `${terminalSettings.fontSize}px`,
                                    fontWeight: terminalSettings.fontWeight,
                                    lineHeight: terminalSettings.lineHeight,
                                    letterSpacing: `${terminalSettings.letterSpacing}px`,
                                    fontVariantLigatures: terminalSettings.ligatures ? 'contextual common-ligatures' : 'none',
                                    fontFeatureSettings: terminalSettings.ligatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0',
                                    whiteSpace: 'pre',
                                }}
                            >
                                {SAMPLE}
                            </div>
                        </div>

                        <select
                            id="terminal-font-family"
                            aria-label="Terminal font"
                            className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-neutral-800
                                border border-gray-300 dark:border-neutral-700
                                text-gray-900 dark:text-gray-100 outline-none
                                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
                            value={terminalSettings.fontFamily}
                            onChange={(event) => set({ fontFamily: event.target.value })}
                        >
                            {terminalFonts.map(font => (
                                <option key={font.id} value={font.id}>
                                    {font.label}
                                    {font.bundled ? ' (bundled)' : ''}
                                    {font.available === false ? ' (not installed)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Size"
                    description="Applies to every open session. Each one refits and tells the remote its new window size."
                    control={
                        <Slider
                            id="terminal-font-size"
                            ariaLabel="Font size"
                            value={terminalSettings.fontSize}
                            {...LIMITS.fontSize}
                            onChange={(fontSize) => set({ fontSize })}
                            format={(value) => `${value} px`}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Weight"
                    description="Bold keeps its contrast: it is drawn 300 heavier than whatever is set here."
                    control={
                        <Slider
                            ariaLabel="Font weight"
                            value={terminalSettings.fontWeight}
                            {...LIMITS.fontWeight}
                            onChange={(fontWeight) => set({ fontWeight })}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Line height"
                    description="A multiple of the font size. Taller lines cost rows, which the remote is told about."
                    control={
                        <Slider
                            ariaLabel="Line height"
                            value={terminalSettings.lineHeight}
                            {...LIMITS.lineHeight}
                            onChange={(lineHeight) => set({ lineHeight })}
                            format={(value) => value.toFixed(2)}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Letter spacing"
                    description="Added to every cell. Negative tightens a face that sets too loose for a terminal."
                    control={
                        <Slider
                            ariaLabel="Letter spacing"
                            value={terminalSettings.letterSpacing}
                            {...LIMITS.letterSpacing}
                            onChange={(letterSpacing) => set({ letterSpacing })}
                            format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Ligatures"
                    description={chosenFont?.ligatures
                        ? 'Draws pairs like -> and != as one glyph. Turns off GPU rendering, which cannot draw them, so a very busy session may scroll less smoothly.'
                        : `${chosenFont?.label || 'This font'} has no ligatures, so this will not change anything. JetBrains Mono, Cascadia Code and Fira Code have them.`}
                    control={
                        <Toggle
                            checked={terminalSettings.ligatures}
                            onChange={(ligatures) => set({ ligatures })}
                            ariaLabel="Ligatures"
                        />
                    }
                />
            </SettingCard>

            {/* ---------------- Cursor, buffer and links ---------------- */}
            <SettingCard>
                <SettingRow
                    align="center"
                    title="Cursor"
                    description="What the caret looks like where the shell is waiting."
                    control={
                        <SegmentedControl
                            ariaLabel="Cursor style"
                            value={terminalSettings.cursorStyle}
                            onChange={(cursorStyle) => set({ cursorStyle })}
                            segments={CURSOR_STYLES.map(style => ({ value: style.id, label: style.label }))}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Blink the cursor"
                    control={
                        <Toggle
                            checked={terminalSettings.cursorBlink}
                            onChange={(cursorBlink) => set({ cursorBlink })}
                            ariaLabel="Blink the cursor"
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Scrollback"
                    description="Lines kept above the top of the window, per session. Find-in-scrollback searches all of
                        them, and every line costs memory in this window rather than on the server."
                    control={
                        <Slider
                            ariaLabel="Scrollback lines"
                            value={terminalSettings.scrollback}
                            {...LIMITS.scrollback}
                            onChange={(scrollback) => set({ scrollback })}
                            format={(value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value))}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Opening links"
                    description={`A URL printed in the session is clickable and opens in your browser.
                        Asking for ${MODIFIER_KEY} as well is what editors do: it stops a click meant for the
                        text under a URL from throwing a browser at the screen mid-session.`}
                    control={
                        <SegmentedControl
                            ariaLabel="Opening links"
                            value={terminalSettings.linkActivation}
                            onChange={(linkActivation) => set({ linkActivation })}
                            segments={LINK_ACTIVATIONS.map(mode => ({ value: mode.id, label: mode.label }))}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Back to the defaults"
                    description={isDefault
                        ? 'Everything above is already at its default.'
                        : 'Resets the font, spacing, cursor, scrollback and link clicking. Leaves the colour scheme alone.'}
                    control={
                        <button
                            className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300
                                dark:border-neutral-700 text-gray-700 dark:text-gray-300 transition-all
                                active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800
                                disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={isDefault}
                            onClick={() => {
                                onTerminalSettingsReset?.();
                                toast.success('Terminal type reset', toastOptions());
                            }}
                        >
                            Reset
                        </button>
                    }
                />
            </SettingCard>

            {/* ---------------- Colour ---------------- */}
            <SettingCard>
                <SettingRow
                    title="Terminal Colors"
                    description="Choose a color scheme for your terminal, or build your own"
                >
                    {/* Reflows on the column's own width rather than a fixed
                        count: at the 900px minimum window the content pane is
                        narrow enough that four fixed columns collide. The list
                        scrolls so the settings below it stay in reach. */}
                    <div
                        className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(104px,1fr))]
                            max-h-[26rem] overflow-y-auto pr-1 -mr-1"
                        id="terminal-theme-selector"
                    >
                        {TERMINAL_THEME_OPTIONS.map((option) => (
                            <button
                                key={option.id}
                                className={tileClass(terminalTheme === option.id)}
                                data-terminal-theme={option.id}
                                onClick={() => {
                                    onTerminalThemeChange(option.id);
                                    toast.success(`Terminal theme changed to ${option.label}`, toastOptions());
                                }}
                            >
                                <ThemeSwatch
                                    background={option.background}
                                    foreground={option.foreground}
                                    bordered={LIGHT_THEMES.has(option.id)}
                                />
                                <span className={labelClass(terminalTheme === option.id)}>
                                    {option.label}
                                </span>
                            </button>
                        ))}

                        {/* The user's own palette, shown with its ANSI colours so
                            it is recognisable rather than just "Custom". */}
                        <button
                            className={tileClass(customSelected)}
                            data-terminal-theme={CUSTOM_THEME_ID}
                            onClick={() => {
                                onTerminalThemeChange(CUSTOM_THEME_ID);
                                toast.success('Terminal theme changed to Custom', toastOptions());
                            }}
                        >
                            <ThemeSwatch
                                background={customColors.background}
                                foreground={customColors.foreground}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    {['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'].map(key => (
                                        <div
                                            key={key}
                                            style={{
                                                height: '6px',
                                                width: '6px',
                                                borderRadius: '999px',
                                                backgroundColor: customColors[key],
                                            }}
                                        />
                                    ))}
                                </div>
                            </ThemeSwatch>
                            <span className={labelClass(customSelected)}>Custom</span>
                        </button>
                    </div>
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    title="Custom Theme"
                    description="Set your own background, text, cursor and ANSI colors"
                    align="center"
                    control={
                        <button
                            className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300
                                dark:border-neutral-700 text-gray-700 dark:text-gray-300 transition-all
                                active:scale-95 hover:bg-gray-50 dark:hover:bg-neutral-800"
                            onClick={() => setEditorOpen(true)}
                        >
                            Edit colors
                        </button>
                    }
                />
            </SettingCard>

            {editorOpen && (
                <CustomThemeDialog
                    colors={customColors}
                    onSave={applyCustomTheme}
                    onClose={() => setEditorOpen(false)}
                />
            )}
        </SettingsPage>
    );
}
