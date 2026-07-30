import { useState } from 'react';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow from '../ui/SettingRow';
import Toggle from '../ui/Toggle';

/**
 * Owns its own flag: App reads it straight from localStorage at startup, so no
 * props have to flow through the panel.
 */
export default function GeneralPage() {
    const [restore, setRestore] = useState(localStorage.getItem('restoreSessions') !== 'false');

    const toggle = (next) => {
        setRestore(next);
        localStorage.setItem('restoreSessions', String(next));
    };

    return (
        <SettingsPage title="General" description="How the app behaves when it starts.">
            <SettingCard>
                <SettingRow
                    align="center"
                    title="Restore sessions"
                    description="Reopen the tabs that were open when the app closed and reconnect to their hosts"
                    control={
                        <Toggle
                            checked={restore}
                            onChange={toggle}
                            ariaLabel="Restore sessions"
                        />
                    }
                />
            </SettingCard>
        </SettingsPage>
    );
}
