const { app, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Finding out that a newer release exists.
 *
 * Deliberately a notifier and not an updater. Installing a downloaded binary
 * means trusting it, and the only thing that makes that trust checkable is a
 * code signature -- an Authenticode certificate on Windows, a Developer ID and
 * notarization on macOS -- neither of which this project pays for. An updater
 * without them would be an unauthenticated remote code execution channel into a
 * machine that holds SSH keys, which is a strange thing to build into an SSH
 * client. So: the app learns a release exists and hands over a link. The
 * download happens in the browser, where the OS still gets to have an opinion
 * about what it just received.
 *
 * Nothing here touches the account or the vault. A release notice that only
 * reached signed-in users with an unlocked vault would be a security fix
 * quietly withheld from the people least likely to notice it was missing.
 */

const REPO = process.env.CLOUDBLAST_UPDATE_REPO || 'BradPerbs/cloudterm';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// For installs that are updated by something else -- a package manager, an
// enterprise deployment -- where a notice the user cannot act on is only noise.
const DISABLED = process.env.CLOUDBLAST_UPDATE_DISABLED === '1';

const SCHEMA_VERSION = 1;

/*
 * GitHub allows 60 unauthenticated requests an hour per *IP*, and behind a
 * corporate NAT that ceiling is shared with everyone else in the building. Ten
 * manual checks an hour is more than anyone needs and leaves the rest of the
 * budget for the people sitting next to them.
 *
 * The window is a rolling hour rather than a counter that resets on the hour,
 * so the tenth check does not buy a full budget one minute later.
 */
const MANUAL_LIMIT = 10;
const MANUAL_WINDOW_MS = 60 * 60 * 1000;

const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;

// A launch check, but not *during* the launch: the first seconds belong to the
// window and to the sessions being restored into it.
const LAUNCH_DELAY_MS = 30 * 1000;

const REQUEST_TIMEOUT_MS = 15 * 1000;

// Release notes are prose of unbounded length; the panel shows a line of it.
const NOTES_LIMIT = 600;

const statePath = () => path.join(app.getPath('userData'), 'updates.json');

let state = null;
let inFlight = null;
let notifier = null;
let pollTimer = null;

// Not persisted. A failure from three days ago is not something to greet the
// user with on the next launch.
let lastError = '';

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function load() {
    if (state) return state;

    try {
        const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));

        state = {
            etag: typeof raw.etag === 'string' ? raw.etag : '',
            checkedAt: raw.checkedAt || null,
            latest: raw.latest || null,
            dismissed: typeof raw.dismissed === 'string' ? raw.dismissed : '',
            // Kept on disk so the limit survives a restart. Reopening the app
            // to get ten more checks would make it a suggestion.
            manual: Array.isArray(raw.manual) ? raw.manual.filter(Number.isFinite) : [],
        };
    } catch {
        state = { etag: '', checkedAt: null, latest: null, dismissed: '', manual: [] };
    }

    return state;
}

function persist() {
    try {
        fs.writeFileSync(statePath(), JSON.stringify({ version: SCHEMA_VERSION, ...state }, null, 2));
    } catch (error) {
        // A check that cannot record itself still worked; it just re-checks
        // sooner than it needed to.
        console.error('Failed to save the update state:', error.message);
    }
}

const emit = () => notifier?.('updates-state', status());

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

/**
 * Semver as far as release tags use it: `v1.2.3`, `1.2.3-beta.1`. Positive when
 * `a` is the newer of the two.
 *
 * Comparing the strings is the bug this exists to avoid: `'1.10.0' < '1.9.0'`
 * is true of the text and false of the versions, and getting it wrong means an
 * entire minor release where nobody is told there is an update.
 */
