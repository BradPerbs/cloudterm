import { memo, useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowRight01Icon,
    Cancel01Icon,
    CancelCircleIcon,
    ComputerTerminal01Icon,
    Copy01Icon,
    FolderRemoveIcon,
    Megaphone02Icon,
    PencilEdit02Icon,
    Refresh01Icon,
    Tag01Icon,
    Unlink01Icon,
} from 'hugeicons-react';
import { TITLE_BAR_HEIGHT } from '../lib/layout';
import { IS_MAC } from '../lib/platform';
import { OsIcon, hostOs } from '../lib/os-icons';
import { useTabDrag } from '../hooks/useTabDrag';
import { collapseTab, finishTabOpen, openTab, resizeTab, setTabSize, spinPlus } from '../lib/tabMotion';
import { useEnterOn } from '../hooks/useEnter';
import { playRipple } from '../lib/enterMotion';
import ContextMenu from './ui/ContextMenu';
import NotificationsMenu from './NotificationsMenu';
import Tooltip from './ui/Tooltip';
import { TAB_COLORS, segmentStrip, tabColor, withAlpha } from '../lib/tabs';
import logoUrl from '../logoterminal.svg';
import { useT } from '../i18n';

// Ripple effect hook
function useRippleEffect() {
    useEffect(() => {
        const createRipple = (event) => {
            const target = event.target.closest('button, .nav-item, .host-card, .folder-card, .btn-primary, .btn-secondary, .btn-icon');
            if (!target || target.closest('.tab-item')) return;

            const rect = target.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = event.clientX - rect.left - size / 2;
            const y = event.clientY - rect.top - size / 2;

            // Ensure target has relative positioning and hidden overflow
            const computedStyle = window.getComputedStyle(target);
            if (computedStyle.position === 'static') {
                target.style.position = 'relative';
            }
            if (computedStyle.overflow !== 'hidden') {
                target.style.overflow = 'hidden';
            }

            const ripple = document.createElement('span');
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            ripple.className = 'ripple';

            target.appendChild(ripple);

            // Spreads and takes itself away again. See lib/enterMotion.
            playRipple(ripple);
        };

        document.addEventListener('mousedown', createRipple);
        return () => document.removeEventListener('mousedown', createRipple);
    }, []);
}

