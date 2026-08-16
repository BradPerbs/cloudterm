import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    Search01Icon,
    Download04Icon,
    Delete02Icon,
    RefreshIcon,
    Link01Icon,
    PlugSocketIcon,
    ComputerIcon,
    PencilEdit02Icon,
    PlusSignIcon,
    Key01Icon,
    Shield01Icon,
    SquareLock01Icon,
    Upload04Icon,
    Copy01Icon,
    AlertCircleIcon,
    UserIcon,
    ArrowRight01Icon,
    SearchRemoveIcon,
    TimelineIcon,
    PulseRectangle01Icon,
} from 'hugeicons-react';
import ConfirmDialog from './ui/ConfirmDialog';
import EmptyFrame from './ui/EmptyFrame';
import Button, { CollapsingButton, IconButton } from './ui/Button';
import { FIELD_CLASS } from './ui/Field';
import { useActivity } from '../hooks/useActivity';
import useNarrow from '../hooks/useNarrow';
import { useT } from '../i18n';
import {
    CATEGORY_LABELS,
    describeChange,
    describeEntry,
    formatClock,
    fullDate,
    fullStamp,
    groupByDay,
    isSameActor,
    kindOf,
} from '../lib/activity';
import { toastOptions } from '../lib/toast';

/**
 * The activity log.
 *
 * What was connected to, what was changed, and what was done to files on the
 * far side, in one list, newest first. It reads the record the main process
 * keeps; nothing here can add to it, which is the point of having it.
 *
 * "Who" is the OS account this app ran under. There are no separate identities
 * in this client, so that is the honest answer, and it is the one that matters
 * when a machine is shared or a backup was restored somewhere else.
 */

/**
 * Where the Clear button drops its label and keeps its bin.
 *
 * Measured on the page rather than the window, since the assistant opens as a
 * column beside it and takes 340px or more off it. This header carries a title
 * as well as its controls, so it runs out sooner than it looks: the filter
 * field, two icon buttons and a labelled Clear come to about 360px on their
 * own, and the title needs the rest.
 */
const COMPACT_AT = 520;

const FILTERS = [
    { id: '', labelKey: 'logs.filterAll' },
    { id: 'connection', labelKey: CATEGORY_LABELS.connection },
    { id: 'data', labelKey: CATEGORY_LABELS.data },
    { id: 'files', labelKey: CATEGORY_LABELS.files },
    { id: 'security', labelKey: CATEGORY_LABELS.security },
];

/** One glyph per kind of thing that happened, so the list scans vertically. */
const KIND_ICONS = {
    connect: Link01Icon,
    disconnect: Link01Icon,
    tunnel: PlugSocketIcon,
    desktop: ComputerIcon,
    monitor: PulseRectangle01Icon,
    add: PlusSignIcon,
    edit: PencilEdit02Icon,
    delete: Delete02Icon,
    key: Key01Icon,
    shield: Shield01Icon,
    lock: SquareLock01Icon,
    upload: Upload04Icon,
    download: Download04Icon,
    copy: Copy01Icon,
};

/**
 * Two text weights, and nothing below them.
 *
 * The `neutral` scale in this project is a *surface* ramp (neutral-600 is
 * #2f334d, a panel colour), so reaching for it as a text grey put 1.3:1 on the
 * background it was sitting on. These are the two that clear their floor in
 * both themes, which takes an asymmetric pair: gray-400 reads at 6.7:1 on the
 * dark panel and 2.4:1 on the light one, and gray-600 does the reverse.
 *
 *   MUTED  7.2:1 light / 6.7:1 dark   secondary text, meant to be read
 *   FAINT  4.6:1 light / 3.5:1 dark   chrome, meant to be found when looked for
 */
const MUTED = 'text-gray-600 dark:text-gray-400';
const FAINT = 'text-gray-500 dark:text-gray-500';

/**
 * Colour is for trouble, and nothing else.
 *
 * Tinting each row by what kind of event it was produced a column of green,
 * blue, violet and amber chips that all meant the same thing ("this worked"),
 * and the one line that did not work had to compete with them to be seen. The
 * category is already in the glyph and in the words; it does not need a filled
 * swatch as well.
 *
 * So a failure keeps its red chip and a warning its amber one, because those
 * are what the log is scanned for. Everything else is a bare grey glyph in the
 * same grey as the timestamp beside it, and the column reads as one quiet run
 * broken only where something went wrong.
 */
