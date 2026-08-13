import { useMemo } from 'react';
import { ArrowDown01Icon, Loading03Icon, Refresh01Icon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';
import EffortSlider from './EffortSlider';
import {
    modelRows,
    modelRow,
    effortStops,
    effortLabel,
    nearestEffort,
    isDiscovered,
} from '../../lib/ai-catalog';
import { useT } from '../../i18n';

/**
 * The model and how hard it should think, as one chip in the composer.
 *
 * These two live on the settings page as well, where they are explained
 * properly. They are repeated here because they are the settings people change
 * mid-conversation, when an answer was not good enough or is taking too long,
 * and walking to a settings page to do it means losing the thread you were
 * pulling on. One control for both, because "which model, how hard" is a
 * single decision about how much this next question is worth.
 *
 * Neither list is written here, and neither has a hardcoded stand-in. `models`
 * is what the installed Claude Code reported it can run, and the effort scale
 * is narrowed to the levels the chosen model actually takes, which is not the
 * same five for all of them. Until the runtime has been asked, which it can
 * only be once it is running, the menu offers the one row that is true either
 * way: whatever Claude Code is already set to use.
 */

/**
 * What the list is doing, when it is not simply there.
 *
 * Reading a catalog means starting the agent's runtime, which takes about a
 * second and sometimes fails, and a menu with one row in it looks the same
 * either way. So it says which: still coming, or came back with nothing and
 * here is the button to ask again.
 */
function ModelNote({ loading, onRefresh }) {
    const t = useT();

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-2.5 h-9 text-[11px] text-gray-500 dark:text-neutral-400">
                <Loading03Icon size={13} strokeWidth={2} className="shrink-0 animate-spin" />
                {t('assistant.readingModels')}
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={onRefresh}
            className="w-full h-9 px-2.5 flex items-center gap-2 rounded-lg text-left text-[11px]
                transition-colors text-gray-500 dark:text-neutral-400
                hover:bg-gray-100 dark:hover:bg-surface-control
                hover:text-gray-900 dark:hover:text-white"
        >
            <Refresh01Icon size={13} strokeWidth={2} className="shrink-0" />
            {t('assistant.noModels')}
        </button>
    );
}

export default function ModelMenu({ settings, models, loading, onRefresh, onChange }) {
    const t = useT();
    const rows = useMemo(
        () => modelRows(models, settings.model, settings.provider),
        [models, settings.model, settings.provider]
    );

    const model = modelRow(rows, settings.model);
    const stops = useMemo(() => effortStops(model), [model]);

    // What the dial shows, which is the saved level unless this model does not
    // have that stop. The setting itself is not rewritten: switching back to a
    // model that has it should show the choice, not the compromise.
    const shown = nearestEffort(stops, settings.effort);
    const effort = stops.find(option => option.value === shown);

    const discovered = isDiscovered(models);

    const sections = [
        {
            heading: t('assistant.model'),
            // Nothing under the rows once the list is there: the rows are the
            // answer, and a refresh button under a working menu is furniture.
            note: discovered ? null : <ModelNote loading={loading} onRefresh={onRefresh} />,
            value: settings.model,
            // The effort travels with the model, because the scales differ:
            // picking one that stops at "extra high" while "ultra" is saved
            // would leave a setting no menu shows and the agent cannot honour.
            // Written here rather than silently on render, since this is the
            // user changing something.
            onChange: (value) => onChange({
                model: value,
                effort: nearestEffort(effortStops(modelRow(rows, value)), settings.effort),
            }),
            options: rows,
        },
    ];

    // A model with no effort setting, or with only one level, gets no dial. A
    // scale you cannot move is a control that reports a state rather than
    // changing one, and the panel has a settings page for saying things.
    if (stops.length > 1) {
        sections.push({
            heading: t('assistant.effort'),
            // The tick a row would have carried, moved to the heading: the
            // slider shows where you are on the scale but not what that
            // position is called.
            aside: effortLabel(effort),
            content: (
                <EffortSlider
                    options={stops}
                    value={shown}
                    onChange={(value) => onChange({ effort: value })}
                />
            ),
        });
    }

    return (
        <PanelMenu
            align="right"
            direction="up"
            menuClassName="w-60"
            sections={sections}
            trigger={({ open, toggle }) => (
                <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={toggle}
                    title={t('assistant.modelAndEffort')}
                    className={`h-7 pl-2 pr-1.5 rounded-xl flex items-center gap-1 transition-colors
                        text-[11px] outline-none focus-visible:ring-2
                        focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                        ${open
                            ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-900 dark:text-gray-100'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] '
                                + 'hover:text-gray-700 dark:hover:text-gray-200'}`}
                >
                    <span className="font-medium">{model.short}</span>
                    {effort && <span className="opacity-60">{effortLabel(effort)}</span>}
                    <ArrowDown01Icon
                        size={11}
                        strokeWidth={2}
                        className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                </button>
            )}
        />
    );
}
