import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Cancel01Icon } from 'hugeicons-react';
import { setSheetAway, slideSheet } from '../../lib/panelMotion';

/**
 * A card that rises from the bottom and rests over the page it came from.
 *
 * It stops short of the top edge, so a strip of the page stays visible above
 * it and the two read as sheets of paper stacked slightly out of line. That
 * offset is the whole idea: the page is still there, still the thing you were
 * working in, and this is laid over it rather than replacing it.
 *
 * It fills the content region instead of floating at some width of its own,
 * which is what keeps two different sheets looking like the same object. A
 * panel that picks its own width has nothing to line up with.
 *
 * `onClose` fires after the exit transition, so the caller can unmount on it
 * without the card vanishing mid-slide. `dismiss` is how the page underneath
 * asks for the same thing — see the prop.
 */

/** How much of the page is left showing above the sheet. */
const TOP_OFFSET = 20;

/**
 * Focus without letting the browser scroll to find the target.
 *
 * This matters more than it looks. The sheet mounts already translated fully
 * off the bottom, so at the moment focus lands its fields are outside the
 * visible box. Left alone the browser scrolls the nearest scrollable ancestor
 * to bring them into view, which drags the page behind the sheet sideways and
 * up while the sheet is still sliding: the animation looks broken because two
 * things are moving, only one of them on purpose.
 */
const focusQuietly = (element) => element?.focus?.({ preventScroll: true });

/**
 * `dismiss` is a token the caller changes to close the sheet from outside.
 *
 * It exists because the obvious way — the caller flipping the flag it mounts
 * the sheet on — cuts the exit off: the card is gone on the next paint instead
 * of dropping away. Handing the request in lets the sheet leave the way it
 * leaves on Escape, and the caller still unmounts, just on the `onClose` at the
 * end of it. Any change counts, so a counter is the usual thing to pass.
 */
export default function Sheet({ title, subtitle, footer, onClose, dismiss, children }) {
    const panelRef = useRef(null);
    const scrimRef = useRef(null);

    // Guards the exit: a second Escape while it is already sliding out would
    // queue a second onClose.
    const closing = useRef(false);

    /**
     * Out and back. The exit reports its own end, so the caller unmounts as the
     * card lands rather than on a timer set just short of a transition.
     */
    const close = useCallback(() => {
        if (closing.current) return;
        closing.current = true;

        slideSheet({
            card: panelRef.current,
            scrim: scrimRef.current,
            open: false,
            onComplete: onClose,
        });
    }, [onClose]);

    /**
     * Put where it comes from, then sent where it is going. Both in one layout
     * effect, because GSAP reads the card as it stands rather than needing a
     * painted frame at the old value first: this is where the pair of nested
     * animation frames used to be, and the state they existed to flip.
     *
     * StrictMode mounts, unmounts and remounts, so the rise is dropped on the
     * way out and simply played again by the second mount.
     */
    useLayoutEffect(() => {
        setSheetAway(panelRef.current, scrimRef.current);
        const rise = slideSheet({
            card: panelRef.current,
            scrim: scrimRef.current,
            open: true,
        });
        return () => rise.kill();
    }, []);

    // The token the sheet was mounted under. Only a change means anything; the
    // value itself is nobody's business here.
    const openedAt = useRef(dismiss);

    useEffect(() => {
        if (dismiss !== openedAt.current) close();
    }, [dismiss, close]);

    useEffect(() => {
        const handleKey = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
                return;
            }

            if (event.key !== 'Tab' || !panelRef.current) return;

            const focusable = panelRef.current.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                focusQuietly(last);
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                focusQuietly(first);
            }
        };

        document.addEventListener('keydown', handleKey, true);
        return () => document.removeEventListener('keydown', handleKey, true);
    }, [close]);

    // Move focus in so Escape and Tab work without a click first.
    useEffect(() => {
        focusQuietly(
            panelRef.current?.querySelector('[data-autofocus]')
            || panelRef.current?.querySelector('input, textarea, button')
        );
    }, []);

    // Mounted into the content region rather than the body, so it covers the
    // page it belongs to and stops at the sidebar instead of the window edge.
    const container = document.getElementById('main-content') || document.body;

    /**
     * `children` and `footer` may be functions, which are handed the animated
     * close. Saving has to go out the same way cancelling does; the caller
     * unmounting the sheet the moment a save succeeds skips the exit and the
     * card vanishes instead of leaving.
     */
    const render = (node) => (typeof node === 'function' ? node(close) : node);

    return createPortal(
        <div className="absolute inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={title}>
            {/* Light on purpose. The strip of page above the sheet is the thing
                that makes this read as stacked rather than as a new screen, and
                a heavy scrim buries it. */}
            <div
                ref={scrimRef}
                onClick={close}
                className="absolute inset-0 bg-black/20"
            />

            <div
                ref={panelRef}
                className="absolute left-0 right-0 bottom-0 flex flex-col
                    bg-white dark:bg-surface-raised
                    border-t border-x border-gray-200 dark:border-surface-control
                    rounded-t-2xl overflow-hidden"
                style={{
                    top: TOP_OFFSET,
                    // Promoted to its own compositor layer, so the whole form
                    // subtree and the shadow below are rasterised once and only
                    // moved after that. Without it every frame of the slide
                    // repaints the card and the fields inside it.
                    willChange: 'transform',
                    // Tight rather than broad: a wide blur under a full-width
                    // moving element is the other half of the same cost.
                    boxShadow: '0 -6px 20px -6px rgba(0, 0, 0, 0.3)',
                }}
            >
                <div className="shrink-0 flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gray-100 dark:border-surface-control">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                            {title}
                        </h2>
                        {subtitle && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                {subtitle}
                            </p>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={close}
                        aria-label="Close"
                        title="Close (Esc)"
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                    >
                        <Cancel01Icon size={16} strokeWidth={2} />
                    </button>
                </div>

                {/* The form is capped rather than run edge to edge: a field box
                    the width of the window is unreadable and unpleasant to fill. */}
                <div className="flex-1 overflow-y-auto px-6 py-6">
                    <div className="max-w-2xl mx-auto">{render(children)}</div>
                </div>

                {footer && (
                    <div className="shrink-0 border-t border-gray-100 dark:border-surface-control px-6 py-4">
                        <div className="max-w-2xl mx-auto flex items-center justify-end gap-2">
                            {render(footer)}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        container
    );
}

// Footer actions use the shared `Button`. A sheet-specific button would be one
// more place for the app's controls to drift out of line with each other.
