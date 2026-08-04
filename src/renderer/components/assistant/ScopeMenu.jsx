import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown01Icon, GlobalIcon, ServerStack03Icon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';
import SearchField from '../ui/SearchField';
import { useTooltip } from '../ui/Tooltip';
import { OsIcon, hostOs } from '../../lib/os-icons';
import { hostKind } from '../../lib/protocols';
import { FOLLOW, GLOBAL, TARGETS, describeSession } from '../../lib/assistant-scope';

/**
 * What the assistant is pointed at, and the menu that changes it.
 *
 * This is the panel's title as well as its most important control, so it is
 * one labelled button rather than a heading with a switcher beside it: the
 * thing you read to know which server you are talking about is the thing you
 * click to change it.
 *
 * Three ways to answer "which servers", and they are not the same shape, so
 * they are not drawn the same way:
 *
 *   Two radio rows at the top, for the two answers that are a mode rather than
 *   a list: follow the session in front, or hold every host you have saved.
 *
 *   Below them, checkboxes. The sessions that are open and the hosts that are
 *   saved, as one pool you tick through. Ticking anything is the answer, so it
 *   turns the rows above off; unticking the last one hands the panel back to
 *   the session in front.
 *
 * Saved hosts are in that list whether or not they are connected, because "work
 * on these two boxes" is a thing you want to say before either of them is open,
 * and the assistant can connect one itself. A host that already has sessions
 * open says so, and ticking it puts all of them in reach.
 *
 * Desktop-only hosts are not in it at all. Every tool the assistant has works
 * through a shell, and a host stored as `desktop.only` has none: it is an RDP
 * or VNC box, usually a Windows one with no SSH server, that opens straight
 * into a picture of a screen. Offering it would be offering a target where
 * nothing can be done. A Windows host reached over SSH is a different thing and
 * stays selectable, because there the assistant can work perfectly well.
 *
 * The rows are the tab strip's rows: the remote OS on the left and the host's
 * name beside it, one line, nothing else. That is the shape these machines
 * already have everywhere else in the app, and a picker that draws them
 * differently is a picker you have to translate. The address is the thing you
 * check when two boxes share a name, so it is a tooltip rather than a second
 * line under every row: read once, on purpose, instead of forty times on the
 * way past. A saved host with nothing open dims its icon, the way a tab does
 * before its session is up.
 *
 * The search field appears once the list is long enough to hunt through. Below
 * that it is a box that costs a row and saves nothing.
 */

/** Above this many rows, scanning stops working and you want to type. */
const SEARCH_AT = 6;

/**
 * The field at the head of the menu.
 *
 * The app's own `SearchField`, not a copy of it: Hosts, Snippets and the
 * keychain all lead with this control and the whole point of that component is
 * that there is one of it. A hand-rolled one here had already drifted into a
 * tighter radius and a placeholder of its own colour.
 *
 * A component rather than a bare node so it can take the focus the moment the
 * menu opens. The header is only mounted then, and an effect belonging to the
 * menu's owner would have fired long before. It also drops what was typed on
 * the way out, so reopening the menu is never a filtered list with nothing on
 * screen saying why half the servers are missing.
 */
