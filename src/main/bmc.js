const { app, net, session, webContents } = require('electron');
const tls = require('tls');
// Named apart from Electron's `net`, which is the HTTP client above and a
// different thing entirely from Node's sockets.
const sockets = require('net');
const store = require('./store');
const { validateBmc, bmcUrl, DEFAULT_PORTS } = require('./bmc-config');
const { loginScript, usesForm } = require('./bmc-login');

/**
 * A BMC's own web interface, in a pane.
 *
 * Unlike vnc.js and rdp.js this is not a bridge. Nothing is decoded here and no
 * stream is carried: the pane holds a `<webview>` and the board serves it the
 * same UI it would serve a browser. What this module owns is the three things
 * that have to happen in the main process for that to work at all.
 *
 * 1. The certificate. Every service processor ships a self-signed certificate,
 *    so without a decision made here Chromium refuses the load and the pane
 *    shows nothing, forever. The decision is trust on first use, recorded per
 *    host, in the shape known-hosts.js records an SSH host key: unknown is
 *    shown and accepted once, and *changed* stops the load and asks again. See
 *    installVerifier.
 *
 * 2. The credentials. The store's rule is that a stored secret never travels
 *    main -> renderer, and a BMC password is about as consequential a secret as
 *    the app holds: it is root on the hardware, underneath the operating
 *    system. So the password never reaches our renderer. It goes from here into
 *    the guest page directly, either through `executeJavaScript` on the guest's
 *    own webContents (a form login) or through the `login` event (HTTP Basic).
 *    The renderer asks for a login and is told whether one happened.
 *
 * 3. The session. Each host gets its own partition, so two iDRACs can be open
 *    at once without the second one logging the first out, which is what
 *    happens in a browser and is the single most annoying thing about
 *    administering more than one machine from one.
 *
 *    Deliberately not a `persist:` partition. An in-memory one dies with the
 *    app, so a BMC session cookie is never written to disk, and auto-login
 *    makes getting a new one free. The cost of persisting would be a
 *    root-equivalent session sitting in the profile directory to save a form
 *    submission nobody sees.
 *
 * Runtime state is keyed by pane, so a BMC dies with the tab holding it.
 */

/** paneId -> pane state. */
const panes = new Map();

/** Partitions that already have a certificate verifier installed. */
const verified = new Set();

let notifier = null;

/**
 * Asks the user whether to trust a certificate. Installed by ipc.js, which owns
 * the prompt plumbing, exactly as the SSH host-key prompt is wired.
 */
let trustRequester = null;

function setNotifier(fn) {
    notifier = fn;
}

function setTrustRequester(fn) {
    trustRequester = fn;
}

function notify(paneId) {
    const pane = panes.get(paneId);
    if (notifier && pane) notifier('bmc-update', publicState(pane));
}

/** What the renderer is allowed to see. Note the absence of a password. */
function publicState(pane) {
    return {
        paneId: pane.paneId,
        hostId: pane.hostId,
        url: pane.url,
        partition: pane.partition,
        vendor: pane.vendor,
        autoLogin: pane.autoLogin,
        // Whether there is a form to fill *again*, which is not the same
        // question: a board on HTTP Basic auth signs in automatically and has
        // no form, so the pane's "fill it again" button has nothing to do.
        canRefill: pane.fillsForm,
        status: pane.status,
        message: pane.message,
        loggedIn: pane.loggedIn,
    };
}

/**
 * How long the Redfish probe gets before `auto` gives up and picks nothing.
 *
 * Short, and harmless when it expires: an undetected board falls through to the
 * generic form heuristic in bmc-login.js, which is what serves every vendor
 * with no recipe anyway. Detection buys better selectors, not the feature.
 */
const DETECT_TIMEOUT = 2500;

/**
 * How long a scheme probe gets. Shorter than the vendor probe, because it is one
 * handshake against a device on the local network rather than a request that has
 * to be served, and because up to two of them run before the pane shows anything.
 */
const PROBE_TIMEOUT = 1800;

/**
 * How many times a login form will be filled in for one pane.
 *
 * There has to be a ceiling, and it has to be low. A board that rejects the
 * stored password puts its login page back up, which is another finished load,
 * which without a cap would be another attempt, forever, against an account
 * that very likely has a lockout policy counting them.
 *
 * Three, because the redirects that make a cap necessary in the first place
 * (`/` to `/page/login.html`, http to https) cost an attempt each without ever
 * reaching a form.
 */
