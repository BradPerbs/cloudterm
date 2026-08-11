import SettingsPage from '../ui/SettingsPage';
import MonitoringSection from '../MonitoringSection';
import { useT } from '../../../i18n';

/** Which hosts are still answering, and being told when one stops. */
export default function MonitoringPage() {
    const t = useT();

    return (
        <SettingsPage title={t('settings.monitoring.title')} description={t('settings.monitoring.desc')}>
            <MonitoringSection />
        </SettingsPage>
    );
}
