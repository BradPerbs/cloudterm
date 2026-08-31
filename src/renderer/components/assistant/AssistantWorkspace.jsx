import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collapseChip, finishChipOpen, openChip, spinPlus } from '../../lib/tabMotion';
import {
    Cancel01Icon,
    PlusSignIcon,
    MoreHorizontalIcon,
    LinkSquare02Icon,
    ArrowMoveDownLeftIcon,
    Layers01Icon,
} from 'hugeicons-react';
import Tooltip from '../ui/Tooltip';
import ContextMenu from '../ui/ContextMenu';
import PanelMenu from './PanelMenu';
import ScopeMenu from './ScopeMenu';
import AssistantConversation, { HAIRLINE } from './AssistantConversation';
import { useT } from '../../i18n';
import { PANE_HEADER_HEIGHT } from '../../lib/layout';
import {
    FOLLOW,
    GLOBAL,
    describe,
    describeSession,
    followScope,
    fromWire,
    globalScope,
    prune,
    toggle,
} from '../../lib/assistant-scope';

/**
 * The assistant as a set of tabs.
 *
 * One conversation used to be the whole panel. Now the panel holds several,
 * each a tab with its own transcript, scope, draft and attachments, and each
 * kept mounted while it is not in front: a model that is halfway through an
 * answer goes on receiving it, and the composer you were typing into is as
 * you left it when you come back.
 *
 * This is the part shared between the column beside the terminal and a
 * window of its own. The two differ in where the tab list is remembered: the
 * column writes it to localStorage, the way the single conversation was, and
 * a detached window is told what it holds by the main process, which is also
 * where it reports changes so a reload and a close both know what to do.
 *
 * Moving tabs between the two is "detach" and "reattach": the ids go over IPC,
 * the conversations themselves never move, and the events that draw them
 * reach every window alike.
 */

/** Where the column's tabs are remembered. */
const TABS_KEY = 'assistant.tabs';

/** The key the single conversation was kept under, adopted as the first tab. */
const LEGACY_KEY = 'assistant.conversation';

/** Ages in the chat list are minutes and hours, not dates. */
function when(t, timestamp) {
    const age = Date.now() - timestamp;
    if (!timestamp || age < 60_000) return t('monitor.justNow');

    const minutes = Math.floor(age / 60_000);
    if (minutes < 60) return t('monitor.minutesAgo', { count: minutes });

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('monitor.hoursAgo', { count: hours });

    return t('monitor.daysAgo', { count: Math.floor(hours / 24) });
}

let tabCounter = 0;
const newTab = (conversationId = '') => ({
    id: `tab-${Date.now().toString(36)}-${++tabCounter}`,
    conversationId,
    // Which servers the tab is about. The tab owns it because the tab is
    // where it is shown and changed: the selector is the tab's face.
    scope: followScope(),
});

/** The column's tabs as they were left, or one fresh tab. */
function readStoredTabs() {
    try {
        const stored = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
        if (stored && Array.isArray(stored.tabs) && stored.tabs.length > 0) {
            const tabs = stored.tabs
                .filter(entry => entry && typeof entry === 'object')
                .map(entry => newTab(String(entry.conversationId || '')));
            if (tabs.length > 0) {
                const active = Math.min(Math.max(0, Number(stored.active) || 0), tabs.length - 1);
                return { tabs, activeId: tabs[active].id };
            }
        }
    } catch {
        // Unreadable: start again below.
    }

    const legacy = localStorage.getItem(LEGACY_KEY) || '';
    const first = newTab(legacy);
    return { tabs: [first], activeId: first.id };
}