const MAX_LOGIN_ATTEMPTS = 3;

/* ------------------------------------------------------------------ *
 * Certificates
 * ------------------------------------------------------------------ */

/**
 * Install the trust-on-first-use verifier on a host's partition.
 *
 * Chromium calls this for every request the pane makes, so it has to be cheap
 * and it has to be decisive. Three cases, in order:
 *
 *   The certificate verifies normally. Nothing to decide, so Chromium's own
 *   answer is used. A BMC behind a real internal CA is not made to go through
 *   a trust prompt just because it is a BMC.
 *
 *   It does not verify, and its fingerprint is the one this host has already
 *   accepted. That is the ordinary case for the whole life of the feature, and
 *   it must not prompt: the certificate was self-signed yesterday too.
 *
 *   It does not verify and the fingerprint is new or changed. The user is
 *   asked, and the request is held until they answer. Holding rather than
 *   failing is what lets the answer apply to the load already in flight
 *   instead of requiring a reload to take effect.
 */
function installVerifier(partition, paneId) {
    if (verified.has(partition)) return;
    verified.add(partition);

    session.fromPartition(partition).setCertificateVerifyProc(async (request, callback) => {
        const pane = panes.get(paneId);

        // -3 defers to Chromium; 0 accepts; -2 rejects.
        if (request.verificationResult === 'net::OK') {
            callback(-3);
            return;
        }

        const fingerprint = request.certificate?.fingerprint || '';

        if (pane && fingerprint && fingerprint === pane.trustedCert) {
            callback(0);
            return;
        }

        if (!pane || !trustRequester || !fingerprint) {
            callback(-2);
            return;
        }

        // A single pane can have several requests in flight against the same
        // new certificate (the page, its stylesheet, its bundle). One prompt is
        // enough, so the rest wait on the first one's answer.
        if (!pane.certPrompt) {
            pane.certPrompt = trustRequester({
                hostId: pane.hostId,
                paneId: pane.paneId,
                hostname: request.hostname,
                fingerprint,
                issuer: request.certificate?.issuerName || '',
                subject: request.certificate?.subjectName || '',
                validFrom: request.certificate?.validStart || 0,
                validTo: request.certificate?.validExpiry || 0,
                changed: Boolean(pane.trustedCert),
            }).then((accepted) => {
                if (accepted) {
                    pane.trustedCert = fingerprint;
                    // Remembered, so tomorrow's load does not ask again.
                    store.trustBmcCert(pane.hostId, fingerprint);
                }
                pane.certPrompt = null;
                return accepted;
            }).catch(() => {
                pane.certPrompt = null;
                return false;
            });
        }

        callback((await pane.certPrompt) ? 0 : -2);
    });
}

/* ------------------------------------------------------------------ *
 * Scheme detection
 * ------------------------------------------------------------------ */

/**
 * Whether a TLS handshake completes on this port.
 *
 * `rejectUnauthorized: false` because the certificate is not the question. Every
 * board here is self-signed, and whether to trust *this* one is decided later,
 * by the user, through the verifier on the pane's own session. All this asks is
 * whether there is a TLS server on the other end at all, and a handshake that
 * completes is a yes however the certificate is signed.
 *
 * Deliberately not routed through the pane's session: a probe must not raise the
 * trust prompt, which at this point would be asking about a certificate before
 * the pane has decided which address it is even loading.
 */
function probeTls(host, port) {
    return new Promise((resolve) => {
        let socket;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            try {
                socket?.destroy();
            } catch {
                // Already gone.
            }
            resolve(value);
        };

        try {
            socket = tls.connect({
                host,
                port,
                rejectUnauthorized: false,
                // Boards on an IP address get no SNI, which is what a browser
                // does too and what their certificates expect.
                servername: sockets.isIP(host) ? undefined : host,
                timeout: PROBE_TIMEOUT,
            });
        } catch {
            finish(false);
            return;
        }

        socket.once('secureConnect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
    });
}

/** Whether anything accepts a plain TCP connection on this port. */
function probeTcp(host, port) {
    return new Promise((resolve) => {
        let settled = false;
        const socket = new sockets.Socket();
        const finish = (value) => {
            if (settled) return;
            settled = true;
            try {
                socket.destroy();
            } catch {
                // Already gone.
            }
            resolve(value);
        };

        socket.setTimeout(PROBE_TIMEOUT);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));

        try {
            socket.connect(port, host);
        } catch {
            finish(false);
        }
    });
}

