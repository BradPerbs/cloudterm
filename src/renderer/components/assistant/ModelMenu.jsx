import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDown01Icon,
    Loading03Icon,
    Refresh01Icon,
    StarIcon,
    Tick02Icon,
    ViewIcon,
    ViewOffSlashIcon,
} from 'hugeicons-react';
import EffortSlider from './EffortSlider';
import SearchField from '../ui/SearchField';
import ProviderMark from '../../lib/provider-marks';
import {
    PROVIDER_NAMES,
    PROVIDER_ORDER,
    mergedModelRows,
    currentModelRow,
    effortStops,
    effortLabel,
    nearestEffort,
    isDiscovered,
} from '../../lib/ai-catalog';
import { useEnterOn } from '../../hooks/useEnter';
import { useT } from '../../i18n';

/**
 * The model and how hard it should think, as one chip in the composer.
 *
 * These two live on the settings page as well, where they are explained
 * properly. They are repeated here because they are the settings people change
 * mid-conversation, when an answer was not good enough or is taking too long,
 * and walking to a settings page to do it means losing the thread you were
 * pulling on. One control for both, because "which model, how hard" is a
 * single decision about how much this next question is worth.
 *
 * Both belong to the conversation: a pick here moves this tab and no other,
 * and is what the next new chat starts on. The star beside a row pins one
 * model for every new chat instead, until it is taken off.
 *
 * Every agent switched on in settings has its models here, grouped under the
 * agent they belong to, and picking a row moves the agent as well as the
 * model, because a model belongs to exactly one of them. With several agents
 * on, that list is long, so the menu is three parts that behave differently:
 * a search field that stays at the top, the groups in between that scroll
 * under their own sticky headings, and the effort dial fixed at the bottom,
 * where it can be reached without scrolling past forty models to find it.
 *
 * Some runtimes report dozens of aliases and dated snapshots, so a model can
 * be hidden from its row. Hiding is display only and for the whole app: the
 * model a conversation is on is never hidden from its own menu, and the
 * hidden ones are a click away at the bottom of the list.
 *
 * Neither list is written here, and neither has a hardcoded stand-in. Each
 * agent reports what it can run, and the effort scale is narrowed to the
 * levels the chosen model takes. An agent that has not answered yet says so
 * under its heading rather than being padded out with a guess. Each list is
 * read once per run of the app; the button beside the search field asks every
 * agent again, for a model that came out since.
 *
 * The keyboard works the way a command palette does: type to filter, arrows
 * to move, Enter to pick, Escape to clear and then to close.
 */

/** Every word typed has to appear somewhere in the row, in any order. */
function matches(row, words) {
    if (words.length === 0) return true;
    const haystack = `${row.label} ${row.short} ${row.value} ${row.hint || ''} ${PROVIDER_NAMES[row.provider] || ''}`
        .toLowerCase();
    return words.every(word => haystack.includes(word));
}

/** Whether a row is the model starred for new chats. */
const isStarred = (row, starred) => Boolean(starred)
    && starred.provider === row.provider
    && starred.model === row.value;