function AppMenu() {
    const t = useT();
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    // Rendered on a condition rather than mounted, so the entrance is asked
    // for each time it opens. See lib/enterMotion.
    useEnterOn(menuRef, open && 'fade');
    const btnRef = useRef(null);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => {
        if (!open) return;
        const handleClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target) && !btnRef.current.contains(e.target)) {
                close();
            }
        };
        const handleKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open, close]);

    const menuItems = [
        // Reaches the plus button by its class rather than by its tooltip: the
        // tooltip is translated, and a selector built from it would find
        // nothing the moment the app is set to anything but English.
        { label: t('newTab.title'), shortcut: 'Ctrl+N', action: () => { close(); document.querySelector('.tab-add')?.click(); } },
        { type: 'separator' },
        { label: t('titleBar.reload'), shortcut: 'Ctrl+R', action: () => { close(); window.api.window.reload(); } },
        { label: t('titleBar.devTools'), shortcut: 'Ctrl+Shift+I', action: () => { close(); window.api.window.toggleDevTools(); } },
        { type: 'separator' },
        { label: t('titleBar.minimize'), action: () => { close(); window.api.window.minimize(); } },
        { label: t('titleBar.maximize'), action: () => { close(); window.api.window.maximize(); } },
        { type: 'separator' },
        { label: t('titleBar.exit'), shortcut: 'Alt+F4', action: () => { close(); window.api.window.quit(); }, danger: true },
    ];

    // Compute dropdown position from button rect
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left });
        }
    }, [open]);

    return (
        <div className="shrink-0 app-no-drag">
            <button
                ref={btnRef}
                className={`w-8 h-8 flex items-center justify-center rounded-xl transition-colors ${open ? 'bg-gray-200 dark:bg-neutral-700' : 'hover:bg-gray-200 dark:hover:bg-neutral-800'}`}
                onClick={() => setOpen(p => !p)}
            >
                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" viewBox="0 0 16 16" fill="currentColor">
                    <rect y="2" width="16" height="1.5" rx="0.75" />
                    <rect y="7.25" width="16" height="1.5" rx="0.75" />
                    <rect y="12.5" width="16" height="1.5" rx="0.75" />
                </svg>
            </button>

            {open && createPortal(
                <div
                    ref={menuRef}
                    className="fixed w-52 p-1 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 shadow-xl z-[9999]"
                    style={{ top: pos.top, left: pos.left }}
                >
                    {menuItems.map((item, i) =>
                        item.type === 'separator' ? (
                            <div key={i} className="-mx-1 my-1 border-t border-gray-100 dark:border-neutral-800" />
                        ) : (
                            <button
                                key={i}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                    item.danger
                                        ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                                }`}
                                onClick={item.action}
                            >
                                <span className="font-medium">{item.label}</span>
                                {item.shortcut && (
                                    <span className="text-[10px] text-gray-400 dark:text-neutral-500 ml-4">{item.shortcut}</span>
                                )}
                            </button>
                        )
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}

/**
 * One tab in the strip. Its width, and the movements for opening, closing and
 * taking focus, are GSAP's, from `lib/tabMotion`; `closing` renders the tab as
 * it was at the moment of the click: in place, no longer clickable, collapsing
 * out of the strip so its neighbours take the space back rather than jumping
 * into it.
 */
function SessionTab({
    tab,
    active,
    closing,
    renaming,
    dragProps,
    onSelect,
    onClose,
    onMenu,
    onExited,
    onRenameStart,
    onRenameCommit,
    onRenameCancel,
}) {
    const t = useT();
    const isLauncher = tab.type === 'launcher';
    const color = tabColor(tab.color);

    /** Whichever element the tab is: a button, or the field it is renamed in. */
    const tabRef = useRef(null);

    /**
     * The tab arriving in the strip: it takes its width outright, and then
     * opens from nothing onto it.
     *
     * GSAP writes that width inline, which is the point of doing it here at
     * all. A stylesheet rule keyed on `[data-active]` lands the new width the
     * moment React commits the attribute, which is before any tween could have
     * started from the old one.
     *
     * Mount only, so `active` is read as it stood when the tab opened and the
     * cleanup belongs to the tab going rather than to anything changing about
     * it.
     *
     * StrictMode mounts, unmounts and remounts, so the arrival has to be
     * undoable, and undoing it means landing the tab at its full size rather
     * than merely stopping the tween: a killed tween leaves behind whatever it
     * last wrote, and the second mount would take a tab holding the first
     * frame of an opening animation for a tab that is meant to look like that.
     */
    useLayoutEffect(() => {
        const node = tabRef.current;
        if (!node || closing) return undefined;

        setTabSize(node, active);
        openTab(node);
        return () => finishTabOpen(node);
    }, []);

    /**
     * Focus moving on or off the tab, which is a change of width. Tweened from
     * wherever the tab currently is, so clicking along the strip picks up from
     * what is on screen rather than restarting.
     *
     * `shownActive` is what keeps this off the tab's first render, where the
     * width has just been set outright and a tween to the same place would
     * overwrite the opening one and strand it.
     */
    const shownActive = useRef(active);

    useLayoutEffect(() => {
        const node = tabRef.current;
        if (!node || closing || shownActive.current === active) return;
        shownActive.current = active;
        resizeTab(node, active);
    }, [active, closing]);

    /**
     * Collapsing out of the strip.
     *
     * `onExited` is reached through a ref so this is keyed on the close alone.
     * Rebuilt because the callback came back with a new identity, it would kill
     * the collapse partway and start it again.
     */
    const exit = useRef(onExited);
    exit.current = onExited;

    /**
     * The tween reports its own end. The timer is the outside date by which the
     * tab goes either way: a window that is hidden or covered has its frames
     * throttled, and a collapse that never reported back would leave a closed
     * tab sitting in the strip with no width, and no way to close it again.
     */
    useLayoutEffect(() => {
        if (!closing) return undefined;

        const tween = collapseTab(tabRef.current, () => exit.current(tab.id));
        const timer = setTimeout(() => exit.current(tab.id), 600);

        return () => {
            tween?.kill();
            clearTimeout(timer);
        };
    }, [closing, tab.id]);

    // A tab being renamed is a text field, not a button: it takes the keyboard,
    // and Escape has to reach it rather than whatever is behind.
    if (renaming) {
        return (
            <div
                ref={tabRef}
                className="tab-item session-tab flex items-center gap-2 px-3 py-2 rounded-xl text-xs
                    font-medium relative z-10 app-no-drag bg-gray-900/[0.08] dark:bg-surface-control
                    ring-1 ring-gray-900/20 dark:ring-white/25"
                data-tab={tab.id}
                // The field is a different element from the button, so it never
                // carries an inline width. This is what sizes it, through the
                // matching rules in input.css.
                data-active={active ? 'true' : 'false'}
            >
                {color && (
                    <span
                        aria-hidden="true"
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color.hex }}
                    />
                )}
                <input
                    autoFocus
                    aria-label={t('titleBar.renameAria', { name: tab.title })}
                    defaultValue={tab.renamed ? tab.title : ''}
                    placeholder={tab.title}
                    maxLength={60}
                    className="w-28 bg-transparent outline-none text-xs font-semibold
                        text-gray-900 dark:text-white placeholder:font-medium
                        placeholder:text-gray-400 dark:placeholder:text-neutral-500"
                    onFocus={(event) => event.target.select()}
                    // Committing on blur is what makes clicking away mean "keep
                    // it", which is what every other inline rename does.
                    onBlur={(event) => onRenameCommit(tab.id, event.target.value)}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                            onRenameCommit(tab.id, event.currentTarget.value);
                        } else if (event.key === 'Escape') {
                            onRenameCancel();
                        }
                    }}
                />
            </div>
        );
    }

    return (
        <button
            ref={tabRef}
            className={`tab-item session-tab flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer group relative z-10 overflow-hidden app-no-drag ${
                active
                    ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white'
                    : 'bg-gray-900/[0.04] dark:bg-surface-raised text-gray-500 dark:text-gray-400 hover:bg-gray-900/[0.06] dark:hover:bg-surface-control'
            }`}
            data-tab={tab.id}
            data-active={active ? 'true' : 'false'}
            data-closing={closing ? 'true' : undefined}
            // Picking the tab up, and marking it while it is in hand. Spread
            // here so a tab mid-close, which is handed none, simply cannot be.
            {...dragProps}
            aria-hidden={closing || undefined}
            tabIndex={closing ? -1 : undefined}
            // A colour is worn as a wash over the tab's own background rather
            // than replacing it, so an active tab still reads as the active one.
            style={color ? {
                backgroundColor: withAlpha(color.hex, active ? 0.22 : 0.12),
                boxShadow: `inset 0 0 0 1px ${withAlpha(color.hex, active ? 0.5 : 0.28)}`,
            } : undefined}
            onClick={closing ? undefined : () => onSelect(tab.id)}
            // Double-click to rename, the way every tab strip that can be
            // renamed does it. The menu carries the same action for discovery.
            onDoubleClick={closing ? undefined : (event) => {
                event.preventDefault();
                onRenameStart(tab.id);
            }}
            // The menu acts on the tab it was opened over, so right-clicking
            // one deliberately does not also switch to it.
            onContextMenu={closing ? undefined : (event) => {
                event.preventDefault();
                onMenu(tab, event.clientX, event.clientY);
            }}
        >
            {/* The remote OS identifies the tab; until the
                session is up it dims and pulses, which is
                the state the status dot used to carry. An
                empty launcher tab has no host yet.
                Pointing at the tab swaps the icon for the
                close button in the same slot, so nothing
                shifts under the pointer and the tab keeps
                its width whether hovered or not. */}
            <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
                <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0"
                >
                    {isLauncher ? (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                    ) : (
                        <OsIcon
                            os={hostOs(tab.host)}
                            distro={tab.host?.distro}
                            className={`w-4 h-4 ${tab.connected ? '' : 'opacity-50 animate-pulse'}`}
                        />
                    )}
                </span>

                <span
                    className="tab-close absolute inset-0 flex items-center justify-center rounded-md
                        opacity-0 pointer-events-none transition-opacity
                        group-hover:opacity-100 group-hover:pointer-events-auto
                        hover:bg-gray-900/10 dark:hover:bg-white/15"
                    title={t('titleBar.closeTab')}
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose(tab.id);
                    }}
                >
                    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                        <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </span>
            </span>
            <span className="truncate flex-1 text-left min-w-0">{tab.title}</span>

            {/* Which of several sessions on this host it is. Beside the title
                rather than inside it: appended to the string it would be the
                first thing the truncation ate, and it is the only thing on the
                tab telling it from the one next to it.

                Not the pane pill's shape either. That is a count and this is a
                name, so it is drawn quietly, as part of what the tab is
                called. */}
            {tab.ordinal > 0 && (
                <span
                    className="shrink-0 text-[10px] font-semibold tabular-nums
                        text-gray-400 dark:text-gray-500"
                    title={`Session ${tab.ordinal} on this host`}
                >
                    #{tab.ordinal}
                </span>
            )}

            {/* A split tab shows only its focused pane's
                name, so say how many others are behind it. */}
            {tab.paneCount > 1 && (
                <span
                    className="shrink-0 min-w-[16px] h-4 px-1 rounded-md flex items-center justify-center text-[10px] font-bold tabular-nums bg-gray-900/10 dark:bg-white/10 text-gray-600 dark:text-gray-300"
                    title={`${tab.paneCount} panes`}
                >
                    {tab.paneCount}
                </span>
            )}
        </button>
    );
}

/**
 * The palette, as one row inside a menu.
 *
 * A row rather than eight menu items: colour is chosen by eye, and eight named
 * rows make the reader translate "Teal" into a colour before they can pick one.
 * The swatch that is already set is ringed, and clicking it clears the colour,
 * so the control that sets a thing is also the one that unsets it.
 */
function ColorSwatches({ selected, onSelect }) {
    return (
        <div className="flex items-center gap-1.5 px-1">
            {TAB_COLORS.map(color => (
                <button
                    key={color.id}
                    title={selected === color.id ? `${color.label} (click to clear)` : color.label}
                    aria-label={color.label}
                    aria-pressed={selected === color.id}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 active:scale-95 ${
                        selected === color.id
                            ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white ring-offset-white dark:ring-offset-surface-raised'
                            : ''
                    }`}
                    style={{ backgroundColor: color.hex }}
                    onClick={() => onSelect(selected === color.id ? null : color.id)}
                />
            ))}
        </div>
    );
}