/**
 * Settle a record's scheme and port into ones a URL can name.
 *
 * The reason this exists rather than defaulting to HTTPS: boards disagree, and
 * the disagreement is not guessable from anything on the record. Some serve
 * HTTPS only, some serve both and redirect one way or the other, and some older
 * ones serve plain HTTP and answer a TLS handshake with a reset. A person adding
 * a machine knows its address; making them also know which way this board went
 * is asking them to debug before they have connected.
 *
 * A named scheme is honoured without probing, which is what that setting is for.
 */
async function detectEndpoint(host, scheme, port) {
    if (scheme === 'https' || scheme === 'http') {
        return { scheme, port: port || DEFAULT_PORTS[scheme] };
    }

    // A port was given, so the only open question is what is listening on it.
    if (port) {
        return { scheme: await probeTls(host, port) ? 'https' : 'http', port };
    }

    if (await probeTls(host, DEFAULT_PORTS.https)) {
        return { scheme: 'https', port: DEFAULT_PORTS.https };
    }
    if (await probeTcp(host, DEFAULT_PORTS.http)) {
        return { scheme: 'http', port: DEFAULT_PORTS.http };
    }

    // Nothing answered on either. HTTPS, so the load fails against the port the
    // board almost certainly should have been on and says so in those terms,
    // rather than reporting a plain-HTTP failure nobody expected to see.
    return { scheme: 'https', port: DEFAULT_PORTS.https };
}

/* ------------------------------------------------------------------ *
 * Vendor detection
 * ------------------------------------------------------------------ */

/**
 * Ask the board what it is, over Redfish.
 *
 * `/redfish/v1/` is the one endpoint the DMTF specification requires to be
 * readable without authentication, which is what makes it usable before we have
 * logged in. Its `Oem` block is keyed by vendor, and `Vendor` is present on
 * newer implementations. Boards with no Redfish at all (an X9, an older iLO 4)
 * simply fail this, and fall through to the generic heuristic.
 */
function detectVendor(origin, partition) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const timer = setTimeout(() => finish(''), DETECT_TIMEOUT);

        let request;
        try {
            request = net.request({
                method: 'GET',
                url: `${origin}/redfish/v1/`,
                session: session.fromPartition(partition),
            });
        } catch {
            clearTimeout(timer);
            finish('');
            return;
        }

        request.on('response', (response) => {
            let body = '';
            response.on('data', (chunk) => {
                // A service root is a couple of kilobytes. Anything much larger
                // is not one, and is not worth buffering to find that out.
                if (body.length < 64 * 1024) body += chunk.toString('utf8');
            });
            response.on('end', () => {
                clearTimeout(timer);
                finish(vendorFromServiceRoot(body));
            });
            response.on('error', () => {
                clearTimeout(timer);
                finish('');
            });
        });

        request.on('error', () => {
            clearTimeout(timer);
            finish('');
        });

        try {
            request.end();
        } catch {
            clearTimeout(timer);
            finish('');
        }
    });
}

/** Map a Redfish service root onto one of our recipes. */
function vendorFromServiceRoot(body) {
    let root;
    try {
        root = JSON.parse(body);
    } catch {
        return '';
    }

    const names = [
        ...Object.keys(root?.Oem || {}),
        root?.Vendor || '',
        root?.Product || '',
    ].join(' ').toLowerCase();

    if (names.includes('supermicro')) return 'supermicro';
    if (names.includes('dell')) return 'idrac';
    if (names.includes('hpe') || names.includes('hp_')) return 'ilo';
    if (names.includes('openbmc')) return 'openbmc';
    // Whole word, unlike the rest: `ami` is three letters that turn up inside
    // plenty of ordinary ones, and an Oem key is a token rather than prose.
    if (/\bami\b/.test(names) || names.includes('megarac')) return 'ami';
    return '';
}

/* ------------------------------------------------------------------ *
 * HTTP Basic auth
 * ------------------------------------------------------------------ */

/**
 * Answer an auth challenge from a board that has no login page.
 *
 * Registered once, for every pane, because Electron emits this on `app` rather
 * than per session. The guest webContents is matched back to a pane so that a
 * challenge from anywhere else in the app is left entirely alone.
 *
 * Only for `basic`, and only once per pane. A board that rejects the stored
 * credentials would otherwise be answered with the same wrong password on every
 * retry, which is how an account gets locked out.
 */
