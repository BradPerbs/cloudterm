import SettingsPage from '../ui/SettingsPage';
import SessionLogSection from '../SessionLogSection';
import { useT } from '../../../i18n';

/** Session transcripts: what gets recorded, where it goes, how long it stays. */
export default function LoggingPage() {
    const t = useT();

    return (
        <SettingsPage title={t('settings.logging.title')} description={t('settings.logging.desc')}>
            <SessionLogSection />
        </SettingsPage>
    );
}
