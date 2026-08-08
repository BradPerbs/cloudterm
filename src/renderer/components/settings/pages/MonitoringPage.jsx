import SettingsPage from '../ui/SettingsPage';
import MonitoringSection from '../MonitoringSection';

/** Which hosts are still answering, and being told when one stops. */
export default function MonitoringPage() {
    return (
        <SettingsPage
            title="Monitoring"
            description="Check that hosts are still reachable while the app is open, and get a
                notification when one stops answering. It takes two switches: this page turns the
                feature on, and each host you want watched is switched on in its own editor."
        >
            <MonitoringSection />
        </SettingsPage>
    );
}
