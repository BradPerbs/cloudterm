import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { toastStyle as getToastStyle } from '../../../lib/toast';
import { Logout01Icon, RefreshIcon } from 'hugeicons-react';
import logoUrl from '../../../logoterminal.svg';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow, { DIVIDED } from '../ui/SettingRow';
import Toggle from '../ui/Toggle';
import { useT } from '../../../i18n';

/**
 * "5 minutes ago". Short enough to sit on one line next to a button, which a
 * full locale timestamp is not.
 */
function ago(t, iso) {
    if (!iso) return '';

    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

    if (seconds < 60) return t('settings.account.justNow');
    if (seconds < 3600) return t('settings.account.minutesAgo', { count: Math.floor(seconds / 60) });
    if (seconds < 86400) return t('settings.account.hoursAgo', { count: Math.floor(seconds / 3600) });

    return t('settings.account.daysAgo', { count: Math.floor(seconds / 86400) });
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
function syncState(t, sync, running) {
    if (!sync) return { tone: 'off', text: '' };
    if (!sync.enabled) return { tone: 'off', text: t('common.off') };
    if (running || sync.running) return { tone: 'busy', text: t('settings.account.syncing'), pulse: true };

    const result = sync.lastResult;

    if (result?.error) return { tone: 'error', text: result.error };
    if (result?.skipped) return { tone: 'warn', text: result.skipped };
    if (!sync.lastSyncAt) return { tone: 'on', text: t('settings.account.notSyncedYet') };

    if (result && typeof result.total === 'number') {
        return {
            tone: 'on',
            text: `${t('settings.account.serverCount', { count: result.total })} · ${ago(t, sync.lastSyncAt)}`,
        };
    }

    return { tone: 'on', text: t('settings.account.syncedAgo', { when: ago(t, sync.lastSyncAt) }) };
}

/** The state of the saved setup. */
function snapshotState(t, snapshot, saving) {
    if (!snapshot) return { tone: 'off', text: '' };

    // Before `blocked`, which reports being switched off as a reason a sync
    // cannot run. Off is a choice, not a fault, and should not read as one.
    if (!snapshot.enabled) return { tone: 'off', text: t('common.off') };

    if (saving) return { tone: 'busy', text: t('settings.account.saving'), pulse: true };
    if (snapshot.blocked) return { tone: 'warn', text: snapshot.blocked };
    if (snapshot.lastError) return { tone: 'error', text: snapshot.lastError };
    if (snapshot.pending) return { tone: 'busy', text: t('settings.account.saving'), pulse: true };
    if (!snapshot.lastPushAt) return { tone: 'on', text: t('settings.account.notSavedYet') };

    return { tone: 'on', text: t('settings.account.savedAgo', { when: ago(t, snapshot.lastPushAt) }) };
}

/**
 * Connecting the app to a CloudBlast account.
 *
 * Sign-in happens in the system browser and the token lives in main, so this
 * page never sees a credential -- only which account is connected. Everything
 * here is a report on state main owns.
 */
export default function AccountPage() {
    const t = useT();
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
            notify('success', t('settings.account.connectedAs', {
                account: result.status.account?.email || t('settings.account.yourAccount'),
            }));
        } finally {
            setBusy('');
        }
    }, [notify, t]);

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
                ? t('settings.account.disconnected')
                : t('settings.account.disconnectedLocally'));
        } finally {
            setBusy('');
        }
    }, [notify, t]);

    const handleToggleSync = useCallback(async (enabled) => {
        setSync(await window.api.serverSync.setEnabled(enabled));

        notify('success', enabled
            ? t('settings.account.syncOn')
            : t('settings.account.syncOff'));
    }, [notify, t]);

    const handleToggleSnapshot = useCallback(async (enabled) => {
        setSnapshot(await window.api.cloudSnapshot.setEnabled(enabled));

        notify('success', enabled
            ? t('settings.account.backupOn')
            : t('settings.account.backupOff'));
    }, [notify, t]);

    const handleSnapshotPush = useCallback(async () => {
        setBusy('snapshot');

        try {
            const { result, status: next } = await window.api.cloudSnapshot.push();
            setSnapshot(next);

            if (result?.error) notify('error', result.error);
            else if (result?.skipped) notify('error', result.skipped);
            else notify('success', t('settings.account.backedUp'));
        } finally {
            setBusy('');
        }
    }, [notify, t]);

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
                    ? t('settings.account.noServers')
                    : t('settings.account.serversSynced', { count: report.total }));
            }
        } finally {
            setBusy('');
        }
    }, [notify, t]);

    if (!status) return <SettingsPage title={t('settings.account.title')} />;

    const host = (() => {
        try {
            return new URL(status.apiUrl).host;
        } catch {
            return status.apiUrl;
        }
    })();

    return (
        <SettingsPage title={t('settings.account.title')}>
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
                                    {status.account?.name || t('settings.account.fallbackName')}
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
                                {busy === 'signout'
                                    ? t('settings.account.disconnecting')
                                    : t('settings.account.disconnect')}
                            </button>
                        </div>

                        <SettingRow
                            className={DIVIDED}
                            title={t('settings.account.syncServers')}
                            description={t('settings.account.syncServersDesc')}
                            align="center"
                            control={
                                <Toggle
                                    checked={Boolean(sync?.enabled)}
                                    onChange={handleToggleSync}
                                    disabled={Boolean(busy) || !sync}
                                    ariaLabel={t('settings.account.syncServers')}
                                />
                            }
                        >
                            <div className="flex items-center justify-between gap-4">
                                <StatusLine {...syncState(t, sync, busy === 'sync')} />

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
                                    {busy === 'sync' || sync?.running
                                        ? t('settings.account.syncing')
                                        : t('settings.account.syncNow')}
                                </button>
                            </div>
                        </SettingRow>

                        <SettingRow
                            className={DIVIDED}
                            title={t('settings.account.cloudBackup')}
                            description={t('settings.account.cloudBackupDesc')}
                            align="center"
                            control={
                                <Toggle
                                    checked={Boolean(snapshot?.enabled)}
                                    onChange={handleToggleSnapshot}
                                    disabled={Boolean(busy) || !snapshot}
                                    ariaLabel={t('settings.account.cloudBackup')}
                                />
                            }
                        >
                            <div className="flex items-center justify-between gap-4">
                                <StatusLine {...snapshotState(t, snapshot, busy === 'snapshot')} />

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
                                    {busy === 'snapshot'
                                        ? t('settings.account.saving')
                                        : t('settings.account.saveNow')}
                                </button>
                            </div>
                        </SettingRow>
                    </>
                ) : (
                    <SettingRow
                        title={t('settings.account.connect')}
                        description={status.locked
                            ? t('settings.account.unlockFirst')
                            : t('settings.account.connectDesc')}
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
                                        {t('common.cancel')}
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
                                    {busy === 'signin' ? t('settings.account.waitingForBrowser') : (
                                        <>
                                            {t('settings.account.connectAction')}
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
