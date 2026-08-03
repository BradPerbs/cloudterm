const { app, net, shell } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Finding out that a newer release exists, and installing it where that can be
 * done safely.
 *
 * Two modes, and which one is in force is not a preference. It is a question of
 * what the running copy can get verified on its behalf:
 *
 *   install  electron-updater fetches the release and hands the file to the
 *            platform's own updater, which checks its code signature against
 *            the signature of the copy already installed before replacing
 *            anything. That check is the whole basis for trusting a binary
 *            that arrived over the network.
 *   notify   the app learns a release exists and hands over a link. The
 *            download happens in the browser, where the OS still gets to have
 *            an opinion about what it just received.
 *
 * `notify` was the only mode this file had, for the reason set out in
 * `installable` below: an updater with nothing checking signatures is an
 * unauthenticated remote code execution channel into a machine that holds SSH
 * keys, which is a strange thing to build into an SSH client. That reasoning
 * has not changed. What changed is that the NSIS installer on Windows can be
 * updated through a channel that at least verifies the payload against the
 * manifest, and the mac and AppImage paths light up on their own the moment
 * the thing they need is true.
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
 *
 * Install mode reads the releases feed rather than the API and is not bound by
 * that ceiling, but it spends the same budget: one limit is easier to explain
 * than two, and nobody presses this button ten times in an hour for a reason.
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

// Runtime only, all of it. A download that did not finish before the app closed
// is not a download, and a build sitting in the cache from last week is either
// already installed (it installs on quit) or was superseded.
let downloading = false;
let percent = 0;
let readyVersion = '';

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
        // Two Windows artifacts now, an installer and a portable exe, and
        // handing someone the other kind would be a surprise either way: an
        // installed copy left behind by a portable download, or an installer
        // offered to somebody running from a memory stick precisely because
        // they cannot install anything.
        //
        // electron-builder sets PORTABLE_EXECUTABLE_DIR in a portable build and
        // nowhere else, which is the one dependable way to tell them apart.
        const isSetup = (name) => name.includes('setup');
        const wanted = portableBuild()
            ? (name) => name.endsWith('.exe') && !isSetup(name)
            : (name) => name.endsWith('.exe') && isSetup(name);

        // Either kind still beats the release page and a guess.
        return find(wanted) || find(name => name.endsWith('.exe'));
    }

    if (process.platform === 'darwin') {
        // Arch-tagged first; a universal or single-arch build that says nothing
        // about its architecture is still better than no link at all.
        //
        // The dmg and not the zip: the zip exists for Squirrel, which knows to
        // ask for it by name, and a person handed one gets an app with no
        // window telling them where to put it.
        return find(name => name.endsWith('.dmg') && name.includes('arm64') === arm)
            || find(name => name.endsWith('.dmg'));
    }

    return find(name => name.endsWith('.appimage')) || null;
}

/* ------------------------------------------------------------------ *
 * Which mode this copy runs in
 * ------------------------------------------------------------------ */

const portableBuild = () => Boolean(process.env.PORTABLE_EXECUTABLE_DIR);

// Set when the releases feed has no manifest for this platform, which is what
// every release published before this file existed looks like. Not persisted:
// the next launch should try install mode again, because by then the release
// it is looking at may well be one that carries a manifest.
let manifestMissing = false;

let macSigned = null;

/**
 * Whether macOS will let Squirrel swap the bundle out from under us.
 *
 * It will not, for an unsigned build. Squirrel.Mac verifies that the update's
 * code signature satisfies the running app's designated requirement, and a
 * build with no signature has no requirement to satisfy, so the swap is
 * refused after the download has already cost the user a hundred megabytes.
 * Asking `codesign` first is what keeps that download from happening at all.
 *
 * Asked of the OS rather than baked in at build time, so nobody has to
 * remember to flip a flag: the day a Developer ID certificate signs a release,
 * that release updates itself and every one after it.
 *
 * Ad-hoc signatures are the trap here. `codesign -dv` is perfectly happy with
 * one and Squirrel is not, because an ad-hoc signature identifies nothing and
 * so cannot match anything.
 */
