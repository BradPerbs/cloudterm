const { app, shell, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vault = require('./vault');

/**
 * Signing in to a CloudBlast account.
 *
 * OAuth 2.0 authorization code with PKCE, in the shape RFC 8252 prescribes for
 * a native application:
 *
 *   1. Generate a random verifier and its SHA-256 challenge.
 *   2. Listen on an ephemeral loopback port.
 *   3. Open the *system browser* at the console's consent screen.
 *   4. Receive a single-use code on the loopback redirect.
 *   5. Exchange code + verifier for a device-scoped token.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 * The browser is the real browser, never a BrowserWindow. An embedded window
 * can read what is typed into it, hides the address bar the user needs in order
 * to know they are on the real console, and cannot see their password manager
 * or their existing session. This client is open source, so "it is our window"
 * is not a claim a user can check -- the system browser is.
 *
 * There is no client secret. The source is published, so anything embedded here
 * is public by construction. PKCE is what makes that safe: the code is useless
 * without the verifier, and the verifier never leaves this process.
 */

const API_BASE = (process.env.CLOUDBLAST_API_URL || 'https://console.cloudblast.io').replace(/\/+$/, '');
const CLIENT_ID = 'cloudblast-desktop';

const SCHEMA_VERSION = 1;

// Long enough to find the browser window, log in and read the consent screen;
// short enough that an abandoned attempt does not leave a listener open.
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 20 * 1000;

const accountPath = () => path.join(app.getPath('userData'), 'account.json');

// The signed-in session, once loaded. `null` means "not loaded yet"; a loaded
// but signed-out state is represented by an object with no token.
let session = null;

// The sign-in currently in flight, if any. Only one at a time: a second browser
// window racing the first would leave an orphaned listener behind.
let pending = null;

/* ------------------------------------------------------------------ *
 * PKCE
 * ------------------------------------------------------------------ */

const base64url = (buffer) => buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** 32 bytes -> 43 unreserved characters, the shortest length RFC 7636 allows. */
const createVerifier = () => base64url(crypto.randomBytes(32));

const challengeFor = (verifier) =>
    base64url(crypto.createHash('sha256').update(verifier).digest());

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * The token is written under the vault's data key, exactly like a saved host
 * password. That means an opening password protects it too, and that a locked
 * vault makes it unreadable -- which is the intended behaviour, not a gap.
 */
function persist(next) {
    const payload = {
        version: SCHEMA_VERSION,
        account: next.account || null,
        connectedAt: next.connectedAt || null,
        token: next.token ? vault.encryptSecret(next.token) : '',
    };

    fs.writeFileSync(accountPath(), JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function load() {
    if (session) return session;

    try {
        const raw = JSON.parse(fs.readFileSync(accountPath(), 'utf8'));

        session = {
            account: raw.account || null,
            connectedAt: raw.connectedAt || null,
            // Returns '' while the vault is locked, so a locked app reads as
            // signed out rather than throwing on every status poll.
            token: raw.token ? vault.decryptSecret(raw.token) : '',
        };
    } catch {
        session = { account: null, connectedAt: null, token: '' };
    }

    return session;
}

function clear() {
    session = { account: null, connectedAt: null, token: '' };

    try {
        fs.rmSync(accountPath(), { force: true });
    } catch (error) {
        console.error('Failed to remove the stored account:', error.message);
    }
}

// A vault unlocked after startup has to invalidate the cached read, or the
// session stays empty until the next launch.
vault.onUnlocked(() => {
    session = null;
});

/* ------------------------------------------------------------------ *
 * Loopback listener
 * ------------------------------------------------------------------ */

// The cloud mark, inlined: this page is served by a throwaway loopback server
// with no static routes, so there is nowhere to link an asset from.
const LOGO = `<svg class="logo" viewBox="0 0 159 132" fill="none" xmlns="http://www.w3.org/2000/svg">
<path opacity=".8" d="M147.903 56.4801C141.988 49.2327 133.837 44.2036 124.756 42.1989C122.761 32.9202 119.089 24.852 113.901 18.236C113.761 18.0066 113.6 17.7907 113.422 17.5905C95.9418-3.7907 67.2871-3.71003 47.9709 7.34358C31.4483 16.8645 17.4005 36.9545 24.7436 65.7584C7.82222 69.9542 0 84.8806 0 98.3547C0 113.443 9.73786 130.467 31.5282 132H114.061C125.395 132 136.17 127.804 144.471 120.059C164.585 102.308 161.952 73.1814 147.903 56.4801Z" fill="url(#g)"/>
<defs><linearGradient id="g" x1="79.5" y1="0" x2="79.5" y2="132" gradientUnits="userSpaceOnUse">
<stop stop-color="#307AF0"/><stop offset="1" stop-color="#0FCBE3"/></linearGradient></defs></svg>`;

const ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

// The hostname reaches this page, and a hostname is not ours to trust.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/**
 * The page the browser lands on after the console redirects back. Styled to
 * match the console's own auth screens, since the two are read back to back:
 * same card, same type, same tokens. The console follows the panel's stored
 * theme; this page is on a different origin and cannot read it, so it follows
 * the operating system instead.
 *
 * It is the last thing the user sees before coming back to the app, so it does
 * the small amount of work a confirmation screen owes them: says plainly what
 * happened, names the device that was connected, and tells them they are done.
 */
const RESULT_PAGE = ({ title, message, device, tone }) => {
    const hue = tone === 'ok' ? 'ok' : 'bad';

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
:root{--page:#fafafa;--card:#fff;--shadow:0 2px 8px -2px rgba(0,0,0,.08);--text:#000;--muted:#666;
--surface:#fafafa;--border:#eaeaea;--ok:#16a34a;--ok-soft:rgba(22,163,74,.12);--bad:#e00;--bad-soft:rgba(238,0,0,.1)}
@media (prefers-color-scheme:dark){:root{--page:#000;--card:#111219;--shadow:none;--text:#fff;--muted:#d1d5db;
--surface:#171728;--border:#383b49;--ok:#4ade80;--ok-soft:rgba(74,222,128,.16);--bad:#f33;--bad-soft:rgba(255,51,51,.14)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
background:var(--page);color:var(--text);-webkit-font-smoothing:antialiased;
font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:26rem;padding:52px 32px 44px;border-radius:18px;text-align:center;
background:var(--card);box-shadow:var(--shadow);animation:rise .45s cubic-bezier(.2,.7,.3,1) both}
.logo{width:52px;height:43px;display:block;margin:0 auto}
.status{position:relative;width:56px;height:56px;margin:26px auto 0;display:flex;align-items:center;
justify-content:center;border-radius:50%;background:var(--${hue}-soft);color:var(--${hue});
animation:pop .5s cubic-bezier(.2,.8,.3,1) .1s both}
.status:before{content:"";position:absolute;inset:0;border-radius:50%;border:1px solid var(--${hue});
opacity:.25;animation:halo 1.1s cubic-bezier(.2,.7,.3,1) .3s both}
.status svg{width:26px;height:26px}
.status polyline{stroke-dasharray:24;stroke-dashoffset:24;animation:draw .45s ease-out .4s both}
h1{font-size:21px;font-weight:600;letter-spacing:-.015em;margin:22px 0 8px}
p{color:var(--muted);font-size:14px;margin:0}
.device{display:inline-block;margin-top:20px;padding:8px 14px;max-width:100%;border-radius:15px;
background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:13px;
font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.close{margin-top:22px;font-size:13px;color:var(--muted)}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:scale(.7)}60%{transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@keyframes halo{from{opacity:.35;transform:scale(1)}to{opacity:0;transform:scale(1.5)}}
@keyframes draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){
.card,.status,.status:before{animation:none}
.status:before{opacity:.25}
.status polyline{animation:none;stroke-dashoffset:0}}
</style></head>
<body><div class="card">${LOGO}
<div class="status">${ICONS[tone === 'ok' ? 'ok' : 'error']}</div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${device ? `<div class="device">${escapeHtml(device)}</div>` : ''}
<p class="close">You can close this tab.</p>
</div></body></html>`;
};

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

/**
 * Uses Electron's net stack rather than Node's, so the request honours the
 * system proxy and certificate store. An SSH client is very often run from
 * behind a corporate proxy, where a bare Node request simply fails.
 */
async function apiFetch(pathname, { method = 'GET', body, token } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await net.fetch(`${API_BASE}${pathname}`, {
            method,
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });

        const text = await response.text();
        let payload = null;

        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            // An HTML error page from a proxy or a maintenance screen. Reported
            // by status below rather than as a parse failure the user cannot act on.
        }

        return { ok: response.ok, status: response.status, payload };
    } finally {
        clearTimeout(timer);
    }
}

/** The console's error envelope is `{ error: { code, message } }`. */
const apiError = (result, fallback) =>
    result.payload?.error?.message || `${fallback} (HTTP ${result.status})`;

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

function deviceName() {
    const host = os.hostname() || 'Unknown device';
    return `CloudBlast on ${host}`.slice(0, 60);
}

/**
 * Runs the whole flow and resolves with the connected account.
 *
 * Every failure path closes the listener. A loopback port left open after a
 * failed sign-in is a socket accepting authorization codes for a flow nobody is
 * waiting on any more.
 */
async function signIn() {
    if (pending) throw new Error('A sign-in is already in progress');

    const verifier = createVerifier();
    const state = base64url(crypto.randomBytes(24));

    const server = http.createServer();
    let resolveCallback;
    let rejectCallback;
    let settled = false;

    const callback = new Promise((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
    });

    server.on('request', (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');

        if (url.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
        }

        if (settled) {
            response.writeHead(400).end();
            return;
        }

        settled = true;

        const params = Object.fromEntries(url.searchParams);
        const denied = params.error === 'access_denied';

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(params.code
            ? RESULT_PAGE({
                title: "You're signed in",
                message: 'Your CloudBlast account is connected on this device.',
                device: deviceName(),
                tone: 'ok',
            })
            : RESULT_PAGE({
                title: denied ? 'Sign-in cancelled' : 'Sign-in failed',
                message: denied
                    ? 'Nothing was connected and nothing was shared.'
                    : 'The console did not send anything back. Start the sign-in again from the app.',
                tone: 'error',
            }));

        resolveCallback(params);
    });

    const close = () => {
        settled = true;
        try {
            // The browser holds the callback connection open with keep-alive,
            // so close() alone would wait on a socket nobody is using any more.
            server.closeAllConnections?.();
            server.close();
        } catch {
            // Already closed by a completed response.
        }
    };

    const timer = setTimeout(() => {
        rejectCallback(new Error('The sign-in timed out. Try again.'));
    }, FLOW_TIMEOUT_MS);

    pending = { cancel: () => rejectCallback(new Error('Sign-in cancelled')) };

    try {
        // Loopback specifically, not 0.0.0.0: only this machine can reach the
        // listener, so an authorization code cannot be delivered to us by
        // anything else on the network. The port is whatever the OS hands out,
        // which is why the console validates the redirect without it.
        const port = await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        });

        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const authorizeUrl = `${API_BASE}/authorize/desktop?` + new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: redirectUri,
            code_challenge: challengeFor(verifier),
            code_challenge_method: 'S256',
            state,
            device_name: deviceName(),
        });

        await shell.openExternal(authorizeUrl);

        const params = await callback;

        if (params.error) {
            throw new Error(params.error === 'access_denied'
                ? 'Sign-in was cancelled in the browser'
                : 'The console refused the sign-in request');
        }

        // A mismatched state means this callback belongs to a different flow --
        // possibly one someone else started. The code is not exchanged.
        if (!params.state || params.state !== state) {
            throw new Error('The sign-in response did not match this request and was discarded');
        }

        if (!params.code) throw new Error('The console did not return an authorization code');

        const result = await apiFetch('/api/v2/oauth/token', {
            method: 'POST',
            body: {
                client_id: CLIENT_ID,
                code: params.code,
                code_verifier: verifier,
                redirect_uri: redirectUri,
            },
        });

        if (!result.ok) throw new Error(apiError(result, 'The console rejected the sign-in'));

        const data = result.payload?.data;

        if (!data?.access_token) throw new Error('The console returned no access token');

        session = {
            token: data.access_token,
            account: data.account || null,
            connectedAt: new Date().toISOString(),
        };

        persist(session);

        return status();
    } finally {
        clearTimeout(timer);
        close();
        pending = null;
    }
}

function cancelSignIn() {
    pending?.cancel();
}

/**
 * Signing out revokes the token at the console first. Deleting it locally alone
 * would leave a working credential on the server that the user believes they
 * have disconnected.
 *
 * The local state is cleared either way: a user who is offline, or whose token
 * the console has already revoked, must still be able to sign out.
 */
async function signOut() {
    const current = load();
    let revoked = false;

    if (current.token) {
        try {
            const result = await apiFetch('/api/v2/oauth/revoke', {
                method: 'POST',
                token: current.token,
            });
            revoked = result.ok || result.status === 401;
        } catch (error) {
            console.error('Failed to revoke the account token:', error.message);
        }
    }

    clear();

    return { revoked };
}

/* ------------------------------------------------------------------ *
 * Reading the account
 * ------------------------------------------------------------------ */

function status() {
    const current = load();

    return {
        connected: Boolean(current.token),
        account: current.account,
        connectedAt: current.connectedAt,
        apiUrl: API_BASE,
        // The console holds the token, so a locked vault is indistinguishable
        // from signed out unless the UI is told which it is.
        locked: vault.isLocked(),
    };
}

/** Refreshes the cached profile, and tells us whether the token still works. */
async function refresh() {
    const current = load();

    if (!current.token) return status();

    const result = await apiFetch('/api/v2/account', { token: current.token });

    // A revoked or expired token means signed out. Anything else (a 500, a
    // proxy swallowing the request) leaves the session alone -- an outage at
    // the console should not disconnect a working install.
    if (result.status === 401) {
        clear();
        throw new Error('This device was disconnected from your CloudBlast account');
    }

    if (!result.ok) throw new Error(apiError(result, 'Could not reach the console'));

    const data = result.payload?.data;

    if (data) {
        session = {
            ...current,
            account: {
                id: data.id ?? current.account?.id ?? null,
                name: data.name ?? current.account?.name ?? null,
                email: data.email ?? current.account?.email ?? null,
            },
        };
        persist(session);
    }

    return status();
}

/**
 * Every server on the account, ready to be offered as hosts.
 *
 * The console paginates this at 25. Following the pages matters: a sync that
 * only read the first one would not just miss servers, it would decide the
 * missing ones had been deleted and remove their hosts.
 */
async function servers() {
    const current = load();

    if (!current.token) throw new Error('Not signed in');

    const collected = [];
    let page = 1;
    let lastPage = 1;

    // A ceiling rather than a while(true): a console that always reports one
    // more page should stop the sync, not spin forever.
    while (page <= lastPage && page <= 100) {
        const result = await apiFetch(`/api/v2/servers?page=${page}`, { token: current.token });

        if (result.status === 401) {
            clear();
            throw new Error('This device was disconnected from your CloudBlast account');
        }

        if (!result.ok) throw new Error(apiError(result, 'Could not load your servers'));

        const list = result.payload?.data;

        if (!Array.isArray(list)) break;

        collected.push(...list);

        // Absent on a non-paginated response, which then ends the loop.
        lastPage = Number(result.payload?.meta?.last_page) || 1;
        page += 1;
    }

    return collected;
}

/**
 * The SSH credentials for one server.
 *
 * Separate from servers() because the console returns these per server, and
 * because they are the sensitive half: a caller that only wants to list what
 * exists should not be handed root passwords to do it.
 *
 * `password_status` is reported rather than smoothed over -- a server still
 * installing has no password yet, and treating that as "no password" would
 * overwrite a working one on the next sync.
 */
async function credentials(uuid) {
    const current = load();

    if (!current.token) throw new Error('Not signed in');

    const result = await apiFetch(`/api/v2/servers/${encodeURIComponent(uuid)}/credentials`, {
        token: current.token,
    });

    if (result.status === 401) {
        clear();
        throw new Error('This device was disconnected from your CloudBlast account');
    }

    if (!result.ok) throw new Error(apiError(result, 'Could not load server credentials'));

    const data = result.payload?.data || {};

    return {
        username: data.username || 'root',
        password: data.root_password || '',
        passwordStatus: data.password_status || 'ready',
        ipv4: data.ipv4 || '',
        ipv6: data.ipv6 || '',
    };
}

/* ------------------------------------------------------------------ *
 * Setup snapshot
 *
 * The console stores an opaque blob and the key it was encrypted under. These
 * are thin wrappers: nothing here inspects a payload, and the encryption
 * happens in cloud-snapshot.js.
 * ------------------------------------------------------------------ */

async function authed(pathname, options = {}) {
    const current = load();

    if (!current.token) throw new Error('Not signed in');

    const result = await apiFetch(pathname, { ...options, token: current.token });

    if (result.status === 401) {
        clear();
        throw new Error('This device was disconnected from your CloudBlast account');
    }

    return result;
}

/** The account's snapshot key, created on the console if this is the first device. */
async function snapshotKey() {
    const result = await authed('/api/v2/sync/key', { method: 'POST', body: {} });

    if (!result.ok) throw new Error(apiError(result, 'Could not read your account key'));

    return result.payload?.data?.key || '';
}

/** Revision and size only, cheap enough to check on a timer. */
async function snapshotMeta() {
    const result = await authed('/api/v2/sync/snapshot/meta');

    if (!result.ok) throw new Error(apiError(result, 'Could not check your saved setup'));

    return result.payload?.data || { exists: false, revision: 0 };
}

/** The stored blob, or null when this account has never saved one. */
async function snapshotGet() {
    const result = await authed('/api/v2/sync/snapshot');

    if (result.status === 404) return null;

    if (!result.ok) throw new Error(apiError(result, 'Could not load your saved setup'));

    return result.payload?.data || null;
}

/**
 * Store a blob, on the condition that `baseRevision` is still current.
 *
 * A conflict is returned rather than thrown: it is the expected outcome when
 * another device saved first, and the caller's job is to merge and retry, not
 * to treat it as a failure.
 */
async function snapshotPut({ payload, baseRevision, deviceName, stats }) {
    const result = await authed('/api/v2/sync/snapshot', {
        method: 'POST',
        body: {
            payload,
            base_revision: baseRevision,
            device_name: deviceName,
            // Counts only, so an operator can see the feature working without
            // anyone opening a customer's snapshot. See cloud-snapshot.describe.
            stats,
        },
    });

    if (result.status === 409) {
        return { conflict: true, revision: result.payload?.error?.revision ?? null };
    }

    if (!result.ok) throw new Error(apiError(result, 'Could not save your setup'));

    return { conflict: false, revision: result.payload?.data?.revision ?? null };
}

module.exports = {
    status,
    signIn,
    cancelSignIn,
    signOut,
    refresh,
    servers,
    credentials,
    snapshotKey,
    snapshotMeta,
    snapshotGet,
    snapshotPut,
    deviceName,
};