function compareVersions(a, b) {
    const parse = (value) => {
        const [core, pre = ''] = String(value || '').trim().replace(/^v/i, '').split('-');
        return { parts: core.split('.').map(part => parseInt(part, 10) || 0), pre };
    };

    const left = parse(a);
    const right = parse(b);

    for (let i = 0; i < 3; i += 1) {
        const diff = (left.parts[i] || 0) - (right.parts[i] || 0);
        if (diff) return diff > 0 ? 1 : -1;
    }

    // 1.2.0 is newer than 1.2.0-rc.1. Two prereleases of the same version fall
    // back to text order, which is right for rc.1 -> rc.2 and near enough for
    // everything else a tag is likely to say.
    if (left.pre === right.pre) return 0;
    if (!left.pre) return 1;
    if (!right.pre) return -1;
    return left.pre > right.pre ? 1 : -1;
}

/**
 * The file this machine should actually download.
 *
 * Sending someone to a release page with six artifacts on it and letting them
 * work out which one is theirs is the worse half of this feature. An unmatched
 * platform falls back to the page, which is the honest answer when there is no
 * build for it.
 */
function assetFor(assets) {
    const arm = process.arch === 'arm64';
    const find = (test) => assets.find(asset => test(String(asset.name || '').toLowerCase()));

    if (process.platform === 'win32') {
        return find(name => name.endsWith('.exe'));
    }

    if (process.platform === 'darwin') {
        // Arch-tagged first; a universal or single-arch build that says nothing
        // about its architecture is still better than no link at all.
        return find(name => name.endsWith('.dmg') && name.includes('arm64') === arm)
            || find(name => name.endsWith('.dmg'));
    }

    return find(name => name.endsWith('.appimage')) || null;
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

/**
 * Electron's net stack rather than Node's, for the same reason the account
 * module uses it: this runs behind corporate proxies constantly, and a bare
 * Node request ignores both the system proxy and the certificate store that
 * makes such a proxy work.
 */
async function request() {
    const current = load();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await net.fetch(RELEASES_API, {
            signal: controller.signal,
            headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                // GitHub refuses requests without one. Deliberately just the
                // product name: the hostname, the version and the account are
                // nobody's business on a call that is otherwise anonymous.
                'User-Agent': 'CloudBlast-SSH',
                // The reason the ETag is kept at all: a 304 does not count
                // against the hourly rate limit, so the common case -- nothing
                // has changed -- is free.
                ...(current.etag ? { 'If-None-Match': current.etag } : {}),
            },
        });

        const text = response.status === 304 ? '' : await response.text();
        let payload = null;

        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            // An HTML error page from a proxy. Reported by status below.
        }

        return {
            ok: response.ok,
            status: response.status,
            payload,
            etag: response.headers.get('etag') || '',
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function run() {
    const current = load();

    try {
        const response = await request();

        current.checkedAt = new Date().toISOString();

        // Nothing has changed since the last check; the cached release stands.
        if (response.status === 304) {
            lastError = '';
            persist();
            emit();
            return { success: true, message: '', status: status() };
        }

        // A repository with no published release yet. Not an error, and not
        // one the user could do anything about.
        if (response.status === 404) {
            lastError = '';
            current.latest = null;
            persist();
            emit();
            return { success: true, message: '', status: status() };
        }

        if (response.status === 403 || response.status === 429) {
            throw new Error('GitHub is rate limiting update checks. Try again later.');
        }

        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

        const release = response.payload;

        if (!release?.tag_name) throw new Error('GitHub returned an unreadable release');

        const asset = assetFor(release.assets || []);
        const page = release.html_url || RELEASES_PAGE;

        current.etag = response.etag || current.etag;
        current.latest = {
            version: String(release.tag_name).replace(/^v/i, ''),
            name: release.name || '',
            url: asset?.browser_download_url || page,
            page,
            notes: String(release.body || '').trim().slice(0, NOTES_LIMIT),
            publishedAt: release.published_at || null,
        };

        lastError = '';
        persist();
        emit();

        return { success: true, message: '', status: status() };
    } catch (error) {
        // An offline laptop, a proxy in the way, GitHub having a bad morning:
        // none of it is worth interrupting anyone over. The message is kept for
        // the About page, where somebody pressed a button and is owed an answer.
        lastError = error.name === 'AbortError'
            ? 'The update check timed out'
            : error.message;

        // `checkedAt` is deliberately untouched -- a check that failed is not a
        // check -- but the attempt still has to be written down, or a button
        // press that failed costs nothing after a restart and the limit becomes
        // a suggestion for anyone offline.
        persist();
        emit();

        return { success: false, message: lastError, status: status() };
    }
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/** Prunes the rolling window and reports what is left of it. */
function budget() {
    const current = load();
    const since = Date.now() - MANUAL_WINDOW_MS;
    const recent = current.manual.filter(at => at > since);

    if (recent.length !== current.manual.length) current.manual = recent;

    return {
        remaining: Math.max(0, MANUAL_LIMIT - recent.length),
        // One check comes back the moment the oldest in the window ages out.
        resetAt: recent.length >= MANUAL_LIMIT
            ? Math.min(...recent) + MANUAL_WINDOW_MS
            : 0,
    };
}

const minutesUntil = (at) => Math.max(1, Math.ceil((at - Date.now()) / 60000));

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

function status() {
    const current = load();
    const { remaining, resetAt } = budget();
    const version = app.getVersion();
    const latest = current.latest;

    const newer = Boolean(latest && compareVersions(latest.version, version) > 0);

    return {
        version,
        checking: Boolean(inFlight),
        checkedAt: current.checkedAt,
        latest,
        newer,
        // Cleared once the user has been sent to the download, so the green dot
        // does not follow them around forever. It returns by itself when a
        // version newer than the dismissed one appears.
        available: newer && current.dismissed !== latest.version,
        manualRemaining: remaining,
        manualLimit: MANUAL_LIMIT,
        manualResetAt: resetAt ? new Date(resetAt).toISOString() : null,
        error: lastError,
        disabled: DISABLED,
        repo: REPO,
    };
}

/**
 * `manual` is the button. Only the button spends the budget: the daily check
 * costs one request a day and would otherwise eat into an allowance meant for
 * the person actually asking a question.
 */
async function check({ manual = false } = {}) {
    if (DISABLED) {
        return { success: false, message: 'Update checks are turned off', status: status() };
    }

    // The timer and the button can land together, and one request answers both.
    if (inFlight) return inFlight;

    const current = load();

    if (manual) {
        const { remaining, resetAt } = budget();

        if (!remaining) {
            return {
                success: false,
                message: `Too many checks. Try again in ${minutesUntil(resetAt)} minutes.`,
                status: status(),
            };
        }

        current.manual.push(Date.now());
    }

    inFlight = run().finally(() => {
        inFlight = null;
    });

    // Lets the button go into its pending state without waiting for the
    // request, since `checking` reads from `inFlight`.
    emit();

    return inFlight;
}

/**
 * Opens the download in the system browser, never in a window of ours. An
 * in-app fetch would strip the mark of the web, which is the thing that makes
 * SmartScreen and Gatekeeper able to say anything about the file at all --
 * and with nothing signed, those warnings are the only check left.
 */
async function open() {
    const current = load();
    const target = current.latest?.url || RELEASES_PAGE;

    await shell.openExternal(target);

    if (current.latest) dismiss(current.latest.version);

    return true;
}

function dismiss(version) {
    const current = load();

    current.dismissed = version || current.latest?.version || '';
    persist();
    emit();

    return status();
}

function start(notify) {
    notifier = notify;

    if (DISABLED) return;

    const current = load();
    const age = current.checkedAt ? Date.now() - Date.parse(current.checkedAt) : NaN;

    // A check that already happened today does not need repeating because the
    // app restarted; an app left running for a week does need one.
    const first = Number.isFinite(age) && age >= 0 && age < AUTO_INTERVAL_MS
        ? AUTO_INTERVAL_MS - age
        : LAUNCH_DELAY_MS;

    const tick = () => {
        check().catch(() => {
            // `run` already folds every failure into the status it returns.
        });
        pollTimer = setTimeout(tick, AUTO_INTERVAL_MS);
        pollTimer.unref?.();
    };

    pollTimer = setTimeout(tick, first);
    // A day-long timer is not a reason to keep the process alive on a platform
    // where closing the window is meant to end it.
    pollTimer.unref?.();
}

module.exports = { start, check, status, open, dismiss, compareVersions };