function signedOnMac() {
    if (macSigned !== null) return macSigned;

    macSigned = false;

    try {
        // .../CloudTerm.app/Contents/Resources/app.asar, three levels below the
        // bundle whose signature is the one that matters.
        const bundle = path.resolve(app.getAppPath(), '..', '..', '..');
        const result = spawnSync('codesign', ['-dv', '--verbose=2', bundle], {
            encoding: 'utf8',
            timeout: 5000,
        });
        const output = `${result.stderr || ''}${result.stdout || ''}`;

        macSigned = result.status === 0
            && /^Authority=/m.test(output)
            && !/Signature=adhoc/i.test(output);
    } catch {
        // No codesign binary, or it hung. Either way this is not a machine to
        // start replacing application bundles on.
    }

    return macSigned;
}

/**
 * Whether this copy can install a release rather than link to one.
 *
 * Every branch is a thing that has to be true before an update is allowed to
 * overwrite the app, and none of them is about convenience:
 *
 *   unpackaged  There is nothing to replace. `npm run dev` is not a release.
 *   portable    A portable exe is a single file somebody carries around,
 *               often on media they cannot write to, and it has no installer
 *               to hand a payload to. Being unable to install anything is the
 *               reason they are running it.
 *   darwin      See `signedOnMac`.
 *   linux       AppImage updates in place, which needs to know which file it
 *               is. Its own runtime sets APPIMAGE; an extracted or repackaged
 *               copy is somebody else's to update.
 */
function installable() {
    if (DISABLED) return false;
    if (!app.isPackaged) return false;
    if (manifestMissing) return false;

    if (process.platform === 'win32') return !portableBuild();
    if (process.platform === 'darwin') return signedOnMac();
    if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);

    return false;
}

const mode = () => (installable() ? 'install' : 'notify');

/* ------------------------------------------------------------------ *
 * Install mode
 * ------------------------------------------------------------------ */

let updater = null;

/**
 * electron-updater, wired up on first use.
 *
 * Required lazily and never at module load: notify mode is a fetch and a link
 * and has no business paying for the module, and on a portable build or an
 * unsigned mac it would be loaded only to sit there unused.
 */
function api() {
    if (updater) return updater;

    ({ autoUpdater: updater } = require('electron-updater'));

    // Downloading is the cheap half and the half a user cannot start early.
    // Installing is the half that closes their terminals, so it waits to be
    // asked, or for a quit they were making anyway.
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;

    // The default logger narrates every check to stdout. Errors are worth
    // keeping, because they are what the About page is reporting a summary of.
    updater.logger = {
        info() {},
        warn() {},
        debug() {},
        error: (...args) => console.error('[updates]', ...args),
    };

    // Only when overridden. Left alone, electron-updater reads the app-update.yml
    // that electron-builder packaged, which is the repo the build came from and
    // a better answer than anything reconstructed here.
    if (process.env.CLOUDBLAST_UPDATE_REPO) {
        const [owner, repo] = REPO.split('/');
        updater.setFeedURL({ provider: 'github', owner, repo });
    }

    updater.on('update-available', (info) => {
        const current = load();

        current.latest = fromUpdateInfo(info);
        lastError = '';

        // autoDownload means this has already started. Said here rather than on
        // a later event because there is no event for a download beginning, and
        // a progress bar that appears only once bytes arrive reads as a stall.
        downloading = updater.autoDownload && current.latest.version !== readyVersion;
        percent = 0;

        persist();
        emit();
    });

    updater.on('update-not-available', (info) => {
        const current = load();

        // Recorded even though it is not newer: it is still the newest release
        // there is, and `status` decides what that means by comparing it with
        // the running version rather than trusting the event's name.
        current.latest = fromUpdateInfo(info);
        lastError = '';
        downloading = false;

        persist();
        emit();
    });

    updater.on('download-progress', (progress) => {
        const next = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));

        // This fires per chunk. Rounding to whole percent caps the traffic over
        // the bridge at a hundred messages for a download of any size.
        if (next === percent && downloading) return;

        downloading = true;
        percent = next;
        emit();
    });

    updater.on('update-downloaded', (info) => {
        downloading = false;
        percent = 100;
        readyVersion = String(info?.version || '').replace(/^v/i, '');
        lastError = '';
        emit();
    });

    updater.on('error', (error) => {
        // Fires for a failed check and for a failed download alike. The check
        // path also returns the message to whoever pressed the button; this is
        // the only route a download failure has back to the window.
        if (isMissingManifest(error)) {
            manifestMissing = true;
            lastError = '';
        } else {
            lastError = describe(error);
        }

        downloading = false;
        emit();
    });

    return updater;
}

