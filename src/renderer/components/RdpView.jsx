import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
    ComputerIcon,
    Refresh01Icon,
    ArrowExpand01Icon,
    ArrowShrink01Icon,
    ArrowMoveDownRightIcon,
    ClipboardIcon,
    KeyboardIcon,
    AlertCircleIcon,
} from 'hugeicons-react';
import { useRdp } from '../hooks/useRdp';
import { loadIronRdp, describeIronError } from '../lib/rdp-wasm';
import { attachInput, sendCtrlAltDel } from '../lib/rdp-input';
import { formatSize } from '../lib/format';
import { hostOs } from '../lib/os-icons';
import { toastOptions } from '../lib/toast';
import Tooltip from './ui/Tooltip';
import ConnectingSplash from './ui/ConnectingSplash';

/**
 * One Windows desktop, filling one pane.
 *
 * The mirror of VncView, but the division of labour is different. There, the
 * main process had already authenticated by the time the component connected,
 * and noVNC drew a session that needed no credential. Here the protocol runs on
 * this side: IronRDP, compiled to WebAssembly, speaks RDP over the loopback
 * WebSocket that main opened, and performs CredSSP itself.
 *
 * Which means this component is handed a password, and it is the only one in
 * the app that is. It is held in a local for the length of a single builder
 * call and dropped: never in state, never on a ref, never in a closure that
 * outlives `connect`. A re-render cannot leak what it does not keep, and a
 * reconnect asks main for it again.
 */

/**
 * The three modes, which the old wording did nothing to distinguish: "scale the
 * desktop to the pane" and "resize the desktop to match the pane" are the same
 * sentence, and now that scaling fills the pane properly they look alike too.
 *
 * The difference is what changes. `fit` changes the picture — the desktop stays
 * whatever resolution it connected at and is drawn larger or smaller, so text
 * blurs as it stretches. `resize` changes the desktop, over RDP's Display
 * Control channel: Windows genuinely switches resolution, moves the taskbar and
 * reflows, and the result is sharp because nothing is being scaled at all.
 */
const SCALING = {
    fit: { label: 'Stretch', hint: 'Stretch the picture to the pane. The desktop keeps its resolution, so it may look soft.' },
    actual: { label: 'Actual size', hint: 'One remote pixel per screen pixel. Scroll to see the rest.' },
    resize: { label: 'Match', hint: 'Change the desktop\'s resolution to match the pane. Sharp, and Windows reflows to suit.' },
};

const STATUS = {
    opening: { label: 'Preparing…', dot: 'bg-amber-500' },
    loading: { label: 'Loading…', dot: 'bg-amber-500' },
    connecting: { label: 'Connecting…', dot: 'bg-amber-500' },
    connected: { label: 'Connected', dot: 'bg-green-500' },
    closed: { label: 'Disconnected', dot: 'bg-gray-400' },
    error: { label: 'Failed', dot: 'bg-red-500' },
};

/**
 * RDP chooses a resolution when the session opens, so unlike RFB there is a
 * number to pick rather than one to discover. The pane is the obvious answer;
 * these are the bounds on it.
 *
 * It is not fixed for the rest of the session, though. RDP 8.1 added the
 * Display Control channel, which is how mstsc reflows a maximised window, and
 * IronRDP exposes it as `session.resize`. So the pane can go on being the
 * answer: see `follow` below.
 */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
const MAX_WIDTH = 4096;
const MAX_HEIGHT = 2160;

/**
 * How long the pane must hold still before the server is told about it.
 *
 * Every resize renegotiates the desktop and costs a full-screen redraw, so a
 * divider drag would otherwise send one per frame. Longer than the terminal's
 * 80ms for that reason: a shell reflow is cheap and a desktop reflow is not.
 */
const RESIZE_SETTLE = 400;

