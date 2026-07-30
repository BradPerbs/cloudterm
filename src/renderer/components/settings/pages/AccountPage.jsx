import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { toastStyle as getToastStyle } from '../../../lib/toast';
import { Logout01Icon, RefreshIcon } from 'hugeicons-react';
import logoUrl from '../../../logoterminal.svg';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow, { DIVIDED } from '../ui/SettingRow';
import Toggle from '../ui/Toggle';

/**
 * "5 minutes ago". Short enough to sit on one line next to a button, which a
 * full locale timestamp is not.
 */
function ago(iso) {
    if (!iso) return '';

    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

    return `${Math.floor(seconds / 86400)}d ago`;
}

const DOTS = {
    on: 'bg-emerald-500',
    busy: 'bg-blue-500',
    warn: 'bg-amber-500',
    error: 'bg-red-500',
    off: 'bg-gray-300 dark:bg-neutral-600',
};

/**
 * What a background job is doing: one dot, one line.
 *
 * The text is the same muted grey as the rest of the card -- the dot is the
 * only thing carrying state, and it is enough. A failure is the exception,
 * because a red line is the one thing here worth interrupting for.
 */
function StatusLine({ tone, text, pulse = false }) {
    // Nothing known yet. The empty span still holds the button on the right,
    // rather than a bare dot flashing next to no text.
    if (!text) return <span />;

    return (
        <p
            title={text}
            className={`min-w-0 flex items-center gap-2 text-sm
                ${tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
        >
            <span
                className={`shrink-0 w-1.5 h-1.5 rounded-full
                    ${DOTS[tone] || DOTS.off} ${pulse ? 'animate-pulse' : ''}`}
            />
            <span className="truncate">{text}</span>
        </p>
    );
}

/**
 * The last sync.
 *
 * A failure says so rather than showing a stale success: "synced 20 minutes
 * ago" next to a list that never arrived is worse than no line at all.
 */
function syncState(sync, running) {
    if (!sync) return { tone: 'off', text: '' };
    if (!sync.enabled) return { tone: 'off', text: 'Off' };
    if (running || sync.running) return { tone: 'busy', text: 'Syncing…', pulse: true };

    const result = sync.lastResult;

    if (result?.error) return { tone: 'error', text: result.error };
    if (result?.skipped) return { tone: 'warn', text: result.skipped };
    if (!sync.lastSyncAt) return { tone: 'on', text: 'Not synced yet' };

    if (result && typeof result.total === 'number') {
        return {
            tone: 'on',
            text: `${result.total} server${result.total === 1 ? '' : 's'} · ${ago(sync.lastSyncAt)}`,
        };
    }

    return { tone: 'on', text: `Synced ${ago(sync.lastSyncAt)}` };
}

/** The state of the saved setup. */
function snapshotState(snapshot, saving) {
    if (!snapshot) return { tone: 'off', text: '' };

    // Before `blocked`, which reports being switched off as a reason a sync
    // cannot run. Off is a choice, not a fault, and should not read as one.
    if (!snapshot.enabled) return { tone: 'off', text: 'Off' };

    if (saving) return { tone: 'busy', text: 'Saving…', pulse: true };
    if (snapshot.blocked) return { tone: 'warn', text: snapshot.blocked };
    if (snapshot.lastError) return { tone: 'error', text: snapshot.lastError };
    if (snapshot.pending) return { tone: 'busy', text: 'Saving…', pulse: true };
    if (!snapshot.lastPushAt) return { tone: 'on', text: 'Not saved yet' };

    return { tone: 'on', text: `Saved ${ago(snapshot.lastPushAt)}` };
}

/**
 * Connecting the app to a CloudBlast account.
 *
 * Sign-in happens in the system browser and the token lives in main, so this
 * page never sees a credential -- only which account is connected. Everything
 * here is a report on state main owns.
 */
export default function AccountPage() {
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState('');
    const [sync, setSync] = useState(null);
    const [snapshot, setSnapshot] = useState(null);

    const notify = useCallback((kind, message) => {
        toast[kind](message, { style: getToastStyle() });
    }, []);

    useEffect(() => {
        window.api.account.status().then(setStatus);
        window.api.serverSync.status().then(setSync);
        window.api.cloudSnapshot.status().then(setSnapshot);
    }, []);

    // Timer syncs land without anyone asking, so the panel follows them rather
    // than showing a report that stopped being true.
    useEffect(() => window.api.serverSync.onState(setSync), []);
    useEffect(() => window.api.cloudSnapshot.onState(setSnapshot), []);

    const handleSignIn = useCallback(async () => {
        setBusy('signin');

        try {
            const result = await window.api.account.signIn();

            if (!result.success) {
                notify('error', result.message);
                return;
            }

            setStatus(result.status);
            notify('success', `Connected as ${result.status.account?.email || 'your CloudBlast account'}`);
        } finally {
            setBusy('');
        }
    }, [notify]);

    const handleCancel = useCallback(() => {
        window.api.account.cancelSignIn();
    }, []);

    const handleSignOut = useCallback(async () => {
        setBusy('signout');

        try {
            const result = await window.api.account.signOut();
            setStatus(result.status);

            // A token the console never heard about being revoked is still live
            // there. Saying "disconnected" would be untrue.
            notify(result.revoked ? 'success' : 'error', result.revoked
                ? 'Account disconnected'
                : 'Signed out on this device, but the console could not be reached to revoke access. Remove the device from Settings → API.');
        } finally {
            setBusy('');
        }
    }, [notify]);

    const handleToggleSync = useCallback(async (enabled) => {
        setSync(await window.api.serverSync.setEnabled(enabled));

        notify('success', enabled
            ? 'Syncing your CloudBlast servers into Hosts'
            : 'Sync turned off. Hosts already added stay where they are.');
    }, [notify]);

    const handleToggleSnapshot = useCallback(async (enabled) => {
        setSnapshot(await window.api.cloudSnapshot.setEnabled(enabled));

        notify('success', enabled
            ? 'Cloud backup is on'
            : 'Cloud backup is off. What is already saved stays until you replace it.');
    }, [notify]);

    const handleSnapshotPush = useCallback(async () => {
        setBusy('snapshot');

        try {
            const { result, status: next } = await window.api.cloudSnapshot.push();
            setSnapshot(next);

            if (result?.error) notify('error', result.error);
            else if (result?.skipped) notify('error', result.skipped);
            else notify('success', 'Backed up to your CloudBlast account');
        } finally {
            setBusy('');
        }
    }, [notify]);

    const handleSyncNow = useCallback(async () => {
        setBusy('sync');

        try {
            const { report, status: next } = await window.api.serverSync.now();
            setSync(next);

            if (report?.error) {
                notify('error', report.error);
            } else if (report?.skipped) {
                notify('error', report.skipped);
            } else {
                notify('success', report.total === 0
                    ? 'No servers on this account yet'
                    : `${report.total} server${report.total === 1 ? '' : 's'} synced`);
            }
        } finally {
            setBusy('');
        }
    }, [notify]);

    if (!status) return <SettingsPage title="Account" />;

    const host = (() => {
        try {
            return new URL(status.apiUrl).host;
        } catch {
            return status.apiUrl;
        }
    })();

    return (
        <SettingsPage title="Account">
            <SettingCard>
                {status.connected ? (
                    <>
                        <div className="flex items-center gap-3">
                            <span
                                aria-hidden="true"
                                className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center
                                    text-sm font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                            >
                                {(status.account?.name || status.account?.email || '?')
                                    .trim().charAt(0).toUpperCase()}
                            </span>

                            <div className="min-w-0 flex-1">
                                <p className="text-base font-semibold text-gray-900 dark:text-white truncate">
                                    {status.account?.name || 'CloudBlast account'}
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                    {status.account?.email || host}
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={handleSignOut}
                                disabled={Boolean(busy)}
                                className="shrink-0 flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium
                                    text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30
                                    hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50
                                    transition-colors"
                            >
                                <Logout01Icon size={16} strokeWidth={1.8} />
                                {busy === 'signout' ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                        </div>

                        <SettingRow
                            className={DIVIDED}
                            title="Sync my servers"
                            description="Your CloudBlast servers appear in Hosts, ready to connect."
                            align="center"
                            control={
                                <Toggle
                                    checked={Boolean(sync?.enabled)}
                                    onChange={handleToggleSync}
                                    disabled={Boolean(busy) || !sync}
                                    ariaLabel="Sync my servers"
                                />
                            }
                        >
                            <div className="flex items-center justify-between gap-4">
                                <StatusLine {...syncState(sync, busy === 'sync')} />

                                <button
                                    type="button"
                                    onClick={handleSyncNow}
                                    disabled={Boolean(busy)}
                                    className="shrink-0 flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium
                                        text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-neutral-700
                                        hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50
                                        transition-colors"
                                >
                                    <RefreshIcon size={16} strokeWidth={1.8} />
                                    {busy === 'sync' || sync?.running ? 'Syncing…' : 'Sync now'}
                                </button>
                            </div>
                        </SettingRow>

                        <SettingRow
                            className={DIVIDED}
                            title="Cloud backup"
                            description="Your hosts, folders, keys and settings, saved to your account for your other devices."
                            align="center"
                            control={
                                <Toggle
                                    checked={Boolean(snapshot?.enabled)}
                                    onChange={handleToggleSnapshot}
                                    disabled={Boolean(busy) || !snapshot}
                                    ariaLabel="Cloud backup"
                                />
                            }
                        >
                            <div className="flex items-center justify-between gap-4">
                                <StatusLine {...snapshotState(snapshot, busy === 'snapshot')} />

                                <button
                                    type="button"
                                    onClick={handleSnapshotPush}
                                    disabled={Boolean(busy) || !snapshot?.enabled}
                                    className="shrink-0 flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-medium
                                        text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-neutral-700
                                        hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50
                                        transition-colors"
                                >
                                    <RefreshIcon size={16} strokeWidth={1.8} />
                                    {busy === 'snapshot' ? 'Saving…' : 'Save now'}
                                </button>
                            </div>
                        </SettingRow>
                    </>
                ) : (
                    <SettingRow
                        title="Connect your account"
                        description={status.locked
                            ? 'Unlock the app first.'
                            : 'Sync your servers and back up your setup.'}
                        align="center"
                        control={
                            <div className="flex items-center gap-2">
                                {busy === 'signin' && (
                                    <button
                                        type="button"
                                        onClick={handleCancel}
                                        className="px-4 h-9 rounded-xl text-sm font-medium
                                            text-gray-500 dark:text-gray-400
                                            hover:text-gray-900 dark:hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleSignIn}
                                    disabled={Boolean(busy) || status.locked}
                                    className="flex items-center gap-1.5 px-4 h-9 rounded-xl text-sm font-medium
                                        bg-gray-900 dark:bg-white text-white dark:text-gray-900
                                        hover:opacity-90 disabled:opacity-50 transition-opacity"
                                >
                                    {busy === 'signin' ? 'Waiting for browser…' : (
                                        <>
                                            Connect
                                            {/* The mark from the title bar, so the button names the
                                                product the same way the rest of the app does. */}
                                            <img src={logoUrl} alt="" className="w-4 h-4" />
                                            CloudBlast
                                        </>
                                    )}
                                </button>
                            </div>
                        }
                    />
                )}
            </SettingCard>
        </SettingsPage>
    );
}
