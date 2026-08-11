import SettingsPage from '../ui/SettingsPage';
import BackupSection from '../BackupSection';
import ImportSection from '../ImportSection';
import AppImportSection from '../AppImportSection';
import { useT } from '../../../i18n';

export default function BackupPage({ onDataImported }) {
    const t = useT();

    return (
        <SettingsPage title={t('settings.backup.title')} description={t('settings.backup.desc')}>
            <BackupSection onRestored={onDataImported} />
            <ImportSection onImported={onDataImported} />
            <AppImportSection onImported={onDataImported} />
        </SettingsPage>
    );
}