/**
 * How often the framebuffer's real size is re-read while a session is up.
 *
 * There is no event to hang this on. IronRDP resizes the canvas itself when the
 * server reactivates after a Display Control request, and tells nobody:
 * `canvasResizedCallback` is a stub upstream that is never invoked, on the
 * reasoning that RDP has no server-initiated resize. So the canvas backing store
 * is the only honest answer to "how big is the desktop now", and two property
 * reads a second is not worth a cleverer arrangement than a timer.
 */
const SIZE_POLL = 1000;

/**
 * The size the server agreed, or null.
 *
 * Deliberately not `canvas.width`, which is where this used to be read. IronRDP
 * creates the canvas inside `run()` and not inside `connect()`, so at the moment
 * a session is handed back the element is still the HTML default of 300×150.
 * That is exactly what the toolbar showed for the whole session, and what the
 * actual-size layout sized itself against.
 *
 * The session knows without waiting, and knows better: a server is free to
 * answer a request for 1500×900 with something else, and this is what it
 * answered.
 */
function agreedSize(session) {
    try {
        const size = session?.desktopSize?.();
        if (!size) return null;

        const width = size.width;
        const height = size.height;
        // Read before freeing: the fields are backed by wasm memory.
        size.free?.();

        return width && height ? { width, height } : null;
    } catch {
        // A build that does not expose it leaves the poll below to find out.
        return null;
    }
}

/**
 * The desktop is asked for in device pixels, not CSS pixels.
 *
 * A pane 1200 CSS pixels wide on a 125% display is 1500 real ones. Asking for a
 * 1200-wide desktop and drawing it across those 1500 means the browser is
 * scaling every frame up by a quarter, which is exactly the soft, faintly
 * smeared text that makes a remote session feel worse than the machine in front
 * of you. Asked for at 1500, one remote pixel lands on one screen pixel.
 *
 * On its own that would leave everything a quarter smaller than it should be,
 * because the desktop now has more pixels in the same physical space. The scale
 * factor is the other half: it tells Windows the client is a 125% display, so
 * it applies its own DPI scaling and the result is the right size *and* sharp.
 *
 * MS-RDPBCGR carries this as a percentage and requires 100–500, so a display
 * outside that range simply does not get told.
 */
const scaleFactorFor = (ratio) => {
    const percent = Math.round((ratio || 1) * 100);
    return percent >= 100 && percent <= 500 ? percent : 100;
};

/**
 * The plain text out of an IronRDP clipboard payload, or ''.
 *
 * A transaction carries the same content in several formats at once — Windows
 * will offer HTML and RTF alongside the text for anything copied out of an
 * editor — so this picks the one format worth having and ignores the rest.
 * `text/plain` arrives with a charset attached often enough that the match has
 * to be a prefix.
 */
function plainTextOf(data) {
    try {
        for (const item of data?.items?.() || []) {
            if (String(item.mimeType() || '').startsWith('text/plain')) {
                const value = item.value();
                if (typeof value === 'string' && value) return value;
            }
        }
    } catch {
        // A payload in a shape this build does not describe is not worth
        // taking the session down for.
    }
    return '';
}

/** Widths that are not a multiple of four upset some servers' encoders. */
const clampWidth = (value) =>
    Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(value / 4) * 4));
const clampHeight = (value) =>
    Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(value / 2) * 2));

/**
 * The desktop's toolbar button.
 *
 * Wrapped in the app's Tooltip rather than carrying a native `title`. The
 * difference matters most here: a native tooltip waits about a second, draws
 * itself in the OS font, and — the reason this was wrong — never appears at all
 * on a disabled control. Half this row is disabled until the session is up, and
 * a disabled button is exactly the one whose label is worth reading, because it
 * also has to say why it is off.
 */
