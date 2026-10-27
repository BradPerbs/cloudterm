import { useCallback, useRef, useState } from 'react';
import { ArrowDown01Icon, FileEditIcon, Tick01Icon, Undo02Icon } from 'hugeicons-react';
import Reveal from '../ui/Reveal';
import Tooltip from '../ui/Tooltip';
import DiffView, { DiffCounts } from './DiffView';
import { useT } from '../../i18n';

/**
 * The files a turn changed, as a card at its foot.
 *
 * A turn that edits files through the app's own write_file and edit_file, or
 * through a runtime's own edit tool on this computer, ends with this card
 * naming each file and how many lines it gained and lost: the answer to "what
 * did it just do to my server" without scrolling back through every row. Each
 * file opens to its diff, and Undo puts every one back as it was before the
 * turn, removing the files the turn created.
 *
 * Undo goes file by file and says how each one went. A file that has changed
 * since the turn is refused rather than overwritten, as is one on a server
 * with no session open to it. Trying again later only touches the ones not
 * yet back. See ai/checkpoints.js for what is kept and for how long.
 *
 * The diffs are asked for when a file is opened rather than carried on the
 * event: they are whole files' worth of change, and the transcript on disk
 * has a budget. A branch's copy of the card (`from`) reads them from the chat
 * that made the change, and offers no undo of its own: the files are shared,
 * and undoing belongs to that chat.
 *
 *   applied    what the turn left, with Undo offered
 *   reverted   every file is back; the card stays, saying so
 *   partial    some could not be put back, each saying why; Undo tries the rest
 */

/** Why a file was left as it is, by the code main gives. */
const REASONS = {
    changed: 'assistant.undoChanged',
    gone: 'assistant.undoGone',
    unreadable: 'assistant.undoUnreadable',
    closed: 'assistant.undoClosed',
    notKept: 'assistant.undoNotKept',
    failed: 'assistant.undoFailed',
};

/** A path as the folder it is in and the file's own name, the host in front of a server's. */
function splitPath(file) {
    const full = String(file.path || '');
    const at = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
    const folder = at >= 0 ? full.slice(0, at + 1) : '';
    return {
        folder: file.where === 'remote' && file.host ? `${file.host}:${folder}` : folder,
        name: at >= 0 ? full.slice(at + 1) : full,
    };
}

