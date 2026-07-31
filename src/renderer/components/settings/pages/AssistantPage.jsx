import SettingsPage from '../ui/SettingsPage';
import AssistantSection from '../AssistantSection';

/** The assistant: which model runs it, and what it is allowed to do unattended. */
export default function AssistantPage() {
    return (
        <SettingsPage
            title="Assistant"
            description="The assistant reads your terminals and works on your servers through the connections
                you have already opened. It never sees a stored password or key."
        >
            <AssistantSection />
        </SettingsPage>
    );
}
