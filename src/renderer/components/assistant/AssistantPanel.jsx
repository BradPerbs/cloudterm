import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import AgentMark from './AgentMark';
import AssistantWorkspace from './AssistantWorkspace';
import { HeaderButton } from './AssistantConversation';
import { APP_GUTTER, PANE_HEADER_HEIGHT } from '../../lib/layout';
import { revealAssistant, setAssistantWidth } from '../../lib/panelMotion';
import { useT } from '../../i18n';

/**
 * The assistant panel.
 *
 * A column beside the terminal rather than an overlay on top of it, because
 * almost everything it is useful for involves reading the screen it would
 * otherwise be covering. It is one panel for the whole window, not one per
 * pane: a conversation about a server usually turns into a conversation about
 * the one next to it, and a per-pane panel would mean starting again.
 *
 * It is built as its own card, the way `#main-content` is, with the shell's
 * gutter between the two rather than a border against it. Butting a flat
 * panel up against a rounded card leaves a sliver of background trapped in the
 * corner, which is the one arrangement that looks like a mistake rather than a
 * choice.
 *
 * Everything inside is laid out on one spacing step, and the transcript owns
 * the rhythm through a single `space-y` rather than each kind of item carrying
 * its own margins. That is what stops a run of tool calls and replies from
 * drifting into uneven bands.
 */

const MIN_WIDTH = 340;
const MAX_WIDTH = 720;

/** Wide enough to centre a 32px button, and no wider. */
const RAIL_WIDTH = 40;

/**
 * The card, matching `#main-content`'s 16px radius and surface.
 *
 * Deliberately not `overflow-hidden`: nothing inside paints into the corners,
 * and clipping the card would cut the shadow off the scope menu that opens
 * inside it.
 */
const CARD = 'rounded-2xl bg-white/60 dark:bg-surface-raised';


/**
 * The column the assistant lives in, open or shut.
 *
 * One element that changes width, not two swapped for each other: a swap has
 * nothing to animate between, and the rail is the same column with everything
 * but the button clipped off. That is how the sidebar opens on the other side
 * of the window, and this is the same motion mirrored and shortened.
 *
 * The card keeps its full width the whole way and the column clips it, rather
 * than the card being squeezed and stretched. Reflowing a transcript, a
 * markdown block and a growing textarea on every frame of a 180ms slide is
 * both expensive and ugly: the text rewraps four times on the way in. Clipped,
 * the panel is laid out once and then revealed.
 *
 * It is pinned to the right edge for the same reason the sidebar's items are
 * pinned to the left: whatever is already on screen should stay where it is
 * while the rest arrives beside it.
 *
 * The movement itself is GSAP's, from `lib/panelMotion`, which is also where
 * the sidebar's is and where the curve both share is written down. The width
 * is GSAP's to write, so it is not in a `style` prop here.
 */
