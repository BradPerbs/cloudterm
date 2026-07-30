import SettingsPage from '../ui/SettingsPage';
import AppLockSection from '../AppLockSection';
import KnownHostsSection from '../KnownHostsSection';

export default function SecurityPage() {
    return (
        <SettingsPage title="Security" description="Who can open this app, and which servers it trusts.">
            <AppLockSection />
            <KnownHostsSection />
        </SettingsPage>
    );
}
