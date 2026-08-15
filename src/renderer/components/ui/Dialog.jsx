import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TITLE_BAR_BOTTOM } from '../../lib/layout';
import useEnter, { useEnterOn } from '../../hooks/useEnter';

/**
 * Centred modal shell shared by the SFTP dialogs. Escape closes, focus is
 * trapped inside, and the backdrop starts below the title bar so the window
 * stays draggable while a dialog is up.
 */
export default function Dialog({ title, subtitle, icon, onClose, children, footer, width = '28rem' }) {
    const cardRef = useRef(null);

    // The scrim arrives, the card comes up out of it. See lib/enterMotion.
    const scrimRef = useEnter('fade');
    useEnterOn(cardRef, 'dialog');

    useEffect(() => {
        const handleKey = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose?.();
                return;
            }

            if (event.key !== 'Tab' || !cardRef.current) return;

            const focusable = cardRef.current.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKey, true);
        return () => document.removeEventListener('keydown', handleKey, true);
    }, [onClose]);

    // Move focus in so Escape and Tab work without a click first.
    useEffect(() => {
        const target = cardRef.current?.querySelector('[data-autofocus]')
            || cardRef.current?.querySelector('button, input');
        target?.focus();
    }, []);

    return createPortal(
        <div
            className="fixed left-0 right-0 bottom-0 z-[200] flex items-center justify-center p-6"
            style={{ top: TITLE_BAR_BOTTOM }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <div
                ref={scrimRef}
                className="absolute inset-0 bg-black/40 backdrop-blur-[3px]"
                onClick={onClose}
            />

            <div
                ref={cardRef}
                className="relative w-full bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-control rounded-2xl shadow-2xl flex flex-col max-h-full"
                style={{ maxWidth: width }}
            >
                <div className="flex items-start gap-3 p-5 pb-4">
                    {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
                        {subtitle && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>

                {children && <div className="px-5 pb-2 overflow-y-auto">{children}</div>}

                {footer && (
                    <div className="flex items-center justify-end gap-2 p-5 pt-4 border-t border-gray-100 dark:border-surface-control mt-2">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}

export function DialogButton({ variant = 'ghost', children, ...props }) {
    const styles = {
        primary: 'bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90',
        danger: 'bg-red-600 text-white hover:bg-red-500',
        ghost: 'border border-gray-300 dark:border-surface-control text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-control',
    };

    return (
        <button
            type="button"
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]}`}
            {...props}
        >
            {children}
        </button>
    );
}
