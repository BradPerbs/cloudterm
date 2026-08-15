import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEnterOn } from '../../hooks/useEnter';

/**
 * Right-click menu. Items are `{ label, icon, onClick, danger, disabled }`,
 * `{ type: 'separator' }`, `{ type: 'heading', label }`, or
 * `{ type: 'custom', key, render(close) }` for a control that is not a row of
 * text: a swatch strip, say, where eight choices in a line are the whole point
 * and eight stacked rows would not be.
 *
 * The position is clamped to the viewport so a menu opened near the bottom edge
 * still shows all of its items.
 */
export default function ContextMenu({ x, y, items, onClose }) {
    const ref = useRef(null);
    const [position, setPosition] = useState({ left: x, top: y, ready: false });

    useLayoutEffect(() => {
        const menu = ref.current;
        if (!menu) return;

        const { width, height } = menu.getBoundingClientRect();
        const margin = 8;

        setPosition({
            left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
            top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
            ready: true,
        });
    }, [x, y, items.length]);

    useEffect(() => {
        const dismiss = () => onClose();
        const handleKey = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };

        // `mousedown` rather than `click`, so the menu is gone before whatever
        // is underneath it reacts to the press.
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', handleKey, true);
        window.addEventListener('blur', dismiss);
        window.addEventListener('resize', dismiss);

        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', handleKey, true);
            window.removeEventListener('blur', dismiss);
            window.removeEventListener('resize', dismiss);
        };
    }, [onClose]);

    // Comes down from where it was asked for. See lib/enterMotion.
    useEnterOn(ref, 'menu');

    const visible = items.filter(Boolean);

    return createPortal(
        <div
            ref={ref}
            className="fixed z-[300] min-w-[190px] p-1 rounded-xl bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-control shadow-2xl"
            style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            role="menu"
        >
            {visible.map((item, index) => item.type === 'separator' ? (
                <div key={`sep-${index}`} className="-mx-1 my-1 border-t border-gray-100 dark:border-surface-control" />
            ) : item.type === 'heading' ? (
                <div
                    key={`head-${index}`}
                    className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider
                        text-gray-400 dark:text-neutral-500"
                >
                    {item.label}
                </div>
            ) : item.type === 'custom' ? (
                // Given the closer, since a control in here still has to be able
                // to dismiss the menu it lives in.
                <div key={item.key || `custom-${index}`} className="px-1 py-1.5">
                    {item.render(onClose)}
                </div>
            ) : (
                <button
                    key={item.label}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                        onClose();
                        item.onClick();
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        item.danger
                            ? 'text-red-600 dark:text-red-400 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-900/20'
                            : 'text-gray-700 dark:text-gray-300 enabled:hover:bg-gray-100 dark:enabled:hover:bg-surface-control'
                    }`}
                >
                    <span className="shrink-0 w-4 flex items-center justify-center">{item.icon}</span>
                    <span className="flex-1 font-medium">{item.label}</span>
                    {item.shortcut && (
                        <span className="text-[10px] text-gray-400 dark:text-neutral-500 ml-3">
                            {item.shortcut}
                        </span>
                    )}
                </button>
            ))}
        </div>,
        document.body
    );
}