/**
 * One tab in the strip.
 *
 * Its face is the scope selector: which servers the conversation is about is
 * what tells one tab from another, and it is also the thing changed most, so
 * the tab is that control rather than a title with the control somewhere
 * else. On the tab in front the selector is live and opens its menu; on the
 * others it is inert, so a click there brings the tab forward instead. What
 * the conversation was about is the tooltip and the chat list.
 *
 * The selector's button spans the whole tab, with the close button laid over
 * its left end, so the press ripple (which plays on the nearest button)
 * crosses under the × rather than stopping short of it. Close on the left and
 * the servers on the right, so the two are never side by side.
 *
 * It arrives and leaves the way the title bar's tabs do, on the same tweens
 * from `lib/tabMotion`: opening from nothing on mount, and while `closing`,
 * collapsing in place and reporting through `onExited` when it is gone.
 */
function Tab({
    tabId, status, active, closing, scope, scopeProps, onPick, onClose, onMenu, onExited, closeLabel,
}) {
    const t = useT();
    const title = status?.title || t('assistant.newConversation');
    const ref = useRef(null);

    // Mount only. StrictMode mounts twice, so the arrival is undone by landing
    // the chip at full size rather than by killing the tween mid-frame.
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node || closing) return undefined;
        openChip(node);
        return () => finishChipOpen(node);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The tween reports its own end; the timer is the outside date by which
    // the chip goes either way, since a covered window throttles its frames.
    const exit = useRef(onExited);
    exit.current = onExited;
    useLayoutEffect(() => {
        if (!closing) return undefined;
        const tween = collapseChip(ref.current, () => exit.current(tabId));
        const timer = setTimeout(() => exit.current(tabId), 600);
        return () => {
            tween?.kill();
            clearTimeout(timer);
        };
    }, [closing, tabId]);

    return (
        <div
            ref={ref}
            role="tab"
            aria-selected={active}
            aria-hidden={closing || undefined}
            tabIndex={active && !closing ? -1 : 0}
            onClick={closing ? undefined : onPick}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPick();
                }
            }}
            onMouseDown={(event) => {
                // Middle click closes, the way every tab strip does.
                if (event.button === 1) {
                    event.preventDefault();
                    onClose();
                }
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                onMenu(event.clientX, event.clientY);
            }}
            title={title}
            className={`group/tab relative shrink-0 h-8 max-w-[14rem] min-w-[6rem]
                flex items-center rounded-xl text-xs select-none cursor-pointer
                outline-none transition-colors
                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                ${closing ? 'pointer-events-none' : ''}
                ${active
                    ? 'bg-gray-100 dark:bg-surface-control text-gray-900 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] '
                        + 'hover:text-gray-900 dark:hover:text-gray-200'}`}
        >
            <div className="min-w-0 flex-1 flex">
                <ScopeMenu compact inert={!active || closing} scope={scope} {...scopeProps} />
            </div>
            {/* Working, said as a dot: a tab that is answering while another is
                in front should be visibly doing so. */}
            {status?.busy && (
                <span
                    aria-hidden="true"
                    className="shrink-0 mr-2 w-1.5 h-1.5 rounded-full bg-current animate-pulse"
                />
            )}
            <button
                type="button"
                aria-label={closeLabel}
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
                className={`absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-4 h-4 rounded
                    flex items-center justify-center transition-opacity
                    text-gray-400 dark:text-neutral-500
                    hover:text-gray-900 dark:hover:text-white
                    hover:bg-black/[0.06] dark:hover:bg-white/10
                    ${active ? 'opacity-70' : 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100'}`}
            >
                <Cancel01Icon size={10} strokeWidth={2.5} />
            </button>
        </div>
    );
}