/** A small square button at the end of a row, seen on hover or while it is on. */
const ROW_ACTION = `shrink-0 w-7 h-8 flex items-center justify-center rounded-lg transition-[opacity,color]
    outline-none focus-visible:opacity-100 focus-visible:ring-2
    focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

/** Under a heading whose agent has not answered: still reading, or ask again. */
function Pending({ loading, onRefresh }) {
    const t = useT();
    if (loading) {
        return (
            <div className="flex items-center gap-2 h-8 px-2.5 text-[11px] text-gray-500 dark:text-neutral-400">
                <Loading03Icon size={12} strokeWidth={2} className="shrink-0 animate-spin" />
                {t('assistant.readingModels')}
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={onRefresh}
            className="w-full flex items-center gap-2 h-8 px-2.5 rounded-lg text-left text-[11px]
                transition-colors text-gray-500 dark:text-neutral-400
                hover:bg-gray-100 dark:hover:bg-surface-control
                hover:text-gray-900 dark:hover:text-white"
        >
            <Refresh01Icon size={12} strokeWidth={2} className="shrink-0" />
            {t('assistant.noModels')}
        </button>
    );
}

function MenuBody({
    rows, model, settings, providers, catalogs, loading, onRefresh, onPick, onEffort, onClose,
    starred, onStar, hidden, onHide,
}) {
    const t = useT();
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(-1);
    const [showHidden, setShowHidden] = useState(false);
    const searchRef = useRef(null);
    const listRef = useRef(null);
    // The highlighted row is only scrolled into view after keyboard moves.
    // Scrolling after a hover would move the list under a still pointer,
    // which fires a new hover on the row that slid underneath and shakes.
    const followKeyboard = useRef(false);

    useEffect(() => {
        searchRef.current?.focus({ preventScroll: true });
    }, []);

    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const { groups, hiddenCount } = useMemo(() => {
        const on = new Set(providers?.length ? providers : [settings.provider]);
        let count = 0;
        const list = PROVIDER_ORDER.filter(provider => on.has(provider)).map((provider) => {
            const ids = hidden?.[provider] || [];
            // The row the chip is on stays, whatever is hidden: hiding is to
            // declutter the menu, never to strand the chip on a row that is gone.
            const isHidden = row => ids.includes(row.value) && row.key !== model?.key;
            const own = rows.filter(row => row.provider === provider);
            count += own.filter(isHidden).length;
            return {
                provider,
                rows: own
                    .filter(row => (showHidden || !isHidden(row)) && matches(row, words))
                    .map(row => ({ ...row, hidden: isHidden(row) })),
                pending: !isDiscovered(catalogs?.[provider]),
            };
        }).filter(group => group.rows.length > 0 || (words.length === 0 && group.pending));
        return { groups: list, hiddenCount: count };
        // `words` is derived from `query`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, model?.key, providers, catalogs, settings.provider, query, hidden, showHidden]);

    const flat = groups.flatMap(group => group.rows);

    // Land on the model in use when the menu opens, and on the first match
    // once something is typed.
    useEffect(() => {
        followKeyboard.current = true;
        if (words.length > 0) setActive(flat.length > 0 ? 0 : -1);
        else setActive(Math.max(-1, flat.findIndex(row => row.key === model?.key)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    // The highlighted row stays in view as the arrows move it.
    useEffect(() => {
        if (!followKeyboard.current) return;
        followKeyboard.current = false;
        listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    const onKeyDown = (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (flat.length === 0) return;
            followKeyboard.current = true;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive(current => (current < 0 ? 0 : (current + step + flat.length) % flat.length));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (flat[active]) onPick(flat[active]);
        } else if (event.key === 'Escape') {
            // Claimed, or Escape would also blur the composer behind it.
            event.preventDefault();
            event.stopPropagation();
            if (query) setQuery('');
            else onClose();
        }
    };

    const hide = (row) => {
        const ids = hidden?.[row.provider] || [];
        onHide(row.provider, row.hidden
            ? ids.filter(id => id !== row.value)
            : [...new Set([...ids, row.value])]);
    };

    const stops = effortStops(model);
    const shown = nearestEffort(stops, settings.effort);
    const effort = stops.find(option => option.value === shown);
    const described = flat[active] || model;
    // Headings whenever more than one agent is on, even when a search has
    // narrowed the list to one of them: the rows still need to say whose.
    const marked = (providers?.length || 0) > 1;

    let index = -1;

    return (
        <>
            <div className="shrink-0 p-1.5 pb-1 flex items-center gap-1">
                <SearchField
                    ref={searchRef}
                    value={query}
                    onChange={setQuery}
                    onKeyDown={onKeyDown}
                    ariaLabel={t('assistant.searchModels')}
                    placeholder={t('assistant.searchModels')}
                />
                {/* Every switched-on agent asked again, for a model released
                    since the app started. What is listed stays until the new
                    answer arrives, and main keeps it if the re-read fails. */}
                <button
                    type="button"
                    disabled={loading}
                    onClick={() => onRefresh()}
                    aria-label={t('assistant.refreshModels')}
                    title={t('assistant.refreshModels')}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors
                        text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white
                        hover:bg-gray-100 dark:hover:bg-surface-control disabled:hover:bg-transparent
                        outline-none focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
                >
                    <Refresh01Icon size={14} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div
                ref={listRef}
                role="listbox"
                aria-label={t('assistant.model')}
                className="flex-1 min-h-0 max-h-[18rem] overflow-y-auto overscroll-contain px-1 pb-1"
            >
                {groups.length === 0 && (
                    <div className="px-3 py-6 text-center text-[11px] text-gray-500 dark:text-neutral-400">
                        {words.length > 0 ? t('assistant.noModelMatch', { query }) : t('assistant.noModels')}
                    </div>
                )}

                {groups.map(group => (
                    <div key={group.provider} role="group" aria-label={PROVIDER_NAMES[group.provider]}>
                        {marked && (
                            <div className="sticky top-0 z-10 flex items-center gap-1.5 h-7 px-2.5
                                bg-white dark:bg-surface-raised
                                text-[11px] font-semibold text-gray-500 dark:text-neutral-400"
                            >
                                <ProviderMark provider={group.provider} size={12} />
                                <span>{PROVIDER_NAMES[group.provider]}</span>
                            </div>
                        )}

                        {group.rows.map((row) => {
                            index += 1;
                            const position = index;
                            const selected = row.key === model?.key;
                            const highlighted = position === active;
                            const star = isStarred(row, starred);
                            return (
                                <div
                                    key={row.key}
                                    onMouseEnter={() => {
                                        if (active !== position) {
                                            followKeyboard.current = false;
                                            setActive(position);
                                        }
                                    }}
                                    className={`group/row flex items-center rounded-lg transition-colors
                                        ${selected
                                            ? 'bg-gray-200 dark:bg-surface-hover'
                                            : highlighted ? 'bg-gray-100 dark:bg-surface-control' : ''}`}
                                >
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        data-index={position}
                                        onClick={() => onPick(row)}
                                        className="flex-1 min-w-0 h-8 pl-2.5 pr-1 flex items-center gap-2 text-left outline-none"
                                    >
                                        <span className={`min-w-0 truncate text-[13px] font-medium
                                            ${row.hidden
                                                ? 'text-gray-400 dark:text-neutral-500'
                                                : 'text-gray-900 dark:text-white'}`}
                                        >
                                            {row.short || row.label}
                                        </span>
                                        {row.preferred && (
                                            <span className="shrink-0 text-[10px] text-gray-400 dark:text-neutral-500">
                                                {t('assistant.defaultModel')}
                                            </span>
                                        )}
                                        <span className="flex-1" />
                                        {selected && (
                                            <Tick02Icon size={14} strokeWidth={2.5} className="shrink-0 text-gray-900 dark:text-white" />
                                        )}
                                    </button>

                                    {/* Hidden from the menu, or back into it.
                                        Not offered on the row the chip is on,
                                        which is never hidden. */}
                                    {onHide && !selected && (
                                        <button
                                            type="button"
                                            aria-label={row.hidden ? t('assistant.unhideModel') : t('assistant.hideModel')}
                                            title={row.hidden ? t('assistant.unhideModel') : t('assistant.hideModel')}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                hide(row);
                                            }}
                                            className={`${ROW_ACTION}
                                                ${row.hidden || highlighted ? 'opacity-100' : 'opacity-0'} group-hover/row:opacity-100
                                                text-gray-400 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-white`}
                                        >
                                            {row.hidden
                                                ? <ViewIcon size={13} strokeWidth={2} />
                                                : <ViewOffSlashIcon size={13} strokeWidth={2} />}
                                        </button>
                                    )}

                                    {onStar && (
                                        <button
                                            type="button"
                                            aria-pressed={star}
                                            aria-label={star ? t('assistant.unstarModel') : t('assistant.starModel')}
                                            title={star ? t('assistant.unstarModel') : t('assistant.starModel')}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onStar(star ? null : { provider: row.provider, model: row.value });
                                            }}
                                            className={`${ROW_ACTION} mr-0.5
                                                ${star
                                                    ? 'opacity-100 text-gray-900 dark:text-white'
                                                    : `${highlighted ? 'opacity-100' : 'opacity-0'} group-hover/row:opacity-100
                                                        text-gray-400 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-white`}`}
                                        >
                                            <StarIcon size={13} strokeWidth={2} fill={star ? 'currentColor' : 'none'} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {group.pending && group.rows.length === 0 && (
                            <Pending loading={loading} onRefresh={() => onRefresh()} />
                        )}
                    </div>
                ))}

                {/* The hidden ones, a click away rather than gone. */}
                {onHide && hiddenCount > 0 && words.length === 0 && (
                    <button
                        type="button"
                        onClick={() => setShowHidden(value => !value)}
                        className="w-full h-8 mt-0.5 px-2.5 flex items-center gap-2 rounded-lg text-left text-[11px]
                            transition-colors text-gray-500 dark:text-neutral-400
                            hover:bg-gray-100 dark:hover:bg-surface-control
                            hover:text-gray-900 dark:hover:text-white"
                    >
                        {showHidden
                            ? <ViewOffSlashIcon size={12} strokeWidth={2} className="shrink-0" />
                            : <ViewIcon size={12} strokeWidth={2} className="shrink-0" />}
                        {showHidden
                            ? t('assistant.hiddenModelsCollapse')
                            : t('assistant.hiddenModelsShow', { count: hiddenCount })}
                    </button>
                )}
            </div>

            {/* The highlighted model in a sentence, and the dial, both fixed
                below the list so neither has to be scrolled to. */}
            <div className="shrink-0 border-t border-gray-100 dark:border-surface-control">
                {/* Always the same height: the hint changes with the hovered
                    row, and a footer that grows and shrinks moves the list
                    under a still pointer, which shakes. */}
                <p className="px-3 pt-2 text-[11px] leading-snug text-gray-500 dark:text-neutral-400 line-clamp-2 min-h-[2.5rem]">
                    {described?.hint || ' '}
                </p>
                {stops.length > 1 ? (
                    <div className="pt-1.5">
                        <div className="px-3 pb-1 flex items-baseline justify-between text-[11px]">
                            <span className="font-semibold text-gray-500 dark:text-neutral-400">{t('assistant.effort')}</span>
                            <span className="font-medium text-gray-900 dark:text-white">{effortLabel(effort)}</span>
                        </div>
                        <EffortSlider options={stops} value={shown} onChange={onEffort} />
                    </div>
                ) : (
                    <p className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-neutral-400">
                        {model ? t('assistant.noEffort') : t('assistant.pickModel')}
                    </p>
                )}
            </div>
        </>
    );
}

export default function ModelMenu({
    settings, catalogs, providers, loading, onRefresh, onChange,
    starred = null, onStar, hidden = {}, onHide,
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef(null);
    const menuRef = useRef(null);

    // Rendered on a condition rather than mounted, so the entrance is asked
    // for each time it opens. See lib/enterMotion.
    useEnterOn(menuRef, open && 'dialog');

    const rows = useMemo(
        () => mergedModelRows(catalogs, providers, settings),
        [catalogs, providers, settings]
    );

    // Undefined when nothing is pinned and the agent has not named a default,
    // which includes every agent that has not answered yet. The chip says which
    // agent it is in that case, since that much is true and known, and the menu
    // ticks nothing: a list with no choice marked is what "no choice made"
    // looks like.
    const model = currentModelRow(rows, settings);
    const stops = useMemo(() => effortStops(model), [model]);

    // What the dial shows, which is the saved level unless this model does not
    // have that stop. The pin itself is not rewritten: switching back to a
    // model that has it should show the choice, not the compromise.
    const shown = nearestEffort(stops, settings.effort);
    const effort = stops.find(option => option.value === shown);

    // Marks only once there is more than one agent to tell apart. With one on,
    // every row would carry the same mark, which is decoration.
    const marked = (providers?.length || 0) > 1;

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (wrapperRef.current?.contains(event.target)) return;
            setOpen(false);
        };
        // Escape closes from anywhere in the menu, the dial included. In the
        // search field it clears what was typed first, which the field's own
        // handler does, so a field with text in it is left to it.
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            const field = event.target?.tagName === 'INPUT' && menuRef.current?.contains(event.target);
            if (field && event.target.value) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);

    // The effort travels with the model, because the scales differ: picking
    // one that stops at "extra high" while "ultra" is set would leave a level
    // no menu shows and the agent cannot honour. The agent travels with it
    // too, since a row names one model of one agent's.
    const pick = (row) => {
        setOpen(false);
        if (row.key === model?.key) return;
        onChange({
            provider: row.provider,
            model: row.value,
            effort: nearestEffort(effortStops(row), settings.effort),
        });
    };

    return (
        <div ref={wrapperRef} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
                title={t('assistant.modelAndEffort')}
                className={`h-7 pl-2 pr-1.5 rounded-xl flex items-center gap-1 transition-colors
                    text-[11px] outline-none focus-visible:ring-2
                    focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                    ${open
                        ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-900 dark:text-gray-100'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] '
                            + 'hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
                {/* The chip says which agent as well as which model once
                    there is more than one it could be. Two of them can offer
                    a model called `sonnet`, and the name on its own would not
                    say whose plan the next question is spending. */}
                {marked && (
                    <span className="shrink-0 flex items-center">
                        <ProviderMark provider={model?.provider || settings.provider} size={13} />
                    </span>
                )}
                <span className="font-medium">
                    {model?.short || PROVIDER_NAMES[settings.provider] || ''}
                </span>
                {effort && <span className="opacity-60">{effortLabel(effort)}</span>}
                <ArrowDown01Icon
                    size={11}
                    strokeWidth={2}
                    className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div
                    ref={menuRef}
                    role="dialog"
                    aria-label={t('assistant.modelAndEffort')}
                    className="absolute z-40 bottom-full mb-1 right-0 w-[19rem] max-w-[calc(100vw-1rem)]
                        flex flex-col overflow-hidden rounded-xl
                        bg-white dark:bg-surface-raised
                        border border-gray-200 dark:border-surface-control
                        shadow-xl shadow-black/10 dark:shadow-black/40"
                >
                    <MenuBody
                        rows={rows}
                        model={model}
                        settings={settings}
                        providers={providers}
                        catalogs={catalogs}
                        loading={loading}
                        onRefresh={onRefresh}
                        onPick={pick}
                        onEffort={(value) => onChange({ effort: value })}
                        onClose={() => setOpen(false)}
                        starred={starred}
                        onStar={onStar}
                        hidden={hidden}
                        onHide={onHide}
                    />
                </div>
            )}
        </div>
    );
}
