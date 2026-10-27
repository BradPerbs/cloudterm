import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import SearchField from '../../ui/SearchField';
import { useStacked } from './stacked';
import { clearSettingsFilter, filterSettings, parseQuery } from '../../../lib/settings-search';
import { useT } from '../../../i18n';

/**
 * Title block plus the stack of cards below it. One per settings category.
 *
 * Every page carries a search field in its header. The assistant's page alone
 * is a couple of dozen settings, and scrolling past all of them to find the one
 * whose name you already know is the slow way round. The field narrows the
 * page to the cards and rows that mention every word typed; how it does that
 * is in lib/settings-search.
 *
 * The query is normally this page's own, and starts empty whenever the page is
 * opened. A page that has to change what it renders while a search is on can
 * pass `query` and `onQueryChange` and hold it itself.
 */
export default function SettingsPage({ title, description, query: heldQuery, onQueryChange, children }) {
    const t = useT();
    const stacked = useStacked();
    const [ownQuery, setOwnQuery] = useState('');
    const [nothing, setNothing] = useState(false);
    const bodyRef = useRef(null);
    const searchRef = useRef(null);

    const query = heldQuery ?? ownQuery;
    const setQuery = onQueryChange ?? setOwnQuery;
    const terms = parseQuery(query).join(' ');

    // Before paint, so a keystroke never shows a frame of the page unfiltered.
    // The observer is for the sections that draw late: most load their
    // settings over IPC after mounting, and a card that arrives while a search
    // is on has to be judged like the ones that were already there.
    useLayoutEffect(() => {
        const root = bodyRef.current;
        if (!root) return undefined;

        if (!terms) {
            clearSettingsFilter(root);
            setNothing(false);
            return undefined;
        }

        const words = terms.split(' ');
        let frame = 0;
        const apply = () => {
            frame = 0;
            setNothing(!filterSettings(root, words));
        };

        apply();

        const observer = new MutationObserver(() => {
            if (!frame) frame = requestAnimationFrame(apply);
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });

        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [terms]);

    // The highlight is registered on the document, not on this page, so it
    // has to be taken down when the page goes.
    useEffect(() => () => clearSettingsFilter(bodyRef.current), []);

    /**
     * Ctrl+F and `/` reach the field, as they do on the other pages with a
     * list to search. The home view is kept mounted under the terminal tabs,
     * hidden rather than removed, so the field being visible is what says this
     * page is the one in front. A Ctrl+F something closer to the keyboard has
     * already taken (the assistant's own find, say) is left to it.
     */
    useEffect(() => {
        const handler = (event) => {
            if (event.defaultPrevented) return;

            const field = searchRef.current;
            if (!field?.checkVisibility?.({ visibilityProperty: true })) return;

            const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
            const find = (event.ctrlKey || event.metaKey) && event.key === 'f' && !event.altKey;
            const slash = event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey;
            if (!find && !slash) return;

            event.preventDefault();
            field.focus();
            field.select();
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // Escape empties the field first and lets go of it second, so a search can
    // be abandoned without reaching for the mouse.
    const handleSearchKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (query) setQuery('');
        else event.currentTarget.blur();
    };

    return (
        <div className="flex flex-col gap-6">
            <div className={`px-1 flex ${stacked ? 'flex-col gap-3' : 'items-center justify-between gap-6'}`}>
                <div className="min-w-0">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
                    {description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
                    )}
                </div>
                <div className={stacked ? 'flex' : 'flex w-60 shrink-0'}>
                    <SearchField
                        ref={searchRef}
                        value={query}
                        onChange={setQuery}
                        onKeyDown={handleSearchKeyDown}
                        ariaLabel={t('settings.search')}
                        placeholder={t('settings.search')}
                    />
                </div>
            </div>

            {nothing && (
                <p className="px-1 text-sm text-gray-500 dark:text-gray-400 break-words">
                    {t('settings.search.empty', { query: query.trim() })}
                </p>
            )}

            <div ref={bodyRef} className="flex flex-col gap-6">
                {children}
            </div>
        </div>
    );
}
