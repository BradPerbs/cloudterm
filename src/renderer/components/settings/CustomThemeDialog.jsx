import { useMemo, useState } from 'react';
import Dialog, { DialogButton } from '../ui/Dialog';
import ColorField from '../ui/ColorField';
import {
    DEFAULT_CUSTOM_THEME,
    TERMINAL_COLOR_FIELDS,
    TERMINAL_THEME_PRESETS,
    sanitizeCustomTheme,
    themeToCustomColors,
} from '../../hooks/useTerminalTheme';
import { TERMINAL_FONT_FAMILY } from '../../hooks/useTerminalSettings';
import { useT, translate } from '../../i18n';

const BASE_FIELDS = TERMINAL_COLOR_FIELDS.filter(field => field.group === 'base');
const ANSI_FIELDS = TERMINAL_COLOR_FIELDS.filter(field => field.group === 'ansi');

// 0.3 alpha as the last byte of an 8-digit hex, matching what the terminal is
// handed for its selection colour.
const SELECTION_SUFFIX = '4d';

/** What the theme actually looks like, in the colours being edited. */
function ThemePreview({ colors }) {
    return (
        <div
            className="rounded-xl border border-gray-200 dark:border-surface-control overflow-hidden"
            style={{ backgroundColor: colors.background }}
        >
            <div
                className="p-3.5 text-[11px] leading-relaxed"
                style={{ fontFamily: TERMINAL_FONT_FAMILY, color: colors.foreground }}
            >
                <div>
                    <span style={{ color: colors.green }}>user@server</span>
                    <span style={{ color: colors.foreground }}>:</span>
                    <span style={{ color: colors.blue }}>~/app</span>
                    <span style={{ color: colors.magenta }}> (main)</span>
                    <span style={{ color: colors.foreground }}>$ ./deploy.sh</span>
                </div>
                <div style={{ color: colors.cyan }}>→ building bundle…</div>
                <div>
                    <span style={{ color: colors.yellow }}>warning</span>
                    <span> 2 unused imports</span>
                </div>
                <div style={{ color: colors.red }}>error: port 8080 already in use</div>
                <div>
                    <span style={{ backgroundColor: `${colors.selectionBackground}${SELECTION_SUFFIX}` }}>
                        selected output
                    </span>
                    <span style={{ color: colors.white }}> done in 1.4s</span>
                </div>
                <div className="flex items-center gap-1">
                    <span style={{ color: colors.foreground }}>$</span>
                    <span
                        className="inline-block w-[2px] h-3.5 animate-pulse"
                        style={{ backgroundColor: colors.cursor }}
                    />
                </div>
            </div>

            <div className="flex">
                {ANSI_FIELDS.map(field => (
                    <div
                        key={field.key}
                        className="h-2 flex-1"
                        style={{ backgroundColor: colors[field.key] }}
                        title={translate(field.labelKey)}
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * The custom theme editor. Edits are a draft until saved, so backing out of a
 * palette you don't like costs nothing, and saving is what selects it.
 */
export default function CustomThemeDialog({ colors, onSave, onClose }) {
    const t = useT();
    const [draft, setDraft] = useState(() => sanitizeCustomTheme(colors));
    const [preset, setPreset] = useState('');

    const dirty = useMemo(
        () => TERMINAL_COLOR_FIELDS.some(field => draft[field.key] !== colors?.[field.key]),
        [draft, colors]
    );

    const setColor = (key, value) => setDraft(current => ({ ...current, [key]: value }));

    const startFrom = (themeId) => {
        setPreset(themeId);
        if (themeId) setDraft(themeToCustomColors(themeId));
    };

    return (
        <Dialog
            title={t('termColors.title')}
            subtitle={t('termColors.subtitle')}
            width="34rem"
            onClose={onClose}
            footer={
                <>
                    <DialogButton onClick={() => { setPreset(''); setDraft({ ...DEFAULT_CUSTOM_THEME }); }}>
                        {t('common.reset')}
                    </DialogButton>
                    <DialogButton onClick={onClose}>{t('common.cancel')}</DialogButton>
                    <DialogButton variant="primary" onClick={() => onSave(draft)}>
                        {dirty ? t('common.saveAndApply') : t('common.apply')}
                    </DialogButton>
                </>
            }
        >
            <div className="space-y-5">
                <ThemePreview colors={draft} />

                <label className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
                        {t('common.startFrom')}
                    </span>
                    <select
                        value={preset}
                        onChange={(event) => startFrom(event.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl text-sm border border-gray-300
                            dark:border-surface-control bg-white dark:bg-neutral-800 text-gray-900 dark:text-white
                            outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white"
                    >
                        <option value="">{t('common.keepCurrentColors')}</option>
                        {TERMINAL_THEME_PRESETS.map(option => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                    </select>
                </label>

                <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
                        {t('termColors.groupBase')}
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {BASE_FIELDS.map(field => (
                            <ColorField
                                key={field.key}
                                label={t(field.labelKey)}
                                value={draft[field.key]}
                                onChange={(value) => setColor(field.key, value)}
                            />
                        ))}
                    </div>
                </div>

                <div className="pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
                        {t('termColors.groupAnsi')}
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {ANSI_FIELDS.map(field => (
                            <ColorField
                                key={field.key}
                                label={t(field.labelKey)}
                                value={draft[field.key]}
                                onChange={(value) => setColor(field.key, value)}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
