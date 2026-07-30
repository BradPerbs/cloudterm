import { useState, useLayoutEffect, useCallback } from 'react';
import {
    DEFAULT_APP_COLORS,
    applyAppColors,
    clearAppColors,
    sanitizeAppColors,
} from '../lib/app-colors';

/** The theme that is the user's own colours rather than one of ours. */
export const CUSTOM_THEME = 'custom';

const THEMES = new Set(['light', 'dark', 'system', CUSTOM_THEME]);

const THEME_KEY = 'theme';
const COLORS_KEY = 'appColors';
const LOGO_KEY = 'titleBarLogo';
const LOGO_IMAGE_KEY = 'titleBarLogoImage';
const LOGO_SIDE_KEY = 'titleBarLogoSide';

/** Which end of the title bar the mark sits at. */
export const LOGO_SIDES = ['left', 'right'];

/**
 * A stored logo, if it is still one we would draw.
 *
 * Checked rather than trusted: this is the one setting whose value is a URL the
 * renderer puts in an `<img>`, and it can arrive from another device through
 * the settings snapshot. Only the image data URLs main hands out are accepted,
 * so nothing else can be smuggled into that slot.
 */
const readLogoImage = () => {
    const saved = localStorage.getItem(LOGO_IMAGE_KEY);
    return typeof saved === 'string' && /^data:image\/[a-z.+-]+;base64,[A-Za-z0-9+/=]+$/.test(saved)
        ? saved
        : null;
};

const readTheme = () => {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.has(saved) ? saved : 'system';
};

const readColors = () => {
    try {
        const saved = localStorage.getItem(COLORS_KEY);
        return sanitizeAppColors(saved ? JSON.parse(saved) : null);
    } catch {
        return { ...DEFAULT_APP_COLORS };
    }
};

export function useTheme() {
    const [theme, setThemeState] = useState(readTheme);
    const [appColors, setAppColorsState] = useState(readColors);

    // The mark in the title bar: whether it is drawn, whose it is, and which
    // end it sits at. Owned here rather than by the settings page, because the
    // title bar is what has to be told about it.
    const [showLogo, setShowLogoState] = useState(() => localStorage.getItem(LOGO_KEY) !== 'false');
    const [logoImage, setLogoImageState] = useState(readLogoImage);
    const [logoSide, setLogoSideState] = useState(() => {
        const saved = localStorage.getItem(LOGO_SIDE_KEY);
        return LOGO_SIDES.includes(saved) ? saved : 'left';
    });

    const applyTheme = useCallback((themeName, colors) => {
        const root = document.documentElement;
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        // A custom palette is a retint of the dark ramp, so choosing one is also
        // choosing dark: the light surfaces are Tailwind's greys and would not
        // hear about it.
        root.classList.toggle(
            'dark',
            themeName === 'dark' || themeName === CUSTOM_THEME || (themeName === 'system' && prefersDark)
        );

        if (themeName === CUSTOM_THEME) applyAppColors(colors);
        else clearAppColors();
    }, []);

    const setTheme = useCallback((newTheme) => {
        setThemeState(newTheme);
        localStorage.setItem(THEME_KEY, newTheme);
    }, []);

    const setAppColors = useCallback((colors) => {
        const next = sanitizeAppColors(colors);
        setAppColorsState(next);
        localStorage.setItem(COLORS_KEY, JSON.stringify(next));
        return next;
    }, []);

    const setShowLogo = useCallback((next) => {
        setShowLogoState(next);
        localStorage.setItem(LOGO_KEY, String(next));
    }, []);

    /** A data URL from the picker, or null to go back to the app's own mark. */
    const setLogoImage = useCallback((dataUrl) => {
        if (dataUrl) {
            localStorage.setItem(LOGO_IMAGE_KEY, dataUrl);
        } else {
            localStorage.removeItem(LOGO_IMAGE_KEY);
        }
        // Read back rather than stored as given, so an image that would not
        // survive a reload does not display for the rest of this run either.
        setLogoImageState(readLogoImage());
    }, []);

    const setLogoSide = useCallback((next) => {
        const side = LOGO_SIDES.includes(next) ? next : 'left';
        setLogoSideState(side);
        localStorage.setItem(LOGO_SIDE_KEY, side);
    }, []);

    // Before the paint rather than after it: this is what decides whether the
    // window is black or white, and a frame of the wrong one is a flash.
    useLayoutEffect(() => {
        applyTheme(theme, appColors);

        // Listen for system theme changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            if (theme === 'system') applyTheme('system', appColors);
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme, appColors, applyTheme]);

    return {
        theme, setTheme,
        appColors, setAppColors,
        showLogo, setShowLogo,
        logoImage, setLogoImage,
        logoSide, setLogoSide,
    };
}