function FileRow({ file, open, onToggle, result, struck, change, unavailable }) {
    const t = useT();
    const { folder, name } = splitPath(file);
    return (
        <div>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                title={file.path}
                className="w-full min-w-0 h-8 px-2.5 flex items-center gap-2 text-left select-none
                    transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]"
            >
                <span className="min-w-0 flex-1 flex items-baseline text-[11px] font-jetbrains">
                    <span className="min-w-0 truncate text-gray-400 dark:text-gray-500">{folder}</span>
                    <span className="shrink-0 text-gray-700 dark:text-gray-200">{name}</span>
                </span>
                {file.created && (
                    <span className="shrink-0 text-[10.5px] text-gray-400 dark:text-gray-500">{t('assistant.fileCreated')}</span>
                )}
                <DiffCounts
                    added={file.added || 0}
                    removed={file.removed || 0}
                    className={struck ? 'opacity-50 line-through' : ''}
                />
                <ArrowDown01Icon
                    size={13}
                    strokeWidth={2}
                    className={`shrink-0 text-gray-400 dark:text-gray-600 transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>
            {result && (
                <p className={`px-2.5 pb-1.5 -mt-0.5 text-[11px] leading-snug ${result.ok
                    ? 'text-gray-500 dark:text-gray-400'
                    : 'text-amber-700 dark:text-amber-400'}`}
                >
                    {result.text}
                </p>
            )}
            <Reveal open={open}>
                <div className="select-text border-t border-black/[0.06] dark:border-white/[0.06]">
                    {change ? (
                        <DiffView diff={change} header={false} />
                    ) : (
                        <p className="px-2.5 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                            {unavailable ? t('assistant.reviewUnavailable') : t('assistant.loadingReview')}
                        </p>
                    )}
                </div>
            </Reveal>
        </div>
    );
}

export default function FilesChanged({ item, conversationId, onRevert }) {
    const t = useT();
    const [reverting, setReverting] = useState(false);
    const [problem, setProblem] = useState('');
    const [open, setOpen] = useState(() => new Set());
    const [diffs, setDiffs] = useState(null);
    const [missing, setMissing] = useState(false);
    const asked = useRef(false);

    const files = item.files || [];
    const added = files.reduce((total, file) => total + (file.added || 0), 0);
    const removed = files.reduce((total, file) => total + (file.removed || 0), 0);
    const reverted = item.status === 'reverted';
    const inherited = Boolean(item.from);
    const source = item.from || conversationId;

    // The lines, once, the first time any of them is wanted.
    const loadDiffs = useCallback(() => {
        if (asked.current || !source) return;
        asked.current = true;
        Promise.resolve(window.api.ai.turnChanges?.(source, item.turnId))
            .then((answer) => {
                if (!answer?.found) {
                    setMissing(true);
                    return;
                }
                setDiffs(new Map(answer.files.map(file => [file.id, file.diff])));
            })
            .catch(() => setMissing(true));
    }, [source, item.turnId]);

    const toggle = useCallback((id) => {
        loadDiffs();
        setOpen((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, [loadDiffs]);

    const undo = useCallback(async () => {
        if (reverting || !onRevert) return;
        setReverting(true);
        setProblem('');
        try {
            // Main says no only when it holds nothing for this turn: the
            // conversation is gone, or the turn has aged out of what is kept.
            const answer = await onRevert(item.turnId);
            if (answer && answer.success === false) setProblem(t('assistant.undoNothingKept'));
        } finally {
            setReverting(false);
        }
    }, [reverting, onRevert, item.turnId, t]);

    // How each file came out of the undo, by its id: back, or why not.
    const failed = new Map((item.failed || []).map(entry => [entry.id, entry]));
    const back = new Set(item.reverted || []);
    const resultOf = (file) => {
        const failure = failed.get(file.id);
        if (failure) {
            return {
                ok: false,
                text: t(REASONS[failure.reason] || REASONS.failed, {
                    host: failure.host || file.host || '',
                    message: failure.message || '',
                }),
            };
        }
        if (back.has(file.path) || reverted) {
            return { ok: true, text: file.created ? t('assistant.undoRemoved') : t('assistant.undoRestored') };
        }
        if (file.kept === false && !inherited) return { ok: false, text: t(REASONS.notKept) };
        return null;
    };

    return (
        <div className="rounded-lg bg-gray-50 dark:bg-white/[0.035] overflow-hidden select-none">
            <div className="h-9 px-2.5 flex items-center gap-2">
                {reverted
                    ? <Undo02Icon size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
                    : <FileEditIcon size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />}
                <span className="min-w-0 truncate text-[11px] font-medium text-gray-700 dark:text-gray-300">
                    {reverted
                        ? t('assistant.filesReverted', { count: files.length })
                        : t('assistant.filesChanged', { count: files.length })}
                </span>
                <DiffCounts added={added} removed={removed} className={reverted ? 'opacity-50 line-through' : ''} />

                <span className="ml-auto" />
                {inherited && (
                    <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                        {t('assistant.filesFromEarlier')}
                    </span>
                )}
                {reverted && (
                    <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        <Tick01Icon size={13} strokeWidth={2.25} className="text-emerald-600 dark:text-emerald-400" />
                        {t('assistant.undone')}
                    </span>
                )}
                {!inherited && !reverted && onRevert && (
                    <Tooltip label={t('assistant.undoHint')} placement="top">
                        <button
                            type="button"
                            onClick={undo}
                            disabled={reverting}
                            className="h-6 px-2 shrink-0 flex items-center gap-1.5 rounded-md
                                text-[11px] font-medium transition-colors outline-none border
                                text-gray-700 dark:text-gray-200
                                border-gray-300 dark:border-white/[0.16]
                                hover:bg-gray-100 hover:border-gray-400
                                dark:hover:bg-white/[0.08] dark:hover:border-white/[0.28]
                                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                                disabled:opacity-60 disabled:cursor-default"
                        >
                            <Undo02Icon size={12} strokeWidth={2} />
                            {reverting
                                ? t('assistant.undoing')
                                : item.status === 'partial' ? t('assistant.undoRest') : t('assistant.undo')}
                        </button>
                    </Tooltip>
                )}
            </div>

            {problem && (
                <p className="px-2.5 pb-2 -mt-1 text-[11px] text-red-600 dark:text-red-400">{problem}</p>
            )}

            <div className="border-t border-black/[0.06] dark:border-white/[0.06] py-0.5">
                {files.map(file => (
                    <FileRow
                        key={file.id || `${file.where}:${file.host}:${file.path}`}
                        file={file}
                        open={open.has(file.id)}
                        onToggle={() => toggle(file.id)}
                        result={resultOf(file)}
                        struck={reverted || back.has(file.path)}
                        change={diffs?.get(file.id) || null}
                        unavailable={missing || Boolean(diffs && !diffs.get(file.id))}
                    />
                ))}
            </div>
        </div>
    );
}
