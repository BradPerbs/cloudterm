import { useMemo, useState } from 'react';
import Dialog, { DialogButton } from '../ui/Dialog';
import ColorField from '../ui/ColorField';
import {
    APP_COLOR_FIELDS,
    APP_COLOR_PRESETS,
    DEFAULT_APP_COLORS,
    derivePalette,
    sanitizeAppColors,
} from '../../lib/app-colors';
import { useT } from '../../i18n';

/**
 * The app in miniature, in the colours being edited.
 *
 * Six flat swatches would say what the colours are but not what they do; this
 * says which one is the window, which is a panel and which is a button, which is
 * the whole question when you are picking them.
 */
function AppPreview({ colors }) {
    return (
        <div
            className="rounded-xl overflow-hidden border border-gray-200 dark:border-surface-control"
            style={{ backgroundColor: colors.base }}
        >
            {/* Title bar: the tab in front, then two behind it. */}
            <div className="flex items-center gap-1.5 px-2.5 py-2">
                <div className="w-3.5 h-3.5 rounded" style={{ backgroundColor: colors.control }} />
                <div
                    className="h-5 w-20 rounded-md flex items-center px-1.5"
                    style={{ backgroundColor: colors.control }}
                >
                    <div className="h-1 w-10 rounded-full bg-white/70" />
                </div>
                <div className="h-5 w-16 rounded-md flex items-center px-1.5" style={{ backgroundColor: colors.raised }}>
                    <div className="h-1 w-8 rounded-full" style={{ backgroundColor: colors.muted }} />
                </div>
                <div className="h-5 w-16 rounded-md flex items-center px-1.5" style={{ backgroundColor: colors.raised }}>
                    <div className="h-1 w-6 rounded-full" style={{ backgroundColor: colors.muted }} />
                </div>
            </div>

            <div className="flex gap-2 px-2.5 pb-2.5">
                {/* Sidebar */}
                <div
                    className="w-9 rounded-lg py-2 flex flex-col items-center gap-2"
                    style={{ backgroundColor: colors.raised }}
                >
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.active }} />
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.control }} />
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.control }} />
                </div>

                {/* A card with a row of controls, the shape most of the app is. */}
                <div className="flex-1 rounded-lg p-2.5 space-y-2" style={{ backgroundColor: colors.raised }}>
                    <div className="h-1.5 w-24 rounded-full bg-white/75" />
                    <div className="h-1.5 w-32 rounded-full" style={{ backgroundColor: colors.muted }} />

                    <div className="flex items-center gap-1.5 pt-0.5">
                        <div
                            className="h-5 flex-1 rounded-md flex items-center px-2"
                            style={{ backgroundColor: colors.control }}
                        >
                            <div className="h-1 w-12 rounded-full" style={{ backgroundColor: colors.muted }} />
                        </div>
                        {/* Hover and pressed, side by side, so the two steps that
                            only ever appear under a pointer can still be judged. */}
                        <div className="h-5 w-8 rounded-md" style={{ backgroundColor: colors.hover }} />
                        <div className="h-5 w-8 rounded-md" style={{ backgroundColor: colors.active }} />
                        <div className="h-5 w-12 rounded-md bg-white" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * The app colour editor. Edits are a draft until saved, so trying a palette on
 * costs nothing, and saving is what applies it.
 */
export default function AppColorsDialog({ colors, onSave, onClose }) {
    const t = useT();
    const [draft, setDraft] = useState(() => sanitizeAppColors(colors));
    const [preset, setPreset] = useState('');

    const dirty = useMemo(
        () => APP_COLOR_FIELDS.some(field => draft[field.key] !== colors?.[field.key]),
        [draft, colors]
    );

    const setColor = (key, value) => setDraft(current => ({ ...current, [key]: value }));

    const startFrom = (presetId) => {
        setPreset(presetId);
        const chosen = APP_COLOR_PRESETS.find(option => option.id === presetId);
        if (chosen) setDraft({ ...chosen.colors });
    };

    return (
        <Dialog
            title={t('settings.appearance.appColors')}
            subtitle={t('appColors.subtitle')}
            width="34rem"
            onClose={onClose}
            footer={
                <>
                    <DialogButton onClick={() => { setPreset(''); setDraft({ ...DEFAULT_APP_COLORS }); }}>
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
                <AppPreview colors={draft} />

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
                        {APP_COLOR_PRESETS.map(option => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                    </select>
                </label>

                {/* One colour, and the ramp is rebuilt around it: the shortcut
                    for "make the app green" without setting five near-identical
                    darks by hand. Every step below stays editable afterwards. */}
                <div className="rounded-xl p-3 bg-gray-50 dark:bg-surface-base/60 border border-gray-200 dark:border-surface-control">
                    <ColorField
                        label={t('appColors.derive')}
                        hint={t('appColors.deriveHint')}
                        value={draft.base}
                        onChange={(value) => { setPreset(''); setDraft(derivePalette(value)); }}
                    />
                </div>

                <div className="pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
                        {t('appColors.surfaces')}
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {APP_COLOR_FIELDS.map(field => (
                            <ColorField
                                key={field.key}
                                label={t(field.labelKey)}
                                hint={t(field.hintKey)}
                                value={draft[field.key]}
                                onChange={(value) => { setPreset(''); setColor(field.key, value); }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
