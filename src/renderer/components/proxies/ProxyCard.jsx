import { memo, useCallback } from 'react';
import {
    AlertCircleIcon,
    CheckmarkCircle02Icon,
    Copy01Icon,
    Delete02Icon,
    Edit02Icon,
    Link03Icon,
    Loading03Icon,
    LockPasswordIcon,
    MoreVerticalIcon,
    Route02Icon,
} from 'hugeicons-react';
import IconTile from '../hosts/IconTile';
import MenuButton from '../ui/MenuButton';
import { describeProxy, nameProxy, proxyLabel, supportsAuth } from '../../lib/proxies';

/**
 * One saved proxy, as a tile in the grid.
 *
 * Built to the same two lines as a host card and a key card, because it is the
 * same kind of object in the same kind of collection: what it is called, and the
 * one string that identifies it. For a proxy that is its kind and address, since
 * two SOCKS5 entries are told apart by nothing else.
 *
 * The marks on the right are the three things that change what the proxy does:
 * whether a credential goes with it, whether it is reached through another proxy,
 * and how many hosts stop connecting if it goes.
 */

/** The card is the edit button, so the menu on it opts out of that click. */
const stop = (event) => event.stopPropagation();

/** The last check, if one has been run since the page was opened. */
function CheckMark({ check }) {
    if (!check) return null;

    if (check.running) {
        return (
            <span
                title="Checking"
                className="flex items-center text-gray-400 dark:text-neutral-500"
            >
                <Loading03Icon size={12} strokeWidth={2.5} className="animate-spin" />
            </span>
        );
    }

    return (
        <span
            title={check.message}
            className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${check.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}
        >
            {check.success
                ? <CheckmarkCircle02Icon size={11} strokeWidth={2.5} />
                : <AlertCircleIcon size={11} strokeWidth={2.5} />}
            {check.success ? 'Answered' : 'No answer'}
        </span>
    );
}

function ProxyCard({ entry, check, onEdit, onDuplicate, onTest, onDelete }) {
    const { proxy, usedBy, route } = entry;

    const handleClick = useCallback((event) => {
        if (event.target.closest('[data-action]')) return;
        onEdit();
    }, [onEdit]);

    // Enter and Space reach the card through the keyboard; without them a proxy
    // could be tabbed to and not opened.
    const handleKeyDown = useCallback((event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onEdit();
    }, [onEdit]);

    // The name usually is the address, in which case saying it twice wastes the
    // line the identity is supposed to be on.
    const identity = describeProxy(proxy);
    const named = proxy.name && proxy.name !== identity;

    const menuItems = [
        { label: 'Edit proxy', icon: <Edit02Icon size={14} strokeWidth={2} />, onSelect: onEdit },
        {
            label: 'Check it answers',
            icon: <CheckmarkCircle02Icon size={14} strokeWidth={2} />,
            onSelect: onTest,
        },
        { label: 'Duplicate', icon: <Copy01Icon size={14} strokeWidth={2} />, onSelect: onDuplicate },
        { separator: true },
        { label: 'Delete', icon: <Delete02Icon size={14} strokeWidth={2} />, danger: true, onSelect: onDelete },
    ];

    return (
        <div
            // What useFlipOrder follows a card by when the grid rewraps.
            data-card-id={proxy.id}
            className="org-card group relative cursor-pointer rounded-2xl p-2.5"
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
        >
            <div className="flex items-center gap-2.5">
                <IconTile size="md">
                    <Route02Icon size={20} strokeWidth={1.5} className="text-gray-500 dark:text-gray-300" />
                </IconTile>

                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate leading-tight">
                        {nameProxy(proxy)}
                    </h3>

                    {/* The marks keep their width and the address gives way: a
                        truncated address still says which proxy this is, while
                        half a warning says nothing. */}
                    <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                        <p className="flex-1 min-w-0 text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight">
                            {named ? (
                                <>
                                    <span className="font-mono">{proxy.host}:{proxy.port}</span>
                                    <span className="mx-1 opacity-50">·</span>
                                    {proxyLabel(proxy.type)}
                                </>
                            ) : identity}
                            {proxy.username && (
                                <>
                                    <span className="mx-1 opacity-50">·</span>
                                    <span className="font-mono">{proxy.username}</span>
                                </>
                            )}
                        </p>

                        {/* Read-only, so they stay part of the card's own click
                            target rather than opting out of it the way the menu
                            does: a badge that swallows the click is a dead spot
                            in the middle of a card that opens. */}
                        <span className="shrink-0 flex items-center gap-1.5">
                            <CheckMark check={check} />

                            {/* Only where the protocol has real authentication.
                                A SOCKS4 ident is not a credential and marking it
                                as one would overstate what the proxy checks. */}
                            {proxy.hasPassword && supportsAuth(proxy.type) && (
                                <span
                                    title="A password is stored for this proxy"
                                    className="flex items-center text-gray-400 dark:text-neutral-500"
                                >
                                    <LockPasswordIcon size={12} strokeWidth={2} />
                                </span>
                            )}

                            {/* A chained proxy is reached through another one, so
                                the address above is not where this machine dials.
                                Worth saying on the card. */}
                            {route.length > 1 && (
                                <span
                                    title={`Reached through ${route.slice(0, -1).map(nameProxy).join(' → ')}`}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md
                                        bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                >
                                    <Link03Icon size={11} strokeWidth={2.5} />
                                    {route.length} hops
                                </span>
                            )}

                            {usedBy > 0 && (
                                <span
                                    title={`Used by ${usedBy} host${usedBy === 1 ? '' : 's'}`}
                                    className="text-[10px] font-medium tabular-nums text-gray-400 dark:text-neutral-500"
                                >
                                    {usedBy} host{usedBy === 1 ? '' : 's'}
                                </span>
                            )}
                        </span>
                    </div>
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
                        title="Proxy actions"
                        items={menuItems}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(ProxyCard);