/**
 * A run of tabs that belong together, outlined together.
 *
 * The outline is a border in the group's colour with nothing behind it, so the
 * tabs inside keep their own backgrounds and still read as tabs; a filled wash
 * behind them turns the whole run into one object and the active tab stops
 * standing out inside it.
 *
 * The group's name is a tab-shaped pill of the same height and radius as its
 * neighbours, sitting inside the outline as the run's first item. It is a button
 * rather than a label, because it is also where the group's menu lives; the
 * tabs themselves already use right-click for their own.
 */
function TabGroup({ group, children, onMenu, renaming, onRenameCommit, onRenameCancel }) {
    const t = useT();
    const color = tabColor(group.color) || TAB_COLORS[0];

    // Matches a tab exactly apart from the colour: same padding, radius, text
    // size and weight, so the pill sits in the row rather than on top of it.
    const PILL = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium shrink-0 max-w-[132px]';

    return (
        <div
            className="flex items-center gap-1 p-[2px] rounded-[14px] shrink-0 app-no-drag"
            style={{
                // A full-strength outline on all four sides. The strip is sized
                // to fit this exactly (see TITLE_BAR_HEIGHT); given any less
                // room the top and bottom runs are clipped away and what is left
                // reads as a pair of parentheses instead of a box.
                border: `1.5px solid ${withAlpha(color.hex, 0.8)}`,
                // Enough tint to bind the run together, not enough to become the
                // background the tabs are read against.
                backgroundColor: withAlpha(color.hex, 0.08),
            }}
            data-tab-group={group.id}
        >
            {renaming ? (
                <div
                    className={PILL}
                    style={{ backgroundColor: withAlpha(color.hex, 0.18) }}
                >
                    <span
                        aria-hidden="true"
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color.hex }}
                    />
                    <input
                        autoFocus
                        aria-label={t('titleBar.renameGroupAria', { name: group.name })}
                        defaultValue={group.name}
                        maxLength={40}
                        className="w-20 bg-transparent outline-none text-xs font-semibold"
                        style={{ color: color.hex }}
                        onFocus={(event) => event.target.select()}
                        onBlur={(event) => onRenameCommit(group.id, event.target.value)}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') onRenameCommit(group.id, event.currentTarget.value);
                            else if (event.key === 'Escape') onRenameCancel();
                        }}
                    />
                </div>
            ) : (
                <button
                    className={`${PILL} transition-colors`}
                    style={{ backgroundColor: withAlpha(color.hex, 0.18), color: color.hex }}
                    title={`${group.name} (click for group options)`}
                    onClick={(event) => onMenu(group, event.clientX, event.clientY)}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        onMenu(group, event.clientX, event.clientY);
                    }}
                >
                    <span
                        aria-hidden="true"
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color.hex }}
                    />
                    <span className="truncate font-semibold">{group.name}</span>
                </button>
            )}

            {children}
        </div>
    );
}

