import { useState } from 'react';
import { FileSyncIcon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import Checkbox from '../ui/Checkbox';
import { formatSize, formatDateTime } from '../../lib/format';

function Comparison({ label, size, modifiedAt, highlight }) {
    return (
        <div className={`flex-1 rounded-xl border p-3 ${
            highlight
                ? 'border-gray-900/20 dark:border-white/20 bg-gray-50 dark:bg-surface-control/60'
                : 'border-gray-200 dark:border-surface-control'
        }`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-neutral-500">
                {label}
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white mt-1 tabular-nums">
                {formatSize(size)}
            </p>
            {modifiedAt !== undefined && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {formatDateTime(modifiedAt)}
                </p>
            )}
        </div>
    );
}

/**
 * Raised when a transfer is about to write over something that already exists.
 * The transfer is parked in the main process until this resolves, so every
 * path out of here has to send a decision.
 */
export default function ConflictDialog({ conflict, onRespond }) {
    const [applyToAll, setApplyToAll] = useState(false);

    const respond = (action) => onRespond({ action, applyToAll });

    const canResume = conflict.targetSize > 0 && conflict.targetSize < conflict.sourceSize;

    return (
        <Dialog
            width="32rem"
            title="File already exists"
            subtitle={conflict.destination}
            onClose={() => respond('cancel')}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-900/20 text-amber-500">
                    <FileSyncIcon size={20} strokeWidth={2} />
                </span>
            }
            footer={
                <>
                    <DialogButton onClick={() => respond('cancel')}>Cancel transfer</DialogButton>
                    <DialogButton onClick={() => respond('skip')}>Skip</DialogButton>
                    {canResume && (
                        <DialogButton onClick={() => respond('resume')}>Resume</DialogButton>
                    )}
                    <DialogButton onClick={() => respond('rename')}>Keep both</DialogButton>
                    <DialogButton variant="danger" onClick={() => respond('overwrite')} data-autofocus>
                        Overwrite
                    </DialogButton>
                </>
            }
        >
            <div className="flex gap-3">
                <Comparison label="Incoming" size={conflict.sourceSize} highlight />
                <Comparison
                    label="Existing"
                    size={conflict.targetSize}
                    modifiedAt={conflict.targetModifiedAt}
                />
            </div>

            {canResume && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    The existing file is smaller. <strong>Resume</strong> appends the missing
                    {' '}{formatSize(conflict.sourceSize - conflict.targetSize)} instead of starting over.
                </p>
            )}

            <Checkbox
                className="mt-4"
                checked={applyToAll}
                onChange={(event) => setApplyToAll(event.target.checked)}
                label="Apply to the rest of this transfer"
            />
        </Dialog>
    );
}
