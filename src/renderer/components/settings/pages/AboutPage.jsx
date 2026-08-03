import { useState } from 'react';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow from '../ui/SettingRow';
import useUpdate from '../../../hooks/useUpdate';
import { formatDateTime } from '../../../lib/format';

/**
 * What the update row says, in one line.
 *
 * `message` is the answer owed to somebody who just pressed the button, so it
 * outranks the derived state: "try again in twelve minutes" is more use than
 * the "up to date" that is also true at that moment.
 *
 * Below it the order is by what the user can act on. A build already on disk
 * outranks one still arriving, which outranks one only known about, because
 * each is a step further along and the later step is the one worth reporting.
 */
function describe(status, message) {
    if (!status) return 'Checking for updates…';
    if (status.disabled) return 'Update checks are turned off for this install.';
    if (message) return message;

    if (status.ready) {
        return `Version ${status.readyVersion} is ready to install. Restart to finish.`;
    }

    if (status.downloading) {
        return status.latest
            ? `Downloading version ${status.latest.version}…`
            : 'Downloading the update…';
    }

    if (status.checking) return 'Checking for updates…';

    if (status.newer) {
        // Two different promises, and the difference is the whole point of the
        // mode. Only one of them ends with the app being replaced.
        return status.mode === 'install'
            ? `Version ${status.latest.version} is available.`
            : `Version ${status.latest.version} is available to download.`;
    }

    if (status.checkedAt) return `Up to date. Last checked ${formatDateTime(status.checkedAt)}.`;

    return 'Not checked yet.';
}

const PRIMARY = `flex items-center gap-1.5 px-4 h-9 rounded-xl text-sm font-medium
    bg-gray-900 dark:bg-white text-white dark:text-gray-900
    hover:opacity-90 transition-opacity`;

export default function AboutPage() {
    const { status, check, open, download, install } = useUpdate();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    // Wraps whichever call the button makes, since all three answer with the
    // same `{ success, message }` and all three want the same pending state.
    const run = async (action) => {
        setBusy(true);
        setMessage('');

        try {
            const result = await action();
            // Only failures get a message of their own. A successful call has
            // already changed the state the line below is derived from, and
            // saying it twice in two different wordings reads as two answers.
            setMessage(result.success ? '' : result.message);
        } catch (error) {
            setMessage(error.message);
        } finally {
            setBusy(false);
        }
    };

    const checking = busy || Boolean(status?.checking);
    const spent = status?.manualRemaining === 0;
    const installs = status?.mode === 'install';

    // Available, not downloading, not downloaded: in install mode that only
    // happens when a download failed, so the button is a retry rather than a
    // start. In notify mode it is the ordinary state and the button is a link.
    const stalled = installs && status?.newer && !status.downloading && !status.ready;

    // The allowance only matters once it is nearly gone. Announcing "10 checks
    // left" to somebody who pressed the button once would invent a limit they
    // were never going to reach.
    const hint = status && !status.disabled && status.manualRemaining <= 3
        ? (spent
            ? `No checks left this hour${status.manualResetAt ? `, until ${formatDateTime(status.manualResetAt)}` : ''}.`
            : `${status.manualRemaining} of ${status.manualLimit} checks left this hour.`)
        : '';

    return (
        <SettingsPage title="About">
            <div className="bg-gray-100 dark:bg-neutral-800 text-gray-900 dark:text-white rounded-xl p-8 flex items-center justify-between">
                <div>
                    <h4 className="text-2xl font-bold mb-1">CloudTerm</h4>
                    {/* Read from the packaged app rather than written here, so
                        a release cannot ship claiming to be the version before
                        it. Held back until it is known, since a wrong version
                        for one frame is worse than none. */}
                    {status && <p className="opacity-80">Version {status.version}</p>}
                </div>
                <div className="w-16 h-16 bg-white dark:bg-black/20 rounded-2xl flex items-center justify-center text-gray-900 dark:text-white">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="4 17 10 11 4 5" />
                        <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                </div>
            </div>

            <SettingCard>
                <SettingRow
                    align="center"
                    title="Updates"
                    description={describe(status, message)}
                    control={status?.disabled ? null : (
                        <div className="flex items-center gap-2">
                            {/* One action button at most, and which one it is
                                says where the update has got to. A restart is
                                the only thing worth offering once a build is
                                on disk, so nothing else appears beside it. */}
                            {status?.ready ? (
                                <button type="button" onClick={install} className={PRIMARY}>
                                    Restart to update
                                </button>
                            ) : stalled ? (
                                <button
                                    type="button"
                                    onClick={() => run(download)}
                                    disabled={busy}
                                    className={`${PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    Download {status.latest.version}
                                </button>
                            ) : status?.newer && !installs ? (
                                <button type="button" onClick={() => open()} className={PRIMARY}>
                                    Download {status.latest.version}
                                </button>
                            ) : null}

                            {/* Disabled while a download runs and once one has
                                finished: a check then would either be answered
                                from the release already in hand or start the
                                transfer over, and neither is what pressing it
                                means. */}
                            <button
                                type="button"
                                onClick={() => run(check)}
                                disabled={checking || spent || status?.downloading || status?.ready}
                                className="shrink-0 flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium
                                    text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-neutral-700
                                    hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50
                                    disabled:cursor-not-allowed transition-colors"
                            >
                                {checking ? 'Checking…' : 'Check for updates'}
                            </button>
                        </div>
                    )}
                />

                {/* Drawn only while bytes are moving. The percentage is
                    repeated in text because a bar at 4% and a bar that is not
                    moving look the same from across a desk. */}
                {status?.downloading && status.progress !== null && (
                    <div className="mt-4">
                        <div
                            role="progressbar"
                            aria-label="Downloading the update"
                            aria-valuenow={status.progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            className="h-1.5 rounded-full bg-gray-200 dark:bg-neutral-700 overflow-hidden"
                        >
                            <div
                                className="h-full rounded-full bg-gray-900 dark:bg-white transition-[width] duration-300 ease-out"
                                style={{ width: `${status.progress}%` }}
                            />
                        </div>
                        <p className="mt-1.5 text-xs tabular-nums text-gray-400 dark:text-neutral-500">
                            {status.progress}%
                        </p>
                    </div>
                )}

                {status?.newer && status.latest.notes && (
                    <p className="mt-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400 whitespace-pre-line line-clamp-4">
                        {status.latest.notes}
                    </p>
                )}

                {hint && (
                    <p className="mt-3 text-xs text-gray-400 dark:text-neutral-500">
                        {hint}
                    </p>
                )}

                <p className="mt-4 text-xs leading-relaxed text-gray-400 dark:text-neutral-500">
                    {/* Said plainly either way, because the two behave nothing
                        alike and a user who assumes the wrong one either waits
                        for an install that is not coming or is surprised by one
                        that is. The second sentence is the privacy note: the
                        check is a request to GitHub and nothing else, and it
                        carries no account and no machine name with it. */}
                    {installs
                        ? 'Updates download in the background and install when you quit. Checking asks GitHub for the latest release and sends nothing about you or your machine.'
                        : 'Updates are not installed automatically. The download opens in your browser, where your system can check it. Checking asks GitHub for the latest release and sends nothing about you or your machine.'}
                </p>
            </SettingCard>
        </SettingsPage>
    );
}
