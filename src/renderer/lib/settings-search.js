/**
 * Filtering a settings page down to the settings that mention what was typed.
 *
 * This works on what the page has drawn, not on a list of settings kept beside
 * it. A page is several dozen rows spread over sections that each build their
 * own markup, and an index of them would be one more thing to remember to edit
 * every time a row is added, in five languages. The text on screen is already
 * translated, already current, and already the words the user is looking at,
 * so it is what gets searched.
 *
 * Three kinds of block take part, each marked by the component that draws it:
 * a group (a heading over several cards, for a page that wants one), a card
 * (SettingCard) and a row (SettingRow). They nest, and a block is kept when its
 * own words match or when anything inside it is kept. A block whose own words
 * match keeps everything inside it too, so searching for a card's heading shows
 * the whole card rather than a heading over nothing.
 *
 * Hidden blocks are marked with an attribute rather than taken out of the
 * tree: the sections keep their state, and clearing the search puts every row
 * back exactly as it was. React leaves attributes it did not set alone, so the
 * marks survive a re-render; anything React mounts afresh is caught by the
 * observer in SettingsPage and filtered again.
 */

const UNIT = '[data-setting-group], [data-setting-card], [data-setting-row]';

export const MISS = 'data-search-miss';

/**
 * The first row still showing in a card. Every row after the first draws a
 * rule above itself, and with the rows before it hidden that rule would sit at
 * the top of the card dividing it from nothing.
 */
export const FIRST = 'data-search-first';

/** The name the matches are registered under; see `::highlight` in input.css. */
const HIGHLIGHT = 'settings-search';

/**
 * Where the user types rather than reads. What is in a field is their data,
 * not the name of the setting it belongs to, and a block list containing "rm"
 * should not turn up on a search for "rm" as though it were a setting.
 */
const SKIP = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE']);

/**
 * Lower case with the accents off, so "configuracao" finds "Configuração" and
 * "nhiet" finds "nhiệt". Four of the five catalogs carry marks that people
 * routinely leave off when they type.
 */
export const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a query, each of which has to appear somewhere in a match. */
export const parseQuery = (query) => fold(query || '').split(/\s+/).filter(Boolean);

/** The text nodes that belong to this block and not to one nested inside it. */
function ownTexts(unit) {
    const texts = [];
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
            if (SKIP.has(node.tagName) || node.matches(UNIT)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
        },
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        texts.push(node);
    }
    return texts;
}

/** The blocks under `root` as a tree, outermost first. */
function buildTree(root) {
    const units = [...root.querySelectorAll(UNIT)];
    const entries = new Map(units.map(el => [el, { el, children: [] }]));
    const tops = [];

    for (const el of units) {
        const parent = entries.get(el.parentElement?.closest(UNIT));
        (parent ? parent.children : tops).push(entries.get(el));
    }
    return tops;
}

const matches = (texts, terms) => {
    const haystack = fold(texts.map(node => node.data).join(' '));
    return terms.every(term => haystack.includes(term));
};

/**
 * Decides one block and everything under it, and returns whether it is kept.
 * `kept` collects the text of every block left showing, for the highlight.
 */
function visit(entry, terms, forced, kept) {
    const texts = ownTexts(entry.el);
    const whole = forced || matches(texts, terms);

    let anyChild = false;
    let first = true;
    const isCard = entry.el.hasAttribute('data-setting-card');

    for (const child of entry.children) {
        const shown = visit(child, terms, whole, kept);
        anyChild ||= shown;

        if (isCard && shown && first) {
            child.el.setAttribute(FIRST, '');
            first = false;
        } else {
            child.el.removeAttribute(FIRST);
        }
    }

    const shown = whole || anyChild;
    entry.el.toggleAttribute(MISS, !shown);
    if (shown) kept.push(...texts);
    return shown;
}

/**
 * The places in one text node where the terms occur, as ranges.
 *
 * Matching was done on folded text, so each folded character remembers which
 * character of the original it came from. Folding a character can leave
 * nothing (a combining mark) or, rarely, more than one, so the two strings do
 * not line up by index on their own.
 */
function rangesIn(node, terms) {
    const raw = node.data;
    let folded = '';
    const from = [];

    for (let index = 0; index < raw.length;) {
        const char = String.fromCodePoint(raw.codePointAt(index));
        const piece = fold(char);
        for (let k = 0; k < piece.length; k += 1) from.push(index);
        folded += piece;
        index += char.length;
    }
    from.push(raw.length);

    const ranges = [];
    for (const term of terms) {
        for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
            const range = new Range();
            range.setStart(node, from[at]);
            range.setEnd(node, from[at + term.length]);
            ranges.push(range);
        }
    }
    return ranges;
}

function highlight(texts, terms) {
    // The Custom Highlight API marks text without wrapping it in elements,
    // which matters here: the rows belong to React, and a <mark> spliced into
    // one would be gone, or worse, on its next render.
    if (!window.CSS?.highlights || typeof Highlight === 'undefined') return;

    const ranges = [];
    for (const node of texts) {
        const folded = fold(node.data);
        if (terms.some(term => folded.includes(term))) ranges.push(...rangesIn(node, terms));
    }

    if (ranges.length) {
        CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    } else {
        CSS.highlights.delete(HIGHLIGHT);
    }
}

/**
 * Hides every block under `root` that does not mention all of `terms`, and
 * returns whether anything is left.
 *
 * Wrappers that are not blocks themselves (a div holding a card so it can be
 * scrolled to, say) are hidden when nothing inside them is kept, or the page's
 * gap would still be spent on them and leave holes between the cards.
 */
export function filterSettings(root, terms) {
    const tops = buildTree(root);
    const kept = [];
    const shownTops = tops.filter(entry => visit(entry, terms, false, kept));

    for (const child of root.children) {
        if (child.matches(UNIT) || !child.querySelector(UNIT)) continue;
        child.toggleAttribute(MISS, !shownTops.some(entry => child.contains(entry.el)));
    }

    highlight(kept, terms);
    return shownTops.length > 0;
}

/** Puts every block back and takes the highlight down. */
export function clearSettingsFilter(root) {
    root?.querySelectorAll(`[${MISS}], [${FIRST}]`).forEach((el) => {
        el.removeAttribute(MISS);
        el.removeAttribute(FIRST);
    });
    window.CSS?.highlights?.delete(HIGHLIGHT);
}
