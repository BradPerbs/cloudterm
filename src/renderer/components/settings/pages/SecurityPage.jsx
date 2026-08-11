import SettingsPage from '../ui/SettingsPage';
import AppLockSection from '../AppLockSection';
import KnownHostsSection from '../KnownHostsSection';
import { useT } from '../../../i18n';

export default function SecurityPage() {
    const t = useT();

    return (
        <SettingsPage title={t('settings.security.title')} description={t('settings.security.desc')}>
            <AppLockSection />
            <KnownHostsSection />
        </SettingsPage>
    );
}
