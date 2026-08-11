import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import SettingsPage from '../ui/SettingsPage';
import SettingCard from '../ui/SettingCard';
import SettingRow, { DIVIDED } from '../ui/SettingRow';
import Toggle from '../ui/Toggle';
import { toastOptions } from '../../../lib/toast';
import { LANGUAGES, setLanguage, translate, useLanguage, useT } from '../../../i18n';

/**
 * Owns the restore flag: App reads it straight from localStorage at startup, so
 * no props have to flow through the panel.
 *
 * Starting at boot is not a setting of ours at all. It is a login item the
 * system keeps, and the user can remove it somewhere that is not this app, so
 * the switch is drawn from what main reads back rather than from anything
 * stored here. See src/main/startup.js.
 */
export default function GeneralPage() {
    const t = useT();
    const language = useLanguage();
    const [restore, setRestore] = useState(localStorage.getItem('restoreSessions') !== 'false');
    // Null until main has answered; there is nothing honest to draw before then.
    const [startup, setStartup] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;

        window.api.startup.status()
            .then((status) => {
                if (alive) setStartup(status);
            })
            .catch((error) => {
                if (!alive) return;
                setStartup({
                    supported: false,
                    reason: error?.message || t('settings.general.startupUnknown'),
                    enabled: false,
                });
            });

        return () => { alive = false; };
    }, [t]);

    const toggleRestore = (next) => {
        setRestore(next);
        localStorage.setItem('restoreSessions', String(next));
    };

    /**
     * The confirmation is deliberately shown in the language just chosen: it is
     * the first proof that the setting took, and saying it in the language being
     * left would be a strange way to demonstrate that.
     *
     * Hence `translate` rather than the `t` from this render, which is still
     * bound to the language being left: the store has already moved on by the
     * time this line runs, but React has not re-rendered yet.
     */
    const changeLanguage = (next) => {
        const chosen = setLanguage(next);
        const entry = LANGUAGES.find(item => item.id === chosen);
        toast.success(
            translate('settings.general.languageChanged', { language: entry?.label || chosen }),
            toastOptions(),
        );
    };

    const toggleStartup = async (next) => {
        setSaving(true);
        try {
            const result = await window.api.startup.setEnabled(next);
            // Whatever came back, it is what the system now says, so the switch
            // follows it rather than the click that was made.
            setStartup({
                supported: result.supported,
                reason: result.reason,
                enabled: result.enabled,
            });

            if (result.success) {
                toast.success(
                    next
                        ? t('settings.general.startupOn')
                        : t('settings.general.startupOff'),
                    toastOptions(),
                );
            } else {
                toast.error(result.message || t('settings.general.startupFailed'), toastOptions());
            }
        } catch (error) {
            toast.error(error?.message || t('settings.general.startupFailed'), toastOptions());
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsPage title={t('settings.general.title')} description={t('settings.general.desc')}>
            <SettingCard>
                {/* First on the page, and first for a reason: somebody who cannot
                    read the rest of this screen needs to be able to find this
                    row, and the top of the first page is where they will look.
                    Each language is named in itself for the same reason. */}
                <SettingRow
                    align="center"
                    title={t('settings.general.language')}
                    description={t('settings.general.languageDesc')}
                    control={
                        <select
                            id="app-language"
                            aria-label={t('settings.general.language')}
                            value={language}
                            onChange={(event) => changeLanguage(event.target.value)}
                            className="h-9 px-3 rounded-xl text-sm bg-white dark:bg-neutral-800
                                border border-gray-300 dark:border-neutral-700
                                text-gray-900 dark:text-gray-100 outline-none
                                focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25"
                        >
                            {LANGUAGES.map(entry => (
                                <option key={entry.id} value={entry.id} lang={entry.tag}>
                                    {entry.label}
                                    {entry.label === entry.english ? '' : ` (${entry.english})`}
                                </option>
                            ))}
                        </select>
                    }
                />

                <SettingRow
                    align="center"
                    className={DIVIDED}
                    title={t('settings.general.startup')}
                    description={
                        <>
                            {t('settings.general.startupDesc')}
                            {startup && !startup.supported && startup.reason && (
                                <span className="block mt-1.5 text-xs text-gray-400 dark:text-neutral-500">
                                    {startup.reason}
                                </span>
                            )}
                        </>
                    }
                    control={
                        <Toggle
                            checked={Boolean(startup?.enabled)}
                            onChange={toggleStartup}
                            disabled={!startup?.supported || saving}
                            ariaLabel={t('settings.general.startup')}
                        />
                    }
                />

                <SettingRow
                    align="center"
                    className={DIVIDED}
                    title={t('settings.general.restore')}
                    description={t('settings.general.restoreDesc')}
                    control={
                        <Toggle
                            checked={restore}
                            onChange={toggleRestore}
                            ariaLabel={t('settings.general.restore')}
                        />
                    }
                />
            </SettingCard>
        </SettingsPage>
    );
}