/**
 * A release with no update manifest attached to it.
 *
 * Every release published before this feature existed is one, so this is the
 * ordinary state of things until the next tag goes out, not a fault. Treated
 * as "install mode does not apply here" and handed to the notifier, which
 * reads the API and can describe a release whatever it was built by. The user
 * gets a link instead of an installer, which is exactly what they had before.
 */
function isMissingManifest(error) {
    const text = `${error?.code || ''} ${error?.message || ''}`;

    return /ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(text)
        || /Cannot find channel/i.test(text)
        || /HttpError: 404/i.test(text);
}

function describe(error) {
    if (!error) return 'The update check failed';
    if (error.name === 'AbortError') return 'The update check timed out';

    const message = String(error.message || error);

    if (/ENOTFOUND|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
        return 'Could not reach GitHub to check for updates';
    }

    return message;
}

/**
 * The release notes as they arrive in install mode.
 *
 * The API hands back the markdown somebody typed. The releases feed hands back
 * the HTML GitHub rendered from it, which would otherwise reach the About page
 * with its tags showing.
 */
function stripHtml(value) {
    return String(value || '')
        .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
        .replace(/<\s*li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\n{3,}/g, '\n\n');
}

/** electron-updater's UpdateInfo, in the shape the renderer already reads. */
function fromUpdateInfo(info) {
    // An array when fullChangelog is on, which it is not, but a release that
    // arrives in the other shape should still say something.
    const notes = Array.isArray(info?.releaseNotes)
        ? info.releaseNotes.map(entry => entry?.note || '').join('\n\n')
        : info?.releaseNotes;

    return {
        version: String(info?.version || '').replace(/^v/i, ''),
        name: info?.releaseName || '',
        // No per-asset link here, and none wanted: in install mode the file is
        // fetched by the updater, and the page is the fallback for somebody who
        // would rather do it themselves.
        url: RELEASES_PAGE,
        page: RELEASES_PAGE,
        notes: stripHtml(notes).trim().slice(0, NOTES_LIMIT),
        publishedAt: info?.releaseDate || null,
    };
}

async function runInstall() {
    const current = load();

    try {
        const result = await api().checkForUpdates();

        // autoDownload leaves this running behind the check. Caught rather than
        // awaited: the button is answering "is there an update", and a hundred
        // megabytes is not something to hold a click open for. The failure is
        // already going to the window through the `error` event, so this only
        // stops node complaining about a rejection nobody handled.
        result?.downloadPromise?.catch(() => {});

        // Set after the await, so a check that threw does not get recorded as
        // one that happened. `manifestMissing` is the exception: the release
        // was read, it simply cannot be installed, so the notifier goes and
        // reads the same release properly rather than leaving the user with
        // nothing.
        if (manifestMissing) return runNotify();

        current.checkedAt = new Date().toISOString();
        lastError = '';
        persist();
        emit();

        return { success: true, message: '', status: status() };
    } catch (error) {
        if (isMissingManifest(error)) {
            manifestMissing = true;
            return runNotify();
        }

        lastError = describe(error);
        persist();
        emit();

        return { success: false, message: lastError, status: status() };
    }
}

