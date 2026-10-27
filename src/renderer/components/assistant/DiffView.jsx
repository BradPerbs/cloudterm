import { useState } from 'react';
import { useT } from '../../i18n';

/**
 * What an edit changed, drawn the way a diff is read.
 *
 * An edit used to show its arguments: the passage before and the passage
 * after as two blocks of text, which a person has to compare by eye to see
 * what moved, and a whole-file write showed nothing but its path. This is the
 * same information laid out as lines, removed above added, coloured, with the
 * count in the header. It is drawn on the approval card before the edit is
 * made, which is where it matters most, on the tool row once it is, and in
 * the files-changed card at the end of a turn.
 *
 * The main process works the lines out (see ai/diff.js), so this only draws
 * them and the same block serves every runtime's edit tool.
 *
 * A long change opens on its first lines with a button for the rest, so a
 * rewritten config does not push the reply and the composer off the panel.
 */

/** Lines shown before the rest is folded behind a button. */
const COLLAPSED_LINES = 24;

const NUMBER = `w-9 shrink-0 select-none pr-2 text-right tabular-nums
    text-gray-400 dark:text-neutral-500`;

const TONE = {
    add: {
        line: 'bg-emerald-500/[0.10] text-emerald-800 dark:text-emerald-300',
        sign: 'text-emerald-600 dark:text-emerald-400',
    },
    remove: {
        line: 'bg-red-500/[0.09] text-red-800 dark:text-red-300',
        sign: 'text-red-600 dark:text-red-400',
    },
    same: {
        line: 'text-gray-500 dark:text-gray-400',
        sign: 'text-transparent',
    },
};

const SIGN = { add: '+', remove: '-', same: ' ' };

/** How many lines went in and came out, in the diff's own colours. */
export function DiffCounts({ added = 0, removed = 0, className = '' }) {
    return (
        <span className={`shrink-0 flex items-center gap-1.5 text-[11px] font-medium tabular-nums ${className}`}>
            <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
            <span className="text-red-600 dark:text-red-400">-{removed}</span>
        </span>
    );
}

/**
 * One run of changed lines and the context around it. A run after the first
 * is set off by a gap mark, or by its file's name in a patch that spans
 * several. Numbered only when the numbers mean something: a passage taken out
 * of the middle of a file has none that would be true.
 */
function Hunk({ hunk, previous, numbered }) {
    const newFile = hunk.file && hunk.file !== previous?.file;
    return (
        <div>
            {newFile ? (
                <div className="px-2.5 pt-1.5 pb-0.5 text-[10.5px] select-none text-gray-500 dark:text-gray-400">
                    {hunk.file}
                </div>
            ) : previous && (
                <div aria-hidden="true" className="px-2.5 text-[10px] leading-4 select-none text-gray-400 dark:text-neutral-500">
                    ⋯
                </div>
            )}
            {hunk.lines.map((line, at) => {
                const tone = TONE[line.type] || TONE.same;
                return (
                    <div key={at} className={`flex ${tone.line}`}>
                        {numbered && (
                            <span className={NUMBER} aria-hidden="true">
                                {line.after ?? line.before ?? ''}
                            </span>
                        )}
                        <span
                            aria-hidden="true"
                            className={`w-4 shrink-0 select-none text-center ${tone.sign} ${numbered ? '' : 'ml-1'}`}
                        >
                            {SIGN[line.type]}
                        </span>
                        <span className="whitespace-pre pr-2.5">{line.text || ' '}</span>
                    </div>
                );
            })}
        </div>
    );
}

/** The hunks cut to `limit` lines, across hunk boundaries. */
function cut(hunks, limit) {
    const shown = [];
    let room = limit;
    for (const hunk of hunks) {
        if (room <= 0) break;
        const lines = hunk.lines.length > room ? hunk.lines.slice(0, room) : hunk.lines;
        shown.push(lines === hunk.lines ? hunk : { ...hunk, lines });
        room -= lines.length;
    }
    return shown;
}

/**
 * `header` off for a diff under a row that already names the file and counts
 * its lines. `path` is named in the header when given; `note` is a few words
 * after it, such as "every match" for an edit that replaces them all.
 */
export default function DiffView({ diff, path = '', note = '', header = true, className = '' }) {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    if (!diff) return null;

    const hunks = Array.isArray(diff.hunks) ? diff.hunks : [];
    const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
    const long = total > COLLAPSED_LINES + 4;
    const shown = long && !expanded ? cut(hunks, COLLAPSED_LINES) : hunks;
    const name = path || '';

    return (
        <div className={`min-w-0 ${className}`}>
            {header && (
                <div className="px-2.5 h-7 flex items-center gap-2 select-none
                    border-b border-black/[0.06] dark:border-white/[0.06]">
                    {name && (
                        <span
                            className="min-w-0 truncate font-jetbrains text-[11px] text-gray-600 dark:text-gray-400"
                            title={name}
                        >
                            {name}
                        </span>
                    )}
                    {(note || diff.whole) && (
                        <span className="min-w-0 truncate text-[11px] text-gray-400 dark:text-gray-500">
                            {[note, diff.whole ? t('assistant.diffWholeFile') : ''].filter(Boolean).join(' · ')}
                        </span>
                    )}
                    <DiffCounts added={diff.added} removed={diff.removed} className="ml-auto" />
                </div>
            )}

            {diff.tooLarge ? (
                <p className="px-2.5 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                    {t('assistant.diffTooLarge')}
                </p>
            ) : (
                // Scrolls on its own in both directions: a long line must not
                // stretch the panel, and an opened long change must not bury
                // the reply under it. The inner box is as wide as the widest
                // line, so every line's tint runs the same length.
                <div className="max-h-96 overflow-auto font-jetbrains text-[11px] leading-[1.6] py-1">
                    <div className="w-max min-w-full">
                        {shown.map((hunk, index) => (
                            <Hunk
                                key={`${hunk.file || ''}-${hunk.before}-${hunk.after}-${index}`}
                                hunk={hunk}
                                previous={shown[index - 1]}
                                numbered={!diff.partial}
                            />
                        ))}
                    </div>
                </div>
            )}

            {(long || diff.hidden > 0) && !diff.tooLarge && (
                <div className="px-2.5 h-7 flex items-center gap-3 select-none
                    border-t border-black/[0.06] dark:border-white/[0.06]">
                    {long && (
                        <button
                            type="button"
                            onClick={() => setExpanded(value => !value)}
                            className="text-[11px] font-medium transition-colors
                                text-gray-500 dark:text-gray-400
                                hover:text-gray-900 dark:hover:text-white"
                        >
                            {expanded ? t('assistant.diffShowLess') : t('assistant.diffShowAll', { count: total })}
                        </button>
                    )}
                    {diff.hidden > 0 && (expanded || !long) && (
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                            {t('assistant.diffHidden', { count: diff.hidden })}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