app.on('login', (event, contents, details, authInfo, callback) => {
    if (authInfo?.isProxy) return;

    const pane = paneForContents(contents?.id);
    if (!pane || pane.vendor !== 'basic' || !pane.password) return;

    // Gated on the user's own switch, not on `fillsForm`: turning auto-login off
    // means "do not sign me in", and that has to hold for the board that asks in
    // a browser dialog just as it does for the one that asks in a form.
    if (!pane.autoLogin) return;

    if (pane.basicAttempted) {
        pane.status = 'failed';
        pane.message = 'The IPMI rejected the stored username or password';
        notify(pane.paneId);
        return;
    }

    pane.basicAttempted = true;
    event.preventDefault();
    callback(pane.username, pane.password);

    pane.loggedIn = true;
    pane.status = 'ready';
    notify(pane.paneId);
});

function paneForContents(id) {
    if (!id) return null;
    for (const pane of panes.values()) {
        if (pane.webContentsId === id) return pane;
    }
    return null;
}

/* ------------------------------------------------------------------ *
 * Opening
 * ------------------------------------------------------------------ */

/**
 * Prepare a pane's BMC session and hand the renderer what it needs to load it.
 *
 * Returns the URL and the partition, and never the password. The renderer
 * cannot do anything with either that it could not do by reading the host
 * record, which is the point: the secret stays on this side and arrives in the
 * guest page later, from here.
 */
async function open(paneId, hostId) {
    close(paneId);

    const resolved = store.resolveBmc(hostId);
    if (!resolved) return { success: false, message: 'That host no longer exists' };

    const problem = validateBmc(resolved);
    if (problem) return { success: false, message: problem };

    // Settled before the URL is built, because the scheme is part of it. Costs
    // at most two handshakes against a device on the local network, and only
    // when the record asked for `auto`.
    const endpoint = await detectEndpoint(resolved.host, resolved.scheme, resolved.port);
    const url = bmcUrl({ ...resolved, ...endpoint });
    const partition = `bmc-${hostId}`;

    const pane = {
        paneId,
        hostId,
        url,
        partition,
        vendor: resolved.vendor,
        username: resolved.username,
        password: resolved.password,
        autoLogin: resolved.autoLogin,
        // Set below, once detection has settled which firmware this is and
        // therefore whether there is a form at all.
        fillsForm: false,
        trustedCert: resolved.trustedCert,
        certPrompt: null,
        webContentsId: 0,
        basicAttempted: false,
        // Counted rather than flagged. See MAX_LOGIN_ATTEMPTS: a board that
        // redirects on the way to its login page spends attempts without ever
        // seeing a form, so "have we tried" is the wrong question.
        loginAttempts: 0,
        loggedIn: false,
        status: 'loading',
        message: '',
    };

    panes.set(paneId, pane);
    installVerifier(partition, paneId);

    /*
     * Detection runs before the page is handed over, not after, because the
     * recipe it picks is needed the moment the login form paints. It is bounded
     * and it cannot fail the open: a board that says nothing stays on `auto`,
     * which the login script reads as "no selectors, use the heuristic".
     */
    if (resolved.vendor === 'auto') {
        try {
            const detected = await detectVendor(new URL(url).origin, partition);
            if (detected) pane.vendor = detected;
        } catch {
            // An address that will not parse as a URL is one the page load is
            // about to reject anyway, with a better message than this could give.
        }
    }

    pane.fillsForm = pane.autoLogin && usesForm(pane.vendor);

    return {
        success: true,
        url,
        partition,
        vendor: pane.vendor,
        autoLogin: pane.autoLogin,
        canRefill: pane.fillsForm,
    };
}

/**
 * Adopt the guest page the renderer has created.
 *
 * The renderer owns the `<webview>` element and therefore its webContents id;
 * this side owns everything that has to be done *to* it. So the id crosses IPC
 * once, on mount, and from then on the guest is driven from here.
 */
