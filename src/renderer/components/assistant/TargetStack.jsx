import { useState } from 'react';
import { useTooltip } from '../ui/Tooltip';
import { OsIcon } from '../../lib/os-icons';

/**
 * A set of servers, drawn rather than spelled out.
 *
 * Overlapping tiles, the way the tab strip stacks a group: at a glance it is
 * how many and roughly which, which is what a title has room to say. Hovering
 * separates them, with a moment of motion so the eye can follow which tile went
 * where, and names the one under the pointer.
 *
 * The panel header uses this to say what the conversation is pointed at, and an
 * approval card uses it to say where a command is about to run. They are the
 * same question asked twice, so they are drawn once, here.
 *
 * A mark is `{ key, os, distro, name, address, dim }`. `name` and `address` are
 * the tooltip's two lines, so a stack of four boxes that share a name is still
 * one you can tell apart without opening anything.
 */

/** Tiles past this many stop being a glance and start being a list. */
const MAX_TILES = 4;

/** How far each tile hides under the one before it, and how far it spreads. */
const OVERLAP = -7;
const SPREAD = 2;

/**
 * An opaque chip with an outline, because these overlap: a translucent tile
 * would show the one underneath through it, and without the ring two white
 * squares half on top of each other read as one wide rounded box.
 */
const TILE = `relative w-5 h-5 rounded-md shrink-0 flex items-center justify-center
    bg-white dark:bg-surface-control
    ring-1 ring-black/10 dark:ring-white/[0.12]
    transition-all duration-200 ease-out`;

/**
 * One server, as its OS.
 *
 * Its own component because the tooltip is a hook, and because the tile has to
 * know whether it is the one under the pointer: the stack spreads as a whole,
 * but the one being pointed at lifts clear of the others as well, so a tooltip
 * naming a machine is unambiguous about which tile it came from.
 */
function Tile({ mark, index, spread, depth, placement }) {
    const { triggerProps, tooltip } = useTooltip({
        label: mark.name,
        hint: mark.address,
        placement,
    });

    const [lifted, setLifted] = useState(false);

    return (
        <span
            {...triggerProps}
            onMouseEnter={(event) => {
                triggerProps.onMouseEnter?.(event);
                setLifted(true);
            }}
            onMouseLeave={(event) => {
                triggerProps.onMouseLeave?.(event);
                setLifted(false);
            }}
            className={`${TILE} ${lifted ? 'ring-gray-400 dark:ring-white/30' : ''}`}
            style={{
                marginLeft: index === 0 ? 0 : (spread ? SPREAD : OVERLAP),
                // The leftmost sits on top at rest, so every tile shows its own
                // left edge rather than a sliver of the one behind it. The one
                // being pointed at goes above all of them.
                zIndex: lifted ? depth + 1 : depth - index,
                transform: lifted ? 'translateY(-1px) scale(1.1)' : 'none',
            }}
        >
            <OsIcon
                os={mark.os}
                distro={mark.distro}
                className={`w-3.5 h-3.5 ${mark.dim ? 'opacity-40' : ''}`}
            />
            {tooltip}
        </span>
    );
}

/**
 * Capped, with the remainder as a plain count. Nine tiles is not a glance, and
 * whatever label sits beside this says the real total either way.
 */
export default function TargetStack({ marks, placement = 'bottom' }) {
    const [spread, setSpread] = useState(false);

    if (marks.length === 0) return null;

    const shown = marks.slice(0, MAX_TILES);
    const rest = marks.length - shown.length;

    return (
        // The spread is the container's, not each tile's. Driven per tile, the
        // 2px gap the spread opens up is a gap the pointer crosses between
        // them, and the stack would collapse and reopen on the way from one to
        // the next.
        <span
            className="flex items-center shrink-0 pr-0.5"
            onMouseEnter={() => setSpread(true)}
            onMouseLeave={() => setSpread(false)}
        >
            {shown.map((mark, index) => (
                <Tile
                    key={mark.key}
                    mark={mark}
                    index={index}
                    spread={spread}
                    depth={marks.length}
                    placement={placement}
                />
            ))}

            {rest > 0 && (
                <span
                    className={`${TILE} text-[9px] font-semibold tabular-nums
                        text-gray-500 dark:text-neutral-400`}
                    style={{ marginLeft: spread ? SPREAD : OVERLAP, zIndex: 0 }}
                >
                    +{rest}
                </span>
            )}
        </span>
    );
}