const TONES = {
    failure: 'text-red-500 bg-red-50 dark:bg-red-900/20',
    warning: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
};

function toneFor(entry) {
    return TONES[entry.outcome] || MUTED;
}

/**
 * One line of the log.
 *
 * Time on the left in its own fixed column, the way every log a person has ever
 * read is laid out: it gives the eye a rail to run down, and it is the column
 * you are scanning for when you come here asking "what happened at four".
 *
 * The actor is deliberately not on every row. On a single-account machine it is
 * the same eleven characters a hundred times over, which is how a detail that
 * matters gets trained into wallpaper. It appears when it differs from whoever
 * is sitting here now (a shared workstation, a restored backup), and in the
 * expanded detail, where it is being looked for rather than skimmed past.
 */
function LogRow({ entry, currentActor }) {
    const [open, setOpen] = useState(false);

    const kind = kindOf(entry);
    const Icon = KIND_ICONS[kind] || PencilEdit02Icon;
    const changes = entry.changes || [];
    const foreign = !isSameActor(entry.actor, currentActor);

    // The most useful change reads inline; the rest are one click away.
    const inline = [entry.subject, entry.detail, changes[0] && describeChange(changes[0])]
        .filter(Boolean)
        .join('  ·  ');

    // The first change is already on the line; the counter stands for the rest.
    const more = changes.length - 1;
    // Every row opens: even one with nothing hidden has an exact time and an
    // actor worth reading, which is the whole reason for keeping the record.
    const expandable = true;

    return (
        <div
            className={`group flex items-start gap-3 px-3 py-1.5 rounded-lg transition-colors ${
                expandable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-surface-control' : ''
            }`}
            onClick={expandable ? () => setOpen(value => !value) : undefined}
        >
            <time
                dateTime={new Date(entry.at).toISOString()}
                title={fullStamp(entry.at)}
                // Not FAINT: this is the column the eye runs down, so it reads
                // at least as clearly as the detail sitting beside it.
                className={`shrink-0 mt-1 w-[62px] font-mono text-[11px] tabular-nums ${MUTED}`}
            >
                {formatClock(entry.at)}
            </time>

            {/* The box stays 24px whether or not it is filled, so the glyphs
                hold one column however the outcomes fall. */}
            <div className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${toneFor(entry)}`}>
                <Icon size={15} strokeWidth={1.75} />
            </div>

            <div className="min-w-0 flex-1 py-0.5">
                <div className="flex items-baseline gap-2.5 min-w-0">
                    <span className="shrink-0 text-sm text-gray-900 dark:text-gray-100">
                        {describeEntry(entry)}
                    </span>

                    {inline && (
                        <span className={`min-w-0 truncate text-[11px] ${MUTED}`}>
                            {inline}
                        </span>
                    )}

                    {foreign && (
                        <span
                            title={`Recorded by ${entry.actor?.user} on ${entry.actor?.machine}`}
                            className="shrink-0 inline-flex items-center gap-1 text-[11px] px-1.5 py-px rounded
                                       bg-gray-100 dark:bg-surface-control text-gray-600 dark:text-gray-300"
                        >
                            <UserIcon size={10} strokeWidth={2} />
                            {entry.actor?.user || 'unknown'}
                        </span>
                    )}

                    {more > 0 && !open && (
                        <span className={`shrink-0 text-[11px] ${FAINT}`}>
                            +{more} more
                        </span>
                    )}
                </div>

                {open && (
                    <div className="mt-1.5 mb-1 flex flex-col gap-1 border-l-2 border-gray-200 dark:border-surface-hover pl-3">
                        {entry.message && (
                            <span className="text-[11px] text-red-600 dark:text-red-400 break-words">
                                {entry.message}
                            </span>
                        )}
                        {changes.map((change, index) => (
                            <span
                                key={`${change.field}-${index}`}
                                className={`text-[11px] font-mono break-words ${MUTED}`}
                            >
                                {describeChange(change)}
                            </span>
                        ))}
                        {/* Opened on purpose, so it reads at full strength
                            rather than as the chrome it sits under. */}
                        <span className={`text-[11px] ${MUTED}`}>
                            {entry.actor?.user || 'unknown'}
                            {entry.actor?.machine ? ` on ${entry.actor.machine}` : ''}
                            {' · '}
                            {fullStamp(entry.at)}
                        </span>
                    </div>
                )}
            </div>

            {entry.outcome === 'failure' && (
                <AlertCircleIcon size={13} strokeWidth={2} className="shrink-0 mt-1.5 text-red-500" />
            )}
        </div>
    );
}

function LogsPanel({ isActive = true, reachedForPage = 0 }) {
    const t = useT();
    const [category, setCategory] = useState('');
    const [failuresOnly, setFailuresOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [confirming, setConfirming] = useState(null);

    // How much room the page has, which is not how big the window is.
    const [panelRef, cramped] = useNarrow(COMPACT_AT);

    const { entries, summary, loading, exhausted, refresh, loadMore, clear, exportLog } =
        useActivity({ category, failuresOnly, search });

    // The confirm dialog belongs to this page; Home stays mounted behind a
    // terminal tab, so without this it would sit over the shell you switched
    // to. Reaching for this page while standing on it dismisses it as well.
    // Nothing is cut short: a centred dialog has no exit animation.
    useEffect(() => {
        setConfirming(null);
    }, [isActive, reachedForPage]);

    const groups = useMemo(() => groupByDay(entries), [entries]);

    const handleExport = useCallback(async () => {
        const result = await exportLog();
        if (result?.canceled) return;
        if (result?.success) {
            toast.success(`Exported ${result.count} entries`, toastOptions({ duration: 2400 }));
        } else {
            toast.error(result?.message || 'Could not export the log', toastOptions());
        }
    }, [exportLog]);

    const handleClear = useCallback(() => {
        setConfirming({
            title: 'Clear the activity log?',
            message: 'Every recorded connection and change is removed from this machine. '
                + 'This cannot be undone, so export it first if you need to keep it.',
            confirmLabel: 'Clear log',
            onConfirm: async () => {
                setConfirming(null);
                await clear();
                toast.success('Activity log cleared', toastOptions({ duration: 1800 }));
            },
        });
    }, [clear]);

    const counts = summary || {};
    const countFor = (id) => (id ? counts[id] : counts.all);

    return (
        <div ref={panelRef} className="flex flex-col gap-6 h-full" id="logs-panel">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('nav.logs')}</h2>

                {/* `ml-auto` only does anything once the row has wrapped, where
                    it holds these to the right edge rather than letting them
                    sit under the title. `min-w-0` rather than `shrink-0` so the
                    filter field inside can give width back: the buttons carry
                    their own `shrink-0`, so it is the only thing that does. */}
                <div className="flex items-center gap-2 min-w-0 ml-auto">
                    {/* The width lives on the wrapper, the way SearchField's
                        does: FIELD_CLASS carries `w-full`, which Tailwind emits
                        after the fixed widths and wins over anything set on the
                        input itself. A ceiling and a floor rather than one
                        width, so the field gives a little back before the row
                        has to wrap. */}
                    <div className="relative flex-1 min-w-[7rem] max-w-[11rem]">
                        <Search01Icon
                            size={15}
                            strokeWidth={2}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                        />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('common.filter')}
                            spellCheck={false}
                            aria-label={t('logs.filterAria')}
                            className={`${FIELD_CLASS} h-9 pl-9 pr-3 rounded-xl`}
                        />
                    </div>

                    <IconButton
                        icon={<RefreshIcon size={15} strokeWidth={2} />}
                        title={t('logs.refresh')}
                        onClick={refresh}
                    />
                    <IconButton
                        icon={<Download04Icon size={15} strokeWidth={2} />}
                        title={t('logs.export')}
                        onClick={handleExport}
                    />
                    <CollapsingButton
                        compact={cramped}
                        variant="dangerOutline"
                        icon={<Delete02Icon size={15} strokeWidth={2} />}
                        label={t('common.clear')}
                        onClick={handleClear}
                        disabled={!counts.all}
                        className="shrink-0"
                    />
                </div>
            </div>

            <p className={`-mt-3 max-w-3xl text-sm ${MUTED}`}>
                {t('logs.blurbStart')}
                {counts.actor?.user
                    ? <span className="font-medium text-gray-800 dark:text-gray-200">{` ${counts.actor.user}`}</span>
                    : null}
                {t('logs.blurbEnd')}
            </p>

            <div className="flex items-center gap-2 flex-wrap">
                {FILTERS.map((filter) => {
                    const active = category === filter.id;
                    const count = countFor(filter.id);
                    return (
                        <button
                            key={filter.id || 'all'}
                            onClick={() => setCategory(filter.id)}
                            className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${
                                active
                                    ? 'bg-gray-900 dark:bg-white text-white dark:text-black'
                                    : 'bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-400 '
                                      + 'hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-surface-hover'
                            }`}
                        >
                            {t(filter.labelKey)}
                            {count > 0 && (
                                <span className={`ml-1.5 tabular-nums ${active ? 'opacity-60' : 'opacity-50'}`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}

                <span className="w-px h-5 bg-gray-200 dark:bg-surface-control mx-1" />

                <button
                    onClick={() => setFailuresOnly(value => !value)}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                        failuresOnly
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-400 '
                              + 'hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-surface-hover'
                    }`}
                >
                    <AlertCircleIcon size={13} strokeWidth={2} />
                    {t('logs.problemsOnly')}
                    {(counts.failures || 0) + (counts.warnings || 0) > 0 && (
                        <span className="tabular-nums opacity-60">
                            {(counts.failures || 0) + (counts.warnings || 0)}
                        </span>
                    )}
                </button>
            </div>

            {loading && entries.length === 0 ? (
                <EmptyFrame title={t('logs.reading')} />
            ) : entries.length === 0 ? (
                counts.all ? (
                    <EmptyFrame
                        icon={<SearchRemoveIcon size={28} strokeWidth={1.5} />}
                        title={t('logs.noMatches')}
                        note={t('logs.noMatchesNote')}
                    />
                ) : (
                    <EmptyFrame
                        icon={<TimelineIcon size={28} strokeWidth={1.5} />}
                        title={t('logs.empty')}
                        note={t('logs.emptyNote')}
                    />
                )
            ) : (
                <div className="flex flex-col gap-5 pb-4">
                    {groups.map(group => (
                        <div key={group.key} className="flex flex-col gap-0.5">
                            {/* "Today" earns a real weight rather than the tiny
                                uppercase grey it had: it is the only thing
                                dating the clock times in the column below it. */}
                            <div className="flex items-baseline gap-2.5 px-3 mb-1.5">
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                    {group.label}
                                </span>
                                <span className={`text-[11px] ${FAINT}`}>
                                    {fullDate(group.entries[0].at)}
                                </span>
                                <span className="flex-1 h-px bg-gray-200 dark:bg-surface-control" />
                                <span className={`text-[11px] tabular-nums ${FAINT}`}>
                                    {group.entries.length === 1 ? '1 entry' : `${group.entries.length} entries`}
                                </span>
                            </div>

                            {group.entries.map(entry => (
                                <LogRow key={entry.id} entry={entry} currentActor={counts.actor} />
                            ))}
                        </div>
                    ))}

                    {!exhausted && (
                        <div className="flex justify-center pt-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<ArrowRight01Icon size={14} strokeWidth={2} className="rotate-90" />}
                                onClick={loadMore}
                            >
                                Load older entries
                            </Button>
                        </div>
                    )}

                    {exhausted && counts.all > 0 && (
                        <p className={`pt-1 text-center text-[11px] ${FAINT}`}>
                            {counts.all >= counts.capacity
                                ? `Oldest of ${counts.capacity} kept entries; older activity is dropped as new arrives`
                                : 'That is the whole log'}
                        </p>
                    )}
                </div>
            )}

            {confirming && (
                <ConfirmDialog {...confirming} onCancel={() => setConfirming(null)} />
            )}
        </div>
    );
}

export default memo(LogsPanel);