function attach(paneId, webContentsId) {
    const pane = panes.get(paneId);
    if (!pane) return { success: false, message: 'That pane has no IPMI session' };

    const contents = webContents.fromId(webContentsId);
    if (!contents || contents.isDestroyed()) {
        return { success: false, message: 'That view is no longer open' };
    }

    /*
     * Once only, per guest.
     *
     * The renderer calls this from `dom-ready`, which fires again on every
     * navigation the page makes, and a BMC UI navigates plenty. Without this
     * guard each load would add another copy of the handlers below, so a login
     * would be attempted once per navigation so far and the pane would report
     * its state several times over.
     */
    if (pane.webContentsId === webContentsId) return { success: true };

    pane.webContentsId = webContentsId;

    /*
     * The iKVM console, and most vendors' firmware update pages, open in a
     * popup. Denying it (which is what the main window does, deliberately)
     * would break the one workflow people actually keep a BMC open for, and
     * sending it to the system browser would send it somewhere with none of
     * this session's cookies, where it would land on a login page.
     *
     * So it gets a real window on the *same* partition, which is the only way
     * it arrives logged in.
     */
    contents.setWindowOpenHandler(({ url }) => {
        if (!/^https?:/i.test(url)) return { action: 'deny' };
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: 1100,
                height: 800,
                backgroundColor: '#16161e',
                webPreferences: {
                    partition: pane.partition,
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: true,
                },
            },
        };
    });

    const onLoaded = () => {
        const current = panes.get(paneId);
        if (!current || current.webContentsId !== webContentsId) return;

        current.status = 'ready';
        current.message = '';
        notify(paneId);

        /*
         * On every finished load until the form has actually been submitted,
         * and not once per pane.
         *
         * Once per pane was wrong, and wrong in a way that made this feature do
         * nothing on the boards it most needs to work on. An AMI-based board
         * (Tyan, and most of the white-box world) answers `/` with a redirect to
         * its real login page. That first load spends the one attempt: the
         * script starts polling, the redirect navigates the page out from under
         * it, and the script dies with it. The login page then loads and is
         * never looked at.
         *
         * `loggedIn` is what stops it rather than a flag set on the way in, so
         * the redirects cost attempts and a submitted form ends it.
         */
        if (current.fillsForm && !current.loggedIn && current.loginAttempts < MAX_LOGIN_ATTEMPTS) {
            performLogin(paneId).catch(() => {});
        }
    };

    contents.on('did-finish-load', onLoaded);

    /*
     * A page that finished before this call gets no event to wait for.
     *
     * The renderer attaches on `dom-ready`, which normally precedes
     * `did-finish-load`, so the handler above is registered in time. Normally is
     * not always: a small or cached page can be done by the time the id has
     * crossed IPC, and the pane would then sit on "loading" with a fully
     * rendered board behind it and no login filled in.
     */
    if (!contents.isLoadingMainFrame()) onLoaded();

    contents.on('did-fail-load', (event, code, description, validatedUrl, isMainFrame) => {
        // -3 is ABORTED, which is what a navigation superseded by another one
        // reports. It is not a failure the user needs to hear about.
        if (!isMainFrame || code === -3) return;

        const current = panes.get(paneId);
        if (!current || current.webContentsId !== webContentsId) return;

        current.status = 'failed';
        current.message = describeLoadFailure(code, description);
        notify(paneId);
    });

    contents.on('destroyed', () => {
        const current = panes.get(paneId);
        if (current && current.webContentsId === webContentsId) current.webContentsId = 0;
    });

    return { success: true };
}

/** Chromium's load errors, in the words the pane should use. */
function describeLoadFailure(code, description) {
    if (code === -202 || code === -200 || code === -201) {
        return 'The IPMI certificate was not accepted';
    }
    if (code === -105) return 'That address did not resolve';
    if (code === -106) return 'This machine is not on a network';
    if (code === -109 || code === -102) return 'Nothing answered on that address and port';
    if (code === -7 || code === -118) return 'The IPMI did not answer in time';
    return description || 'The IPMI web interface could not be loaded';
}

/**
 * Fill in the login form, in the guest page.
 *
 * This is the only place the password is used for a form login, and it does not
 * leave the main process by any route the renderer can observe: the script is
 * built here, run on the guest's webContents from here, and its result is a
 * boolean.
 */
