import SettingsPage from '../ui/SettingsPage';
import BackupSection from '../BackupSection';
import ImportSection from '../ImportSection';

export default function BackupPage({ onDataImported }) {
    return (
        <SettingsPage title="Backup" description="Bring an existing setup in, or take a copy out.">
            <BackupSection onRestored={onDataImported} />
            <ImportSection onImported={onDataImported} />
        </SettingsPage>
    );
}
