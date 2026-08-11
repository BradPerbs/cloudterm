import SettingsPage from '../ui/SettingsPage';
import AssistantSection from '../AssistantSection';
import { useT } from '../../../i18n';

/** The assistant: which model runs it, and what it is allowed to do unattended. */
export default function AssistantPage() {
    const t = useT();

    return (
        <SettingsPage title={t('settings.assistant.title')} description={t('settings.assistant.desc')}>
            <AssistantSection />
        </SettingsPage>
    );
}
