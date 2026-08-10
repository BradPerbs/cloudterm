import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertCircleIcon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    CpuIcon,
    Home01Icon,
    LinkSquare02Icon,
    LockKeyIcon,
    Refresh01Icon,
    SecurityLockIcon,
} from 'hugeicons-react';
import { useBmc } from '../hooks/useBmc';
import Tooltip from './ui/Tooltip';

/**
 * One service processor's own web interface, filling one pane.
 *
 * This component is a browser chrome and nothing else. It does not know what a
 * BMC is, cannot read the page, and never sees the password: the `<webview>`
 * loads the vendor's UI directly, and the main process logs it in by driving
 * that guest page from its own side. See src/main/bmc.js.
 *
 * Two things here are less obvious than they look.
 *
 * The `<webview>` is only rendered once both the URL and the partition are
 * known, and it is keyed by the partition. Both attributes are read by the
 * element when it attaches to the document, and setting either afterwards
 * either throws or is silently ignored, so the element must be born complete.
 * Keying it means a different host gets a *new* element rather than a mutated
 * one.
 *
 * The certificate prompt is drawn in the pane rather than as a modal over the
 * window, for the reason SessionScreen gives about host keys: the pane it
 * belongs to has nothing else in it yet, so there is nothing to interrupt.
 */

const STATUS = {
    idle: { label: 'Not open', dot: 'bg-gray-400' },
    loading: { label: 'Loading…', dot: 'bg-amber-500' },
    'logging-in': { label: 'Signing in…', dot: 'bg-amber-500' },
    ready: { label: 'Open', dot: 'bg-green-500' },
    failed: { label: 'Failed', dot: 'bg-red-500' },
};

/**
 * Navigation history moved onto its own object in Electron 36. Both spellings
 * are tried because the deprecated one is what older builds have, and a pane
 * whose back button silently does nothing is worse than one that never had it.
 */
function nav(view, method) {
    if (!view) return false;
    try {
        if (view.navigationHistory?.[method]) return view.navigationHistory[method]();
        if (typeof view[method] === 'function') return view[method]();
    } catch {
        // Called before the guest attached, which is not an error worth raising.
    }
    return false;
}

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

/**
 * The one question this pane asks before it will show anything.
 *
 * A BMC's certificate is self-signed, so it is accepted once and remembered. A
 * *changed* one is the interesting case and is worded as such: on a service
 * processor it usually means the board was reflashed or factory reset, and
 * occasionally it means something else entirely.
 */
function CertPrompt({ request, onRespond }) {
    const when = (seconds) => {
        if (!seconds) return '';
        try {
            return new Date(seconds * 1000).toLocaleDateString();
        } catch {
            return '';
        }
    };

    const validity = [when(request.validFrom), when(request.validTo)].filter(Boolean).join(' to ');

    return (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-gray-50 dark:bg-surface-base">
            <div className="max-w-md w-full text-center">
                <SecurityLockIcon
                    size={32}
                    strokeWidth={1.75}
                    className={`mx-auto mb-3 ${request.changed ? 'text-red-400 dark:text-red-500' : 'text-amber-400 dark:text-amber-500'}`}
                />

                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                    {request.changed
                        ? 'This IPMI is presenting a different certificate'
                        : 'This IPMI has a certificate nothing vouches for'}
                </h3>

                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {request.changed
                        ? 'It was reflashed or reset, or something is answering in its place. Check before you accept it.'
                        : 'Service processors ship self-signed certificates, so this is expected. It is remembered once you accept it.'}
                </p>

                <dl className="mt-4 text-left rounded-xl border border-gray-200 dark:border-surface-control p-3 space-y-1.5">
                    {[
                        ['Address', request.hostname],
                        ['Fingerprint', request.fingerprint],
                        ['Subject', request.subject],
                        ['Issuer', request.issuer],
                        ['Valid', validity],
                    ].filter(([, value]) => value).map(([label, value]) => (
                        <div key={label} className="flex gap-3">
                            <dt className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-gray-400 dark:text-neutral-500 pt-px">
                                {label}
                            </dt>
                            <dd className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 break-all">
                                {value}
                            </dd>
                        </div>
                    ))}
                </dl>

                <div className="mt-4 flex items-center justify-center gap-2">
                    <button
                        type="button"
                        onClick={() => onRespond(false)}
                        className="px-4 h-9 rounded-xl border border-gray-200 dark:border-surface-control text-gray-700 dark:text-gray-300 font-semibold text-sm hover:bg-gray-100 dark:hover:bg-surface-control active:scale-95 transition-all"
                    >
                        Do not open
                    </button>
                    <button
                        type="button"
                        onClick={() => onRespond(true)}
                        className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                    >
                        Accept and remember
                    </button>
                </div>
            </div>
        </div>
    );
}

