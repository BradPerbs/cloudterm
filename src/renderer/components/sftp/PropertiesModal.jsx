import { InformationCircleIcon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import { formatSize, formatDateTime, formatMode, formatOctal } from '../../lib/format';

function Row({ label, children, mono }) {
    return (
        <div className="flex gap-4 py-2 border-b border-gray-100 dark:border-surface-control/70 last:border-0">
            <span className="w-32 shrink-0 text-sm text-gray-500 dark:text-gray-400">{label}</span>
            <span className={`text-sm text-gray-900 dark:text-white min-w-0 break-all ${mono ? 'font-mono' : ''}`}>
                {children}
            </span>
        </div>
    );
}

const kindOf = (entry) => {
    if (entry.isSymlink) return entry.targetIsDirectory ? 'Symbolic link (directory)' : 'Symbolic link';
    if (entry.isDirectory) return 'Directory';
    return 'File';
};

export default function PropertiesModal({ entry, path, onClose }) {
    return (
        <Dialog
            width="30rem"
            title={entry.name}
            subtitle={kindOf(entry)}
            onClose={onClose}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-400">
                    <InformationCircleIcon size={20} strokeWidth={2} />
                </span>
            }
            footer={<DialogButton variant="primary" onClick={onClose} data-autofocus>Close</DialogButton>}
        >
            <div className="flex flex-col">
                <Row label="Path" mono>{path}</Row>
                {!entry.isDirectory && <Row label="Size" >{formatSize(entry.size)} ({entry.size.toLocaleString()} bytes)</Row>}
                <Row label="Permissions" mono>
                    {formatMode(entry.mode, entry)} · {formatOctal(entry.mode)}
                </Row>
                <Row label="Owner">
                    {entry.uid === null ? 'unknown' : `uid ${entry.uid}`}
                    {entry.gid !== null && ` · gid ${entry.gid}`}
                </Row>
                <Row label="Modified">{formatDateTime(entry.modifyTime)}</Row>
                <Row label="Accessed">{formatDateTime(entry.accessTime)}</Row>
                {entry.isSymlink && (
                    <Row label="Link target" mono>
                        {entry.linkTarget || 'unresolved'}
                        {entry.broken && ' (broken)'}
                    </Row>
                )}
            </div>
        </Dialog>
    );
}