/* ------------------------------------------------------------------ *
 * Notify mode
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
                'User-Agent': 'CloudTerm',
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

async function runNotify() {
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
    const ready = Boolean(readyVersion) && compareVersions(readyVersion, version) > 0;

    return {
        version,
        // What the buttons mean. 'install' promises a restart will apply the
        // update; 'notify' promises only a link, and the two must never be
        // worded the same way.
        mode: mode(),
        checking: Boolean(inFlight),
        checkedAt: current.checkedAt,
        latest,
        newer,
        // Cleared once the user has been sent to the download, so the green dot
        // does not follow them around forever. It returns by itself when a
        // version newer than the dismissed one appears.
        //
        // Install mode does not clear it on the way past: there, being sent to
        // the download is not the end of anything, and the dot has a restart
        // still to ask for.
        available: newer && current.dismissed !== latest.version,
        downloading,
        // Null rather than zero when idle, so a bar is drawn only when there is
        // something to draw about.
        progress: downloading ? percent : null,
        // Downloaded and waiting for a restart. The quit that happens anyway
        // will apply it; the button only saves the user waiting for one.
        ready,
        readyVersion: ready ? readyVersion : '',
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

    // Nothing to check for. A second check cannot improve on a build already
    // sitting on disk waiting for a restart, and running one would only give
    // the download a chance to start over.
    if (readyVersion) {
        return { success: true, message: '', status: status() };
    }

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

    inFlight = (installable() ? runInstall() : runNotify()).finally(() => {
        inFlight = null;
    });

    // Lets the button go into its pending state without waiting for the
    // request, since `checking` reads from `inFlight`.
    emit();

    return inFlight;
}

/**
 * Fetch the release, for a download that failed or one nobody started.
 *
 * Not the usual path: autoDownload means an available update is already on its
 * way by the time anyone sees it. This is the retry, and it is why a failed
 * download does not need a fresh check to recover from.
 */
async function download() {
    if (!installable()) return { success: false, message: 'This build installs updates from a browser', status: status() };
    if (readyVersion) return { success: true, message: '', status: status() };

    try {
        downloading = true;
        percent = 0;
        lastError = '';
        emit();

        await api().downloadUpdate();

        return { success: true, message: '', status: status() };
    } catch (error) {
        // The `error` event has already recorded this and pushed it out; the
        // message is repeated here for whoever pressed the button.
        lastError = describe(error);
        downloading = false;
        emit();

        return { success: false, message: lastError, status: status() };
    }
}

/**
 * Close the app and let the installer replace it.
 *
 * Silent, and running again afterwards. The assisted installer asks where to
 * put the app and whether to make shortcuts, which are first-install questions;
 * asking them again of somebody who pressed "Restart to update" would be
 * putting a wizard in the way of a decision they already made.
 *
 * Deferred by a tick so the IPC reply reaches the renderer before the process
 * starts tearing itself down. Without it the window is gone before the click
 * has been answered, which surfaces as an error in a UI that is about to be
 * replaced anyway.
 */
function install() {
    if (!installable() || !readyVersion) return false;

    setImmediate(() => {
        try {
            api().quitAndInstall(true, true);
        } catch (error) {
            lastError = describe(error);
            emit();
        }
    });

    return true;
}

/**
 * Opens the download in the system browser, never in a window of ours. An
 * in-app fetch would strip the mark of the web, which is the thing that makes
 * SmartScreen and Gatekeeper able to say anything about the file at all --
 * and on an unsigned build those warnings are the only check left.
 */
async function open() {
    const current = load();
    const target = current.latest?.url || RELEASES_PAGE;

    await shell.openExternal(target);

    // Only in notify mode. There, handing over the link is everything this
    // feature does and the notice has served its purpose. In install mode the
    // update is still coming, and clearing the dot would hide a restart that
    // has not happened yet.
    if (current.latest && !installable()) dismiss(current.latest.version);

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
            // `runInstall` and `runNotify` both fold every failure into the
            // status they return.
        });
        pollTimer = setTimeout(tick, AUTO_INTERVAL_MS);
        pollTimer.unref?.();
    };

    pollTimer = setTimeout(tick, first);
    // A day-long timer is not a reason to keep the process alive on a platform
    // where closing the window is meant to end it.
    pollTimer.unref?.();
}

module.exports = {
    start,
    check,
    status,
    open,
    dismiss,
    download,
    install,
    compareVersions,
    stripHtml,
};