function BmcView({ paneId, host, isActive, toolbarHost = null }) {
    const viewRef = useRef(null);

    // Guards the async gap between asking main to prepare a session and getting
    // an address back: the pane can be closed in between.
    const generationRef = useRef(0);

    /**
     * Whether this pane has already asked for a session.
     *
     * Deliberately not the generation counter, which is a different question and
     * was briefly asked in its place. React's StrictMode mounts, unmounts and
     * remounts every component in development, keeping its refs, so a counter
     * bumped by the unmount is never back at its initial value on the remount
     * and a "have we started" test written against it answers no exactly once
     * and yes forever after. The pane then sits on its opening screen with
     * nothing to report, because nothing was ever asked for.
     *
     * Cleared by the same cleanup that bumps the generation, so a genuine
     * unmount reopens and a StrictMode one does too.
     */
    const startedRef = useRef(false);

    const { session, open, close, attach, login } = useBmc(paneId);

    const [target, setTarget] = useState(null);      // { url, partition, vendor }
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [address, setAddress] = useState('');
    const [history, setHistory] = useState({ back: false, forward: false });
    const [certRequest, setCertRequest] = useState(null);

    const start = useCallback(async () => {
        const generation = ++generationRef.current;

        setError('');
        setCertRequest(null);
        setStatus('loading');
        setTarget(null);

        const result = await open(host?.id);

        if (generation !== generationRef.current) return;

        if (!result?.success) {
            setStatus('failed');
            setError(result?.message || 'Could not open the IPMI');
            return;
        }

        setTarget({ url: result.url, partition: result.partition, vendor: result.vendor });
        setAddress(result.url);
    }, [open, host?.id]);

    // Opened when the pane first shows this view, and never re-opened on every
    // activation: a BMC session is a login, and re-running it whenever the tab
    // regains focus would sign in again on every switch.
    useEffect(() => {
        if (!isActive || startedRef.current) return;
        startedRef.current = true;
        start();
    }, [isActive, start]);

    // Closing is defensive, and matches VncView: the pane may never have opened
    // a session at all, and main treats a close of nothing as a success.
    useEffect(() => () => {
        startedRef.current = false;
        generationRef.current++;
        close(host?.id);
    }, [close, host?.id]);

    /* The certificate question, for this pane only. */
    useEffect(() => {
        if (!window.api.bmc?.onCertPrompt) return undefined;
        return window.api.bmc.onCertPrompt((request) => {
            if (request?.paneId === paneId) setCertRequest(request);
        });
    }, [paneId]);

    const respondCert = useCallback((accepted) => {
        const request = certRequest;
        setCertRequest(null);
        if (!request) return;

        window.api.bmc.respondCert(request.requestId, accepted);

        if (accepted) {
            // The held request resumes on its own, but the navigation that was
            // already refused does not, so the page is asked for again.
            setStatus('loading');
            setTimeout(() => viewRef.current?.reload(), 50);
        } else {
            setStatus('failed');
            setError('The certificate was not accepted');
        }
    }, [certRequest]);

    /*
     * Hand the guest to main once it exists.
     *
     * `dom-ready` is the first event at which getWebContentsId() is meaningful.
     * Everything main does to this page (the login, the popup policy, the load
     * reporting) is hung off that id, so this is the call that turns an ordinary
     * embedded browser into a BMC pane.
     */
    useEffect(() => {
        const view = viewRef.current;
        if (!view || !target) return undefined;

        const onDomReady = () => {
            try {
                attach(view.getWebContentsId());
            } catch {
                // The element detached between the event and this call.
            }
        };

        const onNavigate = () => {
            try {
                setAddress(view.getURL());
            } catch {
                // Same.
            }
            setHistory({
                back: Boolean(nav(view, 'canGoBack')),
                forward: Boolean(nav(view, 'canGoForward')),
            });
        };

        view.addEventListener('dom-ready', onDomReady);
        view.addEventListener('did-navigate', onNavigate);
        view.addEventListener('did-navigate-in-page', onNavigate);

        // And once now, in case the guest attached before this effect ran. The
        // call throws until the element has a webContents, which is what the
        // catch inside onDomReady is for, and main ignores a second attach of
        // the same id, so the overlap costs nothing.
        onDomReady();

        return () => {
            view.removeEventListener('dom-ready', onDomReady);
            view.removeEventListener('did-navigate', onNavigate);
            view.removeEventListener('did-navigate-in-page', onNavigate);
        };
    }, [target, attach]);

    // Main is the authority on load and login state; local status only covers
    // the window before the guest exists.
    const effectiveStatus = certRequest ? 'loading' : (session?.status || status);
    const statusUi = STATUS[effectiveStatus] || STATUS.idle;
    const message = session?.message || error;
    const failed = effectiveStatus === 'failed';

    /**
     * Everything this view needs a button for.
     *
     * Kept as one value so it can be rendered in either of two places without
     * being written twice: into the pane's own header when there is one, which
     * is the normal case and the point of `toolbarHost`, or into a header of its
     * own when this view is standing alone. Same arrangement as RdpView, for the
     * same reason.
     *
     * Deliberately no host name and no status dot. The pane header already
     * carries both, and repeating them was the second bar's entire content.
     *
     * The address stays, because it is the one thing here the pane header does
     * not say: which page of the board's interface you are looking at, which
     * changes as you move around it.
     */
    const controls = (
        <>
            {address && (
                <span className="text-[11px] font-mono text-gray-400 dark:text-neutral-500 truncate max-w-[220px] mr-1 hidden lg:inline">
                    {address}
                </span>
            )}

            {session?.loggedIn && (
                <span className="text-[11px] text-green-600 dark:text-green-500 shrink-0 mr-1 hidden md:inline">
                    signed in
                </span>
            )}

            {/* An auto-login that did not happen, said where it happened. The
                page behind this looks perfectly fine when the fill has silently
                found nothing, so without a line here the only symptom is a login
                screen the user assumes is their own fault. Not on the failure
                overlay, because the pane has not failed: the board loaded, it
                just did not get signed in. */}
            {!session?.loggedIn && !failed && session?.message && (
                <span className="text-[11px] text-amber-600 dark:text-amber-500 truncate max-w-[260px] mr-1 hidden md:inline">
                    {session.message}
                </span>
            )}

            <IconButton
                icon={<ArrowLeft01Icon size={15} strokeWidth={2} />}
                title="Back"
                disabled={!history.back}
                onClick={() => nav(viewRef.current, 'goBack')}
            />
            <IconButton
                icon={<ArrowRight01Icon size={15} strokeWidth={2} />}
                title="Forward"
                disabled={!history.forward}
                onClick={() => nav(viewRef.current, 'goForward')}
            />
            <IconButton
                icon={<Refresh01Icon size={15} strokeWidth={2} />}
                title="Reload"
                disabled={!target}
                onClick={() => viewRef.current?.reload()}
            />
            <IconButton
                icon={<Home01Icon size={15} strokeWidth={2} />}
                title="Back to the IPMI's own address"
                disabled={!target}
                onClick={() => viewRef.current?.loadURL(target.url)}
            />

            {/* No extra margin: the row's own gap spaces this, exactly as it
                does the pane header's other dividers. */}
            <div className="h-5 w-px bg-gray-200 dark:bg-surface-control" />

            {/* Only offered where there is a form to fill. A board on HTTP Basic
                auth was answered at the challenge, and one set to `manual` was
                never going to be filled in. */}
            <IconButton
                icon={<LockKeyIcon size={15} strokeWidth={2} />}
                title="Fill in the login again"
                disabled={!target || !session?.canRefill}
                onClick={() => login()}
            />
            <IconButton
                icon={<LinkSquare02Icon size={15} strokeWidth={2} />}
                title="Open in the system browser"
                disabled={!address}
                onClick={() => window.api.links?.open(address)}
            />
        </>
    );

    return (
        <div className="absolute inset-0 flex flex-col bg-gray-50 dark:bg-surface-base">
            {/* Only when there is nowhere better to put them. With a pane header
                the controls go there instead, and this view is just the board. */}
            {!toolbarHost && (
                <div className="h-11 shrink-0 flex items-center justify-end gap-1 px-3 border-b border-gray-200 dark:border-surface-control">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mr-auto ${statusUi.dot}`} title={statusUi.label} />
                    {controls}
                </div>
            )}

            {toolbarHost && createPortal(controls, toolbarHost)}

            <div className="flex-1 min-h-0 relative">
                {/* Born complete, and keyed by partition: both attributes are
                    read when the element attaches and cannot be changed after. */}
                {target && (
                    <webview
                        ref={viewRef}
                        key={target.partition}
                        src={target.url}
                        partition={target.partition}
                        allowpopups="true"
                        className="absolute inset-0"
                        style={{ display: 'flex', width: '100%', height: '100%' }}
                    />
                )}

                {certRequest && <CertPrompt request={certRequest} onRespond={respondCert} />}

                {!certRequest && (!target || failed) && (
                    <div className="absolute inset-0 flex items-center justify-center p-6 bg-gray-50 dark:bg-surface-base">
                        <div className="text-center max-w-sm">
                            {failed ? (
                                <AlertCircleIcon
                                    size={32}
                                    strokeWidth={1.75}
                                    className="mx-auto text-red-400 dark:text-red-500 mb-3"
                                />
                            ) : (
                                <CpuIcon
                                    size={32}
                                    strokeWidth={1.5}
                                    className="mx-auto text-gray-300 dark:text-neutral-700 mb-3"
                                />
                            )}

                            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                                {failed ? 'Could not open the IPMI' : 'Opening the IPMI…'}
                            </h3>

                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {message || (failed ? '' : 'Reaching the service processor…')}
                            </p>

                            {failed && (
                                <button
                                    type="button"
                                    onClick={start}
                                    className="mt-4 px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
                                >
                                    Try again
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(BmcView);
