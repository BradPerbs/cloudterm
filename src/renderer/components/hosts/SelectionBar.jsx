import { memo, useEffect, useState } from 'react';
import { Cancel01Icon, Delete02Icon, FolderAddIcon, FolderTransferIcon, Tag01Icon } from 'hugeicons-react';
import useEnter from '../../hooks/useEnter';
import Button, { IconButton } from '../ui/Button';
import { useT } from '../../i18n';

/**
 * What you can do with the cards you have picked out.
 *
 * Floats over the list rather than sitting in the header, for two reasons: it
 * exists only while there is a selection, and a bar that appears and disappears
 * in the layout would shove the whole grid up and down as you select and
 * deselect. It is also nearer the cards it is talking about than a header would
 * be, which is where your eyes already are.
 *
 * The actions are not equals, and the row says so: filing a selection is what
 * you selected it for, so `Move` is the only filled thing here and the rest
 * carry no chrome until you touch them, which is the rule stated on `Button`'s
 * own variants. Four bordered buttons of the same weight would have left
 * nothing leading and a red outline shouting from the end of it.
 *
 * `Tag` is the one action that comes and goes: folders are not tagged, so a
 * selection of folders alone is not offered it. Showing it disabled would be
 * worse: a permanently greyed button in a bar that only exists for a moment is
 * a puzzle, not an affordance.
 *
 * It is always one row. A floating bar is sized by its contents while the panel
 * it floats in can be half its width, and both of the ways flexbox offers to
 * cope with that look broken rather than tight: shrinking breaks the text
 * mid-phrase ("3 / selected"), and wrapping strands the last button on a line
 * of its own. So the contents are made to fit instead: nothing shrinks,
 * nothing wraps, and the words stand down to their icons on a narrow window.
 */

/** Where the labelled actions and the count fit beside the sidebar. */
const ROOMY = '(min-width: 1000px)';

function useRoomForLabels() {
    const [roomy, setRoomy] = useState(() => window.matchMedia?.(ROOMY).matches ?? true);

    useEffect(() => {
        const query = window.matchMedia?.(ROOMY);
        if (!query) return undefined;

        const update = () => setRoomy(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    return roomy;
}

/** "2 hosts · 1 folder", and nothing at all when it would only repeat the count. */
function describe(t, hosts, folders) {
    if (hosts === 0 || folders === 0) return '';
    return `${t('hosts.count', { count: hosts })} · ${t('hosts.folderCount', { count: folders })}`;
}

function SelectionBar({ hostCount, folderCount, onMove, onGroup, onTag, onDelete, onClear }) {
    const t = useT();

    /**
     * Rises into place, because it appears under the cursor rather than where
     * the pointer is looking, and something that simply exists on the next
     * frame reads as a repaint rather than an answer. See lib/enterMotion,
     * which also holds the centring across the movement.
     */
    const barRef = useEnter('selection');
    const total = hostCount + folderCount;
    const mixture = describe(t, hostCount, folderCount);
    const roomy = useRoomForLabels();

    // Named once and spent twice, so the bubble on the narrow bar and the label
    // on the wide one can never drift apart.
    const actions = [
        {
            label: t('hosts.move'),
            variant: 'primary',
            onClick: onMove,
            icon: <FolderTransferIcon size={14} strokeWidth={2} />,
        },
        hostCount > 0 && {
            label: t('hosts.tag'),
            variant: 'ghost',
            onClick: onTag,
            icon: <Tag01Icon size={14} strokeWidth={2} />,
        },
        {
            label: t('hosts.newFolder'),
            variant: 'ghost',
            onClick: onGroup,
            icon: <FolderAddIcon size={14} strokeWidth={2} />,
        },
        {
            label: t('common.delete'),
            variant: 'dangerGhost',
            onClick: onDelete,
            icon: <Delete02Icon size={14} strokeWidth={2} />,
        },
    ].filter(Boolean);

    return (
        <div ref={barRef} className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20
            flex flex-nowrap items-center gap-1.5 pl-4 pr-2 py-2 rounded-2xl
            bg-white dark:bg-surface-raised
            border border-gray-200 dark:border-surface-control shadow-2xl">

            {/* One line, one baseline. The breakdown earns its place only when
                the selection is of two kinds; "3 selected · 3 hosts" is the
                same fact twice. */}
            <p className="shrink-0 mr-2 whitespace-nowrap text-[13px] leading-none">
                <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                    {t('hosts.selectedCount', { count: total })}
                </span>
                {mixture && (
                    <span className="ml-2 text-[11px] text-gray-400 dark:text-neutral-500">
                        {mixture}
                    </span>
                )}
            </p>

            {actions.map(({ label, ...action }) => (roomy ? (
                <Button key={label} size="sm" className="shrink-0" {...action}>
                    {label}
                </Button>
            ) : (
                <IconButton
                    key={label}
                    size="sm"
                    title={label}
                    tooltipPlacement="top"
                    className="shrink-0"
                    {...action}
                />
            )))}

            <IconButton
                size="sm"
                variant="ghost"
                onClick={onClear}
                title={t('hosts.clearSelection')}
                hint="Esc"
                tooltipPlacement="top"
                className="shrink-0 ml-1"
                icon={<Cancel01Icon size={14} strokeWidth={2.5} />}
            />
        </div>
    );
}

export default memo(SelectionBar);
