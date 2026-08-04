import { memo } from 'react';
import { ArrowLeft01Icon, CloudIcon } from 'hugeicons-react';
import { syncedFolder } from '../../lib/server-sync';
import { IconButton } from '../ui/Button';

/**
 * Where you are in the folder tree, and the way back out.
 *
 * Every crumb is also a drop target, which is what makes moving a card *up* a
 * level possible at all: there is no card to aim at for "out of here", so the
 * path itself has to be one. Dropping on the crumb you are already standing in
 * is a no-op, so it stays inert.
 *
 * The account folder keeps its mark here as well as on its card, because
 * standing inside it is exactly where the card is no longer on screen to say
 * so.
 */
function HostsBreadcrumb({ path, dropTargetId, onNavigate }) {
    const parentId = path.length > 1 ? path[path.length - 2].id : null;

    return (
        <div className="flex items-center gap-1.5 shrink-0" id="breadcrumb">
            {parentId !== null && (
                <IconButton
                    size="sm"
                    variant="ghost"
                    title="Up one level"
                    onClick={() => onNavigate(parentId)}
                    icon={<ArrowLeft01Icon size={16} strokeWidth={2} />}
                    className="-ml-1 mr-0.5"
                />
            )}

            {path.map((crumb, index) => {
                const isCurrent = index === path.length - 1;
                const isDropTarget = dropTargetId === crumb.id && !isCurrent;
                // The crumb you are standing in is not somewhere to move to.
                const dropId = isCurrent ? undefined : crumb.id;
                const isSynced = syncedFolder(crumb.id) === 'account';

                return (
                    <span key={crumb.id || 'root'} className="flex items-center gap-1.5 min-w-0">
                        {index > 0 && (
                            <span className="text-gray-300 dark:text-neutral-600 select-none" aria-hidden="true">›</span>
                        )}
                        <button
                            type="button"
                            aria-current={isCurrent ? 'page' : undefined}
                            onClick={() => onNavigate(crumb.id)}
                            data-drop-folder={dropId}
                            title={isSynced ? 'Synced from your CloudBlast account' : undefined}
                            className={`breadcrumb-item max-w-[14rem] truncate px-2 py-1 -mx-0.5 rounded-lg
                                text-sm font-medium transition-colors outline-none
                                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                                ${isCurrent
                                    ? 'text-gray-900 dark:text-white'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control'}
                                ${isDropTarget
                                    ? 'bg-gray-900/[0.07] dark:bg-surface-hover text-gray-900 dark:text-white ring-2 ring-gray-900/20 dark:ring-white/25'
                                    : ''}`}
                        >
                            <span className="flex items-center gap-1 min-w-0">
                                {/* Inherits the crumb's own colour, so it dims
                                    and lights with the name rather than being a
                                    second thing to look at. */}
                                {isSynced && (
                                    <CloudIcon size={13} strokeWidth={2.5} className="shrink-0 opacity-70" />
                                )}
                                <span className="truncate">{crumb.name}</span>
                            </span>
                        </button>
                    </span>
                );
            })}
        </div>
    );
}

export default memo(HostsBreadcrumb);
