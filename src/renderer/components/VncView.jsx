import { memo, useCallback, useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import toast from 'react-hot-toast';
import {
    ComputerIcon,
    Refresh01Icon,
    ClipboardIcon,
    ViewIcon,
    ViewOffSlashIcon,
    ArrowExpand01Icon,
    ArrowShrink01Icon,
    ArrowMoveDownRightIcon,
    KeyboardIcon,
    AlertCircleIcon,
} from 'hugeicons-react';
import { useVnc } from '../hooks/useVnc';
import { formatSize } from '../lib/format';
import { toastOptions } from '../lib/toast';
import Tooltip from './ui/Tooltip';

/**
 * One remote desktop, filling one pane.
 *
 * The RFB stream arrives over a loopback WebSocket that the main process opened
 * and *already authenticated*: by the time this component connects, the
 * handshake with the real server is done and the bridge is presenting a plain
 * "no authentication" session. So there is no password here, no credentials
 * option on the RFB object, and nothing for a `credentialsrequired` event to
 * supply: if one ever fires, something is wrong rather than merely unconfigured.
 *
 * noVNC owns the canvas, the encodings and the input handling. This component
 * owns the lifecycle and the controls around it.
 */

/** The scaling buttons are icons, so the wording only ever appears as a tooltip. */
const SCALING = {
    fit: { hint: 'Scale the desktop to the pane' },
    actual: { hint: 'Actual size, pan to see the rest' },
    resize: { hint: 'Ask the server to match the pane' },
};

const STATUS = {
    opening: { label: 'Preparing…', dot: 'bg-amber-500' },
    connecting: { label: 'Connecting…', dot: 'bg-amber-500' },
    connected: { label: 'Connected', dot: 'bg-green-500' },
    closed: { label: 'Disconnected', dot: 'bg-gray-400' },
    error: { label: 'Failed', dot: 'bg-red-500' },
};

/**
 * The same button as RdpView's, and the same fix: the app's Tooltip rather than
 * a native `title`, which waits a second and shows nothing at all on a disabled
 * control — which most of this row is until the session is up.
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

function VncView({ paneId, host, isActive, isFocused, isLive }) {
    const screenRef = useRef(null);
    const rfbRef = useRef(null);
    // Guards the async gap between asking main to prepare a session and getting
    // an address back: the pane can be closed in between.
    const generationRef = useRef(0);

    const { session, open, close, reportName } = useVnc(paneId);

    // Read inside RFB event handlers, which outlive the render that created them.
    const activeRef = useRef(false);
    activeRef.current = isActive && isFocused;

    const [status, setStatus] = useState('closed');
    const [error, setError] = useState('');
    const [scaling, setScaling] = useState('fit');
    const [viewOnly, setViewOnly] = useState(false);
    const [size, setSize] = useState(null);

    /** Apply the view options that live on the RFB object rather than in state. */
    const applyView = useCallback((rfb, mode, readOnly) => {
        if (!rfb) return;
        rfb.viewOnly = readOnly;
        rfb.scaleViewport = mode === 'fit';
        rfb.resizeSession = mode === 'resize';
        // Only meaningful at actual size, where the desktop can be larger than
        // the pane and has to be pannable.
        rfb.clipViewport = mode === 'actual';
    }, []);

    const teardown = useCallback(() => {
        const rfb = rfbRef.current;
        rfbRef.current = null;
        if (!rfb) return;
        try {
            rfb.disconnect();
        } catch {
            // Already gone; nothing to disconnect.
        }
    }, []);

    const connect = useCallback(async () => {
        const generation = ++generationRef.current;

        teardown();
        setError('');
        setSize(null);
        setStatus('opening');

        const result = await open(host?.id);

        // The pane switched away, closed, or asked again while we waited.
        if (generation !== generationRef.current) return;

        if (!result?.success) {
            setStatus('error');
            setError(result?.message || 'Could not open the desktop');
            return;
        }
        if (!screenRef.current) return;

        setScaling(result.scaling || 'fit');
        setViewOnly(Boolean(result.viewOnly));
        setStatus('connecting');

        let rfb;
        try {
            // No `credentials`: the bridge authenticated upstream, and this side
            // of it is deliberately a session that needs none.
            rfb = new RFB(screenRef.current, result.url, {
                shared: result.shared !== false,
            });
        } catch (creationError) {
            setStatus('error');
            setError(creationError.message);
            return;
        }

        rfb.background = '#0a0a0f';
        rfb.qualityLevel = result.quality ?? 6;
        rfb.compressionLevel = result.compression ?? 2;
        // Without this a desktop with no cursor of its own shows nothing at all
        // where the pointer is.
        rfb.showDotCursor = true;
        applyView(rfb, result.scaling || 'fit', Boolean(result.viewOnly));

        rfb.addEventListener('connect', () => {
            setStatus('connected');
            // The canvas backing store is the framebuffer, so its dimensions are
            // the desktop's real resolution however the view is being scaled.
            // Read from the DOM rather than from noVNC's internals, which are
            // not part of its API.
            const canvas = screenRef.current?.querySelector('canvas');
            if (canvas) setSize({ width: canvas.width, height: canvas.height });
            if (activeRef.current) rfb.focus();
        });

        rfb.addEventListener('disconnect', (event) => {
            rfbRef.current = null;
            // A clean disconnect is the server saying goodbye; anything else is
            // worth showing, because the pane otherwise just goes blank.
            setStatus(event.detail?.clean ? 'closed' : 'error');
            if (!event.detail?.clean) {
                setError('The desktop connection dropped');
            }
        });

        rfb.addEventListener('desktopname', (event) => {
            const name = event.detail?.name || '';
            reportName(name);
        });

        rfb.addEventListener('securityfailure', (event) => {
            setError(event.detail?.reason || 'The desktop refused the connection');
        });

        // The remote clipboard follows the local one. The other direction is a
        // button, because reading the local clipboard on every focus change
        // would be a surprising thing for a viewer to do on its own.
        rfb.addEventListener('clipboard', (event) => {
            const text = event.detail?.text;
            if (text) window.api.clipboard.writeText(text);
        });

        rfb.addEventListener('credentialsrequired', () => {
            // Cannot happen against our own bridge, which offers "None". If it
            // does, the alternative to saying so is an empty pane.
            setStatus('error');
            setError('The desktop asked for credentials the bridge cannot supply');
            teardown();
        });

        rfbRef.current = rfb;
    }, [applyView, host?.id, open, reportName, teardown]);

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

    // Keyboard input goes to whatever has focus, so the desktop has to take it
    // when the pane becomes the active one.
    useEffect(() => {
        if (status !== 'connected') return;
        if (isActive && isFocused) rfbRef.current?.focus();
        else rfbRef.current?.blur();
    }, [isActive, isFocused, status]);

    useEffect(() => {
        applyView(rfbRef.current, scaling, viewOnly);
    }, [applyView, scaling, viewOnly]);

    const sendCtrlAltDel = useCallback(() => {
        rfbRef.current?.sendCtrlAltDel();
    }, []);

    const pasteFromLocal = useCallback(async () => {
        const rfb = rfbRef.current;
        if (!rfb) return;
        const text = await window.api.clipboard.readText();
        if (!text) {
            toast.error('Nothing in the clipboard', toastOptions({ duration: 1800 }));
            return;
        }
        rfb.clipboardPasteFrom(text);
        toast.success('Clipboard sent to the desktop', toastOptions({ duration: 1500 }));
    }, []);

    const statusUi = STATUS[status] || STATUS.closed;
    const connected = status === 'connected';
    const busy = status === 'opening' || status === 'connecting';

    return (
        <div className="absolute inset-0 flex flex-col bg-gray-50 dark:bg-surface-base">
            {/* Controls that have no keyboard equivalent once noVNC has the
                keyboard: the whole point of Ctrl+Alt+Del here is that it cannot
                be typed. */}
            <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-gray-200 dark:border-surface-control">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusUi.dot}`} title={statusUi.label} />

                <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                    {session?.desktopName || host?.name || 'Desktop'}
                </span>

                <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate hidden sm:inline">
                    {session?.address || ''}
                </span>

                {size && (
                    <span className="text-[11px] font-mono text-gray-400 dark:text-neutral-500 shrink-0 hidden md:inline">
                        {size.width}×{size.height}
                    </span>
                )}

                <div className="ml-auto flex items-center gap-1 shrink-0">
                    {connected && session && (
                        <span className="text-[11px] font-mono tabular-nums text-gray-400 dark:text-neutral-500 mr-1 hidden lg:inline">
                            ↓{formatSize(session.bytesDown)} ↑{formatSize(session.bytesUp)}
                        </span>
                    )}

                    {/* Scaling is a segmented set of three, small enough to keep
                        as icons rather than a control that needs a label. */}
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

                    <div className="w-px h-5 bg-gray-200 dark:bg-surface-control mx-0.5" />

                    <IconButton
                        icon={viewOnly
                            ? <ViewOffSlashIcon size={15} strokeWidth={2} />
                            : <ViewIcon size={15} strokeWidth={2} />}
                        title={viewOnly ? 'View only: input is not sent' : 'Input is being sent'}
                        active={viewOnly}
                        disabled={!connected}
                        onClick={() => setViewOnly(value => !value)}
                    />
                    <IconButton
                        icon={<ClipboardIcon size={15} strokeWidth={2} />}
                        title="Send the local clipboard to the desktop"
                        disabled={!connected || viewOnly}
                        onClick={pasteFromLocal}
                    />
                    <IconButton
                        icon={<KeyboardIcon size={15} strokeWidth={2} />}
                        title="Send Ctrl+Alt+Del"
                        disabled={!connected || viewOnly}
                        onClick={sendCtrlAltDel}
                    />
                    <IconButton
                        icon={<Refresh01Icon size={15} strokeWidth={2} />}
                        title="Reconnect"
                        disabled={busy}
                        onClick={connect}
                    />
                </div>
            </div>

            <div className="flex-1 min-h-0 relative">
                {/* noVNC's target. Left mounted through every state so the canvas
                    it creates is never rebuilt underneath it. */}
                <div
                    ref={screenRef}
                    className="absolute inset-0"
                    style={{ background: '#0a0a0f' }}
                />

                {status !== 'connected' && (
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
                                {busy ? statusUi.label : status === 'error' ? 'Could not open the desktop' : 'Desktop disconnected'}
                            </h3>

                            {error ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
                            ) : (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {busy
                                        ? session?.address || 'Reaching the VNC server…'
                                        : 'The session ended. Reconnect to open it again.'}
                                </p>
                            )}

                            {/* A tunnelled desktop cannot come up without the SSH
                                session that carries it, and that is worth saying
                                rather than leaving as a refused connection. */}
                            {!isLive && session?.transport === 'tunnel' && (
                                <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
                                    This desktop rides the SSH connection, which is not open.
                                </p>
                            )}

                            {!busy && (
                                <button
                                    type="button"
                                    onClick={connect}
                                    className="mt-4 px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                                >
                                    Reconnect
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(VncView);