async function performLogin(paneId) {
    const pane = panes.get(paneId);
    if (!pane) return { success: false, message: 'That pane has no IPMI session' };
    if (!usesForm(pane.vendor)) return { success: false, message: 'This IPMI does not use a login form' };
    if (!pane.password) return { success: false, message: 'No IPMI password is stored for this host' };

    const contents = pane.webContentsId ? webContents.fromId(pane.webContentsId) : null;
    if (!contents || contents.isDestroyed()) {
        return { success: false, message: 'That view is no longer open' };
    }

    pane.loginAttempts += 1;
    pane.status = 'logging-in';
    notify(paneId);

    let result;
    try {
        result = await contents.executeJavaScript(loginScript({
            username: pane.username,
            password: pane.password,
            vendor: pane.vendor,
        }), true);
    } catch {
        /*
         * The page navigated while the script was running, taking the script
         * with it. That is not a failure and not an attempt: on these boards it
         * is the redirect towards the login page, which is exactly the load that
         * is about to be worth filling in. So the count is given back, and the
         * `did-finish-load` for wherever the page went next tries again.
         */
        pane.loginAttempts -= 1;
        pane.status = 'ready';
        pane.message = '';
        notify(paneId);
        return { success: false, message: 'The page changed while logging in' };
    }

    if (result?.ok) {
        pane.loggedIn = true;
        pane.status = 'ready';
        pane.message = '';
    } else if (result?.reason === 'no-form') {
        /*
         * No password box anywhere on the page. Two very different situations
         * with one appearance: the session is already live and this is the
         * dashboard, or the fill has quietly failed to find a form it should
         * have found.
         *
         * Told apart by whether we have been here before. The first load with no
         * form is the ordinary "already signed in" case and is silent; a later
         * one, after attempts have been spent, is worth saying out loud, because
         * the alternative is a pane that looks fine and is sitting on a login
         * page nobody filled in.
         */
        pane.status = 'ready';
        pane.message = pane.loginAttempts >= MAX_LOGIN_ATTEMPTS
            ? 'No login form was found to fill in'
            : '';
    } else if (result?.reason === 'no-username-field') {
        pane.status = 'ready';
        pane.message = describeMissingUsername(result.survey);
    } else {
        pane.status = 'ready';
        pane.message = 'The login form could not be filled in automatically';
    }

    notify(paneId);
    return { success: Boolean(result?.ok), message: pane.message, reason: result?.reason || '' };
}

/**
 * Say which kind of "no username box" this was.
 *
 * The three cases want three different things done about them, and one sentence
 * covering all of them tells the user nothing they can act on. Every input on
 * the page being hidden is a form that has not finished rendering, or one behind
 * a tab; nothing but the password box is a page whose fields this script cannot
 * reach, which is worth reporting as such rather than as a failure to look
 * properly.
 */
function describeMissingUsername(survey) {
    if (!survey) return 'Found the password box on this page but no username box';

    if (survey.inputs > 0 && survey.inputs === survey.hidden) {
        return 'The login fields on this page are all hidden. Try signing in by hand';
    }
    if (survey.inputs <= 1) {
        return 'This page has a password box and nothing to put a username in';
    }
    return `Found the password box but no username box among ${survey.inputs} fields`;
}

/**
 * Re-run the login on demand, from the pane's own button.
 *
 * The budget is reset, because a person pressing the button has looked at the
 * page and decided this is worth another go, which is a better signal than the
 * count this was protecting against.
 */
function login(paneId) {
    const pane = panes.get(paneId);
    if (pane) {
        pane.loginAttempts = 0;
        pane.loggedIn = false;
    }
    return performLogin(paneId);
}

function get(paneId) {
    const pane = panes.get(paneId);
    return pane ? publicState(pane) : null;
}

function close(paneId) {
    const pane = panes.get(paneId);
    if (!pane) return { success: true };

    panes.delete(paneId);

    /*
     * The partition's storage goes with the pane. It is in-memory, so this is
     * not about the disk; it is about the next open of the same host starting
     * from a clean session rather than inheriting a half-authenticated one from
     * a pane that was closed mid-login.
     */
    try {
        session.fromPartition(pane.partition).clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
        }).catch(() => {});
    } catch {
        // The partition never got as far as existing.
    }

    verified.delete(pane.partition);
    return { success: true };
}

/** Called when a tab closes, for whatever it was holding. */
function cleanup(paneId) {
    close(paneId);
}

module.exports = {
    setNotifier,
    setTrustRequester,
    open,
    attach,
    login,
    get,
    close,
    cleanup,
    detectVendor,
    vendorFromServiceRoot,
};