function IconButton({ icon, title, onClick, disabled, active }) {
    return (
        <Tooltip label={title}>
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                    active
                        ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white'
                        : 'text-gray-500 dark:text-gray-400 enabled:hover:bg-gray-100 dark:enabled:hover:bg-surface-control enabled:hover:text-gray-900 dark:enabled:hover:text-white'
                }`}
            >
                {icon}
            </button>
        </Tooltip>
    );
}

function RdpView({ paneId, host, isActive, isFocused, isLive, toolbarHost = null }) {
    const frameRef = useRef(null);
    const canvasRef = useRef(null);
    const sessionRef = useRef(null);
    const ironrdpRef = useRef(null);
    const detachInputRef = useRef(null);
    // Guards the async gap between asking main to prepare a session and having
    // one: the pane can be closed several times over in between.
    const generationRef = useRef(0);
    // A server that will not resize will refuse every resize, and one toast per
    // divider drag would be worse than the silence it replaces.
    const warnedRef = useRef(false);
    // Reached from inside a builder callback, which outlives no session but is
    // built before the handler exists.
    const sendClipboardRef = useRef(null);
    // What the far side was last told this machine's clipboard holds.
    const lastSentRef = useRef(null);

    const { session, open, close, get } = useRdp(paneId);

    const [status, setStatus] = useState('closed');
    const [error, setError] = useState('');
    const [scaling, setScaling] = useState('fit');
    const [size, setSize] = useState(null);

    const teardown = useCallback(() => {
        detachInputRef.current?.();
        detachInputRef.current = null;

        const current = sessionRef.current;
        sessionRef.current = null;
        if (!current) return;

        try {
            current.shutdown();
        } catch {
            // Already gone.
        }
    }, []);

    const connect = useCallback(async () => {
        const generation = ++generationRef.current;
        const current = () => generation === generationRef.current;

        teardown();
        setError('');
        setSize(null);
        // A different session may well answer differently, and knows nothing
        // about what the last one was told this machine had copied.
        warnedRef.current = false;
        lastSentRef.current = null;

        // Load WASM before asking main for the password, so the secret does not
        // sit on the IPC result through a multi-megabyte compile.
        setStatus('loading');
        let ironrdp;
        try {
            ironrdp = await loadIronRdp();
        } catch (loadError) {
            if (!current()) return;
            setStatus('error');
            setError(`The RDP module failed to load: ${loadError.message}`);
            return;
        }

        if (!current()) return;
        ironrdpRef.current = ironrdp;

        setStatus('opening');
        const result = await open(host?.id);
        if (!current()) {
            if (result) result.password = '';
            return;
        }

        if (!result?.success) {
            setStatus('error');
            setError(result?.message || 'Could not open the desktop');
            return;
        }

        // From here the password is in hand. Everything between this line and
        // the builder call is deliberately short; the wipe in `finally` covers
        // every exit, including cancel, missing canvas, and connect errors.
        let live;
        try {
            const canvas = canvasRef.current;
            const frame = frameRef.current;
            if (!canvas || !frame) return;

            setScaling(SCALING[result.scaling] ? result.scaling : 'fit');
            setStatus('connecting');

            const ratio = window.devicePixelRatio || 1;
            const scaleFactor = scaleFactorFor(ratio);
            const width = clampWidth((frame.clientWidth || MIN_WIDTH) * ratio);
            const height = clampHeight((frame.clientHeight || MIN_HEIGHT) * ratio);

            const builder = new ironrdp.SessionBuilder();
            builder.username(result.username || '');
            builder.password(result.password || '');
            if (result.domain) builder.serverDomain(result.domain);
            builder.destination(result.destination);
            builder.proxyAddress(result.url);
            // Not optional: the builder refuses to connect without one, and the
            // bridge checks it against the token it just issued.
            builder.authToken(result.authToken);
            builder.desktopSize(new ironrdp.DesktopSize(width, height));
            builder.renderCanvas(canvas);
            // Network Level Authentication. Required by default on every
            // supported version of Windows Server.
            builder.extension(new ironrdp.Extension('enable_credssp', true));
            // The other half of asking for the desktop in device pixels.
            if (scaleFactor !== 100) {
                builder.extension(new ironrdp.Extension('desktop_scale_factor', scaleFactor));
            }
            // Registered because the builder takes it and a later build may
            // start honouring it. It cannot be relied on: upstream this is a
            // stub that is never called, which is why the size is polled below.
            builder.canvasResizedCallback(() => {
                if (current() && canvas.width && canvas.height) {
                    setSize({ width: canvas.width, height: canvas.height });
                }
            });

            /*
             * Clipboard, both directions.
             *
             * Remote to local is unconditional, matching VncView: what was
             * copied over there is on this machine's clipboard by the time you
             * reach for it.
             *
             * Local to remote is on request. RDP asks — through this callback —
             * at the moment someone pastes on the far side, so reading the
             * local clipboard here is answering a question rather than
             * volunteering an answer. That distinction is why VncView, which
             * gets no such question, has a button instead. This has both.
             */
            builder.remoteClipboardChangedCallback((data) => {
                const text = plainTextOf(data);
                if (!text) return;

                // Recorded as though this side had sent it, which is what stops
                // the echo: without this, copying on the desktop puts the text
                // on the local clipboard, and the next focus sends that exact
                // text back — announcing ourselves as the owner of a clipboard
                // the desktop already owns, and taking it away from the copy
                // that started it. The far side already has this content; there
                // is nothing to tell it.
                lastSentRef.current = text;

                window.api.clipboard.writeText(text);
            });

            builder.forceClipboardUpdateCallback(() => {
                // Deliberately not awaited: this is a notification, and the
                // paste on the far side is not waiting on this promise.
                sendClipboardRef.current?.();
            });

            // The remote pointer. Not optional — the builder refuses to connect
            // without both of these — and worth doing properly rather than
            // stubbing: the cursor shape is how a desktop says a control is
            // draggable, a field is editable, or the machine is busy.
            builder.setCursorStyleCallbackContext(canvas);
            builder.setCursorStyleCallback((context, kind, data, hotspotX, hotspotY) => {
                const target = context || canvas;
                if (!target?.style) return;

                try {
                    if (kind === 'hidden') {
                        target.style.cursor = 'none';
                    } else if (kind === 'url' && data) {
                        // A data: URI, which the CSP's `img-src ... data:`
                        // covers — CSS cursors are fetched as images.
                        target.style.cursor =
                            `url(${data}) ${hotspotX || 0} ${hotspotY || 0}, default`;
                    } else {
                        target.style.cursor = 'default';
                    }
                } catch {
                    // An unusable cursor is not worth ending a session over.
                }
            });

            live = await builder.connect();
        } catch (connectError) {
            if (!current()) return;
            setStatus('error');

            // IronRDP can only report that the leg to the proxy failed; it has
            // no way to know why, because the why happened on the other side of
            // it. The bridge does know — it is the one that dialled, negotiated
            // and gave up — so its reason is the better answer whenever it has
            // one, and "failed before the session started" is the fallback
            // rather than the message.
            const reported = await get().catch(() => null);
            setError(reported?.lastError || describeIronError(connectError, ironrdp));

            close(host?.id);
            return;
        } finally {
            // The builder has copied what it needs. Nothing here should keep a
            // reference to the credential after this point — including early
            // exits above that never reached connect.
            result.password = '';
        }

        if (!current()) {
            try {
                live.shutdown();
            } catch {
                // Nothing to shut down.
            }
            return;
        }

        sessionRef.current = live;
        // The canvas has not been sized yet, since `run()` below does that, so
        // this asks the session rather than the element.
        setSize(agreedSize(live));
        setStatus('connected');

        detachInputRef.current = attachInput(canvasRef.current, () => sessionRef.current, ironrdp);
        if (isActive && isFocused) canvasRef.current?.focus();

        // `run` resolves when the session ends, however it ends. Anything other
        // than a shutdown we asked for is worth showing, because the pane
        // otherwise just stops updating and looks frozen.
        live.run().then(
            (info) => {
                if (!current()) return;
                sessionRef.current = null;
                setStatus('closed');
                const reason = (() => {
                    try {
                        return info?.reason?.() || '';
                    } catch {
                        return '';
                    }
                })();
                if (reason) setError(reason);
            },
            (runError) => {
                if (!current()) return;
                sessionRef.current = null;
                setStatus('error');
                setError(describeIronError(runError, ironrdp));
            }
        );
        // `isActive`/`isFocused` are read once, to decide the initial focus; the
        // effect below owns it from then on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [close, host?.id, open, teardown]);

    // Connect on mount, and tear down for good on unmount. `paneId` and the
    // host id are the identity of the session, so a change to either is a
    // different desktop rather than the same one moving.
    useEffect(() => {
        connect();

        return () => {
            generationRef.current++;
            teardown();
            close(host?.id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paneId, host?.id]);

    // Keyboard input goes to whatever has focus, so the canvas has to take it
    // when the pane becomes the active one.
    useEffect(() => {
        if (status !== 'connected') return;
        if (isActive && isFocused) canvasRef.current?.focus();
        else canvasRef.current?.blur();
    }, [isActive, isFocused, status]);

    /**
     * Follow the framebuffer.
     *
     * `agreedSize` covers the size a session opens at; this covers every change
     * after it, which under Match is one per pane resize. Nothing announces
     * them (see SIZE_POLL), so the canvas is asked on a slow tick. The state is
     * left alone unless the answer moved, which keeps this from re-rendering the
     * pane once a second for nothing.
     */
    useEffect(() => {
        if (status !== 'connected') return undefined;

        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        const timer = setInterval(() => {
            const { width, height } = canvas;
            if (!width || !height) return;

            setSize(previous => (
                previous && previous.width === width && previous.height === height
                    ? previous
                    : { width, height }
            ));
        }, SIZE_POLL);

        return () => clearInterval(timer);
    }, [status]);

    /**
     * Keep the remote desktop the same size as the pane.
     *
     * Only in `resize` mode: the other two are deliberately *not* this. `fit`
     * scales a fixed desktop down, and `actual` scrolls around it — both want
     * the resolution left alone, and reflowing the remote windows underneath
     * someone who asked for neither would be the wrong answer.
     *
     * The observer is on the pane rather than the window: a split divider moves
     * this without the window changing at all.
     */
    useEffect(() => {
        if (scaling !== 'resize' || status !== 'connected') return undefined;

        const frame = frameRef.current;
        if (!frame) return undefined;

        let timer = null;
        let last = '';

        const push = () => {
            const session = sessionRef.current;
            if (!session) return;

            // Device pixels here too, for the same reason as at connect: a
            // desktop resized to the pane's CSS size would go soft again the
            // moment it arrived.
            const ratio = window.devicePixelRatio || 1;
            const width = clampWidth((frame.clientWidth || MIN_WIDTH) * ratio);
            const height = clampHeight((frame.clientHeight || MIN_HEIGHT) * ratio);

            // Clamping and rounding mean many pixel sizes land on the same
            // request, and the server redraws for every one it is sent.
            const key = `${width}x${height}`;
            if (key === last) return;
            last = key;

            try {
                // The scale factor travels with the size: a resize that dropped
                // it would leave Windows drawing a high-resolution desktop at
                // 100%, which is sharp and far too small to read.
                session.resize(width, height, scaleFactorFor(ratio), null, null);
            } catch (error) {
                // A server without the Display Control channel — anything
                // before RDP 8.1 — keeps the size it opened with, which is not
                // worth ending a working session over. But it is worth saying:
                // swallowing this is what makes the button look like it does
                // nothing at all.
                if (!warnedRef.current) {
                    warnedRef.current = true;
                    toast(
                        'This server would not change its resolution. Fit scales the desktop instead.',
                        toastOptions
                    );
                }
                console.warn('RDP resize refused:', error);
            }
        };

        // The size on entering the mode is as much a change as any later one.
        push();

        const observer = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(push, RESIZE_SETTLE);
        });
        observer.observe(frame);

        return () => {
            clearTimeout(timer);
            observer.disconnect();
        };
    }, [scaling, status]);

    /**
     * Put this machine's clipboard on the remote one.
     *
     * `announce` separates the two callers. Answering RDP's own request is
     * silent — someone pressing Ctrl+V over there has not asked this side for a
     * progress report — while the toolbar button says what it did, because a
     * button that appears to do nothing is a button you press again.
     */
    const sendClipboard = useCallback(async ({ announce = false, force = false } = {}) => {
        const session = sessionRef.current;
        const ironrdp = ironrdpRef.current;
        if (!session || !ironrdp) return;

        const text = await window.api.clipboard.readText();
        if (!text) {
            if (announce) toast.error('Nothing in the clipboard', toastOptions({ duration: 1800 }));
            return;
        }

        // Every send is a format-list PDU the far side has to process, and the
        // triggers below fire on things as ordinary as clicking into the pane.
        // Sending the same text again would be pure noise — except from the
        // button, where saying "sent" and not sending would be a lie.
        if (!force && text === lastSentRef.current) {
            if (announce) {
                toast.success('Clipboard sent to the desktop', toastOptions({ duration: 1500 }));
            }
            return;
        }

        try {
            const data = new ironrdp.ClipboardData();
            data.addText('text/plain', text);
            // Not freed: wasm-bindgen hands ownership across with the call, and
            // freeing what the other side now owns is worse than the few bytes.
            await session.onClipboardPaste(data);
            lastSentRef.current = text;
            if (announce) {
                toast.success('Clipboard sent to the desktop', toastOptions({ duration: 1500 }));
            }
        } catch (error) {
            if (announce) {
                toast.error(`Could not send the clipboard: ${error.message}`, toastOptions);
            }
        }
    }, []);

    // The builder's callback is created before this function exists, and holds
    // the ref rather than the function so a reconnect does not leave it calling
    // into a previous session.
    sendClipboardRef.current = sendClipboard;

    /**
     * Keep the far side told about this machine's clipboard.
     *
     * RDP does not fetch on demand: pasting on the desktop reads a format list
     * the client announced *earlier*, so a clipboard that is only sent when
     * asked is a clipboard that is never there when it is wanted. That was the
     * bug — the announcement happened once, if at all, and copying here
     * afterwards never reached the remote.
     *
     * Two moments cover it. Coming up primes the session, and taking the canvas
     * is the last thing anyone does before pasting into the desktop — including
     * after alt-tabbing away to copy something, because coming back to a window
     * whose canvas had focus focuses it again.
     *
     * Deliberately *not* on window focus as well. Every announcement makes this
     * side the owner of the far side's clipboard, so the cheapest thing to get
     * wrong here is to send too often: an announcement fired by something as
     * incidental as returning to the window can take the clipboard away from a
     * copy that was made on the desktop. Repeats are dropped by text, which
     * covers the rest.
     */
    useEffect(() => {
        if (status !== 'connected') return undefined;

        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        const push = () => { sendClipboard(); };

        push();
        canvas.addEventListener('focus', push);

        return () => canvas.removeEventListener('focus', push);
    }, [status, sendClipboard]);


    const onCtrlAltDel = useCallback(() => {
        sendCtrlAltDel(sessionRef.current, ironrdpRef.current);
    }, []);

    const statusUi = STATUS[status] || STATUS.closed;
    const connected = status === 'connected';
    const busy = status === 'opening' || status === 'loading' || status === 'connecting';

    /*
     * Who and where, in the form the shell pane's connecting screen uses.
     *
     * `session.address` is the authority once main has a session — it is the
     * one that knows a tunnelled desktop is reached through SSH — but there is
     * a moment before that where only the record can answer, and it says the
     * same thing. The domain goes in front in the backslash form RDP itself
     * uses, since that is how the account was typed into the editor.
     */
    const desktop = host?.desktop;
    const where = session?.address
        || (desktop?.host ? `${desktop.host}:${desktop.port || 3389}` : '');
    const account = session?.username || desktop?.username || '';
    const domain = session?.domain || desktop?.domain || '';
    const who = account && domain ? `${domain}\\${account}` : account;
    const dialling = where && who ? `${who}@${where}` : where;

    /**
     * Everything this view needs a button for.
     *
     * Kept as one value so it can be rendered in either of two places without
     * being written twice: into the pane's own header when there is one — which
     * is the normal case, and the point of `toolbarHost` — or into a header of
     * its own when this view is standing alone.
     *
     * Deliberately no host name, address or status dot. The pane header already
     * carries all three, and repeating them was the second bar's whole content.
     */
    const controls = (
        <>
            {size && (
                <span className="text-[11px] font-mono text-gray-400 dark:text-neutral-500 shrink-0 mr-1 hidden md:inline">
                    {size.width}×{size.height}
                </span>
            )}

            {connected && session && (
                <span className="text-[11px] font-mono tabular-nums text-gray-400 dark:text-neutral-500 mr-1 hidden lg:inline">
                    ↓{formatSize(session.bytesDown)} ↑{formatSize(session.bytesUp)}
                </span>
            )}

            {/* Stretch and Match look alike until you read what they do, so
                these lead with the difference rather than the shape. */}
            <IconButton
                icon={<ArrowShrink01Icon size={15} strokeWidth={2} />}
                title={SCALING.fit.hint}
                active={scaling === 'fit'}
                disabled={!connected}
                onClick={() => setScaling('fit')}
            />
            <IconButton
                icon={<ArrowExpand01Icon size={15} strokeWidth={2} />}
                title={SCALING.actual.hint}
                active={scaling === 'actual'}
                disabled={!connected}
                onClick={() => setScaling('actual')}
            />
            <IconButton
                icon={<ArrowMoveDownRightIcon size={15} strokeWidth={2} />}
                title={SCALING.resize.hint}
                active={scaling === 'resize'}
                disabled={!connected}
                onClick={() => setScaling('resize')}
            />

            {/* No extra margin: the row's own gap spaces this, exactly as it
                does the pane header's other dividers. */}
            <div className="h-5 w-px bg-gray-200 dark:bg-surface-control" />

            {/* The other direction needs no button: what is copied on the
                desktop reaches this machine's clipboard on its own. */}
            <IconButton
                icon={<ClipboardIcon size={15} strokeWidth={2} />}
                title="Send this machine's clipboard to the desktop"
                disabled={!connected}
                onClick={() => sendClipboard({ announce: true, force: true })}
            />

            {/* No keyboard equivalent once the canvas has the keyboard: the
                whole point of Ctrl+Alt+Del is that it cannot be typed. */}
            <IconButton
                icon={<KeyboardIcon size={15} strokeWidth={2} />}
                title="Send Ctrl+Alt+Del"
                disabled={!connected}
                onClick={onCtrlAltDel}
            />
            <IconButton
                icon={<Refresh01Icon size={15} strokeWidth={2} />}
                title="Reconnect"
                disabled={busy}
                onClick={connect}
            />
        </>
    );

    return (
        <div className="absolute inset-0 flex flex-col bg-gray-50 dark:bg-surface-base">
            {/* Only when there is nowhere better to put them. With a host the
                controls go into the pane header instead, and this view is just
                the desktop. */}
            {!toolbarHost && (
                <div className="h-11 shrink-0 flex items-center justify-end gap-1 px-3 border-b border-gray-200 dark:border-surface-control">
                    {controls}
                </div>
            )}

            {toolbarHost && createPortal(controls, toolbarHost)}

            <div
                ref={frameRef}
                className={`flex-1 min-h-0 relative ${
                    scaling === 'actual' ? 'overflow-auto' : 'overflow-hidden'
                }`}
                style={{ background: '#0a0a0f' }}
            >
                {/* IronRDP's target, and the thing that takes the keyboard.
                    Left mounted through every state so the framebuffer it owns
                    is never rebuilt underneath it. `tabIndex` is what makes a
                    canvas focusable at all. */}
                <div
                    className={
                        scaling === 'actual'
                            ? 'w-max h-max'
                            : 'absolute inset-0 flex items-center justify-center'
                    }
                >
                    <canvas
                        ref={canvasRef}
                        tabIndex={0}
                        className="outline-none block"
                        /*
                         * `width/height: 100%` rather than `maxWidth/maxHeight`.
                         * The max form only ever scales *down*, so a desktop
                         * smaller than the pane — which is every desktop until
                         * the server has caught up with a resize, and any
                         * desktop at all once the window is opened wider than
                         * the resolution it connected at — just sat there small
                         * in the corner. `contain` keeps the aspect ratio, so
                         * this fills the pane in both directions instead.
                         *
                         * `resize` gets the same treatment on purpose: the
                         * server takes a moment to redraw, and this is what
                         * covers that moment. Once it has caught up the canvas
                         * already matches the pane and the scaling is a no-op.
                         */
                        style={scaling === 'actual'
                            /*
                             * Down by the device ratio, because the desktop is
                             * asked for in device pixels. Left at its intrinsic
                             * size the canvas would lay itself out as that many
                             * *CSS* pixels and come out a quarter too big on a
                             * 125% display — which is not what "actual size"
                             * means. Divided, one remote pixel is one screen
                             * pixel, which is.
                             */
                            ? (size
                                ? {
                                    width: `${size.width / (window.devicePixelRatio || 1)}px`,
                                    height: `${size.height / (window.devicePixelRatio || 1)}px`,
                                }
                                : undefined)
                            : { width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                </div>

                {/* Coming up: the same screen a shell pane shows, because it is
                    the same wait. `note` carries the two steps ahead of the
                    connection proper (preparing the session, loading the
                    decoder) which a shell does not have and the sweep alone
                    cannot distinguish. */}
                {busy && (
                    <ConnectingSplash
                        title={host?.name || 'Desktop'}
                        subtitle={dialling}
                        note={status === 'connecting' ? '' : statusUi.label}
                        os={hostOs(host)}
                        distro={host?.distro}
                        className="z-20 bg-gray-50 dark:bg-surface-base text-gray-900 dark:text-white"
                    />
                )}

                {/* Not coming up and not up: failed, or over. */}
                {!busy && status !== 'connected' && (
                    <div className="absolute inset-0 flex items-center justify-center p-6 bg-gray-50 dark:bg-surface-base">
                        <div className="text-center max-w-sm">
                            {status === 'error' ? (
                                <AlertCircleIcon
                                    size={32}
                                    strokeWidth={1.75}
                                    className="mx-auto text-red-400 dark:text-red-500 mb-3"
                                />
                            ) : (
                                <ComputerIcon
                                    size={32}
                                    strokeWidth={1.5}
                                    className="mx-auto text-gray-300 dark:text-neutral-700 mb-3"
                                />
                            )}

                            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                                {status === 'error' ? 'Could not open the desktop' : 'Desktop disconnected'}
                            </h3>

                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {error || 'The session ended. Reconnect to open it again.'}
                            </p>

                            {/* A tunnelled desktop cannot come up without the SSH
                                session that carries it, and that is worth saying
                                rather than leaving as a refused connection. */}
                            {!isLive && session?.transport === 'tunnel' && (
                                <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
                                    This desktop rides the SSH connection, which is not open.
                                </p>
                            )}

                            <button
                                type="button"
                                onClick={connect}
                                className="mt-4 px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                            >
                                Reconnect
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(RdpView);