export default function AssistantWorkspace({
    sessions,
    hosts = [],
    activeSessionId,
    onOpenSettings,
    onOpenSnippets,
    onClose,
    /** In a window of its own rather than the column beside the terminal. */
    detached = false,
    /** Tabs pushed in from elsewhere: `{ conversationIds, seq }`. */
    adopt = null,
}) {
    const t = useT();

    // The column has its tabs at once; a window has to ask for them.
    const [state, setState] = useState(() => (detached
        ? { tabs: [], activeId: '' }
        : readStoredTabs()));
    const [ready, setReady] = useState(!detached);

    /** What each tab reports about itself: `{ title, busy }`, by tab id. */
    const [statuses, setStatuses] = useState({});

    const { tabs, activeId } = state;

    /**
     * Tabs that have been closed but are still on screen, each remembered
     * with the place it held, whether it was in front, and what it said, so
     * it collapses from where it was and as it looked. Dropped once the
     * collapse reports back.
     */
    const [closingTabs, setClosingTabs] = useState([]);
    const dropClosingTab = useCallback((tabId) => {
        setClosingTabs(current => current.filter(entry => entry.tab.id !== tabId));
    }, []);

    // The state as it stands, for callbacks that must not close over a render.
    const stateRef = useRef(state);
    stateRef.current = state;
    const statusesRef = useRef(statuses);
    statusesRef.current = statuses;

    /* ------------------------------------------------------------------ *
     * Where the tab list lives
     * ------------------------------------------------------------------ */

    useEffect(() => {
        if (!detached) return undefined;
        let cancelled = false;
        window.api.ai.windowTabs()
            .then(({ conversationIds = [] } = {}) => {
                if (cancelled) return;
                const list = conversationIds.length > 0
                    ? conversationIds.map(id => newTab(id))
                    : [newTab()];
                setState({ tabs: list, activeId: list[0].id });
            })
            .catch(() => {
                if (cancelled) return;
                const first = newTab();
                setState({ tabs: [first], activeId: first.id });
            })
            .finally(() => {
                if (!cancelled) setReady(true);
            });
        return () => { cancelled = true; };
    }, [detached]);

    // Every window reports what it holds, the column included: main is where
    // "a conversation is shown in one place" is enforced, and it can only do
    // that knowing both sides.
    useEffect(() => {
        if (!ready) return;
        window.api.ai.setWindowTabs?.(tabs.map(tab => tab.conversationId).filter(Boolean));
    }, [tabs, ready]);

    useEffect(() => {
        if (!ready || detached) return;
        const active = Math.max(0, tabs.findIndex(tab => tab.id === activeId));
        localStorage.setItem(TABS_KEY, JSON.stringify({
            tabs: tabs.map(tab => ({ conversationId: tab.conversationId })),
            active,
        }));
        // The old single slot is what an older build would read, so it
        // follows the tab in front.
        const current = tabs[active]?.conversationId;
        if (current) localStorage.setItem(LEGACY_KEY, current);
    }, [tabs, activeId, ready, detached]);

    /* ------------------------------------------------------------------ *
     * Changing the tabs
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Scope: which servers each tab is about
     * ------------------------------------------------------------------ */

    const setScope = useCallback((tabId, next) => {
        setState(current => ({
            ...current,
            tabs: current.tabs.map(tab => (tab.id === tabId
                ? { ...tab, scope: typeof next === 'function' ? next(tab.scope) : next }
                : tab)),
        }));
    }, []);

    /**
     * A tab that takes on an existing conversation is pointed back at the
     * servers that conversation was about. Main keeps the selection per
     * conversation, so a tab moved to another window, opened from the chat
     * list, or restored after a restart reads it back rather than starting
     * from "follow". Each tab is read once; the answer is applied only if
     * nobody has touched the selection in the meantime, since a choice made
     * while the read was in flight beats what was stored before it.
     */
    const restored = useRef(new Set());
    useEffect(() => {
        for (const tab of tabs) {
            if (!tab.conversationId || restored.current.has(tab.id)) continue;
            restored.current.add(tab.id);
            window.api.ai.history(tab.conversationId).then((past) => {
                if (!past?.found) return;
                const scope = fromWire(past);
                if (scope.mode === FOLLOW) return;
                setState(current => ({
                    ...current,
                    tabs: current.tabs.map(entry => (
                        entry.id === tab.id && entry.scope.mode === FOLLOW ? { ...entry, scope } : entry
                    )),
                }));
            }).catch(() => {});
        }
    }, [tabs]);

    // A session a tab was pinned to can be closed underneath it, which would
    // otherwise leave it pointed at nothing with no sign of why. Pinned hosts
    // survive: an unconnected host is still somewhere to work.
    useEffect(() => {
        const open = sessions.map(session => session.sessionId);
        setState(current => {
            let changed = false;
            const tabs = current.tabs.map((tab) => {
                const pruned = prune(tab.scope, open);
                if (pruned === tab.scope) return tab;
                changed = true;
                return { ...tab, scope: pruned };
            });
            return changed ? { ...current, tabs } : current;
        });
    }, [sessions]);

    /**
     * What the "current session" option names. Derived from the active
     * session rather than from any tab's scope: read off the scope it would
     * relabel itself the moment "All hosts" was picked.
     */
    const followLabel = useMemo(() => describeSession(
        sessions.find(session => session.sessionId === activeSessionId),
        t('assistant.nothingConnected'),
    ), [sessions, activeSessionId, t]);

    /** The selector's props for one tab, minus the scope itself. */
    const scopePropsFor = useCallback((tab) => ({
        onSetMode: (mode) => setScope(tab.id, mode === GLOBAL ? globalScope() : followScope()),
        onToggle: (kind, id) => setScope(tab.id, current => toggle(current, kind, id)),
        sessions,
        hosts,
        activeSessionId,
        followLabel,
        scopeLabel: describe(tab.scope, { sessions, hosts, activeSessionId }).label,
    }), [setScope, sessions, hosts, activeSessionId, followLabel]);

    /** A tab learning which conversation it holds, or moving to another. */
    const setConversation = useCallback((tabId, conversationId) => {
        setState(current => ({
            ...current,
            tabs: current.tabs.map(tab => (tab.id === tabId ? { ...tab, conversationId } : tab)),
        }));
    }, []);

    const addTab = useCallback((conversationId = '') => {
        const tab = newTab(conversationId);
        setState(current => ({ tabs: [...current.tabs, tab], activeId: tab.id }));
        return tab.id;
    }, []);

    /**
     * A conversation asked for by id: brought to the front if a tab already
     * holds it, opened in a new one otherwise. What the history menu does.
     */
    const openConversation = useCallback((conversationId) => {
        setState(current => {
            const holder = current.tabs.find(tab => tab.conversationId === conversationId);
            if (holder) return { ...current, activeId: holder.id };
            const tab = newTab(conversationId);
            return { tabs: [...current.tabs, tab], activeId: tab.id };
        });
    }, []);

    /**
     * Take tabs out of the strip. The conversation behind each is parked, not
     * closed: it stays in the history, and the query it was running is let go.
     * The strip never goes empty in the column; in a window it means the
     * window is done.
     */
    const dropTabs = useCallback((tabIds, { park = true } = {}) => {
        // Remembered before they go, so they can collapse from their places.
        const held = stateRef.current;
        const going = held.tabs
            .map((tab, index) => ({ tab, index, active: tab.id === held.activeId, status: statusesRef.current[tab.id] }))
            .filter(entry => tabIds.includes(entry.tab.id));
        if (going.length > 0) setClosingTabs(current => [...current, ...going]);

        setState(current => {
            const going = current.tabs.filter(tab => tabIds.includes(tab.id));
            if (park) {
                for (const tab of going) {
                    if (tab.conversationId) window.api.ai.park(tab.conversationId);
                }
            }
            let remaining = current.tabs.filter(tab => !tabIds.includes(tab.id));

            if (remaining.length === 0) {
                if (detached) {
                    window.api.ai.closeWindow();
                    return { tabs: [], activeId: '' };
                }
                remaining = [newTab()];
            }

            // The tab after the one that closed takes its place, then the one
            // before, the way a browser does it.
            let nextActive = current.activeId;
            if (tabIds.includes(nextActive)) {
                const index = current.tabs.findIndex(tab => tab.id === nextActive);
                const next = current.tabs.slice(index + 1).find(tab => !tabIds.includes(tab.id))
                    || [...current.tabs.slice(0, index)].reverse().find(tab => !tabIds.includes(tab.id))
                    || remaining[0];
                nextActive = next.id;
            }
            return { tabs: remaining, activeId: nextActive };
        });
        setStatuses(current => {
            const next = { ...current };
            for (const id of tabIds) delete next[id];
            return next;
        });
    }, [detached]);

    const closeTab = useCallback((tabId) => dropTabs([tabId]), [dropTabs]);

    /* ------------------------------------------------------------------ *
     * History
     * ------------------------------------------------------------------ */

    /** Every conversation the app still has, newest first. Read on demand. */
    const [conversations, setConversations] = useState([]);
    const refreshConversations = useCallback(async () => {
        try {
            setConversations(await window.api.ai.list() || []);
        } catch {
            // The menu just shows what it had.
        }
    }, []);

    /**
     * Throw a conversation away for good. Any tab holding it goes too, and
     * the strip's own rule fills the gap if that was the last one.
     */
    const removeConversation = useCallback(async (conversationId) => {
        const holders = tabs.filter(tab => tab.conversationId === conversationId).map(tab => tab.id);
        if (holders.length > 0) dropTabs(holders, { park: false });
        await window.api.ai.close(conversationId);
        await refreshConversations();
    }, [tabs, dropTabs, refreshConversations]);

    // Another window has opened one of these, so it goes from here: neither
    // parked nor closed, since the other window is carrying it on. The tabs
    // are read through a ref so the subscription is made once.
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    useEffect(() => window.api.ai.onReleaseTabs?.(({ conversationIds }) => {
        if (!Array.isArray(conversationIds) || conversationIds.length === 0) return;
        const holders = tabsRef.current
            .filter(tab => conversationIds.includes(tab.conversationId))
            .map(tab => tab.id);
        if (holders.length > 0) dropTabs(holders, { park: false });
    }), [dropTabs]);

    // Tabs handed to this strip from a window that closed or gave them back.
    // Anything already open here is only brought forward.
    const adopted = useRef(0);
    useEffect(() => {
        if (!adopt || adopt.seq === adopted.current) return;
        adopted.current = adopt.seq;
        setState(current => {
            const open = new Set(current.tabs.map(tab => tab.conversationId));
            const fresh = (adopt.conversationIds || [])
                .filter(id => id && !open.has(id))
                .map(id => newTab(id));
            const first = fresh[0]
                || current.tabs.find(tab => tab.conversationId === adopt.conversationIds?.[0]);
            return {
                tabs: [...current.tabs, ...fresh],
                activeId: first ? first.id : current.activeId,
            };
        });
    }, [adopt]);

    /* ------------------------------------------------------------------ *
     * Windows
     * ------------------------------------------------------------------ */

    /** Lift these tabs into a window of their own. */
    const detachTabs = useCallback(async (tabIds) => {
        const ids = tabs
            .filter(tab => tabIds.includes(tab.id))
            .map(tab => tab.conversationId)
            .filter(Boolean);
        if (ids.length === 0) return;
        const result = await window.api.ai.detach(ids);
        if (result?.success) dropTabs(tabIds, { park: false });
    }, [tabs, dropTabs]);

    /** Every tab in its own window, one after another. */
    const detachEach = useCallback(async () => {
        for (const tab of tabs) {
            // eslint-disable-next-line no-await-in-loop
            await detachTabs([tab.id]);
        }
    }, [tabs, detachTabs]);

    /** Back to the column in the main window. */
    const reattach = useCallback(async (tabIds) => {
        const ids = tabs
            .filter(tab => tabIds.includes(tab.id))
            .map(tab => tab.conversationId)
            .filter(Boolean);
        await window.api.ai.reattach(ids);
        dropTabs(tabIds, { park: false });
    }, [tabs, dropTabs]);

    /**
     * The strip's one menu: the chats the app still has, the moves between
     * windows, and closing the panel. Actions are rows of a section with no
     * current value, so picking one runs it and nothing is left ticked.
     */
    const activeConversationId = tabs.find(tab => tab.id === activeId)?.conversationId || '';

    const menuSections = useMemo(() => {
        const several = tabs.length > 1;
        const actions = {};
        const rows = [];
        const add = (value, label, icon, fn) => {
            actions[value] = fn;
            rows.push({ value, label, icon });
        };

        if (!detached || several) {
            add('detach', several ? t('assistant.detachTab') : t('assistant.detachOnly'),
                <LinkSquare02Icon size={14} strokeWidth={1.5} />, () => detachTabs([activeId]));
        }
        if (several) {
            add('detach-all', t('assistant.detachAll'),
                <Layers01Icon size={14} strokeWidth={1.5} />, () => detachTabs(tabs.map(tab => tab.id)));
            add('detach-each', t('assistant.detachEach'),
                <LinkSquare02Icon size={14} strokeWidth={1.5} />, detachEach);
        }
        if (detached) {
            if (several) {
                add('reattach', t('assistant.reattachTab'),
                    <ArrowMoveDownLeftIcon size={14} strokeWidth={1.5} />, () => reattach([activeId]));
            }
            add('reattach-all', several ? t('assistant.reattachAll') : t('assistant.reattach'),
                <ArrowMoveDownLeftIcon size={14} strokeWidth={1.5} />, () => reattach(tabs.map(tab => tab.id)));
        }
        if (!detached && onClose) {
            add('close', t('assistant.closePanel'),
                <Cancel01Icon size={14} strokeWidth={1.5} />, onClose);
        }

        // The current conversation is always in the list main keeps, so the
        // only way this is empty is a read that has not answered yet.
        const chats = conversations.length > 0
            ? conversations
            : [{ conversationId: activeConversationId, title: '', updatedAt: Date.now() }];

        // The short list first. The chats can run to twenty and scroll, and
        // the moves between windows should not be at the bottom of that.
        return [
            {
                heading: t('assistant.windows'),
                value: '',
                onChange: (value) => actions[value]?.(),
                options: rows,
            },
            {
                heading: t('assistant.chats'),
                value: activeConversationId,
                onChange: openConversation,
                options: chats.map(conversation => ({
                    value: conversation.conversationId,
                    label: conversation.title || t('assistant.newConversation'),
                    hint: when(t, conversation.updatedAt),
                    onRemove: () => removeConversation(conversation.conversationId),
                })),
            },
        ];
    }, [
        tabs, activeId, activeConversationId, detached, conversations, onClose,
        detachTabs, detachEach, reattach, openConversation, removeConversation, t,
    ]);

    /* ------------------------------------------------------------------ *
     * Keyboard
     * ------------------------------------------------------------------ */

    // Ctrl+Tab and Ctrl+Shift+Tab walk the strip, Ctrl+T opens a tab and
    // Ctrl+W closes the one in front. Only while focus is inside the
    // assistant, which is what a handler on the wrapper gives: the terminal
    // keeps the same chords for its own tabs.
    const onKeyDown = useCallback((event) => {
        if (!event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? -1 : 1;
            setState(current => {
                const index = current.tabs.findIndex(tab => tab.id === current.activeId);
                const next = current.tabs[(index + step + current.tabs.length) % current.tabs.length];
                return next ? { ...current, activeId: next.id } : current;
            });
        } else if (event.key === 'w' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            closeTab(activeId);
        } else if (event.key === 't' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            addTab();
        }
    }, [activeId, closeTab, addTab]);

    /* ------------------------------------------------------------------ *
     * Right-click on a tab
     * ------------------------------------------------------------------ */

    /** `{ tabId, x, y }` while a tab's own menu is open. */
    const [menu, setMenu] = useState(null);

    /** The plus glyph, which turns under the pointer. */
    const plusRef = useRef(null);

    const menuItems = useMemo(() => {
        if (!menu) return [];
        const several = tabs.length > 1;
        const others = tabs.filter(tab => tab.id !== menu.tabId).map(tab => tab.id);
        const current = menu.tabId === activeId;

        return [
            {
                label: t('assistant.newTab'),
                icon: <PlusSignIcon size={14} strokeWidth={2} />,
                shortcut: 'Ctrl+T',
                onClick: () => addTab(),
            },
            { type: 'separator' },
            (!detached || several) && {
                label: several ? t('assistant.detachTab') : t('assistant.detachOnly'),
                icon: <LinkSquare02Icon size={14} strokeWidth={1.5} />,
                onClick: () => detachTabs([menu.tabId]),
            },
            several && {
                label: t('assistant.detachAll'),
                icon: <Layers01Icon size={14} strokeWidth={1.5} />,
                onClick: () => detachTabs(tabs.map(tab => tab.id)),
            },
            several && {
                label: t('assistant.detachEach'),
                icon: <LinkSquare02Icon size={14} strokeWidth={1.5} />,
                onClick: detachEach,
            },
            detached && several && {
                label: t('assistant.reattachTab'),
                icon: <ArrowMoveDownLeftIcon size={14} strokeWidth={1.5} />,
                onClick: () => reattach([menu.tabId]),
            },
            detached && {
                label: several ? t('assistant.reattachAll') : t('assistant.reattach'),
                icon: <ArrowMoveDownLeftIcon size={14} strokeWidth={1.5} />,
                onClick: () => reattach(tabs.map(tab => tab.id)),
            },
            { type: 'separator' },
            {
                label: t('assistant.closeTab'),
                icon: <Cancel01Icon size={14} strokeWidth={1.5} />,
                shortcut: current ? 'Ctrl+W' : undefined,
                onClick: () => closeTab(menu.tabId),
            },
            several && {
                label: t('assistant.closeOtherTabs'),
                icon: <Cancel01Icon size={14} strokeWidth={1.5} />,
                onClick: () => dropTabs(others),
            },
        ];
    }, [menu, tabs, activeId, detached, addTab, detachTabs, detachEach, reattach, closeTab, dropTabs, t]);

    const reportStatus = useCallback((tabId, status) => {
        setStatuses(current => {
            const held = current[tabId];
            if (held && held.title === status.title && held.busy === status.busy) return current;
            return { ...current, [tabId]: status };
        });
    }, []);

    /**
     * The strip as drawn: the live tabs, with each closing one put back at the
     * place it held so it collapses there rather than at the end of the row.
     */
    const strip = useMemo(() => {
        const rows = tabs.map(tab => ({ key: tab.id, tab, closing: false }));
        for (const entry of [...closingTabs].sort((a, b) => a.index - b.index)) {
            rows.splice(Math.min(entry.index, rows.length), 0, {
                key: entry.tab.id,
                tab: entry.tab,
                closing: true,
                active: entry.active,
                status: entry.status,
            });
        }
        return rows;
    }, [tabs, closingTabs]);

    if (!ready) return null;

    return (
        <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
            {/* The strip. Above the conversation's own header, since that
                header belongs to one conversation and this row is about which
                one. The list scrolls sideways past what fits; the menu on the
                right stays put. */}
            <div
                role="tablist"
                data-assistant-tabs=""
                // The pane headers' grid: a 44px row, 32px controls with a 12px
                // radius, 6px in from the card's edge. That is the inset that
                // keeps a 12px corner concentric with the card's 16px one; the
                // 8px chips at 4px this used to have sat visibly off it.
                className={`shrink-0 px-1.5 flex items-center gap-1 border-b ${HAIRLINE}`}
                style={{ height: PANE_HEADER_HEIGHT }}
            >
                <div
                    className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto scrollbar-none py-1"
                    // The wheel scrolls the strip sideways: it is a row, and a
                    // vertical wheel over a row that cannot move vertically
                    // is a request to move it the way it can.
                    onWheel={(event) => {
                        if (event.deltaY === 0 || event.deltaX !== 0) return;
                        event.currentTarget.scrollLeft += event.deltaY;
                    }}
                >
                    {strip.map(({ key, tab, closing, active, status }) => (
                        <Tab
                            key={key}
                            tabId={tab.id}
                            closing={closing}
                            status={closing ? status : statuses[tab.id]}
                            active={closing ? active : tab.id === activeId}
                            scope={tab.scope}
                            scopeProps={scopePropsFor(tab)}
                            onPick={() => setState(current => ({ ...current, activeId: tab.id }))}
                            onClose={() => closeTab(tab.id)}
                            onMenu={(x, y) => setMenu({ tabId: tab.id, x, y })}
                            onExited={dropClosingTab}
                            closeLabel={t('assistant.closeTab')}
                        />
                    ))}
                    {/* The title bar's plus, to the letter: the same glyph,
                        and the same quarter turn under the pointer, on the
                        same tween. */}
                    <Tooltip label={t('assistant.newTab')} hint="Ctrl+T" placement="bottom">
                        <button
                            type="button"
                            aria-label={t('assistant.newTab')}
                            onClick={() => addTab()}
                            onPointerEnter={() => spinPlus(plusRef.current, true)}
                            onPointerLeave={() => spinPlus(plusRef.current, false)}
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl
                                transition-colors outline-none
                                text-gray-400 dark:text-gray-500
                                hover:bg-gray-900/[0.06] hover:text-gray-900
                                dark:hover:bg-surface-control dark:hover:text-white
                                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
                        >
                            <svg ref={plusRef} className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                        </button>
                    </Tooltip>
                </div>

                <PanelMenu
                    align="right"
                    menuClassName="w-72"
                    sections={menuSections}
                    trigger={({ open, toggle }) => (
                        <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={open}
                            aria-label={t('assistant.tabMenu')}
                            title={t('assistant.tabMenu')}
                            onClick={() => {
                                if (!open) refreshConversations();
                                toggle();
                            }}
                            className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-xl
                                transition-colors outline-none
                                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                                ${open
                                    ? 'bg-gray-100 dark:bg-surface-control text-gray-900 dark:text-white'
                                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 '
                                        + 'dark:hover:bg-surface-control dark:hover:text-white'}`}
                        >
                            <MoreHorizontalIcon size={16} strokeWidth={2} />
                        </button>
                    )}
                />
            </div>

            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menuItems}
                    onClose={() => setMenu(null)}
                />
            )}

            {/* Every tab, mounted; only the one in front is shown. Hiding
                rather than unmounting is what keeps a background tab's
                stream, draft and scope. */}
            {tabs.map(tab => (
                // A class rather than `hidden`: the attribute's reset and the
                // `flex` utility weigh the same, and the utility is declared
                // later, so a hidden flex box would still be drawn.
                <div
                    key={tab.id}
                    className={tab.id === activeId ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}
                >
                    <AssistantConversation
                        tabId={tab.id}
                        conversationId={tab.conversationId}
                        active={tab.id === activeId}
                        scope={tab.scope}
                        sessions={sessions}
                        hosts={hosts}
                        activeSessionId={activeSessionId}
                        onConversationChange={(id) => setConversation(tab.id, id)}
                        onStatus={reportStatus}
                        onOpenSettings={onOpenSettings}
                        onOpenSnippets={onOpenSnippets}
                    />
                </div>
            ))}
        </div>
    );
}
