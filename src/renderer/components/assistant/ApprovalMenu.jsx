import { useState } from 'react';
import { ArrowDown01Icon, FlashIcon, SecurityCheckIcon, Shield01Icon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';
import ConfirmDialog from '../ui/ConfirmDialog';

/**
 * What the assistant will do before asking, as a chip in the composer.
 *
 * This is the setting people reach for mid-conversation more than any other:
 * loosen it because the approvals are getting in the way of an investigation,
 * tighten it because the box being worked on turned out to matter. Sending
 * someone to a settings page for that costs them the thread they were pulling
 * on, so the whole choice is here and the settings page keeps the long
 * explanation.
 *
 * Icon only. It is a standing state rather than an action, and the composer row
 * has one label on it already; two competing bits of small text is what makes
 * that row look like a toolbar.
 *
 * Switching to "never ask" is gated behind a confirm. One click from a chip is
 * otherwise how someone turns off every approval without reading what that
 * means for deletes and restarts on live hosts.
 */

const APPROVALS = [
    {
        value: 'always',
        labelKey: 'assistant.approvalAlways',
        hintKey: 'assistant.approvalAlwaysHint',
        icon: <SecurityCheckIcon size={14} strokeWidth={1.5} />,
    },
    {
        value: 'writes',
        labelKey: 'assistant.approvalWrites',
        hintKey: 'assistant.approvalWritesHint',
        icon: <Shield01Icon size={14} strokeWidth={1.5} />,
    },
    {
        value: 'never',
        label: 'Never ask',
        hint: 'Nothing stops, deletes included',
        icon: <FlashIcon size={14} strokeWidth={1.5} />,
    },
];

export default function ApprovalMenu({ settings, onChange }) {
    const [confirmNever, setConfirmNever] = useState(false);
    const current = APPROVALS.find(option => option.value === settings.approval) || APPROVALS[1];

    // The one state worth colouring. Somebody who has turned approvals off and
    // then forgotten deserves to notice before the next destructive command,
    // and the chip is the only place in the panel that can tell them.
    const loud = current.value === 'never';

    const pick = (value) => {
        if (value === 'never' && settings.approval !== 'never') {
            setConfirmNever(true);
            return;
        }
        onChange({ approval: value });
    };

    return (
        <>
            <PanelMenu
                direction="up"
                menuClassName="w-56"
                sections={[
                    {
                        value: settings.approval,
                        onChange: pick,
                        options: APPROVALS,
                    },
                ]}
                trigger={({ open, toggle }) => (
                    <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label={`Approvals: ${current.label}`}
                        onClick={toggle}
                        title={`Approvals: ${current.label}`}
                        className={`h-7 pl-1.5 pr-1 rounded-xl flex items-center gap-0.5 transition-colors
                            outline-none focus-visible:ring-2
                            focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                            ${loud
                                ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-500/10'
                                : open
                                    ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-gray-200'
                                    : 'text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/[0.06] '
                                        + 'hover:text-gray-600 dark:hover:text-gray-400'}`}
                    >
                        {current.icon}
                        <ArrowDown01Icon
                            size={11}
                            strokeWidth={2}
                            className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
                        />
                    </button>
                )}
            />

            {confirmNever && (
                <ConfirmDialog
                    title="Turn off approvals?"
                    message="Never ask runs every tool without stopping — including commands that delete data or restart services on live hosts. Blocked commands are still refused."
                    confirmLabel="Never ask"
                    variant="danger"
                    onConfirm={() => {
                        setConfirmNever(false);
                        onChange({ approval: 'never' });
                    }}
                    onCancel={() => setConfirmNever(false)}
                />
            )}
        </>
    );
}
