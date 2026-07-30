import SettingsPage from '../ui/SettingsPage';
import SessionLogSection from '../SessionLogSection';

/** Session transcripts: what gets recorded, where it goes, how long it stays. */
export default function LoggingPage() {
    return (
        <SettingsPage
            title="Logging"
            description="Write what each session showed to a file, and decide which sessions
                are recorded and how long the files are kept."
        >
            <SessionLogSection />
        </SettingsPage>
    );
}
