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
 */
function describe(status, message) {
    if (!status) return 'Checking for updates…';
    if (status.disabled) return 'Update checks are turned off for this install.';
    if (message) return message;
    if (status.checking) return 'Checking for updates…';
    if (status.newer) return `Version ${status.latest.version} is available.`;
    if (status.checkedAt) return `Up to date. Last checked ${formatDateTime(status.checkedAt)}.`;

    return 'Not checked yet.';
}

export default function AboutPage() {
    const { status, check, open } = useUpdate();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    const handleCheck = async () => {
        setBusy(true);
        setMessage('');

        try {
            const result = await check();
            // Only failures get a message of their own. A successful check has
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
                            {status?.newer && (
                                <button
                                    type="button"
                                    onClick={() => open()}
                                    className="flex items-center gap-1.5 px-4 h-9 rounded-xl text-sm font-medium
                                        bg-gray-900 dark:bg-white text-white dark:text-gray-900
                                        hover:opacity-90 transition-opacity"
                                >
                                    Download {status.latest.version}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleCheck}
                                disabled={checking || spent}
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
                    {/* Said plainly because the alternative is a user assuming
                        the app updates itself and then not updating for a year.
                        The second half is the privacy note: the check is a
                        request to GitHub and nothing else, and it carries no
                        account and no machine name with it. */}
                    Updates are not installed automatically. The download opens in your browser,
                    where your system can check it. Checking asks GitHub for the latest release
                    and sends nothing about you or your machine.
                </p>
            </SettingCard>
        </SettingsPage>
    );
}
