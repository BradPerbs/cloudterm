import { memo, useCallback } from 'react';
import { Copy01Icon, Delete02Icon, Edit02Icon, MoreVerticalIcon } from 'hugeicons-react';
import { OsIcon } from '../lib/os-icons';
import { DEFAULT_PORTS, hostKind, protocolLabel } from '../lib/protocols';
import IconTile from './hosts/IconTile';
import MenuButton from './ui/MenuButton';
import Tag from './ui/Tag';

/**
 * One host, as a tile in the grid or a row in the list.
 *
 * Two lines, always: what it is called, and what it connects with and as whom.
 * Anything else that is worth saying rides on the end of the second line rather
 * than opening a third one; a card that grows a line for some hosts and not
 * others makes a grid of them look broken. Tags obey that rule too: they sit at
 * the end of the second line, however many of them a host is carrying.
 *
 * Both layouts are the same component because they hold the same things in the
 * same order, and the only real difference is whether that runs across or down.
 */

/** The card is the connect button, so the controls on it opt out of that click. */
const stop = (event) => event.stopPropagation();

/**
 * How many tags a card draws before it starts counting them instead.
 *
 * A grid tile is a quarter of the window at its widest and is already carrying
 * an address; a list row has the whole width to spend. Past the cap the rest
 * become "+3", which is honest about there being more without letting a host
 * with nine tags squeeze its own address off the card.
 */
const TAG_LIMIT = { grid: 2, list: 4 };

