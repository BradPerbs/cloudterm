import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Cancel01Icon, Maximize01Icon, Minimize01Icon, CommandLineIcon, CpuIcon, Folder01Icon, Camera01Icon, Refresh01Icon, ArrowDataTransferHorizontalIcon, ComputerIcon, LayoutTwoColumnIcon, LayoutTwoRowIcon, ArrowExpand01Icon, ArrowShrink01Icon, Search01Icon, FlashIcon, Menu01Icon, Megaphone02Icon, RecordIcon, StopCircleIcon } from 'hugeicons-react';
import { resolveTerminalTheme } from '../hooks/useTerminalTheme';
import { DEFAULT_TERMINAL_SETTINGS, resolveFontFamily } from '../hooks/useTerminalSettings';
import toast from 'react-hot-toast';
import { useTransfers } from '../hooks/useTransfers';
import { useTunnels } from '../hooks/useTunnels';
import { useSshConnection } from '../hooks/useSshConnection';
import { toastOptions } from '../lib/toast';
import { MODIFIER_KEY } from '../lib/platform';
import { OsIcon, hostOs } from '../lib/os-icons';
import { protocolLabel } from '../lib/protocols';
import SegmentedControl from './ui/SegmentedControl';
import MenuButton from './ui/MenuButton';
import Tooltip from './ui/Tooltip';
import SessionScreen from './ui/SessionScreen';
import SftpView from './SftpView';
import TunnelsView from './tunnels/TunnelsView';
import VncView from './VncView';
import RdpView from './RdpView';
import BmcView from './BmcView';
import SearchBar from './terminal/SearchBar';
import PaneRoute, { DesktopPaneRoute } from './terminal/PaneRoute';
import SnippetPalette from './snippets/SnippetPalette';

// Pane ids that already opened a connection. Guards against React StrictMode's
// double-mount in development dialling the same host twice.
const connectedPanes = new Set();

// A pane can be a quarter of the window, so the header sheds what it cannot
// fit, least important first: the view labels, then the status line. What is
// left is the pane's name and the route mark, which between them say which
// session you are looking at and where it goes.
const COMPACT_WIDTH = 760;
const NARROW_WIDTH = 560;

// The action buttons are handled separately, because they are not dropped;
// they move into the header's burger menu one at a time as the room for them
// runs out, so every action stays reachable at any pane width.
const ACTION_BUTTON = 32;                 // w-8
const ACTION_GAP_COMPACT = 6;             // gap-1.5
const ACTION_GAP = 8;                     // gap-2
const HEADER_CHROME = 24 + 12;            // px-3 either side, gap-3 between groups
// What the pane's name is never made to give up. Below this the title would be
// an ellipsis and the header would stop identifying the session at all.
const IDENTITY_MIN = 124;

const nextFrame = () => new Promise(requestAnimationFrame);

/**
 * Resolve once the terminal font is actually usable. Browsers only fetch a
 * webfont when something needs it, so without this the first terminal measures
 * the fallback font and every column count downstream is wrong.
 *
 * Asked for the family that is actually configured, not the bundled one: a
 * chosen face that is still loading has the same effect on the measurement.
 */
function ensureTerminalFont(fontSize, weight, fontFamily) {
    if (!document.fonts?.load) return Promise.resolve();
    return document.fonts
        .load(`${weight} ${fontSize}px ${fontFamily}`)
        .catch(() => {}); // Fall back silently to the next family in the stack.
}

/**
 * The xterm options a settings record means.
 *
 * One place, used by both the initial construction and the update effect, so
 * the two can never drift into disagreeing about what a setting does.
 */
function terminalOptions(settings) {
    return {
        fontFamily: resolveFontFamily(settings.fontFamily),
        fontSize: settings.fontSize,
        fontWeight: settings.fontWeight,
        // xterm draws bold as a separate weight; keeping the gap constant means
        // bold still reads as bold at weight 300 and at weight 600.
        fontWeightBold: Math.min(900, settings.fontWeight + 300),
        lineHeight: settings.lineHeight,
        letterSpacing: settings.letterSpacing,
        cursorStyle: settings.cursorStyle,
        cursorBlink: settings.cursorBlink,
        scrollback: settings.scrollback,
        smoothScrollDuration: settings.smoothScrollDuration,
    };
}

// A row is only given back once the overflow is worth seeing. Both renderers
// round the drawn height to whole device pixels, so a sub-pixel overhang is
// arithmetic rather than a clipped line, and trading a whole row for it would
// leave a visible gap at the bottom of every pane.
const ROW_CLIP_SLACK = 1; // px

/**
 * Size the terminal to its pane, without ever leaving a row half-drawn.
 *
 * `FitAddon` divides the pane's height by the height of one cell, but the only
 * padding it subtracts is padding sitting on the `.xterm` element itself, and
 * the padding here is on the container wrapping it. Everything in this app is
 * `border-box`, so the height it reads back already includes that padding, and
 * `p-3` gets handed to the terminal as though it were room for text. At 24px it
 * is worth an entire row: the session comes up one row taller than the pane can
 * show, and `overflow-hidden` quietly cuts the difference off the bottom. What
 * it cuts is the newest line: the prompt, the line being typed on, the thing
 * just printed.
 *
 * The renderers add a second, smaller drift: WebGL floors a cell to whole
 * device pixels, while the DOM renderer derives it back out of the height the
 * screen already had. Swapping one for the other (on mount, on the ligature
 * toggle, on a move to a display with a different pixel ratio) changes what a
 * row costs without changing how many rows there are.
 *
 * So the proposal is checked against the height the rows are actually being
 * drawn at, measured off the DOM rather than recomputed from the numbers that
 * disagree, and a row is given back when they do not fit. Blank space under the
 * last line is invisible; half a line of text is the bug.
 *
 * Returns false when nothing could be measured, so callers know not to report
 * the geometry onwards.
 */
function fitToPane(term, fitAddon, container) {
    if (!term || !fitAddon || !container) return false;

    // No box at all: the pane is behind SFTP, the desktop, or an inactive tab.
    // Measuring now would propose the one-row minimum and rewrap the whole
    // scrollback into a 2x1 terminal.
    if (!container.clientHeight || !container.clientWidth) return false;

    const proposed = fitAddon.proposeDimensions();
    if (!proposed?.rows || !proposed?.cols) return false;

    const style = getComputedStyle(container);
    const available = container.getBoundingClientRect().height
        - parseFloat(style.paddingTop)
        - parseFloat(style.paddingBottom);

    // What one row actually costs on screen, taken from the rows on screen; the
    // renderer's own cell height is the number in question.
    const screen = term.element?.querySelector('.xterm-screen') || term.element;
    const drawn = screen?.getBoundingClientRect().height || 0;
    const cellHeight = term.rows > 0 ? drawn / term.rows : 0;

    let rows = proposed.rows;
    if (cellHeight > 0) {
        rows = Math.max(1, Math.min(rows, Math.floor((available + ROW_CLIP_SLACK) / cellHeight)));
    }

    // `fit()` is not used: it would resize to the proposal first and be
    // corrected straight after, costing a reflow and a stray SIGWINCH every
    // time the pane moves. Resizing fires a full render on its own.
    if (rows !== term.rows || proposed.cols !== term.cols) {
        term.resize(proposed.cols, rows);
    }
    return true;
}

/**
 * One SSH session, filling one pane.
 *
 * `pane` is a leaf of the tab's layout tree, and its id is the session key the
 * main process knows this connection by. A tab with no splits holds exactly one
 * of these, which is the shape this component had before panes existed.
 */
