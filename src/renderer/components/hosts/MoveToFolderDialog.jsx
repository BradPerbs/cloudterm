import { useMemo, useState } from 'react';
import { Folder02Icon, FolderTransferIcon, Search01Icon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import { FIELD_CLASS } from '../ui/Field';
import { rootLabel, folderLabel, folderSubtree } from '../../lib/organize';
import { useT } from '../../i18n';

/**
 * Where a selection is going.
 *
 * Every folder in the tree, by its full path rather than its own name: two
 * folders called "Production" are the normal case, and "AWS / Production" is
 * the only thing that tells them apart.
 *
 * A folder cannot receive a selection that contains it, or one that contains
 * the folder it is inside: the result would be a branch with no route to it
 * from the root, which is to say hosts that quietly vanish. Those destinations
 * are listed and disabled rather than hidden, so the answer to "where did it
 * go" is on screen instead of being a gap.
 */
export default function MoveToFolderDialog({
    folders,
    movingFolderIds = [],
    sourceId = null,   // where the selection already sits, when they agree
    count,
    onMove,
    onCancel,
}) {
    const t = useT();
    const [query, setQuery] = useState('');

    // Every folder being moved, and everything inside it, at any depth.
    const blocked = useMemo(() => {
        const ids = new Set();
        for (const id of movingFolderIds) {
            for (const inside of folderSubtree(folders, id)) ids.add(inside);
        }
        return ids;
    }, [folders, movingFolderIds]);

    const destinations = useMemo(() => {
        const list = folders
            .map(folder => ({ id: folder.id, label: folderLabel(folders, folder.id) }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

        return [{ id: '', label: rootLabel() }, ...list];
    }, [folders]);

    const shown = useMemo(() => {
        const term = query.trim().toLowerCase();
        if (!term) return destinations;
        return destinations.filter(entry => entry.label.toLowerCase().includes(term));
    }, [destinations, query]);

    return (
        <Dialog
            title={t('hosts.moveTitle', { count })}
            subtitle={t('hosts.moveSubtitle')}
            onClose={onCancel}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center
                    bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-300">
                    <FolderTransferIcon size={20} strokeWidth={2} />
                </span>
            }
            footer={<DialogButton onClick={onCancel}>{t('common.cancel')}</DialogButton>}
        >
            <div className="relative mb-2">
                <Search01Icon
                    size={14}
                    strokeWidth={2}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                {/* Shorter than a form field, so it keeps `rounded-lg`: that is
                    the radius the buttons and tags use at this height, and the
                    `rounded-xl` in `FIELD_CLASS` is for the taller ones. */}
                <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('hosts.findFolder')}
                    spellCheck={false}
                    aria-label={t('hosts.findFolder')}
                    data-autofocus
                    className={`${FIELD_CLASS} pl-9 py-1.5 rounded-lg text-[13px]`}
                />
            </div>

            <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5 -mx-1 px-1">
                {shown.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-neutral-500 px-2 py-6 text-center">
                        {t('hosts.noFolderMatches', { query: query.trim() })}
                    </p>
                )}

                {shown.map((entry) => {
                    const inside = blocked.has(entry.id);
                    const here = entry.id === sourceId;

                    return (
                        <button
                            key={entry.id || 'root'}
                            type="button"
                            disabled={inside || here}
                            onClick={() => onMove(entry.id)}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors
                                text-gray-700 dark:text-gray-300
                                enabled:hover:bg-gray-100 dark:enabled:hover:bg-surface-control
                                disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Folder02Icon size={15} strokeWidth={2} className="shrink-0 opacity-70" />
                            <span className="flex-1 min-w-0 truncate text-[13px] font-medium">
                                {entry.label}
                            </span>
                            {(here || inside) && (
                                <span className="shrink-0 text-[10px] text-gray-400 dark:text-neutral-500">
                                    {here ? t('hosts.alreadyHere') : t('hosts.insideSelection')}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </Dialog>
    );
}