function ScopeSearch({ value, onChange }) {
    const ref = useRef(null);

    useEffect(() => {
        ref.current?.focus();
        return () => onChange('');
        // `onChange` is a setter, and this is mount and unmount either way.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <SearchField
            ref={ref}
            value={value}
            onChange={onChange}
            ariaLabel="Search sessions and hosts"
            placeholder="Search servers"
            onKeyDown={(event) => {
                // Escape is claimed while there is something to clear, or the
                // first press shuts the menu rather than emptying the field it
                // was aimed at.
                if (event.key === 'Escape' && value) {
                    event.stopPropagation();
                    onChange('');
                }
            }}
        />
    );
}

function matches(needle, ...fields) {
    if (!needle) return true;
    return fields.filter(Boolean).join(' ').toLowerCase().includes(needle);
}

/* ------------------------------------------------------------------ *
 * The stack in the header
 * ------------------------------------------------------------------ */

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
 * One server in the header, as its OS.
 *
 * Its own component because the tooltip is a hook, and because the tile has to
 * know whether it is the one under the pointer: the stack spreads as a whole,
 * but the one being pointed at lifts clear of the others as well, so a tooltip
 * naming a machine is unambiguous about which tile it came from.
 */
function Tile({ mark, index, spread, depth }) {
    const { triggerProps, tooltip } = useTooltip({
        label: mark.name,
        hint: mark.address,
        placement: 'bottom',
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
 * What the panel is pointed at, drawn rather than spelled out.
 *
 * Overlapping tiles, the way the tab strip stacks a group: at a glance it is
 * how many and roughly which, which is what a title has room to say. Hovering
 * separates them, with a moment of motion so the eye can follow which tile went
 * where, and names the one under the pointer.
 *
 * Capped, with the remainder as a plain count. Nine tiles is not a glance, and
 * the label beside this says the real total either way.
 */
function TargetStack({ marks }) {
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

export default function ScopeMenu({
    scope,
    onSetMode,
    onToggle,
    sessions = [],
    hosts = [],
    activeSessionId = '',
    followLabel,
    scopeLabel,
}) {
    const [query, setQuery] = useState('');

    /**
     * Which hosts already have a terminal open, so a row can say so and a tick
     * on it can be read as covering them. Sessions opened from the Hosts page
     * carry the host they came from; one opened ad hoc carries none and appears
     * only in the sessions list.
     */
    const openByHost = useMemo(() => {
        const map = new Map();
        for (const session of sessions) {
            if (!session.hostId) continue;
            map.set(session.hostId, (map.get(session.hostId) || 0) + 1);
        }
        return map;
    }, [sessions]);

    /**
     * The servers the header draws, in the order they were picked.
     *
     * Sessions first, then hosts, which is the order the menu lists them in:
     * the stack and the list should not disagree about which machine is which.
     * Nothing for "all hosts", where there is no set to draw.
     */
    const marks = useMemo(() => {
        const fromSession = session => ({
            key: `session:${session.sessionId}`,
            os: session.os,
            distro: session.distro,
            name: describeSession(session),
            address: session.address,
            dim: false,
        });

        if (scope.mode === GLOBAL) return [];

        if (scope.mode !== TARGETS) {
            const session = sessions.find(entry => entry.sessionId === activeSessionId);
            return session ? [fromSession(session)] : [];
        }

        const tiles = [];

        for (const id of scope.sessionIds) {
            const session = sessions.find(entry => entry.sessionId === id);
            if (session) tiles.push(fromSession(session));
        }

        for (const id of scope.hostIds) {
            const host = hosts.find(entry => entry.id === id);
            if (!host) continue;
            tiles.push({
                key: `host:${id}`,
                os: hostOs(host),
                distro: host.distro,
                name: host.name || host.host || 'Unnamed host',
                // Same dimming as the menu rows, and for the same reason: a
                // pinned host with nothing open is a target you have not
                // reached yet.
                address: host.host || '',
                dim: !openByHost.get(id),
            });
        }

        return tiles;
    }, [scope, sessions, hosts, activeSessionId, openByHost]);

    const needle = query.trim().toLowerCase();

    /** The session "Current session" is currently naming, for its tooltip. */
    const followed = sessions.find(session => session.sessionId === activeSessionId);

    /**
     * The hosts worth offering: the ones with a shell behind them. See the note
     * at the top of the file for why a desktop-only host is not one of them.
     */
    const selectable = useMemo(
        () => hosts.filter(host => hostKind(host) !== 'desktop'),
        [hosts],
    );

    const shownSessions = useMemo(
        () => sessions.filter(session => matches(needle, session.hostName, session.address)),
        [sessions, needle],
    );

    const shownHosts = useMemo(
        () => selectable.filter(host => matches(needle, host.name, host.host, ...(host.tags || []))),
        [selectable, needle],
    );

    const pinned = scope.mode === TARGETS;

    const sections = [
        {
            // Nothing is on when a set is pinned, which is what says the rows
            // below have taken over rather than sitting alongside these two.
            value: pinned ? '' : scope.mode,
            onChange: onSetMode,
            // One line each, like the server rows below them. What they mean
            // is a hover, not a caption: these two are read once to learn what
            // they do and picked by name every time after that, so a permanent
            // second line on each is two lines of the menu spent explaining
            // something nobody is still reading.
            options: [
                {
                    value: FOLLOW,
                    label: 'Current session',
                    tooltip: followLabel,
                    tooltipHint: followed?.address || '',
                    icon: <ServerStack03Icon size={14} strokeWidth={1.5} />,
                },
                {
                    value: GLOBAL,
                    label: 'All hosts',
                    tooltip: 'Every saved host and open session',
                    icon: <GlobalIcon size={14} strokeWidth={1.5} />,
                },
            ],
        },
    ];

    if (shownSessions.length > 0) {
        sections.push({
            heading: 'Open sessions',
            multi: true,
            values: pinned ? scope.sessionIds : [],
            onToggle: id => onToggle('session', id),
            options: shownSessions.map(session => ({
                value: session.sessionId,
                label: session.hostName || session.address || session.sessionId,
                icon: <OsIcon os={session.os} distro={session.distro} className="w-4 h-4" />,
                // The number the tab strip is showing for this terminal, when
                // it is one of several on the same host. Without it, four
                // sessions on `web-01` are four rows nobody can choose between.
                badge: session.ordinal > 0 ? `#${session.ordinal}` : '',
                tooltip: session.address,
            })),
        });
    }

    if (shownHosts.length > 0) {
        sections.push({
            heading: 'Saved hosts',
            multi: true,
            values: pinned ? scope.hostIds : [],
            onToggle: id => onToggle('host', id),
            options: shownHosts.map((host) => {
                const open = openByHost.get(host.id) || 0;
                return {
                    value: host.id,
                    label: host.name || host.host || 'Unnamed host',
                    icon: <OsIcon os={hostOs(host)} distro={host.distro} className="w-4 h-4" />,
                    // Dimmed with nothing open, as a tab is before its session
                    // comes up. It is the one thing about a host row that is
                    // worth seeing without hovering: whether ticking it means
                    // reaching a terminal or opening one.
                    dim: open === 0,
                    // What ticking this row will mean, spelled out for the one
                    // moment someone wants it rather than on every row forever.
                    tooltip: host.host || host.name || 'Saved host',
                    tooltipHint: open > 0
                        ? `${open} session${open === 1 ? '' : 's'} open`
                        : 'Not connected',
                };
            }),
        });
    }

    if (needle && shownSessions.length === 0 && shownHosts.length === 0) {
        sections.push({
            // `content` rather than `note`, because a section with neither
            // content nor options has no row list for the menu to map over.
            content: (
                <div className="px-2.5 py-3 text-[11px] text-center text-gray-500 dark:text-neutral-400">
                    Nothing matches that
                </div>
            ),
        });
    }

    const total = sessions.length + selectable.length;

    return (
        <PanelMenu
            className="min-w-0 flex-1"
            menuClassName="w-full min-w-[260px]"
            sections={sections}
            header={total > SEARCH_AT ? (
                <ScopeSearch value={query} onChange={setQuery} />
            ) : null}
            trigger={({ open, toggle }) => (
                <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={toggle}
                    className={`w-full h-8 pl-2.5 pr-2 rounded-xl flex items-center gap-1.5 transition-colors
                        outline-none focus-visible:ring-2
                        focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                        ${open
                            ? 'bg-gray-100 dark:bg-white/[0.07]'
                            : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]'}`}
                >
                    {/* The servers themselves, not a logo. The header's job is
                        to say which machine you are talking about, and these
                        are that: an app mark in front of them would be one
                        thing to read before the thing you came to read, but
                        their own icons are the thing you came to read.

                        They also carry the names, on hover, which is what lets
                        the text beside them shrink to a count once there are
                        several. */}
                    <TargetStack marks={marks} />

                    <span className="min-w-0 flex-1 truncate text-left text-xs font-semibold
                        text-gray-800 dark:text-gray-200">
                        {scopeLabel}
                    </span>
                    <ArrowDown01Icon
                        size={12}
                        strokeWidth={2}
                        className={`shrink-0 text-gray-400 dark:text-gray-600 transition-transform
                            ${open ? 'rotate-180' : ''}`}
                    />
                </button>
            )}
        />
    );
}