/**
 * The mark in the title bar: the app's, or the user's own if they have set one.
 *
 * Sized to a 24px box rather than stretched to it, so a wide or tall image keeps
 * its proportions and sits in the row at the same height as everything else.
 *
 * Deliberately square-cornered. The box is only as big as the artwork inside it,
 * so a radius here does not round a backdrop, it cuts the corners off the mark
 * itself -- which the CloudBlast cloud, drawn to the edges of its viewBox, shows
 * plainly. An image that wants rounded corners can arrive with them.
 */
function TitleBarLogo({ src }) {
    return (
        <div className="shrink-0 app-no-drag flex items-center justify-center w-6 h-6">
            <img
                src={src}
                alt="Logo"
                className="max-w-full max-h-full object-contain"
            />
        </div>
    );
}

function TitleBar({
    tabs,
    activeTabId,
    groups = [],
    showLogo = true,
    logoImage = null,
    logoSide = 'left',
    broadcast = 'off',
    broadcastCount = 0,
    onBroadcastChange,
    onTabClick,
    onTabClose,
    onTabCloseOthers,
    onTabCloseRight,
    onTabDuplicate,
    onTabDisconnect,
    onTabReconnect,
    onTabRename,
    onTabColor,
    onTabGroup,
    onTabUngroup,
    onTabNewGroup,
    onTabReorder,
    onGroupRename,
    onGroupColor,
    onGroupDelete,
    onNewSession,
}) {
    useRippleEffect();

    const t = useT();

    const handleMinimize = () => window.api.window.minimize();
    const handleMaximize = () => window.api.window.maximize();
    const handleClose = () => window.api.window.close();

    // Separate home tab from session tabs
    const homeTab = tabs.find(tab => tab.type === 'home');
    const sessionTabs = tabs.filter(tab => tab.type !== 'home');

    /** The strip itself, which the drag measures the tabs against. */
    const stripRef = useRef(null);

    /** The plus, which turns into the tab it is about to open. */
    const plusRef = useRef(null);

    const { carrying, preview, tabProps } = useTabDrag({
        containerRef: stripRef,
        tabs: sessionTabs,
        onReorder: onTabReorder,
        enabled: Boolean(onTabReorder),
    });

    /**
     * The strip as the drag is asking for it.
     *
     * Nothing is committed until the tab is let go of, so while one is in hand
     * this is what the strip is: the order the drop would make, with the
     * carried tab already wearing the group it would land in so the outline it
     * is inside is drawn around it rather than beside it.
     */
    const arranged = useMemo(() => {
        if (!preview) return sessionTabs;

        const byId = new Map(sessionTabs.map(tab => [tab.id, tab]));
        const asked = preview.ids.map(id => byId.get(id)).filter(Boolean);

        // A tab opened while the drag was in flight, which the preview predates.
        const taken = new Set(preview.ids);
        for (const tab of sessionTabs) {
            if (!taken.has(tab.id)) asked.push(tab);
        }

        return asked.map(tab => (
            tab.id === carrying && (tab.groupId || null) !== (preview.groupId || null)
                ? { ...tab, groupId: preview.groupId }
                : tab
        ));
    }, [sessionTabs, preview, carrying]);

    /**
     * Tabs that have been closed but are still on screen, each remembered with
     * the place it held and whether it was focused, so it collapses from the
     * width it actually had. Dropped once the collapse reports back.
     */
    const [closingTabs, setClosingTabs] = useState([]);

    /**
     * Which menu is open, over what, and where the click landed. Held by id
     * rather than by value, so an item stays true to a session that comes up or
     * drops while the menu is sitting open over it.
     *
     * `kind` tells the tab's menu from a group's; they act on different things
     * and there is only ever one open.
     */
    const [menu, setMenu] = useState(null);

    /** The tab or group currently being renamed in place, if any. */
    const [renaming, setRenaming] = useState(null);

    const openTabMenu = useCallback((tab, x, y) => setMenu({ kind: 'tab', id: tab.id, x, y }), []);
    const openGroupMenu = useCallback((group, x, y) => setMenu({ kind: 'group', id: group.id, x, y }), []);

    const startRename = useCallback((kind, id) => setRenaming({ kind, id }), []);
    const cancelRename = useCallback(() => setRenaming(null), []);

    const commitTabRename = useCallback((tabId, value) => {
        setRenaming(null);
        onTabRename?.(tabId, value);
    }, [onTabRename]);

    const commitGroupRename = useCallback((groupId, value) => {
        setRenaming(null);
        onGroupRename?.(groupId, value);
    }, [onGroupRename]);

    /**
     * Hand these tabs to the collapse animation. Marking them before the close
     * itself is what keeps them on screen: by the time the strip re-renders
     * they are already gone from `tabs`, and only the record kept here can
     * still say where they were and how wide.
     */
    const markClosing = useCallback((tabIds) => {
        setClosingTabs((prev) => {
            const known = new Set(prev.map(entry => entry.tab.id));
            const additions = [];

            for (const tabId of tabIds) {
                if (known.has(tabId)) continue;
                const index = sessionTabs.findIndex(tab => tab.id === tabId);
                if (index === -1) continue;
                additions.push({ tab: sessionTabs[index], index, active: activeTabId === tabId });
            }

            return additions.length ? [...prev, ...additions] : prev;
        });
    }, [sessionTabs, activeTabId]);

    const dropClosingTab = useCallback((tabId) => {
        setClosingTabs(prev => prev.filter(entry => entry.tab.id !== tabId));
    }, []);

    const handleTabClose = useCallback((tabId) => {
        markClosing([tabId]);
        onTabClose(tabId);
    }, [markClosing, onTabClose]);

    const handleCloseOthers = useCallback((tabId) => {
        markClosing(sessionTabs.filter(tab => tab.id !== tabId).map(tab => tab.id));
        onTabCloseOthers(tabId);
    }, [markClosing, sessionTabs, onTabCloseOthers]);

    const handleCloseRight = useCallback((tabId) => {
        const at = sessionTabs.findIndex(tab => tab.id === tabId);
        if (at === -1) return;
        markClosing(sessionTabs.slice(at + 1).map(tab => tab.id));
        onTabCloseRight(tabId);
    }, [markClosing, sessionTabs, onTabCloseRight]);

    // A tab id that comes back (a session reopened into the same tab) belongs
    // to the live strip again, whatever its ghost was in the middle of doing.
    useEffect(() => {
        setClosingTabs(prev => {
            const next = prev.filter(entry => !tabs.some(tab => tab.id === entry.tab.id));
            return next.length === prev.length ? prev : next;
        });
    }, [tabs]);

    // Ghosts go back where they were, so a tab closed from the middle of the
    // strip collapses in place instead of jumping to the end of it first.
    // Left to right, or a batch of them would land in the order they were
    // clicked rather than the order they sat in.
    const stripItems = arranged.map(tab => ({
        tab,
        active: activeTabId === tab.id,
        closing: false,
    }));
    for (const entry of [...closingTabs].sort((a, b) => a.index - b.index)) {
        stripItems.splice(Math.min(entry.index, stripItems.length), 0, {
            tab: entry.tab,
            active: entry.active,
            closing: true,
        });
    }

    /**
     * What the right-clicked tab can be asked to do. A launcher tab has no
     * session behind it yet, so it can only be named, filed and closed.
     */
    const tabMenuItems = useMemo(() => {
        if (menu?.kind !== 'tab') return [];

        const size = 15;
        const at = sessionTabs.findIndex(item => item.id === menu.id);
        // Closed under its own menu, by a shortcut or by the session ending.
        if (at === -1) return [];

        const tab = sessionTabs[at];
        const isTerminal = tab.type === 'terminal';
        const split = tab.sessionCount > 1;

        // Groups this tab could join: every one except the one it is in.
        const otherGroups = groups.filter(group => group.id !== tab.groupId);

        return [
            {
                label: t('titleBar.rename'),
                icon: <PencilEdit02Icon size={size} />,
                // Deferred past the menu's own dismissal: it closes on mousedown,
                // and focusing an input in the same tick loses the focus to it.
                onClick: () => setTimeout(() => startRename('tab', tab.id), 0),
            },
            tab.renamed && {
                label: t('titleBar.useHostName'),
                icon: <Refresh01Icon size={size} />,
                onClick: () => onTabRename?.(tab.id, ''),
            },
            { type: 'heading', label: t('titleBar.colour') },
            {
                type: 'custom',
                key: 'tab-colors',
                render: () => (
                    <ColorSwatches
                        selected={tab.color}
                        onSelect={(color) => onTabColor?.(tab.id, color)}
                    />
                ),
            },
            { type: 'separator' },
            ...(tab.groupId
                ? [{
                    label: t('titleBar.removeFromGroup'),
                    icon: <FolderRemoveIcon size={size} />,
                    onClick: () => onTabUngroup?.(tab.id),
                }]
                : [{
                    label: t('titleBar.newGroup'),
                    icon: <Tag01Icon size={size} />,
                    onClick: () => onTabNewGroup?.(tab.id),
                }]),
            ...otherGroups.map(group => ({
                label: t('titleBar.moveToGroup', { group: group.name }),
                icon: (
                    <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: (tabColor(group.color) || TAB_COLORS[0]).hex }}
                    />
                ),
                onClick: () => onTabGroup?.(tab.id, group.id),
            })),
            { type: 'separator' },
            isTerminal && {
                label: t('titleBar.duplicate'),
                icon: <Copy01Icon size={size} />,
                onClick: () => onTabDuplicate(tab.id),
            },
            isTerminal && {
                label: split ? t('titleBar.reconnectAll') : t('titleBar.reconnect'),
                icon: <Refresh01Icon size={size} />,
                onClick: () => onTabReconnect(tab.id),
                disabled: tab.sessionCount === 0 || tab.liveCount === tab.sessionCount,
            },
            isTerminal && {
                label: split ? t('titleBar.disconnectAll') : t('titleBar.disconnect'),
                icon: <Unlink01Icon size={size} />,
                onClick: () => onTabDisconnect(tab.id),
                disabled: tab.liveCount === 0,
            },
            isTerminal && { type: 'separator' },
            {
                label: t('common.close'),
                icon: <Cancel01Icon size={size} />,
                onClick: () => handleTabClose(tab.id),
            },
            {
                label: t('titleBar.closeOthers'),
                icon: <CancelCircleIcon size={size} />,
                onClick: () => handleCloseOthers(tab.id),
                disabled: sessionTabs.length < 2,
            },
            {
                label: t('titleBar.closeRight'),
                icon: <ArrowRight01Icon size={size} />,
                onClick: () => handleCloseRight(tab.id),
                disabled: at === sessionTabs.length - 1,
            },
        ];
    }, [
        menu, sessionTabs, groups, onTabDuplicate, onTabReconnect, onTabDisconnect,
        onTabRename, onTabColor, onTabGroup, onTabUngroup, onTabNewGroup,
        handleTabClose, handleCloseOthers, handleCloseRight, startRename, t,
    ]);

    /** A group's own menu, opened from its name. */
    const groupMenuItems = useMemo(() => {
        if (menu?.kind !== 'group') return [];

        const group = groups.find(item => item.id === menu.id);
        if (!group) return [];

        const members = sessionTabs.filter(tab => tab.groupId === group.id);

        return [
            {
                label: t('titleBar.renameGroup'),
                icon: <PencilEdit02Icon size={15} />,
                onClick: () => setTimeout(() => startRename('group', group.id), 0),
            },
            { type: 'heading', label: t('titleBar.colour') },
            {
                type: 'custom',
                key: 'group-colors',
                render: () => (
                    <ColorSwatches
                        selected={group.color}
                        // A group always has a colour: it is what the outline is
                        // drawn in. Clearing falls back to the first one.
                        onSelect={(color) => onGroupColor?.(group.id, color || TAB_COLORS[0].id)}
                    />
                ),
            },
            { type: 'separator' },
            {
                // The tabs stay open. Dissolving an outline must not be a way to
                // close nine sessions by accident.
                label: t('titleBar.ungroup'),
                icon: <FolderRemoveIcon size={15} />,
                onClick: () => onGroupDelete?.(group.id),
            },
            {
                label: t('titleBar.closeGroupTabs', { count: members.length }),
                icon: <Cancel01Icon size={15} />,
                danger: true,
                disabled: members.length === 0,
                onClick: () => {
                    markClosing(members.map(tab => tab.id));
                    for (const tab of members) onTabClose(tab.id);
                },
            },
        ];
    }, [menu, groups, sessionTabs, onGroupColor, onGroupDelete, onTabClose, markClosing, startRename, t]);

    const menuItems = menu?.kind === 'group' ? groupMenuItems : tabMenuItems;

    /** The strip as single tabs and outlined group runs. */
    const segments = useMemo(() => segmentStrip(stripItems, groups), [stripItems, groups]);

    /** One tab, wherever it sits: loose in the strip or inside a group outline. */
    const renderTab = useCallback(({ tab, active, closing }) => (
        <SessionTab
            key={tab.id}
            tab={tab}
            active={active}
            closing={closing}
            renaming={renaming?.kind === 'tab' && renaming.id === tab.id}
            // A tab on its way out is not one to pick up: it holds no slot in
            // the strip any more, and the drag would be carrying a ghost.
            dragProps={closing ? undefined : tabProps(tab.id)}
            onSelect={onTabClick}
            onClose={handleTabClose}
            onMenu={openTabMenu}
            onExited={dropClosingTab}
            onRenameStart={(tabId) => startRename('tab', tabId)}
            onRenameCommit={commitTabRename}
            onRenameCancel={cancelRename}
        />
    ), [
        renaming, tabProps, onTabClick, handleTabClose, openTabMenu, dropClosingTab,
        startRename, commitTabRename, cancelRename,
    ]);

    return (
        <div
            id="title-bar"
            className="flex items-center justify-between select-none shrink-0 z-50 app-drag"
            style={{ height: TITLE_BAR_HEIGHT }}
        >
            <div
                className="flex items-center flex-1 min-w-0 h-full overflow-hidden"
                style={{
                    gap: '12px',
                    // Room for the traffic lights, which macOS draws over this
                    // row at the position main.js gives them. Wide enough to
                    // clear the cluster and still leave the burger a margin.
                    ...(IS_MAC ? { paddingLeft: 68 } : {}),
                }}
            >
                {/* Burger Menu */}
                <AppMenu />

                {/* Logo. Optional, and either end: it is decoration, and the row
                    it sits in is the one the tab strip is competing for (see
                    Appearance). */}
                {showLogo && logoSide === 'left' && <TitleBarLogo src={logoImage || logoUrl} />}

                {/* Home Tab - Fixed width */}
                {homeTab && (
                    <div className="flex items-center shrink-0 app-no-drag">
                        <button
                            className={`tab-item flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer group relative z-10 ${
                                activeTabId === homeTab.id
                                    ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white'
                                    : 'bg-gray-900/[0.04] dark:bg-surface-raised text-gray-500 dark:text-gray-400 hover:bg-gray-900/[0.06] dark:hover:bg-surface-control'
                            }`}
                            data-tab={homeTab.id}
                            onClick={() => onTabClick(homeTab.id)}
                        >
<ComputerTerminal01Icon className="w-3.5 h-3.5" size={14} />
                            <span className="truncate">{homeTab.title}</span>
                        </button>
                    </div>
                )}

                {/* Divider between Home and Sessions */}
                <div
                    className="shrink-0"
                    style={{
                        width: '1px',
                        height: '16px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        marginLeft: '-6px',
                        marginRight: '-6px'
                    }}
                />

                {/* Session Tabs - Dynamic resizing like Chrome */}
                <div
                    ref={stripRef}
                    className="flex items-center flex-1 min-w-0 h-full overflow-hidden"
                    id="tab-bar"
                    style={{ gap: '4px' }}
                >
                    {segments.map(segment => (
                        segment.kind === 'group' ? (
                            <TabGroup
                                key={segment.key}
                                group={segment.group}
                                onMenu={openGroupMenu}
                                renaming={renaming?.kind === 'group' && renaming.id === segment.group.id}
                                onRenameCommit={commitGroupRename}
                                onRenameCancel={cancelRename}
                            >
                                {segment.items.map(renderTab)}
                            </TabGroup>
                        ) : (
                            renderTab(segment.item)
                        )
                    ))}

                    {/* New Session Plus Button */}
                    <button
                        className="tab-add flex items-center justify-center w-8 h-8 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-900/[0.06] dark:hover:bg-surface-control transition-colors app-no-drag shrink-0"
                        onClick={onNewSession}
                        title={t('newTab.title')}
                        // Pointer events rather than `:hover`, since the turn is
                        // GSAP's now. The colours behind it are still the
                        // stylesheet's, through `transition-colors`.
                        onPointerEnter={() => spinPlus(plusRef.current, true)}
                        onPointerLeave={() => spinPlus(plusRef.current, false)}
                    >
                        <svg ref={plusRef} className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Window Controls */}
            <div className="flex items-center h-full app-no-drag gap-1 shrink-0">
                {/* Ahead of the buttons and with room of its own, so the mark
                    never reads as a fourth one to press. */}
                {showLogo && logoSide === 'right' && (
                    <div className="flex items-center pl-2 pr-3">
                        <TitleBarLogo src={logoImage || logoUrl} />
                    </div>
                )}

                {/* Broadcasting is a mode with consequences a pane border cannot
                    fully carry: the pane you are looking at is only one of the
                    machines being typed at. So it is also said here, in words,
                    with the count, and clicking it is the way out. */}
                {broadcast !== 'off' && (
                    <Tooltip label="Stop sending your typing to every session" hint="Ctrl+Shift+B">
                        <button
                            className="flex items-center gap-1.5 h-7 pl-2 pr-2.5 mr-2 rounded-xl text-[11px] font-semibold
                                bg-amber-100 text-amber-800 hover:bg-amber-200
                                dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25
                                transition-colors"
                            onClick={() => onBroadcastChange?.('off')}
                        >
                            <Megaphone02Icon size={13} strokeWidth={2.25} />
                            <span className="tabular-nums">
                                Typing to {broadcastCount} {broadcastCount === 1 ? 'session' : 'sessions'}
                            </span>
                            {broadcast === 'window' && (
                                <span className="opacity-70 font-medium">· all tabs</span>
                            )}
                        </button>
                    </Tooltip>
                )}

                {/* The bell is the app's control, not the window's, so it keeps
                    a little room of its own before the window's own buttons. */}
                <div className="flex items-center mr-1.5">
                    <NotificationsMenu />
                </div>

                {/* macOS has its own three, over on the left. Drawing a second
                    set here would be one pair too many. */}
                {!IS_MAC && (
                    <>
                        <button
                            className="w-8 h-8 flex items-center justify-center rounded-xl bg-transparent hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                            onClick={handleMinimize}
                        >
                            <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12">
                                <rect y="5" width="12" height="1" fill="currentColor" />
                            </svg>
                        </button>
                        <button
                            className="w-8 h-8 flex items-center justify-center rounded-xl bg-transparent hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                            onClick={handleMaximize}
                        >
                            <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12">
                                <rect width="10" height="10" x="1" y="1" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                            </svg>
                        </button>
                        <button
                            className="w-8 h-8 flex items-center justify-center rounded-xl bg-transparent hover:bg-red-500 hover:text-white transition-colors group"
                            onClick={handleClose}
                        >
                            <svg className="w-3 h-3 text-gray-500 dark:text-gray-400 group-hover:text-white" viewBox="0 0 12 12">
                                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.2" />
                            </svg>
                        </button>
                    </>
                )}
            </div>

            {menu && menuItems.length > 0 && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menuItems}
                    onClose={() => setMenu(null)}
                />
            )}
        </div>
    );
}

export default memo(TitleBar);
