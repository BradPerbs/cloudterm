import init, * as ironrdp from 'ironrdp-wasm';

/**
 * Loading the IronRDP WebAssembly module.
 *
 * The module ships a loader that resolves the `.wasm` next to itself and
 * fetches it, which does work here: a packaged build runs from `file://`, and
 * Electron permits fetching the app's own origin there even though a browser
 * would not. Relying on it would mean relying on that difference staying true,
 * across `webSecurity`, the sandbox flags and whatever Electron decides next.
 *
 * So the bytes come from the main process instead, over IPC, and are compiled
 * from memory. Same path under the dev server and in the built app, and the
 * module is shipped once rather than also being emitted into the bundle.
 *
 * Memoised on the promise rather than the result so that panes opening at the
 * same time share a single four-megabyte compile instead of racing to do it
 * twice. A failure is not cached: the next pane gets to try again.
 */
let loading = null;

export function loadIronRdp() {
    if (loading) return loading;

    loading = (async () => {
        const bytes = await window.api.rdp.wasm();
        if (!bytes?.byteLength) {
            throw new Error('The RDP module could not be read');
        }

        // Async instantiation: compiling four megabytes synchronously would
        // stall every other pane in this renderer while it ran.
        await init({ module_or_path: bytes });

        // Errors surface through IronError, so the log is the only way to see
        // what the protocol actually did. Warn keeps it to the interesting half.
        try {
            ironrdp.setup('warn');
        } catch {
            // Already initialised by another pane.
        }

        return ironrdp;
    })().catch((error) => {
        loading = null;
        throw error;
    });

    return loading;
}

/**
 * Turn an IronError into something worth putting in front of a person.
 *
 * The kinds that map to a specific cause are worth naming, because "the
 * connection failed" sends someone to check their network when the real answer
 * is that the account cannot log on to that machine.
 */
export function describeIronError(error, ironrdpModule) {
    const kinds = ironrdpModule?.IronErrorKind;

    let kind;
    try {
        kind = error?.kind?.();
    } catch {
        kind = undefined;
    }

    if (kinds && kind !== undefined) {
        switch (kind) {
            case kinds.WrongPassword:
                return 'The password was rejected';
            case kinds.LogonFailure:
                return 'The server refused the logon. Check the username, domain and password.';
            case kinds.AccessDenied:
                return 'That account is not allowed to sign in over Remote Desktop';
            case kinds.NegotiationFailure:
                return 'The server would not agree a security protocol. It may require a setting this client cannot offer.';
            case kinds.ProxyConnect:
            case kinds.RDCleanPath:
                return 'The connection to the server failed before the session started';
            default:
                break;
        }
    }

    // `backtrace()` is the only place IronRDP puts the underlying detail.
    try {
        const detail = error?.backtrace?.();
        if (detail) return String(detail).split('\n')[0];
    } catch {
        // Not an IronError.
    }

    return error?.message || 'The desktop connection failed';
}
