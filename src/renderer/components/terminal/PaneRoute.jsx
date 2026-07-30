import { memo } from 'react';
import { Route02Icon } from 'hugeicons-react';
import Tooltip from '../ui/Tooltip';
import { useRdp } from '../../hooks/useRdp';
import { useVnc } from '../../hooks/useVnc';

/**
 * The mark in a pane header saying where this session goes, and what it goes
 * through on the way.
 *
 * It replaces the `user@host` the header used to write out, which was the same
 * string on every pane of a session and only ever half the answer: it said where
 * the session ends up and nothing about what carries it, so a connection relayed
 * through a bastion or opened through a proxy looked identical to a direct one.
 *
 * `route` is what main reported at connect time (see `describeRoute` in ssh.js),
 * so it describes the connection that exists rather than the settings, which may
 * have been edited since. It carries no wording, only structure: main records
 * what happened, this file decides how it reads.
 *
 * The hops are laid out as a column of dots joined by a hairline, so the shape of
 * a route is visible before any of it is read, and the destination is told from
 * what merely carries the connection by weight rather than by colour.
 */

/**
 * The dot for each position in the path.
 *
 * Monochrome on purpose: what each hop is is written on the row beside it, so a
 * colour per kind would be a second, redundant encoding, and a row of primaries
 * in a header this quiet reads as an alert rather than as information. The
 * destination is solid; everything that only carries the connection is not.
 */
const DOTS = {
    origin: 'bg-gray-400 dark:bg-gray-500',
    proxy: 'bg-gray-400 dark:bg-gray-500',
    jump: 'bg-gray-400 dark:bg-gray-500',
    host: 'bg-gray-900 dark:bg-white',
};

/*
 * There is deliberately no "proxy" or "jump host" label on a row. A proxy's
 * address names its protocol (`SOCKS5 10.0.0.1:1080`) so it is already saying what
 * it is, the last row is where the session ends up, and anything between the two
 * is carrying it. A word for each of those had to sit somewhere, and everywhere it
 * could sit was away from the name it belonged to.
 */

function PaneRoute({ route = [] }) {
    // Nothing until there is a live connection to describe: a mark on a pane that
    // is still dialling, or on a serial line that reaches no network, would point
    // at a path that does not exist.
    if (!Array.isArray(route) || route.length === 0) return null;

    const hops = [{ kind: 'origin', label: 'This machine' }, ...route];

    /*
     * One row per hop, and nothing on a row but the hop: its dot, its name, and
     * its address directly after the name.
     *
     * Not a grid of aligned columns, which is what this was. Aligning the
     * addresses meant every one of them started where the *longest* name in the
     * path put them, so a hop with a short name had its address sitting a long way
     * from it, and anything placed after the addresses ended up further out
     * still. Ragged and adjacent beats aligned and adrift, especially over the two
     * to four rows a path ever has.
     */
    const path = (
        <span className="flex flex-col gap-2">
            {hops.map((hop, index) => (
                <span key={`${hop.label}-${index}`} className="flex items-center gap-2">
                    {/* The dot, with a hairline reaching back to the one above it,
                        so the column reads as one route rather than as a list of
                        unrelated servers. The segment is exactly the row gap, so
                        the line is continuous and stops at both ends. */}
                    <span className="relative flex w-2.5 shrink-0 items-center justify-center self-stretch">
                        {index > 0 && (
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 h-2 w-px
                                bg-gray-200 dark:bg-neutral-600" />
                        )}
                        {/* `block` and `shrink-0` are not decoration: a span is
                            inline by default, and width and height do nothing to
                            an inline box, so a dot that ever stops being a flex
                            item collapses. 8px rather than 6, because a 6px
                            circle beside a 1px line reads as a tick. */}
                        <span
                            className={`block w-2 h-2 shrink-0 rounded-full ${DOTS[hop.kind] || DOTS.origin}`}
                        />
                    </span>

                    <span className="font-semibold text-gray-900 dark:text-white">
                        {hop.label || 'Unnamed'}
                    </span>

                    {/* Dropped where it would only restate the name, which is what
                        an unnamed proxy listed by its address does. */}
                    {hop.detail && hop.detail !== hop.label && (
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                            {hop.detail}
                        </span>
                    )}
                </span>
            ))}
        </span>
    );

    return (
        <Tooltip label={path}>
            {/* A bare glyph. It sits beside a pane's name for the whole life of
                the session, so it reads as part of the chrome, and the same
                muted-to-bright hover the header's own buttons use is enough to
                say it has something to show. */}
            <span
                role="img"
                aria-label={`Connection path: ${hops.map(hop => hop.label).join(', then ')}`}
                className="shrink-0 flex items-center cursor-default text-gray-400 dark:text-neutral-500
                    hover:text-gray-900 dark:hover:text-white transition-colors"
            >
                <Route02Icon size={14} strokeWidth={2} />
            </span>
        </Tooltip>
    );
}

export default memo(PaneRoute);

/**
 * The same mark for a pane that is only a desktop.
 *
 * Those panes never dial SSH, so there is no session whose path could be shown:
 * the connection is the desktop's own, and main reports its path on the desktop
 * session instead. Both hooks are read because the pane is one or the other and
 * the idle one simply has no session; they are passive subscriptions, so this
 * neither opens nor closes anything.
 *
 * Mounted only for those panes, which is why the subscription is here rather than
 * in the header: an ordinary session pane has no use for it.
 */
function DesktopPaneRouteInner({ paneId, isRdp }) {
    const rdp = useRdp(paneId);
    const vnc = useVnc(paneId);
    const session = isRdp ? rdp.session : vnc.session;

    return <PaneRoute route={session?.route} />;
}

export const DesktopPaneRoute = memo(DesktopPaneRouteInner);