function TerminalView({
    pane,
    // Which of several sessions on the same host this one is, or 0 when it is
    // the only one. Handed down rather than worked out here: the number only
    // means anything across the whole window, and the tab strip and the
    // assistant's scope menu have to agree with it.
    ordinal = 0,
    terminalTheme,
    customTerminalTheme,
    terminalSettings = DEFAULT_TERMINAL_SETTINGS,
    broadcast = 'off',
    isBroadcastTarget = false,
    broadcastCount = 0,
    onBroadcastChange,
    onInput,
    isActive,
    isFocused = true,
    isSplit = false,
    isZoomed = false,
    canSplit = true,
    isFullscreen,
    onToggleFullscreen,
    onFocus,
    onSplit,
    onToggleZoom,
    onClosePane,
    onConnectResult,
    onConnectionChange,
    onRegisterConnection,
    onUpdateHost,
    // The two questions a handshake can stop on, when it is this pane's
    // handshake that stopped. Both are answered on the pane's own screen.
    hostKeyPrompt = null,
    onHostKeyRespond,
    authPrompt = null,
    onAuthRespond,
}) {
    const rootRef = useRef(null);
    const terminalRef = useRef(null);
    const termRef = useRef(null);
    const fitAddonRef = useRef(null);
    const searchAddonRef = useRef(null);
    // Held so the ligature toggle can tear the GPU renderer down and put it
    // back without rebuilding the terminal underneath it.
    const webglRef = useRef(null);
    const [logging, setLogging] = useState({ recording: false, fileName: '', always: false });
    const [isConnecting, setIsConnecting] = useState(true);
    /**
     * Whether this pane has ever had a session up.
     *
     * It is what decides who owns the pane when there is no connection: before
     * the first one lands there is nothing in the terminal, so the session
     * screen has it, and a failure is a screen rather than a red line in an
     * otherwise blank buffer. After it, the scrollback is the pane, and a drop
     * is reported in the header without covering a word of it.
     */
    const [everConnected, setEverConnected] = useState(false);

    /**
     * The question this pane's handshake is currently stopped on, if any.
     *
     * Read as an id rather than an object so the effects that depend on it fire
     * once per question, and not again every time the queue behind it is
     * rewritten.
     */
    const promptId = hostKeyPrompt?.requestId || authPrompt?.requestId || null;
    const [searchOpen, setSearchOpen] = useState(false);
    const [snippetsOpen, setSnippetsOpen] = useState(false);
    /**
     * A host that is only a desktop: a Windows box with RDP and no SSH server.
     *
     * Everything else in a pane hangs off an SSH session, so this is read before
     * the state that depends on it: such a pane opens straight into the desktop,
     * never dials, and does not offer the views that would need a session.
     */
    const desktopOnly = Boolean(pane?.host?.desktop?.enabled && pane.host.desktop.only);

    /**
     * And a host that is only a service processor: an IPMI in front of a machine
     * this app will never hold a shell on. Read here for the same reason
     * `desktopOnly` is, and it outranks it when both are set, because a pane
     * cannot open on two things and the IPMI is the one that reaches a board
     * that is powered off.
     */
    const bmcOnly = Boolean(pane?.host?.bmc?.enabled && pane.host.bmc.only);

    /**
     * A pane with no SSH session behind it, by either route.
     *
     * The session's own chrome (the status dot, the route mark, Reconnect) is
     * keyed off this rather than off `desktopOnly` alone, because all three
     * describe a connection that a pane like this never opens and would
     * otherwise sit on "connecting" forever.
     */
    const sessionless = desktopOnly || bmcOnly;

    // 'ssh' | 'sftp' | 'tunnels' | 'desktop' | 'bmc'
    const [viewMode, setViewMode] = useState(
        bmcOnly ? 'bmc' : desktopOnly ? 'desktop' : 'ssh',
    );

    /**
     * A view the pane was asked to open on, still waiting on what carries it.
     *
     * "Connect via SFTP" from the Hosts page cannot simply start on the file
     * browser: files are a channel on the SSH session, so there is nothing to
     * browse until that is up. The pane opens on the shell, which is also where
     * a failure to connect is legible, and moves itself across the moment the
     * session is ready. Cleared once honoured, and by any manual switch: after
     * you have chosen a view yourself, nothing should move it for you.
     */
    const pendingView = useRef(['sftp', 'desktop', 'bmc'].includes(pane?.view) ? pane.view : null);

    // The element a view puts its own controls in. State rather than a ref
    // because the child portals into it, and a ref would still be null on the
    // render that matters.
    //
    // Shared by every view that has controls of its own, rather than one slot
    // each: only one view is in front at a time, so a second slot would be an
    // empty div in the header for the whole life of the pane.
    const [paneToolbar, setPaneToolbar] = useState(null);
    // Once opened, the SFTP pane stays mounted: unmounting it would throw away
    // the browsing position and stop the transfer queue reporting progress.
    const [sftpOpened, setSftpOpened] = useState(false);
    // Same for the desktop, and more so: unmounting it would drop a live RFB
    // session and its framebuffer just for glancing at the shell. Open from the
    // start when the desktop is the only thing this pane is for.
    const [desktopOpened, setDesktopOpened] = useState(desktopOnly);
    // And the IPMI, for the strongest version of the same reason: unmounting it
    // would throw away a logged-in session on the vendor's own UI, and whatever
    // half-finished form was on screen with it. Open from the start when the
    // IPMI is the only thing this pane is for.
    const [bmcOpened, setBmcOpened] = useState(bmcOnly);
    const [width, setWidth] = useState(Infinity);
    // The view switcher and the Reconnect button never collapse, and both are
    // text-sized, so how much room is left for the action buttons is measured
    // off them rather than guessed at. Starts at 0 so the first paint, before
    // any measurement, errs towards showing everything.
    const [fixedWidth, setFixedWidth] = useState(0);
    const fixedRef = useRef(null);
    const { summary } = useTransfers(pane?.id);
    // Read here as well as in the panel, so the header badge shows what is
    // forwarding without the panel ever having been opened.
    const { summary: tunnelSummary } = useTunnels(pane?.id);

    // Kept in refs so callbacks never need them as dependencies.
    const connectResultRef = useRef(onConnectResult);
    connectResultRef.current = onConnectResult;

    const connectionChangeRef = useRef(onConnectionChange);
    connectionChangeRef.current = onConnectionChange;

    const titleRef = useRef(pane?.title);
    titleRef.current = pane?.title || 'terminal';

    /**
     * Everything typed, pasted or inserted goes out through here.
     *
     * A ref because the mount effect below registers xterm's data handler once,
     * for the life of the pane, and that handler has to reach whatever the
     * current broadcast scope is, not the one that was in force when the pane
     * opened.
     */
    const inputRef = useRef(onInput);
    inputRef.current = onInput;

    // Same reason: the link addon is loaded once, for the life of the pane, so
    // it has to read the current setting rather than the one that was in force
    // when the session opened.
    const linkActivationRef = useRef(terminalSettings.linkActivation);
    linkActivationRef.current = terminalSettings.linkActivation;

    const sendInput = useCallback((data) => {
        if (!pane?.id) return;
        if (inputRef.current) inputRef.current(pane.id, data);
        else window.api.ssh.sendInput(pane.id, data);
    }, [pane?.id]);

    /**
     * Re-measure the pane and tell the remote what it now is.
     *
     * Every path that can change the size of a cell or of the pane ends up
     * here, so there is one place that decides how many rows fit, and so the
     * rule that the bottom row is never clipped only has to hold in one place.
     */
    const pushResize = useCallback(() => {
        const term = termRef.current;
        if (!fitToPane(term, fitAddonRef.current, terminalRef.current)) return;
        window.api.ssh.resize(pane.id, term.cols, term.rows);
    }, [pane?.id]);

    const connection = useSshConnection({
        tabId: pane?.id,
        hostId: pane?.host?.id,
        getGeometry: () => ({
            cols: termRef.current?.cols || 80,
            rows: termRef.current?.rows || 24,
        }),
        write: (text) => termRef.current?.writeln(text),
        onResult: (result, meta) => connectResultRef.current?.(pane?.id, result, meta),
    });

    // The mount effect wires callbacks that outlive any single render, so it
    // reaches the connection through a ref rather than closing over it.
    const connectionRef = useRef(connection);
    connectionRef.current = connection;

    /** Copy the terminal selection. Returns false when there is nothing to copy. */
    const copySelection = useCallback(async () => {
        const selection = termRef.current?.getSelection();
        if (!selection) return false;
        await window.api.clipboard.writeText(selection);
        return true;
    }, []);

    const pasteFromClipboard = useCallback(async () => {
        const text = await window.api.clipboard.readText();
        // `paste` (not `sendInput`) so bracketed-paste mode is honoured, so pasting
        // multi-line text into vim or a shell prompt behaves as it should.
        if (text) termRef.current?.paste(text);
    }, []);

    /**
     * Put a snippet into the shell.
     *
     * Pasted rather than written, for the same reason as the clipboard above: a
     * multi-line snippet has to land in the line editor as one edit instead of
     * running a line at a time. The Enter that runs it is sent separately,
     * because a newline *inside* a bracketed paste is literal text and would
     * sit in the buffer rather than executing.
     */
    const insertSnippet = useCallback((text, runImmediately) => {
        const term = termRef.current;
        if (!term) return;

        // `paste` raises onData, so the snippet follows the same route as
        // typing, including out to every other session when broadcasting.
        term.paste(text);
        if (runImmediately) sendInput('\r');
        term.focus();
    }, [sendInput]);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        termRef.current?.focus();
    }, []);

    const closeSnippets = useCallback(() => {
        setSnippetsOpen(false);
        termRef.current?.focus();
    }, []);

    // Memoised because the custom theme is built fresh on every resolve, and a
    // new object identity here would re-assign term.options.theme each render,
    // which makes xterm rebuild its glyph atlas.
    const themeConfig = useMemo(
        () => resolveTerminalTheme(terminalTheme, customTerminalTheme),
        [terminalTheme, customTerminalTheme]
    );

    // Same reasoning as the theme: a fresh object every render would re-assign
    // xterm's options on every commit, and each assignment costs a reflow.
    const options = useMemo(() => terminalOptions(terminalSettings), [terminalSettings]);

    /**
     * Put the GPU renderer on a terminal, or take it off again.
     *
     * A pair rather than inline code in two places, because the ligature toggle
     * has to do exactly what mount and unmount do, and a renderer disposed
     * twice, or attached twice, leaves a terminal that draws nothing.
     */
    const attachRenderer = useCallback((term) => {
        if (!term || webglRef.current) return;
        try {
            const addon = new WebglAddon();
            // The context can be lost for reasons that have nothing to do with
            // us (a driver reset, the GPU process restarting). Dropping the
            // addon falls back to the DOM renderer rather than a blank pane.
            addon.onContextLoss(() => {
                try {
                    addon.dispose();
                } catch {
                    // Already gone.
                }
                if (webglRef.current === addon) webglRef.current = null;
            });
            term.loadAddon(addon);
            webglRef.current = addon;
        } catch (error) {
            console.warn('WebGL addon failed to load, using the DOM renderer:', error);
        }
    }, []);

    const detachRenderer = useCallback(() => {
        const addon = webglRef.current;
        webglRef.current = null;
        if (!addon) return;
        try {
            addon.dispose();
        } catch (error) {
            console.warn('WebGL addon dispose failed:', error);
        }
    }, []);

    // How much header we can afford. Measured rather than derived from the
    // split, because a pane's width depends on where the dividers happen to be.
    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            setWidth(entry.contentRect.width);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // Safe from feedback: this group's width follows `narrow` and the
    // connection status, never the number of action buttons beside it, so
    // measuring it cannot make it change size again.
    useEffect(() => {
        const element = fixedRef.current;
        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            setFixedWidth(entry.contentRect.width);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const compact = width < COMPACT_WIDTH;
    const narrow = width < NARROW_WIDTH;

    // How many action buttons the header can still afford. One slot is spent up
    // front on the burger itself, whether or not it ends up needed; paying for
    // it only once something overflows would mean the button that opens the menu
    // is what pushed the next action into it.
    const actionSlot = ACTION_BUTTON + (compact ? ACTION_GAP_COMPACT : ACTION_GAP);
    const actionSlots = Math.max(
        0,
        Math.floor((width - HEADER_CHROME - IDENTITY_MIN - fixedWidth - actionSlot) / actionSlot)
    );

    useEffect(() => {
        if (!terminalRef.current || !pane) return;

        let disposed = false;
        let term = null;
        let observer = null;
        let resizeTimer = null;
        let unsubscribeData = null;
        let unsubscribeDisconnect = null;

        const setup = async () => {
            // xterm derives its cell geometry from the *loaded* font. If the
            // webfont is still pending it measures the fallback instead, so the
            // glyph atlas and the size handed to the PTY both come out wrong:
            // measured here as 125 columns instead of 134.
            await ensureTerminalFont(options.fontSize, options.fontWeight, options.fontFamily);
            if (disposed || !terminalRef.current) return;

            term = new Terminal({
                ...options,
                theme: themeConfig,
                allowProposedApi: true,
                fastScrollModifier: 'alt',
                rescaleOverlappingGlyphs: false,
            });

            const fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            term.open(terminalRef.current);

            const searchAddon = new SearchAddon();
            term.loadAddon(searchAddon);

            // A URL in the scrollback was printed by the remote, so opening it
            // goes through main, which allowlists the scheme. Only a left click
            // opens, and only when nothing is selected: dragging across a URL to
            // copy it must not also launch a browser.
            //
            // Whether that click has to carry Ctrl (Cmd on macOS) is a setting.
            // A click with the modifier missing says so rather than doing
            // nothing, which would read as a link that is simply broken; one
            // toast id, so a second try replaces the hint instead of stacking
            // another copy under it.
            term.loadAddon(new WebLinksAddon((event, uri) => {
                if (event.button !== 0 || term.hasSelection()) return;

                if (linkActivationRef.current === 'modifier' && !event.ctrlKey && !event.metaKey) {
                    toast(
                        `Hold ${MODIFIER_KEY} and click to open this link`,
                        toastOptions({ id: 'terminal-link-modifier' })
                    );
                    return;
                }

                Promise.resolve(window.api.links?.open(uri))
                    .then((result) => {
                        if (result && !result.success) {
                            toast.error(result.message || 'Could not open that link', toastOptions());
                        }
                    })
                    .catch(() => {});
            }));

            termRef.current = term;
            fitAddonRef.current = fitAddon;
            searchAddonRef.current = searchAddon;

            let overlayHidden = false;
            const hideOverlayOnce = () => {
                if (overlayHidden) return;
                overlayHidden = true;
                setIsConnecting(false);
            };

            // Through `sendInput`, not straight to the session: it is what
            // decides whether this keystroke also reaches the other panes.
            term.onData(data => sendInput(data));

            // Ctrl+Shift+C/V. Plain Ctrl+C must stay SIGINT, which is exactly
            // why terminals put copy on the shifted chord. Returning false
            // stops xterm forwarding the key to the shell.
            term.attachCustomKeyEventHandler((event) => {
                if (event.type !== 'keydown') return true;
                if (!event.ctrlKey || !event.shiftKey || event.altKey) return true;

                if (event.code === 'KeyC') {
                    copySelection();
                    return false;
                }
                if (event.code === 'KeyV') {
                    pasteFromClipboard();
                    return false;
                }
                // Both open a panel that takes DOM focus, so the terminal stops
                // seeing keys until it is closed and Escape can go back to
                // meaning what the shell thinks it means.
                if (event.code === 'KeyF') {
                    setSearchOpen(true);
                    return false;
                }
                if (event.code === 'KeyK') {
                    setSnippetsOpen(true);
                    return false;
                }
                return true;
            });

            // The stream closing and the client closing both report the same
            // drop; the connection hook de-duplicates them and decides whether
            // to chase it.
            unsubscribeData = window.api.ssh.onData(pane.id, (message) => {
                if (message.type === 'data') {
                    term.write(message.data);
                    hideOverlayOnce();
                } else if (message.type === 'disconnected') {
                    connectionRef.current.handleDropped();
                }
            });

            unsubscribeDisconnect = window.api.ssh.onDisconnected((paneId) => {
                if (paneId === pane.id) connectionRef.current.handleDropped();
            });

            // Ligatures and the GPU renderer are mutually exclusive: WebGL
            // draws one glyph per cell out of an atlas, which is exactly what a
            // ligature is not. So the renderer is chosen by that setting, and
            // the effect below swaps it when the setting changes.
            //
            // Chosen before the first measurement, never after: the renderer is
            // what decides how tall a row is, and sizing the pane against the
            // DOM renderer's answer only to hand the session to WebGL is a way
            // to come up one row taller than the pane can show.
            if (!terminalSettings.ligatures) attachRenderer(term);

            await nextFrame();
            if (disposed) return;
            fitToPane(term, fitAddon, terminalRef.current);

            // Refit on any layout change. The sidebar, the fullscreen toggle and
            // every divider drag move it too, not just window resizes. Debounced
            // so dragging doesn't reflow the buffer and storm the remote with
            // SIGWINCH on every frame.
            observer = new ResizeObserver(() => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(pushResize, 80);
            });
            observer.observe(terminalRef.current);

            // Nothing to dial: this host has no SSH server, and attempting one
            // would spend the retry budget failing at a machine that was never
            // going to answer. True of a desktop-only host, and more plainly
            // true of an IPMI-only one, where the machine behind the service
            // processor may not even be powered on.
            if (pane?.host?.desktop?.enabled && pane.host.desktop.only) return;
            if (pane?.host?.bmc?.enabled && pane.host.bmc.only) return;

            if (connectedPanes.has(pane.id)) return;
            connectedPanes.add(pane.id);

            const result = await connectionRef.current.connect();
            if (disposed) return;
            if (!result?.success) hideOverlayOnce();
        };

        setup();

        return () => {
            disposed = true;
            clearTimeout(resizeTimer);
            observer?.disconnect();
            unsubscribeData?.();
            unsubscribeDisconnect?.();
            connectedPanes.delete(pane.id);
            searchAddonRef.current = null;
            window.api.ssh.release(pane.id);

            // Tear the GPU renderer down before the terminal, and never let a
            // failure escape: an exception thrown from a cleanup function
            // unmounts the entire React tree, blanking the window.
            detachRenderer();
            try {
                term?.dispose();
            } catch (error) {
                console.warn('Terminal dispose failed:', error);
            }
        };
    }, [pane?.id]);

    // Update theme when it changes
    useEffect(() => {
        if (termRef.current) {
            termRef.current.options.theme = themeConfig;
        }
    }, [themeConfig]);

    /**
     * Typography, live.
     *
     * Every one of these changes the size of a cell, so the terminal has to be
     * measured again and the remote told its new window size; otherwise the
     * shell keeps wrapping at the old column count and every line it redraws
     * lands in the wrong place. One effect for all of them, because that refit
     * only needs doing once however many settings moved.
     */
    useEffect(() => {
        const term = termRef.current;
        if (!term || !fitAddonRef.current) return;

        // Loaded first: assigning a family the browser has not fetched yet makes
        // xterm measure the fallback and cache the wrong cell width.
        let cancelled = false;
        ensureTerminalFont(options.fontSize, options.fontWeight, options.fontFamily).then(() => {
            if (cancelled || termRef.current !== term) return;

            for (const [key, value] of Object.entries(options)) {
                if (term.options[key] !== value) term.options[key] = value;
            }

            pushResize();
        });

        return () => { cancelled = true; };
    }, [options, pane?.id, pushResize]);

    /**
     * The renderer follows the ligature setting.
     *
     * Skipped on the first run for a pane, since the mount effect has already
     * chosen: doing it here as well would attach the addon to a terminal that
     * does not exist yet, or dispose the one it just made.
     */
    useEffect(() => {
        const term = termRef.current;
        if (!term) return;

        if (terminalSettings.ligatures) detachRenderer();
        else attachRenderer(term);

        // The atlas the old renderer built is the wrong shape for the new one,
        // and so, by a pixel or two, is its idea of how tall a row is, which is
        // why the remote is told about this and not just the screen.
        pushResize();
        term.refresh(0, term.rows - 1);
    }, [terminalSettings.ligatures, attachRenderer, detachRenderer, pushResize]);

    // Handle resize on visibility change or fullscreen toggle. The terminal is
    // not given focus while the session screen is asking something, since the
    // answer is typed into that: see `promptId` below.
    useEffect(() => {
        if (!isActive) return;
        const timer = setTimeout(() => {
            pushResize();
            if (isFocused && !promptId) termRef.current?.focus();
        }, 350); // Wait for sidebar animation
        return () => clearTimeout(timer);
    }, [isActive, isFullscreen, isFocused, promptId, pane?.id, pushResize]);

    // Following the focused pane has to be immediate: the 350ms settle above is
    // there for an animating layout, and waiting that long to start typing in
    // the pane you just clicked reads as a dropped keystroke. Answering a
    // question hands focus back here, because this is where typing resumes.
    useEffect(() => {
        if (isActive && isFocused && !promptId) termRef.current?.focus();
    }, [isActive, isFocused, promptId]);

    // The overlay only covers the first dial. A later drop is reported in the
    // header and in the terminal itself, so it must not blank the scrollback
    // the user may still want to read.
    useEffect(() => {
        if (connection.status !== 'connecting') setIsConnecting(false);
        if (connection.status === 'connected') setEverConnected(true);
    }, [connection.status]);

    /**
     * A question the handshake is waiting on has to be where it can be answered.
     *
     * A pane parked on files or a desktop comes back to its shell to ask: both
     * of those ride the session being negotiated, so there is nothing behind
     * them to look at until this is answered anyway.
     */
    useEffect(() => {
        if (promptId) setViewMode('ssh');
    }, [promptId]);

    // Only this component sees the session state. Report it up so the tab
    // strip can dim a dropped session.
    useEffect(() => {
        connectionChangeRef.current?.(pane?.id, connection.status === 'connected');
    }, [connection.status, pane?.id]);

    /**
     * Lend the session's controls to whoever is holding the pane, so the tab
     * strip's menu can end or restart it. They have to come from here: the
     * hook is what knows a close was asked for, and a session pulled out from
     * under it would read as a drop and be dialled straight back.
     */
    useEffect(() => {
        const paneId = pane?.id;
        if (!paneId || !onRegisterConnection) return;

        onRegisterConnection(paneId, {
            disconnect: () => connectionRef.current.disconnect(),
            reconnect: () => connectionRef.current.reconnectNow(),
        });

        return () => onRegisterConnection(paneId, null);
    }, [pane?.id, onRegisterConnection]);

    // Both panels belong to the shell. Leaving one floating over the file
    // browser would be pointing at a buffer that is no longer on screen.
    useEffect(() => {
        if (viewMode === 'ssh') return;
        setSearchOpen(false);
        setSnippetsOpen(false);
    }, [viewMode]);

    /**
     * Whether this session is being written to a file.
     *
     * Asked rather than pushed: main starts a transcript on its own when the
     * setting is on, so the answer is not something the renderer could have
     * derived; it has to come from the side that owns the file. Re-asked when
     * the session comes up, which is when a transcript would have begun.
     */
    const refreshLogging = useCallback(async () => {
        if (!pane?.id) return;
        try {
            setLogging(await window.api.sessionLog.status(pane.id));
        } catch {
            // Locked, or the session has gone. Neither is worth a toast.
        }
    }, [pane?.id]);

    useEffect(() => {
        refreshLogging();
    }, [refreshLogging, connection.status]);

    const toggleLogging = useCallback(async () => {
        const result = logging.recording
            ? await window.api.sessionLog.stop(pane.id)
            : await window.api.sessionLog.start(pane.id);

        if (!result?.success && !logging.recording) {
            toast.error(result?.message || 'Could not start recording', toastOptions());
        } else if (logging.recording) {
            toast.success('Recording stopped', toastOptions());
        } else {
            toast.success(`Recording to ${result.fileName}`, toastOptions());
        }

        refreshLogging();
    }, [logging.recording, pane?.id, refreshLogging]);

    // Right-click pastes, the way PuTTY and mintty do. A selection is left
    // alone. Use Ctrl+Shift+C for that.
    const handleContextMenu = useCallback((event) => {
        event.preventDefault();
        pasteFromClipboard();
    }, [pasteFromClipboard]);

    // Capture just the terminal's rectangle out of the window and hand it to a
    // viewer window. Measured in CSS pixels, which is what capturePage expects.
    const handleScreenshot = useCallback(async () => {
        const element = terminalRef.current;
        if (!element) return;

        const { x, y, width: rectWidth, height } = element.getBoundingClientRect();
        const result = await window.api.screenshot.capture({
            rect: { x, y, width: rectWidth, height },
            title: titleRef.current,
        });

        if (!result?.success) {
            toast.error(result?.message || 'Screenshot failed', toastOptions());
        }
    }, []);

    if (!pane) return null;

    // `label` is the full account, which the status dot carries as its tooltip.
    // `short` is what fits in a header beside everything else, and it leaves
    // out whatever the neighbouring Reconnect button already says.
    const STATUS_UI = {
        connecting: { dot: 'bg-yellow-500 animate-pulse', label: 'Connecting…' },
        connected: { dot: 'bg-green-500', label: 'Connected' },
        reconnecting: { dot: 'bg-yellow-500 animate-pulse', label: 'Reconnecting…' },
        waiting: {
            dot: 'bg-amber-500 animate-pulse',
            label: connection.retryIn
                ? `Reconnecting in ${connection.retryIn}s (attempt ${connection.attempt} of ${connection.maxAttempts})`
                : 'Reconnecting…',
            short: connection.retryIn ? `Retrying in ${connection.retryIn}s` : 'Reconnecting…',
        },
        failed: { dot: 'bg-red-500', label: 'Disconnected, could not reconnect', short: 'Could not reconnect' },
        closed: { dot: 'bg-gray-400 dark:bg-neutral-600', label: 'Disconnected' },
    };

    const statusUi = STATUS_UI[connection.status] || STATUS_UI.connecting;
    const isLive = connection.status === 'connected';

    // A desktop is offered only when the host has one configured. A tunnelled
    // one additionally needs the SSH session it rides on, which is why the two
    // are separate conditions rather than one.
    //
    // And all of it needs an SSH host. Files, forwards and desktops are
    // channels on an SSH connection; a telnet or serial session has a shell and
    // nothing else. The editor does not offer them for those protocols, but a
    // host switched to telnet after the fact still carries whatever it had, so
    // the pane reads the protocol rather than trusting the leftovers.
    const sshHost = (pane?.host?.protocol || 'ssh') === 'ssh';
    const desktop = pane?.host?.desktop;
    const hasDesktop = sshHost && Boolean(desktop?.enabled);
    // Only a tunnelled desktop has to wait: it rides the SSH session, so there
    // is nothing to carry it until that is up. A direct one dials for itself.
    const desktopReady = hasDesktop && (desktopOnly || desktop.transport === 'direct' || isLive);
    // Which viewer the pane gets. A record written before RDP existed has no
    // protocol and is VNC, which is what it was.
    const isRdp = desktop?.protocol === 'rdp';
    /**
     * The IPMI view, which is the one thing in this pane that needs neither an
     * SSH session nor even a running machine. So unlike `hasDesktop` it is not
     * gated on `sshHost`: a serial console into a switch and a BMC beside it is
     * an ordinary pairing, and the whole point of a service processor is that it
     * answers when nothing else does.
     */
    const bmc = pane?.host?.bmc;
    const hasBmc = Boolean(bmc?.enabled);
    /**
     * Which face the session screen is showing, or nothing when the terminal
     * owns the pane.
     *
     * The order is the order of urgency. A question the handshake is blocked on
     * comes before anything else, including over an established session's
     * scrollback, because nothing else in this pane can proceed until it is
     * answered. After that it is the first dial and how it went; once a session
     * has landed, a drop is the header's business and the buffer stays put.
     */
    const sessionScreen =
        hostKeyPrompt ? 'hostkey'
        : authPrompt ? 'auth'
        : isConnecting ? 'connecting'
        : everConnected ? null
        : ['connecting', 'reconnecting'].includes(connection.status) ? 'connecting'
        // 'waiting' is the same face as 'failed', with the clock on it: a dial
        // that never landed and is about to be tried again has not become a
        // different situation.
        : ['failed', 'waiting'].includes(connection.status) ? 'failed'
        : null;

    // The screen carries its own Try again, so the header does not put a second
    // one beside it. Everything else that can be dialled again still does.
    const canReconnect = ['waiting', 'failed', 'closed'].includes(connection.status)
        && sessionScreen !== 'failed';

    /**
     * Move to the view a "Connect via…" asked for, once it can be shown.
     *
     * Each one waits on the thing that carries it: files ride the SSH session,
     * and so does a tunnelled desktop, while a direct desktop dials for itself
     * and is ready at once. A request the host cannot satisfy simply never
     * comes due, which leaves the pane on its shell rather than on a view with
     * nothing behind it.
     *
     * The IPMI waits on nothing at all. It is a second address for the machine,
     * reached by this app rather than through it, so "once it can be shown" is
     * immediately, and making it queue behind a session would defeat the point
     * of asking for it.
     */
    useEffect(() => {
        const next = pendingView.current;
        if (!next) return;

        const ready = next === 'bmc' ? hasBmc
            : next === 'desktop' ? desktopReady
            : (sshHost && isLive);
        if (!ready) return;

        pendingView.current = null;
        if (next === 'sftp') setSftpOpened(true);
        if (next === 'desktop') setDesktopOpened(true);
        if (next === 'bmc') setBmcOpened(true);
        setViewMode(next);
    }, [desktopReady, sshHost, isLive, hasBmc]);

    // Splitting from the host you are already on is the common case, so it is
    // what the plain entries do; the "with…" pair opens the new pane on a
    // chooser instead.
    const splitItems = [
        {
            label: 'Split right',
            hint: 'Alt+Shift+=',
            icon: <LayoutTwoColumnIcon size={14} strokeWidth={2} />,
            disabled: !canSplit,
            onSelect: () => onSplit?.('row', 'duplicate'),
        },
        {
            label: 'Split down',
            hint: 'Alt+Shift+-',
            icon: <LayoutTwoRowIcon size={14} strokeWidth={2} />,
            disabled: !canSplit,
            onSelect: () => onSplit?.('column', 'duplicate'),
        },
        { separator: true },
        {
            label: 'Split right with…',
            icon: <LayoutTwoColumnIcon size={14} strokeWidth={2} />,
            disabled: !canSplit,
            onSelect: () => onSplit?.('row', 'pick'),
        },
        {
            label: 'Split down with…',
            icon: <LayoutTwoRowIcon size={14} strokeWidth={2} />,
            disabled: !canSplit,
            onSelect: () => onSplit?.('column', 'pick'),
        },
    ];

    if (isSplit) {
        splitItems.push(
            { separator: true },
            {
                // A split tab spends its layout slot on zooming, so fullscreen
                // lives here, and it is the layout that benefits from the extra
                // room the most.
                label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
                icon: isFullscreen
                    ? <Minimize01Icon size={14} strokeWidth={2} />
                    : <Maximize01Icon size={14} strokeWidth={2} />,
                onSelect: () => onToggleFullscreen?.(),
            }
        );
    }

    // Every action the header carries, in the order it shows them. `shed` is how
    // eager each one is to leave: as the pane narrows they move into the burger
    // menu one at a time, highest first, so the last thing standing beside the
    // view switcher is the one that ends the session.
    //
    // Each entry describes the action once. The button and the menu row are two
    // renderings of the same thing, which is what keeps a control from quietly
    // meaning something different once it has folded away.
    /**
     * Where the keyboard goes. Named by what it does to *this* pane rather than
     * by the scope's own name, since that is the question being asked of it.
     */
    const broadcastItems = [
        {
            label: 'Off (this pane only)',
            icon: broadcast === 'off' ? <CommandLineIcon size={14} strokeWidth={2} /> : null,
            onSelect: () => onBroadcastChange?.('off'),
        },
        {
            label: 'Every session in this tab',
            hint: 'Ctrl+Shift+B',
            icon: broadcast === 'tab' ? <Megaphone02Icon size={14} strokeWidth={2} /> : null,
            onSelect: () => onBroadcastChange?.('tab'),
        },
        {
            label: 'Every session in the window',
            icon: broadcast === 'window' ? <Megaphone02Icon size={14} strokeWidth={2} /> : null,
            onSelect: () => onBroadcastChange?.('window'),
        },
    ];

    const actions = [
        {
            key: 'broadcast',
            shed: 6,
            label: broadcast === 'off'
                ? 'Send typing to one session'
                : `Sending typing to ${broadcastCount} session${broadcastCount === 1 ? '' : 's'}`,
            icon: <Megaphone02Icon size={16} strokeWidth={2} />,
            // Held open as a state rather than a hover: the mode is dangerous
            // enough that the button should look engaged the whole time it is on.
            active: broadcast !== 'off',
            // ...which is also why it stays visible in the other views while it
            // is on. Typing into a desktop does not broadcast, but hiding the
            // one sign that it is armed would be worse than showing it.
            terminalOnly: broadcast === 'off',
            menu: broadcastItems,
        },
        {
            key: 'record',
            shed: 7,
            label: logging.recording
                ? `Recording to ${logging.fileName}`
                : 'Record this session to a file',
            menuLabel: logging.recording ? 'Stop recording' : 'Start recording',
            icon: logging.recording
                ? <StopCircleIcon size={16} strokeWidth={2} />
                : <RecordIcon size={16} strokeWidth={2} />,
            menuIcon: logging.recording
                ? <StopCircleIcon size={14} strokeWidth={2} />
                : <RecordIcon size={14} strokeWidth={2} />,
            active: logging.recording,
            disabled: !isLive && !logging.recording,
            // Same exception: a recording in progress keeps its stop button
            // wherever you are, because it goes on writing either way.
            terminalOnly: !logging.recording,
            onSelect: () => toggleLogging(),
        },
        {
            key: 'snippets',
            shed: 5,
            label: isLive ? 'Snippets' : 'Connect to run a snippet',
            menuLabel: 'Snippets',
            hint: isLive ? 'Ctrl+Shift+K' : undefined,
            icon: <FlashIcon size={16} strokeWidth={2} />,
            menuIcon: <FlashIcon size={14} strokeWidth={2} />,
            disabled: !isLive,
            terminalOnly: true,
            onSelect: () => setSnippetsOpen(true),
            // The palette dismisses on any click outside itself, and skips the
            // button so it can toggle rather than close-then-reopen. From the
            // menu there is nothing to toggle: opening the menu was already the
            // click outside that closed it.
            onPress: () => setSnippetsOpen(open => !open),
            buttonProps: { 'data-snippet-trigger': true },
        },
        {
            key: 'find',
            shed: 4,
            label: 'Find in terminal',
            hint: 'Ctrl+Shift+F',
            icon: <Search01Icon size={16} strokeWidth={2} />,
            menuIcon: <Search01Icon size={14} strokeWidth={2} />,
            terminalOnly: true,
            onSelect: () => setSearchOpen(true),
        },
        {
            // Least essential of the eight, so it is the first to fold away.
            key: 'screenshot',
            shed: 8,
            label: 'Screenshot terminal',
            icon: <Camera01Icon size={16} strokeWidth={2} />,
            menuIcon: <Camera01Icon size={14} strokeWidth={2} />,
            terminalOnly: true,
            onSelect: () => handleScreenshot(),
        },
        {
            // Already a dropdown. Folded away, its entries are spliced into the
            // burger rather than nested inside it: a submenu at this width would
            // be a menu opening off the edge of a pane a few hundred pixels wide.
            key: 'split',
            shed: 3,
            label: 'Split pane',
            icon: <LayoutTwoColumnIcon size={16} strokeWidth={2} />,
            menu: splitItems,
        },
        {
            // Zoom and fullscreen are the same wish for more room for this
            // pane, answered by whichever one the layout allows.
            key: 'layout',
            shed: 2,
            ...(isSplit
                ? {
                    label: isZoomed ? 'Restore pane' : 'Zoom pane',
                    hint: 'Alt+Shift+Z',
                    icon: isZoomed
                        ? <ArrowShrink01Icon size={16} strokeWidth={2} />
                        : <ArrowExpand01Icon size={16} strokeWidth={2} />,
                    menuIcon: isZoomed
                        ? <ArrowShrink01Icon size={14} strokeWidth={2} />
                        : <ArrowExpand01Icon size={14} strokeWidth={2} />,
                    onSelect: () => onToggleZoom?.(),
                }
                : {
                    label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
                    icon: isFullscreen
                        ? <Minimize01Icon size={16} strokeWidth={2} />
                        : <Maximize01Icon size={16} strokeWidth={2} />,
                    menuIcon: isFullscreen
                        ? <Minimize01Icon size={14} strokeWidth={2} />
                        : <Maximize01Icon size={14} strokeWidth={2} />,
                    onSelect: () => onToggleFullscreen?.(),
                }),
        },
        {
            // Split, this closes the pane, which ends its session too. Alone,
            // there is no pane to close and it means disconnect, leaving the
            // scrollback where it is.
            key: 'close',
            shed: 1,
            label: isSplit ? 'Close pane' : 'Disconnect',
            hint: isSplit ? 'Ctrl+Shift+W' : undefined,
            icon: <Cancel01Icon size={16} strokeWidth={2} />,
            menuIcon: <Cancel01Icon size={14} strokeWidth={2} />,
            danger: true,
            disabled: !isSplit && connection.status === 'closed',
            onSelect: () => (isSplit ? onClosePane?.() : connection.disconnect()),
        },
    ]
        /*
         * Searching, screenshotting, recording and running snippets are all
         * things done to a terminal, and there is no terminal in front of you
         * in the desktop, files or forwards views. They used to grey out there,
         * which reads as "this could work and doesn't" rather than "this is not
         * part of what you are looking at", and on a desktop-only host, which
         * has no terminal at all, it was most of the row permanently dead.
         *
         * Splitting, zooming and closing survive: they act on the pane, and the
         * pane is there whatever it is showing.
         */
        .filter(action => !(action.terminalOnly && viewMode !== 'ssh'));

    const shedCount = Math.max(0, actions.length - actionSlots);
    const folded = new Set(
        [...actions]
            .sort((a, b) => b.shed - a.shed)
            .slice(0, shedCount)
            .map(action => action.key)
    );

    const shownActions = actions.filter(action => !folded.has(action.key));

    // Listed in header order, not in the order they folded, so the menu reads
    // like the row it stands in for.
    const overflowItems = [];
    let previousWasGroup = false;

    for (const action of actions.filter(item => folded.has(item.key))) {
        const isGroup = Boolean(action.menu);

        // A whole dropdown's worth of entries needs a rule around it to stay
        // legible as one thing; single actions read fine as a plain list.
        if (overflowItems.length > 0 && (isGroup || previousWasGroup)) {
            overflowItems.push({ separator: true });
        }

        if (isGroup) {
            overflowItems.push(...action.menu);
        } else {
            overflowItems.push({
                label: action.menuLabel || action.label,
                hint: action.hint,
                icon: action.menuIcon,
                danger: action.danger,
                disabled: action.disabled,
                onSelect: action.onSelect,
            });
        }

        previousWasGroup = isGroup;
    }

    return (
        <div
            ref={rootRef}
            // Capture, because xterm handles the mousedown on the terminal
            // itself and a bubbling listener would never hear about the click
            // that is meant to move focus into this pane.
            onMouseDownCapture={onFocus}
            className={`terminal-view absolute inset-0 flex flex-col ${
                terminalSettings.ligatures ? 'terminal-ligatures' : ''
            }`}
            // Only while the shell is what is on screen: the ring means "typing
            // here goes elsewhere too", which is not true of the file browser.
            data-broadcast={isBroadcastTarget && viewMode === 'ssh' ? 'true' : undefined}
            style={{ backgroundColor: themeConfig.background }}
        >
            {/* Header: identity on the left, every control grouped on the right */}
            <div className={`h-11 bg-white dark:bg-surface-raised border-b border-gray-200 dark:border-surface-control flex justify-between items-center gap-3 px-3 shrink-0 overflow-hidden transition-opacity duration-200 ${
                isSplit && !isFocused ? 'opacity-60' : 'opacity-100'
            }`}>
                <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
                    {/* The SSH session's state, which a desktop-only or
                        IPMI-only pane does not have: it would sit on
                        "connecting" forever, and both of those report their own
                        status in the bar just below. */}
                    {!sessionless && (
                        <Tooltip label={statusUi.label}>
                            <span
                                role="img"
                                className={`w-1.5 h-1.5 rounded-full shrink-0 status-dot ${statusUi.dot}`}
                            />
                        </Tooltip>
                    )}
                    <OsIcon os={hostOs(pane.host)} distro={pane.host?.distro} className="w-4 h-4 shrink-0" />

                    {/* Shrinking is shared out in proportion to these factors,
                        so the status gives up its room many times faster than the
                        name does. The name is what says which session this pane
                        is, so it is the last to go and it still truncates
                        properly when its turn comes. */}
                    <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                        {pane.title}
                    </span>

                    {/* Which of several sessions on this host this pane is,
                        matching the number on its tab and in the assistant's
                        scope menu. Without it here, a split of three panes on
                        one host is three identical headers, and "pin to
                        web-01 #2" names a terminal you cannot find on screen. */}
                    {ordinal > 0 && (
                        <span
                            className="shrink-0 text-[10px] font-semibold tabular-nums
                                text-gray-400 dark:text-gray-500"
                            title={`Session ${ordinal} on this host`}
                        >
                            #{ordinal}
                        </span>
                    )}

                    {/* Where `user@host` used to be written out.

                        It was the same string on every pane of every session, and
                        it was only ever half the answer: it said where the
                        session ends up and nothing about what it goes through to
                        get there, which on a relayed or proxied connection is the
                        part worth knowing. The whole path is on the mark instead,
                        including the address, and the header gets the width back.

                        A desktop-only pane has no session to describe, so it
                        reads the path off the desktop instead. Same mark, same
                        place; only the source differs.

                        An IPMI-only pane gets no mark at all: its address is
                        already on the bar below, as a URL, and a second copy of
                        it here would be the only thing the mark had to say. */}
                    {bmcOnly ? null : desktopOnly
                        ? <DesktopPaneRoute paneId={pane.id} isRdp={isRdp} />
                        : <PaneRoute route={connection.route} />}

                    {/* Anything other than a healthy session gets said out loud:
                        the status dot alone is too easy to miss. Narrow enough
                        and there is no room to say it; the dot keeps its
                        tooltip, and a dead session grows a Reconnect button.

                        Not while the session screen is up, though. It is saying
                        the same thing in the middle of the pane, at a size that
                        can be read, and the header repeating it in amber two
                        inches above is one notice too many. */}
                    {!isLive && connection.status !== 'connecting' && !compact && !sessionScreen && (
                        <span
                            className={`text-xs truncate ${
                                connection.status === 'failed'
                                    ? 'text-red-500'
                                    : 'text-amber-600 dark:text-amber-500'
                            }`}
                            style={{ flexShrink: 20 }}
                        >
                            {statusUi.short || statusUi.label}
                        </span>
                    )}
                </div>

                <div className={`flex items-center shrink-0 ${compact ? 'gap-1.5' : 'gap-2'}`}>
                    {/* Measured, and never folded: switching view and getting a
                        dead session back are what the header is for. */}
                    <div
                        ref={fixedRef}
                        className={`flex items-center shrink-0 ${compact ? 'gap-1.5' : 'gap-2'}`}
                    >
                        {/* Where the desktop and the IPMI hang their own
                            controls. Empty, and so invisible, for every view
                            that has none. */}
                        <div
                            ref={setPaneToolbar}
                            // Same gap as the actions to its right: these sit in
                            // one row and should read as one row.
                            className={`flex items-center empty:hidden ${compact ? 'gap-1.5' : 'gap-2'}`}
                        />

                        {/* The divider between a view's own controls and the
                            switcher. Only where both are on screen: a pane whose
                            switcher is hidden has nothing to divide from. */}
                        {((isRdp && viewMode === 'desktop' && !desktopOnly)
                            || (viewMode === 'bmc' && !bmcOnly)) && (
                            <div className="h-5 w-px bg-gray-200 dark:bg-surface-control" />
                        )}

                        {/* A switcher offering one view is not a choice. A
                            desktop-only host has exactly that, and so does a
                            telnet or serial one: a shell, with no files,
                            forwards or desktop to switch to. The header already
                            says which host it is. */}
                        {!desktopOnly && !bmcOnly && (sshHost || hasDesktop || hasBmc) && (
                        <SegmentedControl
                            ariaLabel="Terminal view"
                            size={narrow ? 'sm' : 'md'}
                            value={viewMode}
                            onChange={(next) => {
                                // Whatever a "Connect via…" was still waiting to
                                // switch to, this outranks it.
                                pendingView.current = null;
                                setViewMode(next);
                                if (next === 'sftp') setSftpOpened(true);
                                if (next === 'desktop') setDesktopOpened(true);
                                if (next === 'bmc') setBmcOpened(true);
                            }}
                            segments={[
                                // The shell, files and forwards are all views on
                                // an SSH session. A desktop-only host has none,
                                // so they are dropped rather than shown greyed
                                // out forever: the pane is a desktop, and the
                                // switcher should say so.
                                ...(desktopOnly ? [] : [
                                // Every segment names itself, at every width.
                                // The label under the icon is a word; the
                                // tooltip is what the view is for, and a
                                // disabled one has to say why it is off.
                                {
                                    value: 'ssh',
                                    // Named for what the pane actually is. A
                                    // segment reading "SSH" on a serial console
                                    // is worse than no label at all.
                                    label: compact ? null : protocolLabel(pane?.host?.protocol),
                                    title: 'Shell session',
                                    icon: <CommandLineIcon size={13} strokeWidth={2.25} />,
                                },
                                ]),
                                // Files and forwards are SSH channels. Dropped
                                // rather than disabled for the other protocols:
                                // a tab that can never be reached is a tab that
                                // costs the others width for nothing.
                                ...(desktopOnly || !sshHost ? [] : [
                                {
                                    value: 'sftp',
                                    label: compact ? null : 'SFTP',
                                    icon: <Folder01Icon size={13} strokeWidth={2.25} />,
                                    disabled: !isLive,
                                    title: isLive ? 'Browse and transfer files' : 'Connect to browse files',
                                    // Transfers keep running while the terminal
                                    // is in front; this is the only sign they
                                    // are there.
                                    badge: summary.active,
                                },
                                {
                                    value: 'tunnels',
                                    label: compact ? null : 'Tunnels',
                                    icon: <ArrowDataTransferHorizontalIcon size={13} strokeWidth={2.25} />,
                                    title: 'Port forwarding',
                                    // Forwards outlive a glance at the terminal,
                                    // so the count is shown here, and a failure
                                    // is worth noticing without opening the panel.
                                    badge: tunnelSummary.failed || tunnelSummary.active,
                                    badgeTone: tunnelSummary.failed > 0 ? 'danger' : 'info',
                                },
                                ]),
                                // Only present when the host has a desktop. A
                                // segment that is always there and almost always
                                // disabled would cost every other view width for
                                // nothing.
                                ...(hasDesktop ? [{
                                    value: 'desktop',
                                    label: compact ? null : 'Desktop',
                                    icon: <ComputerIcon size={13} strokeWidth={2.25} />,
                                    disabled: !desktopReady,
                                    title: desktopReady
                                        ? (isRdp ? 'Windows remote desktop' : 'Remote desktop')
                                        : 'Connect over SSH to reach the desktop',
                                }] : []),
                                // Never disabled, unlike the desktop. A service
                                // processor is reachable when the machine in
                                // front of it is not, which is the entire reason
                                // to have one, so gating this on a live session
                                // would hide it exactly when it is wanted.
                                ...(hasBmc ? [{
                                    value: 'bmc',
                                    label: compact ? null : 'IPMI',
                                    icon: <CpuIcon size={13} strokeWidth={2.25} />,
                                    title: 'The service processor’s web interface',
                                }] : []),
                            ]}
                        />
                        )}

                        {/* The SSH session's own divider and Reconnect. Neither
                            belongs to a pane that has no session. */}
                        {!sessionless && (
                            <div className="h-5 w-px bg-gray-200 dark:bg-surface-control" />
                        )}

                        {canReconnect && (
                            // Wide enough and the button says it itself; the
                            // label is only there for the icon-only state.
                            <Tooltip
                                label={connection.status === 'waiting' ? 'Retry now' : 'Reconnect'}
                                enabled={narrow}
                            >
                                <button
                                    className="h-8 px-3 flex items-center gap-1.5 rounded-xl text-xs font-semibold bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90 active:scale-95 transition-all"
                                    onClick={connection.reconnectNow}
                                >
                                    <Refresh01Icon size={13} strokeWidth={2.5} />
                                    {!narrow && (connection.status === 'waiting' ? 'Retry now' : 'Reconnect')}
                                </button>
                            </Tooltip>
                        )}
                    </div>

                    {/* Whatever still fits. Chords are worth a button of their
                        own wherever there is room for one, because a chord
                        nobody has been told about is not a feature. */}
                    {shownActions.map(action => (
                        action.menu ? (
                            <MenuButton
                                key={action.key}
                                title={action.label}
                                icon={action.icon}
                                active={action.active}
                                items={action.menu}
                            />
                        ) : (
                            <Tooltip key={action.key} label={action.label} hint={action.hint}>
                                <button
                                    className={`w-8 h-8 flex items-center justify-center rounded-xl transition-colors
                                        disabled:opacity-40 disabled:cursor-not-allowed ${
                                        // A mode that is on says so on the button itself. Amber
                                        // rather than the accent: this is a state to notice, not
                                        // a selection to admire.
                                        action.active
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                                            : action.danger
                                                ? 'text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400'
                                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-surface-control dark:hover:text-white'
                                    }`}
                                    onClick={action.onPress || action.onSelect}
                                    disabled={action.disabled}
                                    {...action.buttonProps}
                                >
                                    {action.icon}
                                </button>
                            </Tooltip>
                        )
                    ))}

                    {/* Everything that did not fit, in the order it would have
                        appeared. Costs one button and buys back as many as the
                        pane cannot afford. */}
                    {overflowItems.length > 0 && (
                        <MenuButton
                            title="More actions"
                            icon={<Menu01Icon size={16} strokeWidth={2} />}
                            active={isZoomed && folded.has('layout')}
                            items={overflowItems}
                        />
                    )}
                </div>
            </div>

            {/* The pane's own screen, for every moment it has no session: the
                dial, the two questions a handshake can stop on, and a first
                dial that did not land. `top-11` is what keeps it below this
                pane's header rather than over it. */}
            {sessionScreen && viewMode === 'ssh' && (
                <SessionScreen
                    state={sessionScreen}
                    title={pane.title}
                    // The user is left off when there is not one to name. A
                    // typed address may have arrived without it, and this
                    // screen is where it gets asked for: `@10.0.0.5:22` under
                    // a box asking who to log in as reads as a bug.
                    address={`${pane.host?.username ? `${pane.host.username}@` : ''}`
                        + `${pane.host?.host || ''}:${pane.host?.port || 22}`}
                    os={hostOs(pane.host)}
                    distro={pane.host?.distro}
                    background={themeConfig.background}
                    accent={themeConfig.red}
                    hostKeyPrompt={hostKeyPrompt}
                    onHostKeyRespond={onHostKeyRespond}
                    authPrompt={authPrompt}
                    onAuthRespond={onAuthRespond}
                    message={connection.message}
                    retryIn={connection.retryIn}
                    attempt={connection.attempt}
                    maxAttempts={connection.maxAttempts}
                    onReconnect={connection.reconnectNow}
                    className="top-11 z-20"
                    style={{ backgroundColor: themeConfig.background, color: themeConfig.foreground }}
                />
            )}

            {/* Terminal Container - show when in SSH mode */}
            <div
                ref={terminalRef}
                className="flex-1 overflow-hidden p-3"
                onContextMenu={handleContextMenu}
                style={{
                    backgroundColor: themeConfig.background,
                    display: viewMode === 'ssh' ? 'block' : 'none',
                }}
            />

            {/* SFTP View: mounted once opened, then hidden rather than torn
                down so transfers and the browsing position survive a switch
                back to the shell. */}
            {sftpOpened && (
                <div
                    className="flex-1 overflow-hidden"
                    style={{ display: viewMode === 'sftp' ? 'block' : 'none' }}
                >
                    <SftpView tabId={pane.id} isActive={isActive && isFocused && viewMode === 'sftp'} />
                </div>
            )}

            {/* Desktop: mounted once opened and then hidden, like SFTP. The RFB
                session and its framebuffer are far too expensive to rebuild for
                a look at the shell. */}
            {desktopOpened && (
                <div
                    className="flex-1 overflow-hidden relative"
                    style={{ display: viewMode === 'desktop' ? 'block' : 'none' }}
                >
                    {isRdp ? (
                        <RdpView
                            paneId={pane.id}
                            host={pane.host}
                            isActive={isActive && viewMode === 'desktop'}
                            isFocused={isFocused}
                            isLive={isLive}
                            // Where its controls go. The pane header already
                            // names the host and says whether it is up, so a
                            // second bar underneath repeating that was two rows
                            // of chrome to show one desktop.
                            toolbarHost={viewMode === 'desktop' ? paneToolbar : null}
                        />
                    ) : (
                        <VncView
                            paneId={pane.id}
                            host={pane.host}
                            isActive={isActive && viewMode === 'desktop'}
                            isFocused={isFocused}
                            isLive={isLive}
                        />
                    )}
                </div>
            )}

            {/* IPMI: mounted once opened and then hidden, like the desktop.
                Tearing it down would drop a logged-in session on the board's own
                UI and put the next visit back at its login page. */}
            {bmcOpened && (
                <div
                    className="flex-1 overflow-hidden relative"
                    style={{ display: viewMode === 'bmc' ? 'block' : 'none' }}
                >
                    <BmcView
                        paneId={pane.id}
                        host={pane.host}
                        isActive={isActive && viewMode === 'bmc'}
                        // Same reasoning as the desktop's: the pane header
                        // already names the host and says whether it is up, so a
                        // second bar underneath repeating that was two rows of
                        // chrome to show one web page.
                        toolbarHost={viewMode === 'bmc' ? paneToolbar : null}
                    />
                </div>
            )}

            {/* Tunnels: unlike SFTP this is cheap to mount and carries no
                per-view state, so it follows the toggle directly. */}
            {viewMode === 'tunnels' && (
                <div className="flex-1 overflow-hidden relative">
                    <TunnelsView
                        tabId={pane.id}
                        host={pane.host}
                        isLive={isLive}
                        onUpdateHost={onUpdateHost}
                    />
                </div>
            )}

            {/* Floats over the buffer it searches, so the matches stay visible
                behind it. The addon is created with the terminal, so the guard
                only matters for a click that lands mid-setup. */}
            {searchOpen && viewMode === 'ssh' && searchAddonRef.current && (
                <SearchBar
                    addon={searchAddonRef.current}
                    background={themeConfig.background}
                    onClose={closeSearch}
                />
            )}

            {snippetsOpen && viewMode === 'ssh' && (
                <SnippetPalette
                    hostId={pane.host?.id}
                    hostName={pane.host?.name || pane.title}
                    onInsert={insertSnippet}
                    onClose={closeSnippets}
                />
            )}
        </div>
    );
}

export default memo(TerminalView);
