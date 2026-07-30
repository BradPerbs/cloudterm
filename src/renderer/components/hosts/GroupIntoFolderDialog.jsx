import { useState } from 'react';
import { FolderAddIcon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import { FIELD_CLASS } from '../ui/Field';

/**
 * Name the folder a selection is about to be gathered into.
 *
 * A whole sheet for one field would be more ceremony than the act deserves, and
 * the folder editor would also have to be told to file the selection afterwards,
 * which is not something it otherwise knows how to do.
 */
export default function GroupIntoFolderDialog({ count, parentLabel, onCreate, onCancel }) {
    const [name, setName] = useState('New folder');
    const [busy, setBusy] = useState(false);

    const trimmed = name.trim();

    const submit = async () => {
        if (!trimmed || busy) return;
        setBusy(true);
        try {
            await onCreate(trimmed);
        } finally {
            // The dialog is unmounted by the caller on success; on failure it
            // stays up with the name still in it, so the attempt is not lost.
            setBusy(false);
        }
    };

    return (
        <Dialog
            title="New folder from selection"
            subtitle={`${count} item${count === 1 ? '' : 's'} will be moved into it, inside ${parentLabel}.`}
            onClose={busy ? undefined : onCancel}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center
                    bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-300">
                    <FolderAddIcon size={20} strokeWidth={2} />
                </span>
            }
            footer={
                <>
                    <DialogButton onClick={onCancel} disabled={busy}>Cancel</DialogButton>
                    <DialogButton variant="primary" onClick={submit} disabled={!trimmed || busy}>
                        {busy ? 'Creating…' : 'Create folder'}
                    </DialogButton>
                </>
            }
        >
            <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    submit();
                }}
                onFocus={(event) => event.target.select()}
                placeholder="Folder name"
                spellCheck={false}
                aria-label="Folder name"
                data-autofocus
                className={FIELD_CLASS}
            />
        </Dialog>
    );
}
