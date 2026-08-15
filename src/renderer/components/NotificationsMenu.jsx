import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEnterOn } from '../hooks/useEnter';
import { Notification03Icon } from 'hugeicons-react';
import useUpdate from '../hooks/useUpdate';
import Tooltip from './ui/Tooltip';

/**
 * The bell in the title bar and the panel that hangs off it.
 *
 * The release notice is the one thing filling this so far, and it is read here
 * rather than handed down: the title bar takes a dozen props already and has no
 * stake in any of them. Nothing produces the general `items` yet, so the empty
 * state is what is actually on screen most of the time -- an entry is rendered
 * out all the same, because it is the part the feature will need to look right.
 *
 * Anchored by its right edge rather than its left: it sits a few pixels from
 * the window's corner, and a panel that grew rightwards from the button would
 * go straight off the screen.
 */

const PANEL_WIDTH = 288;
const EDGE = 8;

// Shared so the row keeps its shape whether or not it is pressable, and a
// download in flight does not visibly reflow the panel when it finishes.
const NOTICE = 'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left';

/** Placeholder shape, so the panel below reads as the thing it will be. */
// items: { id, title, body, time, unread }

function NotificationItem({ item }) {
    return (
        <button className="w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800">
            <span
                aria-hidden="true"
                className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.unread ? 'bg-blue-500' : 'bg-transparent'
                }`}
            />
            <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-2">
                    <span className={`flex-1 min-w-0 truncate text-xs ${
                        item.unread
                            ? 'font-medium text-gray-900 dark:text-white'
                            : 'font-medium text-gray-500 dark:text-gray-400'
                    }`}>
                        {item.title}
                    </span>
                    {item.time && (
                        <span className="shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-neutral-500">
                            {item.time}
                        </span>
                    )}
                </span>
                {item.body && (
                    <span className="block mt-0.5 text-[11px] leading-snug text-gray-400 dark:text-neutral-500 truncate">
                        {item.body}
                    </span>
                )}
            </span>
        </button>
    );
}

export default function NotificationsMenu({ items = [], onMarkAllRead }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    // Rendered on a condition rather than mounted, so the entrance is asked
    // for each time it opens. See lib/enterMotion.
    useEnterOn(panelRef, open && 'fade');

    // `open` is the panel's own state above, so the browser handoff is renamed
    // rather than shadowed.
    const { status, open: openInBrowser, download, install } = useUpdate();

    // `available` and not `newer`: in notify mode a version the user has
    // already been sent to download is still newer, and still not worth a dot
    // in their title bar. In install mode nothing clears it on the way past,
    // because a downloaded build still has a restart to ask for and the dot is
    // the only thing asking.
    const update = status?.available ? status.latest : null;

    const ready = Boolean(status?.ready);
    const downloading = Boolean(status?.downloading);

    // Written once and used by the tooltip, the screen reader label and the row
    // itself, so the three cannot drift into describing different states.
    const summary = !update ? '' : ready
        ? `Version ${status.readyVersion} is ready to install`
        : downloading
            ? `Downloading version ${update.version}`
            : `Version ${update.version} is available`;

    // What pressing the row does. A download in flight has nothing to offer,
    // so it reports a percentage and is not a button at all.
    const verb = ready ? 'Restart' : downloading ? `${status.progress ?? 0}%` : 'Download';
    const act = ready
        ? install
        : downloading
            ? null
            // "Download" means two different things by mode, and both are
            // honest: fetch it, or go and get it yourself.
            : (status?.mode === 'install' ? download : openInBrowser);

    const unread = items.filter(item => item.unread).length;

    // The row's insides, lifted out because the row is a button most of the
    // time and a plain div while a download is running.
    const notice = (
        <>
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-xs font-medium text-gray-900 dark:text-white">
                {summary}
            </span>
            {/* Never "Update" on its own. Each of the three says what the press
                actually does: fetch it, go and get it, or close the app. */}
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                {verb}
            </span>
        </>
    );

    const close = useCallback(() => setOpen(false), []);

    // Measured before paint, or the panel shows up at the top-left of the
    // window for a frame on its way to the corner.
    useLayoutEffect(() => {
        if (!open || !btnRef.current) return;
        const rect = btnRef.current.getBoundingClientRect();
        setPos({
            top: rect.bottom + 6,
            right: Math.max(EDGE, window.innerWidth - rect.right),
        });
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const handlePointer = (event) => {
            if (panelRef.current?.contains(event.target)) return;
            if (btnRef.current?.contains(event.target)) return;
            close();
        };
        const handleKey = (event) => { if (event.key === 'Escape') close(); };

        document.addEventListener('mousedown', handlePointer);
        document.addEventListener('keydown', handleKey);
        window.addEventListener('resize', close);
        window.addEventListener('blur', close);
        return () => {
            document.removeEventListener('mousedown', handlePointer);
            document.removeEventListener('keydown', handleKey);
            window.removeEventListener('resize', close);
            window.removeEventListener('blur', close);
        };
    }, [open, close]);

    return (
        <div className="shrink-0 app-no-drag">
            <Tooltip
                label={summary || 'Notifications'}
                enabled={!open}
            >
                <button
                    ref={btnRef}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-label={summary
                        ? `Notifications, ${summary.toLowerCase()}`
                        : (unread ? `Notifications (${unread} unread)` : 'Notifications')}
                    className={`relative w-8 h-8 flex items-center justify-center rounded-xl transition-colors ${
                        open
                            ? 'bg-gray-200 dark:bg-white/10'
                            : 'bg-transparent hover:bg-gray-200 dark:hover:bg-white/10'
                    }`}
                    onClick={() => setOpen(prev => !prev)}
                >
                    <Notification03Icon
                        className={`w-4 h-4 ${
                            open
                                ? 'text-gray-900 dark:text-white'
                                : 'text-gray-500 dark:text-gray-400'
                        }`}
                        size={16}
                        strokeWidth={2}
                    />

                    {/* A waiting build is the one thing here worth a colour of
                        its own, and it outranks the unread count: only one dot
                        ever shows, and green means there is a new version.
                        Ringed in the bar's own background so it stays legible
                        where it overlaps the bell's outline. */}
                    {(update || unread > 0) && (
                        <span
                            aria-hidden="true"
                            className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full
                                ring-2 ring-white dark:ring-surface-base ${
                                update ? 'bg-emerald-500' : 'bg-blue-500'
                            }`}
                        />
                    )}
                </button>
            </Tooltip>

            {open && createPortal(
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="Notifications"
                    className="fixed p-1 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200
                        dark:border-neutral-700 shadow-xl z-[9999] app-no-drag"
                    style={{
                        top: pos?.top ?? -9999,
                        right: pos?.right ?? EDGE,
                        width: PANEL_WIDTH,
                        visibility: pos ? 'visible' : 'hidden',
                    }}
                >
                    {/* No title bar on the panel: it hangs off the bell, which
                        already says what it is. "Mark all read" appears only
                        when there is something to mark. */}
                    {unread > 0 && (
                        <div className="flex justify-end px-1 pt-0.5 pb-1">
                            <button
                                className="text-[10px] font-medium text-gray-400 dark:text-neutral-500
                                    hover:text-gray-900 dark:hover:text-white transition-colors"
                                onClick={() => onMarkAllRead?.()}
                            >
                                Mark all read
                            </button>
                        </div>
                    )}

                    {/* The update sits at the top and stays there: it is the one
                        row that is worth acting on rather than reading. */}
                    {update && (
                        <>
                            {act ? (
                                <button
                                    className={`${NOTICE} transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800`}
                                    onClick={() => { close(); act(); }}
                                >
                                    {notice}
                                </button>
                            ) : (
                                // A download in flight. Nothing to press, so
                                // nothing that looks pressable.
                                <div className={NOTICE}>{notice}</div>
                            )}
                            {items.length > 0 && (
                                <div className="-mx-1 my-1 border-t border-gray-100 dark:border-neutral-800" />
                            )}
                        </>
                    )}

                    {items.length > 0 ? (
                        <div className="max-h-[280px] overflow-y-auto">
                            {items.map(item => (
                                <NotificationItem key={item.id} item={item} />
                            ))}
                        </div>
                    ) : !update && (
                        <div className="px-2 py-5 text-center text-[11px] text-gray-400 dark:text-neutral-500">
                            No notifications
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