function HostCard({
    host,
    view = 'grid',
    folderLabel = '',
    connected = false,
    dragging = false,
    selected = false,
    onEdit,
    onDuplicate,
    onDelete,
    onConnect,
    onPick,
    onTagClick,
    ...dragProps      // data-card-id and the pointer handle, from useCardDrag
}) {
    const isList = view === 'list';

    const handleClick = useCallback((event) => {
        if (event.target.closest('[data-action]')) return;
        // Held modifier: the click is about which cards you mean, not about
        // opening one, which is what it means everywhere else that has a
        // multiple selection.
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            onPick?.(event);
            return;
        }
        onConnect();
    }, [onConnect, onPick]);

    // Enter and Space reach the card through the keyboard; without them a host
    // could be tabbed to and not opened.
    const handleKeyDown = useCallback((event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onConnect();
    }, [onConnect]);

    const protocol = host.protocol || 'ssh';
    const kind = hostKind(host);

    /**
     * What this host connects with, and as whom.
     *
     * Not the address any more. A host left unnamed is listed by its address, so
     * on those cards the line underneath was repeating the line above it, and on
     * the rest it was spending the card's one spare line on the thing least
     * likely to be being looked for. What is written nowhere else is the
     * protocol and the account — which is also what tells two hosts on the same
     * machine apart. The address is kept on the line's tooltip rather than
     * dropped.
     *
     * A desktop names the protocol it draws with, since RDP and VNC are not
     * interchangeable to anyone looking for one of them.
     */
    const label = kind === 'desktop'
        ? (host.desktop?.protocol === 'rdp' ? 'RDP' : 'VNC')
        : protocolLabel(kind);

    /**
     * The account, where the host has one to name.
     *
     * Telnet and VNC ask for a login over the connection itself, so there is no
     * username on the record to show; RDP signs in with CredSSP and does carry
     * one, on the desktop block rather than at the top level. A serial console
     * has no user at all and is identified by the cable instead — two of them
     * are told apart by which port they are on, which is why that stays here.
     */
    const detail = kind === 'serial'
        ? [host.serial?.path || 'No port', host.serial?.baudRate].filter(Boolean).join(' · ')
        : (kind === 'ssh'
            ? host.username
            : (host.desktop?.protocol === 'rdp' ? host.desktop.username : ''));

    /** Still worth having, just not at the front: the hover tells you where. */
    const address = kind === 'serial'
        ? host.serial?.path || ''
        : `${host.host}${host.port && host.port !== DEFAULT_PORTS[protocol] ? `:${host.port}` : ''}`;

    // Only ever what is true of this host right now. `folderLabel` is passed in
    // by search alone: while browsing, the breadcrumb has already said it.
    const extras = [
        folderLabel,
        // Forwards a non-SSH host is still carrying are never started, so
        // counting them here would describe something that does not happen.
        kind === 'ssh' && host.tunnels?.length
            ? `${host.tunnels.length} tunnel${host.tunnels.length === 1 ? '' : 's'}`
            : '',
    ].filter(Boolean);

    const tags = host.tags || [];
    const shownTags = tags.slice(0, TAG_LIMIT[isList ? 'list' : 'grid']);
    const hiddenTags = tags.length - shownTags.length;

    /**
     * The chips, wherever the layout puts them.
     *
     * `data-action` for the same reason the overflow menu carries it: this is a
     * control, not part of the card's own click target, so a press here neither
     * opens a session nor starts a drag. Clicking a tag filters the page by it,
     * which is the shortest route there is from "this machine is tagged db" to
     * "show me the other ones".
     */
    const tagChips = tags.length > 0 && (
        <span
            data-action="tags"
            onClick={stop}
            className="shrink-0 flex items-center gap-1"
        >
            {shownTags.map(tag => (
                <Tag
                    key={tag}
                    tag={tag}
                    size="xs"
                    onClick={onTagClick ? () => onTagClick(tag) : undefined}
                    title={onTagClick ? `Filter by “${tag}”` : tag}
                />
            ))}
            {hiddenTags > 0 && (
                <span
                    title={tags.join(', ')}
                    className="text-[10px] font-medium tabular-nums text-gray-400 dark:text-neutral-500"
                >
                    +{hiddenTags}
                </span>
            )}
        </span>
    );

    const menuItems = [
        { label: 'Connect', onSelect: onConnect },
        { label: 'Edit host', icon: <Edit02Icon size={14} strokeWidth={2} />, onSelect: onEdit },
        { label: 'Duplicate', icon: <Copy01Icon size={14} strokeWidth={2} />, onSelect: onDuplicate },
        { separator: true },
        { label: 'Delete', icon: <Delete02Icon size={14} strokeWidth={2} />, danger: true, onSelect: onDelete },
    ];

    return (
        <div
            className={`host-card org-card group relative cursor-pointer
                ${isList ? 'rounded-xl px-2.5 py-2' : 'rounded-2xl p-2.5'}
                ${dragging ? 'org-card-dragging' : ''}
                ${selected ? 'org-card-selected' : ''}`}
            // Not `aria-pressed`: a card is not a toggle, and a plain click on
            // one still connects. The flag is here for the styling and for the
            // tests, and the bar over the list is what announces the count.
            data-selected={selected || undefined}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            {...dragProps}
        >
            <div className="flex items-center gap-2.5">
                <IconTile size={isList ? 'sm' : 'md'}>
                    <OsIcon
                        os={host.os}
                        distro={host.distro}
                        className={isList ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]'}
                    />
                    {/* A live session is the one thing about a host that is true
                        this second rather than whenever it was last saved, so it
                        is marked on the icon rather than written in the meta. */}
                    {connected && (
                        <span
                            title="Connected"
                            className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500
                                ring-2 ring-white dark:ring-surface-control"
                        />
                    )}
                </IconTile>

                <div className={`min-w-0 flex-1 ${isList ? 'flex items-center gap-3' : ''}`}>
                    <div className={isList ? 'min-w-0 flex-1' : 'min-w-0'}>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate leading-tight">
                            {host.name}
                        </h3>
                        {/* The chips keep their width and this line gives way,
                            because a truncated protocol and user still say what
                            this host is (the name above it already said which)
                            while half a tag says nothing at all. */}
                        <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                            {/* `neutral-500` is #565982 in this palette, which on
                                a #24253a card is barely 2:1, so the line was
                                there and unreadable. This is the tone the rest of
                                the app uses for a secondary line. */}
                            <p
                                title={address || undefined}
                                className="flex-1 min-w-0 text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight"
                            >
                                <span>{label}</span>
                                {detail && (
                                    <>
                                        <span className="mx-1 opacity-50">·</span>
                                        <span className="font-mono">{detail}</span>
                                    </>
                                )}
                                {!isList && extras.map(entry => (
                                    <span key={entry}>
                                        <span className="mx-1 opacity-50">·</span>
                                        {entry}
                                    </span>
                                ))}
                            </p>
                            {!isList && tagChips}
                        </div>
                    </div>

                    {/* The list has room to give these a column of their own,
                        where the grid has to fold them onto the address. */}
                    {isList && tagChips}

                    {isList && extras.length > 0 && (
                        <p className="shrink-0 max-w-[45%] truncate text-[11px] text-gray-500 dark:text-gray-400">
                            {extras.join(' · ')}
                        </p>
                    )}
                </div>

                {/* Idle cards stay quiet; the controls come up on hover, and on
                    keyboard focus so they are still reachable without a mouse. */}
                <div
                    data-action="menu"
                    onClick={stop}
                    className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                >
                    <MenuButton
                        icon={<MoreVerticalIcon size={16} strokeWidth={2} />}
                        title="Host actions"
                        items={menuItems}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(HostCard);
