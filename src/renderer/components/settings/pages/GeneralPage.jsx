import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow, { DIVIDED } from '../ui/SettingRow';
import Toggle from '../ui/Toggle';
import { toastOptions } from '../../../lib/toast';

/**
 * Owns the restore flag: App reads it straight from localStorage at startup, so
 * no props have to flow through the panel.
 *
 * Starting at boot is not a setting of ours at all. It is a login item the
 * system keeps, and the user can remove it somewhere that is not this app, so
 * the switch is drawn from what main reads back rather than from anything
 * stored here. See src/main/startup.js.
 */
export default function GeneralPage() {
    const [restore, setRestore] = useState(localStorage.getItem('restoreSessions') !== 'false');
    // Null until main has answered; there is nothing honest to draw before then.
    const [startup, setStartup] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;

        window.api.startup.status()
            .then((status) => {
                if (alive) setStartup(status);
            })
            .catch((error) => {
                if (!alive) return;
                setStartup({
                    supported: false,
                    reason: error?.message || 'Could not read whether the app starts at boot',
                    enabled: false,
                });
            });

        return () => { alive = false; };
    }, []);

    const toggleRestore = (next) => {
        setRestore(next);
        localStorage.setItem('restoreSessions', String(next));
    };

    const toggleStartup = async (next) => {
        setSaving(true);
        try {
            const result = await window.api.startup.setEnabled(next);
            // Whatever came back, it is what the system now says, so the switch
            // follows it rather than the click that was made.
            setStartup({
                supported: result.supported,
                reason: result.reason,
                enabled: result.enabled,
            });

            if (result.success) {
                toast.success(
                    next
                        ? 'CloudTerm will open when you sign in'
                        : 'CloudTerm will no longer open when you sign in',
                    toastOptions(),
                );
            } else {
                toast.error(result.message || 'That could not be changed', toastOptions());
            }
        } catch (error) {
            toast.error(error?.message || 'That could not be changed', toastOptions());
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsPage title="General" description="How the app behaves when it starts.">
            <SettingCard>
                <SettingRow
                    align="center"
                    title="Start at login"
                    description={
                        <>
                            Open CloudTerm automatically when you sign in to this computer
                            {startup && !startup.supported && startup.reason && (
                                <span className="block mt-1.5 text-xs text-gray-400 dark:text-neutral-500">
                                    {startup.reason}
                                </span>
                            )}
                        </>
                    }
                    control={
                        <Toggle
                            checked={Boolean(startup?.enabled)}
                            onChange={toggleStartup}
                            disabled={!startup?.supported || saving}
                            ariaLabel="Start at login"
                        />
                    }
                />

                <SettingRow
                    align="center"
                    className={DIVIDED}
                    title="Restore sessions"
                    description="Reopen the tabs that were open when the app closed and reconnect to their hosts"
                    control={
                        <Toggle
                            checked={restore}
                            onChange={toggleRestore}
                            ariaLabel="Restore sessions"
                        />
                    }
                />
            </SettingCard>
        </SettingsPage>
    );
}
