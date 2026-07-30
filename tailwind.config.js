/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{html,js,jsx}"],
    darkMode: 'class',
    safelist: [
        'bg-green-50', 'dark:bg-green-900/20', 'text-green-500',
        'bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-500',
        'bg-violet-50', 'dark:bg-violet-900/20', 'text-violet-500',
        'bg-orange-50', 'dark:bg-orange-900/20', 'text-orange-500',
        'rounded-l-lg', 'rounded-r-lg', 'rounded-lg',
    ],
    theme: {
        extend: {
            // The app's text face. Preflight reads `fontFamily.sans` for the
            // `html` rule, so naming it here re-fonts the whole shell and the
            // `font-sans` utility at once, rather than leaving the two to
            // disagree.
            //
            // "Twemoji Country Flags" leads the stack and carries nothing but
            // regional-indicator pairs: Segoe UI Emoji has no flag glyphs at
            // all, so on Windows a flag emoji otherwise renders as the two
            // letters of its country code. Everything else falls straight
            // through to Inter.
            fontFamily: {
                sans: [
                    'Twemoji Country Flags',
                    'Inter',
                    'ui-sans-serif',
                    'system-ui',
                    'sans-serif',
                    '"Apple Color Emoji"',
                    '"Segoe UI Emoji"',
                    'Segoe UI Symbol',
                    '"Noto Color Emoji"',
                ],
            },
            colors: {
                // One elevation ramp for dark mode. Every surface sits on it,
                // so saturation tracks lightness instead of drifting grey the
                // way translucent white overlays do.
                //   base #111219  raised #1a1b26  control #24253a
                //   hover #2e3049 active #3b3d5c  muted text #565982
                //
                // Stated as variables rather than hexes so the ramp can be
                // retinted at runtime: the app's colour settings rewrite the six
                // values in `:root` (see src/renderer/lib/app-colors.js) and
                // every utility below follows without changing a class. The
                // `<alpha-value>` form is what keeps `bg-surface-control/60`
                // and friends working.
                surface: {
                    base: 'rgb(var(--app-base) / <alpha-value>)',
                    raised: 'rgb(var(--app-raised) / <alpha-value>)',
                    control: 'rgb(var(--app-control) / <alpha-value>)',
                    hover: 'rgb(var(--app-hover) / <alpha-value>)',
                    active: 'rgb(var(--app-active) / <alpha-value>)',
                },
                dark: {
                    900: 'rgb(var(--app-base) / <alpha-value>)',
                    800: 'rgb(var(--app-raised) / <alpha-value>)',
                    700: 'rgb(var(--app-control) / <alpha-value>)',
                },
                // The same ramp under the names the app reached for before it
                // had one. Kept in step with `surface` above, deliberately:
                // these are the same five surfaces, not a second palette.
                neutral: {
                    500: 'rgb(var(--app-muted) / <alpha-value>)',
                    600: 'rgb(var(--app-hover) / <alpha-value>)',
                    700: 'rgb(var(--app-active) / <alpha-value>)',
                    800: 'rgb(var(--app-control) / <alpha-value>)',
                    900: 'rgb(var(--app-raised) / <alpha-value>)',
                },
            }
        },
    },
    plugins: [],
}
