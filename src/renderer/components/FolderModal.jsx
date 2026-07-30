import { memo, useCallback, useRef, useState } from 'react';
import Sheet from './ui/Sheet';
import Button from './ui/Button';
import { FIELD_CLASS } from './ui/Field';

/**
 * Mounted only while open: the sheet owns the enter and exit animations and
 * calls `onClose` once it has finished leaving, so there is no `isOpen` or
 * `isClosing` bookkeeping to keep in step here.
 */
function FolderModal({ folder, dismiss, onClose, onSave }) {
    const [name, setName] = useState(folder?.name || '');
    const formRef = useRef(null);

    /**
     * `reportValidity` keeps the browser's own `required` handling now that the
     * action sits in the sheet footer, outside the form. The close is the
     * sheet's animated one, so saving leaves the same way cancelling does.
     */
    const submit = useCallback(async (close) => {
        if (!formRef.current?.reportValidity()) return;
        try {
            await onSave({ id: folder?.id, name });
        } catch {
            // Stay open so a failed save does not discard what was typed.
            return;
        }
        close();
    }, [folder, name, onSave]);

    return (
        <Sheet
            title={folder ? 'Edit folder' : 'New folder'}
            subtitle="Folders group hosts. Deleting one keeps whatever was inside it."
            dismiss={dismiss}
            onClose={onClose}
            footer={(close) => (
                <>
                    <Button onClick={close}>Cancel</Button>
                    <Button variant="primary" onClick={() => submit(close)}>
                        {folder ? 'Save folder' : 'Create folder'}
                    </Button>
                </>
            )}
        >
            {(close) => (
                <form
                    ref={formRef}
                    onSubmit={(event) => { event.preventDefault(); submit(close); }}
                    className="flex flex-col gap-5"
                >
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Folder name
                        </span>
                        <input
                            data-autofocus
                            type="text"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className={FIELD_CLASS}
                            placeholder="e.g. AWS Servers"
                            required
                        />
                    </label>
                </form>
            )}
        </Sheet>
    );
}

export default memo(FolderModal);
