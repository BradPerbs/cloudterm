import SettingCard from './ui/SettingCard';
import SettingRow, { DIVIDED } from './ui/SettingRow';
import Toggle from './ui/Toggle';
import { useT } from '../../i18n';

/**
 * Whether the assistant says so outside the app when a chat needs you, and
 * whether a chime goes with it. Both on unless switched off; see
 * main/ai/attention.js for when one is raised.
 *
 * The sound is a row of its own rather than a part of the first switch, since
 * a banner that arrives in silence is what some people want at a desk with
 * other people at it. It has nothing to go with while the first is off, so it
 * waits, greyed, rather than vanishing and moving the card under the pointer.
 */
export default function NotificationsCard({ settings, update }) {
    const t = useT();
    const notify = settings.notify !== false;

    return (
        <SettingCard>
            <SettingRow
                align="center"
                title={t('settings.assistant.notify')}
                description={t('settings.assistant.notifyDesc')}
                control={
                    <Toggle
                        ariaLabel={t('settings.assistant.notify')}
                        checked={notify}
                        onChange={(value) => update({ notify: value })}
                    />
                }
            />

            <SettingRow
                className={DIVIDED}
                align="center"
                title={t('settings.assistant.notifySound')}
                description={t('settings.assistant.notifySoundDesc')}
                control={
                    <Toggle
                        ariaLabel={t('settings.assistant.notifySound')}
                        checked={settings.notifySound !== false}
                        disabled={!notify}
                        onChange={(value) => update({ notifySound: value })}
                    />
                }
            />
        </SettingCard>
    );
}
