import { useSyncExternalStore } from 'react';
import en from './locales/en';
import zh from './locales/zh';
import vi from './locales/vi';
import pt from './locales/pt';
import ru from './locales/ru';

/**
 * The app's own tiny i18n layer.
 *
 * There is no library behind this on purpose. What the app needs is a lookup, a
 * `{placeholder}` fill and correct plurals, and the platform already has the
 * hard part of that in Intl.PluralRules. A dependency would mostly add a
 * provider component and a bundle.
 *
 * Catalogs are flat maps of dotted key to string, so a key can be grepped for
 * across the app and a locale file diffs one line per string. Anything missing
 * from a locale falls back to English rather than showing the raw key, so a
 * half-finished translation is still a usable app.
 */

export const DEFAULT_LANGUAGE = 'en';

/**
 * The languages on offer, in the order the picker shows them. `label` is the
 * language's own name, because that is the one word a reader who needs this
 * setting is guaranteed to recognise; `english` is what the rest of us call it,
 * shown beside it so the list is navigable in either direction.
 */
export const LANGUAGES = [
    { id: 'en', label: 'English', english: 'English', tag: 'en' },
    { id: 'zh', label: '简体中文', english: 'Chinese (Simplified)', tag: 'zh-Hans' },
    { id: 'vi', label: 'Tiếng Việt', english: 'Vietnamese', tag: 'vi' },
    { id: 'pt', label: 'Português', english: 'Portuguese', tag: 'pt' },
    { id: 'ru', label: 'Русский', english: 'Russian', tag: 'ru' },
];

const CATALOGS = { en, zh, vi, pt, ru };

/** Shared with useSettingsSnapshot, which carries this between devices. */
export const LANGUAGE_KEY = 'language';

const bcp47 = (language) => LANGUAGES.find(entry => entry.id === language)?.tag || language;

/**
 * The first of the system's languages the app has a catalog for.
 *
 * Only the base subtag is matched: someone whose system is pt-BR wants the
 * Portuguese strings, and telling them the app is English because the region
 * did not match would be silly.
 */
function matchSystem() {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];

    for (const tag of tags) {
        const base = String(tag || '').toLowerCase().split('-')[0];
        if (CATALOGS[base]) return base;
    }

    return DEFAULT_LANGUAGE;
}

function readStored() {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return CATALOGS[saved] ? saved : matchSystem();
}

let current = readStored();

const listeners = new Set();

/**
 * Kept in step with the chosen language so the browser hyphenates, quotes and
 * picks fallback fonts as that language rather than as the page's default. It
 * matters most for Chinese, where the same code points are drawn differently
 * depending on the language the run is tagged with.
 */
function applyDocumentLanguage(language) {
    document.documentElement.lang = bcp47(language);
}

applyDocumentLanguage(current);

export const getLanguage = () => current;

/**
 * The chosen language as a BCP-47 tag, for Intl and for `toLocaleString`.
 *
 * Dates follow the app's language rather than the system's: someone who has
 * just told the app to speak Russian did not mean "except the timestamps".
 */
export const localeTag = () => bcp47(current);

export function setLanguage(next) {
    const language = CATALOGS[next] ? next : DEFAULT_LANGUAGE;

    if (language === current) return language;

    current = language;
    localStorage.setItem(LANGUAGE_KEY, language);
    applyDocumentLanguage(language);

    for (const listener of listeners) listener();

    return language;
}

const pluralRules = new Map();

function ruleFor(language) {
    if (!pluralRules.has(language)) {
        pluralRules.set(language, new Intl.PluralRules(bcp47(language)));
    }
    return pluralRules.get(language);
}

const lookup = (language, key) => {
    const value = CATALOGS[language]?.[key];
    return typeof value === 'string' ? value : undefined;
};

/**
 * The form a count wants, in the language's own terms. English has two, Russian
 * has four, Chinese and Vietnamese have one; Intl knows which, so the catalogs
 * only have to supply the forms their own language uses.
 */
function selectPlural(language, key, count) {
    const category = ruleFor(language).select(count);
    return lookup(language, `${key}_${category}`) ?? lookup(language, `${key}_other`);
}

const fill = (text, vars) => (vars
    ? text.replace(/\{(\w+)\}/g, (whole, name) => (
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
    ))
    : text);

// Reported once per key rather than once per render, which would be thousands
// of identical lines for a single missing string.
const reported = new Set();

function reportMissing(key) {
    if (reported.has(key)) return;
    reported.add(key);
    console.warn(`i18n: no string for "${key}"`);
}

/**
 * Look up `key`, filling `{placeholders}` from `vars`.
 *
 * Passing a numeric `vars.count` picks the plural form, so `hosts.count` is
 * stored as `hosts.count_one` and `hosts.count_other` (and the two extra forms
 * Russian needs) rather than as one string.
 */
export function translate(key, vars, language = current) {
    let text;

    if (vars && typeof vars.count === 'number') {
        text = selectPlural(language, key, vars.count);
        if (text === undefined && language !== DEFAULT_LANGUAGE) {
            text = selectPlural(DEFAULT_LANGUAGE, key, vars.count);
        }
    }

    if (text === undefined) text = lookup(language, key);
    if (text === undefined) text = lookup(DEFAULT_LANGUAGE, key);

    if (text === undefined) {
        reportMissing(key);
        return key;
    }

    return fill(text, vars);
}

// One translator per language, made once. A component that hands `t` to a
// memoised child would otherwise break its memo on every render, and this way
// the identity changes exactly when the language does, which is when that child
// does need to redraw.
const translators = new Map();

function translatorFor(language) {
    if (!translators.has(language)) {
        translators.set(language, (key, vars) => translate(key, vars, language));
    }
    return translators.get(language);
}

const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** The chosen language, as a value that re-renders the caller when it changes. */
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage);

/**
 * The translator for the current language.
 *
 * Subscribing per component rather than through a context provider is what
 * makes this work through the `memo()` boundaries the app is full of: a
 * memoised component that asks for `t` re-renders on a language change even
 * though none of its props moved.
 */
export const useT = () => translatorFor(useLanguage());