export default function AssistantPanel({
    open,
    sessions,
    hosts,
    activeSessionId,
    width,
    onWidthChange,
    onOpenSettings,
    onOpenSnippets,
    /** Tabs handed back from a window of the assistant's own. */
    adopt,
    onOpen,
    onClose,
}) {
    const t = useT();

    // Which of the two states the column is drawn in. Not the same thing as
    // `open` while the panel is on its way, since the card has to be there to
    // be revealed and has to stay there long enough to be collapsed.
    const [wide, setWide] = useState(open);

    // The card, which outlives `open` by the length of the slide so there is
    // something to collapse. Everything in it is dropped at the end, exactly as
    // it was when the panel was mounted and unmounted outright.
    const [mounted, setMounted] = useState(open);

    // True from the moment `open` changes until the column has arrived. It
    // carries the clip, and a settled column has none: the resize handle has to
    // move the edge on the frame it is dragged, and the menus inside the card
    // have to be able to cast a shadow past it.
    const [sliding, setSliding] = useState(false);

    /** The column, and the two things that cross fade inside it. */
    const columnRef = useRef(null);
    const railRef = useRef(null);
    const cardRef = useRef(null);

    // The state the column has been told about, so the first render does not
    // animate from itself to itself.
    const drawn = useRef(open);

    /**
     * All of it at once, where this used to spend two frames painting the
     * column at its old width so that a CSS transition had something to start
     * from. GSAP reads the width off the column as it stands, so there is
     * nothing to wait for.
     */
    useEffect(() => {
        if (drawn.current === open) return;
        drawn.current = open;

        setSliding(true);
        setWide(open);
        if (open) setMounted(true);
    }, [open]);

    /**
     * The movement, run once the column has been rendered in its new state:
     * opening mounts the card in the same commit, and it has to be there
     * before there is anything to fade in.
     *
     * `shown` tells a reveal from the two other reasons this runs, both of
     * which want the width outright and no movement at all: the first render,
     * and the resize handle dragging the edge of a panel already open. It is
     * also what makes StrictMode's second mount harmless.
     */
    const shown = useRef(wide);

    /**
     * The reveal in flight. Dropped before another starts, because a panel
     * flicked shut halfway open would otherwise leave the first one to report
     * an arrival that is no longer happening, and the clip would come off in
     * the middle of the second slide.
     */
    const reveal = useRef(null);

    useLayoutEffect(() => {
        const column = columnRef.current;
        if (!column) return;

        if (shown.current === wide) {
            // Not while a reveal has the column: a width arriving from anywhere
            // else mid-slide would put the edge at the far end of a movement
            // that is still playing.
            if (!sliding) setAssistantWidth(column, wide ? width : RAIL_WIDTH);
            return;
        }
        shown.current = wide;

        reveal.current?.kill();
        reveal.current = revealAssistant({
            column,
            rail: railRef.current,
            card: cardRef.current,
            width: wide ? width : RAIL_WIDTH,
            open: wide,
            onComplete: () => {
                setSliding(false);
                if (!wide) setMounted(false);
            },
        });
    }, [wide, width, sliding]);

    // A reveal outliving the panel would go on writing to elements that are no
    // longer anywhere. Unmount only: killing it on any other change would strip
    // the clip off a slide that is still running.
    useEffect(() => () => reveal.current?.kill(), []);

    /** The grab strip, which lives in the gutter between the two cards. */
    const startResize = useCallback((event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;

        const onMove = (move) => {
            // Dragging left widens, so the delta is inverted.
            const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - move.clientX)));
            onWidthChange(next);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [width, onWidthChange]);

    return (
        <div
            ref={columnRef}
            className="relative shrink-0 bg-gray-100 dark:bg-surface-base"
            style={{
                paddingLeft: APP_GUTTER,
                overflow: sliding ? 'hidden' : 'visible',
            }}
        >
            {/* In the gutter, over the gap rather than over either card. Not
                there mid-slide, where it would only offer to resize a panel
                that has not finished arriving. */}
            {wide && !sliding && (
                <div
                    className="absolute left-0 inset-y-0 z-10 cursor-col-resize group"
                    style={{ width: APP_GUTTER }}
                    onMouseDown={startResize}
                >
                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 rounded-full
                        bg-transparent group-hover:bg-gray-900/15 dark:group-hover:bg-white/15 transition-colors" />
                </div>
            )}

            {/* The button that is there when the panel is not. Drawn on the
                shell background rather than as a card, exactly as the sidebar
                is on the other side: it is chrome holding a gutter, not a
                surface. It sits in a block the height of a pane header, on the
                edge the card's own header buttons land on, so the two cross
                fade in place instead of one sliding out from under the other. */}
            {(!wide || sliding) && (
                <div
                    ref={railRef}
                    className="absolute right-0 top-0 flex items-center justify-center"
                    style={{
                        width: RAIL_WIDTH,
                        height: PANE_HEADER_HEIGHT,
                        pointerEvents: wide ? 'none' : 'auto',
                    }}
                >
                    <HeaderButton
                        title={t('assistant.title')}
                        hint="Ctrl+Shift+A"
                        placement="left"
                        icon={<AgentMark size={20} mono />}
                        onClick={onOpen}
                    />
                </div>
            )}

            {mounted && (
                <aside
                    ref={cardRef}
                    className={`absolute inset-y-0 right-0 flex flex-col ${CARD}`}
                    style={{
                        width,
                        // Nothing to click on a panel that is on its way in or
                        // out, and the half of it hanging outside the clip is
                        // not there to be aimed at.
                        pointerEvents: wide ? 'auto' : 'none',
                    }}
                >
                    <AssistantWorkspace
                        sessions={sessions}
                        hosts={hosts}
                        activeSessionId={activeSessionId}
                        adopt={adopt}
                        onOpenSettings={onOpenSettings}
                        onOpenSnippets={onOpenSnippets}
                        onClose={onClose}
                    />
                </aside>
            )}
        </div>
    );
}
