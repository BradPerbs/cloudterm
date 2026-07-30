import { useState } from 'react';
import { LockKeyIcon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import Checkbox from '../ui/Checkbox';
import { formatMode } from '../../lib/format';

const CLASSES = [
    { key: 'owner', label: 'Owner', shift: 6 },
    { key: 'group', label: 'Group', shift: 3 },
    { key: 'other', label: 'Others', shift: 0 },
];

const BITS = [
    { key: 'read', label: 'Read', value: 4 },
    { key: 'write', label: 'Write', value: 2 },
    { key: 'execute', label: 'Execute', value: 1 },
];

/** chmod, driven either by the checkbox grid or by typing the octal directly. */
export default function PermissionsModal({ entry, onApply, onClose }) {
    const [mode, setMode] = useState((entry.mode || 0) & 0o7777);
    const [octal, setOctal] = useState(((entry.mode || 0) & 0o7777).toString(8).padStart(3, '0'));
    const [recursive, setRecursive] = useState(false);

    const setBoth = (next) => {
        setMode(next);
        setOctal(next.toString(8).padStart(3, '0'));
    };

    const toggle = (shift, value) => setBoth(mode ^ (value << shift));

    const handleOctal = (raw) => {
        const cleaned = raw.replace(/[^0-7]/g, '').slice(0, 4);
        setOctal(cleaned);
        if (cleaned) setMode(parseInt(cleaned, 8) & 0o7777);
    };

    return (
        <Dialog
            title="Permissions"
            subtitle={entry.name}
            onClose={onClose}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-500">
                    <LockKeyIcon size={20} strokeWidth={2} />
                </span>
            }
            footer={
                <>
                    <DialogButton onClick={onClose}>Cancel</DialogButton>
                    <DialogButton
                        variant="primary"
                        onClick={() => onApply(mode, recursive)}
                        disabled={!octal}
                    >
                        Apply
                    </DialogButton>
                </>
            }
        >
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-neutral-500">
                        <th className="text-left pb-2 font-semibold" />
                        {BITS.map(bit => (
                            <th key={bit.key} className="pb-2 font-semibold w-20">{bit.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {CLASSES.map(({ key, label, shift }) => (
                        <tr key={key}>
                            <td className="py-1.5 font-medium text-gray-700 dark:text-gray-300">{label}</td>
                            {BITS.map(bit => (
                                <td key={bit.key} className="py-1.5 text-center">
                                    <Checkbox
                                        size="sm"
                                        checked={Boolean(mode & (bit.value << shift))}
                                        onChange={() => toggle(shift, bit.value)}
                                        aria-label={`${label} ${bit.label}`}
                                    />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-surface-control">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Octal</label>
                <input
                    type="text"
                    value={octal}
                    onChange={(event) => handleOctal(event.target.value)}
                    className="w-24 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-surface-control bg-white dark:bg-surface-base text-gray-900 dark:text-white font-mono text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white"
                    data-autofocus
                />
                <span className="font-mono text-sm text-gray-500 dark:text-gray-400">
                    {formatMode(mode, { isDirectory: entry.isDirectory, isSymlink: entry.isSymlink })}
                </span>
            </div>

            {entry.isDirectory && (
                <Checkbox
                    className="mt-3"
                    checked={recursive}
                    onChange={(event) => setRecursive(event.target.checked)}
                    label="Apply to all contents"
                />
            )}
        </Dialog>
    );
}
