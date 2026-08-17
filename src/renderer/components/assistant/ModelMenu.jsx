import { useMemo } from 'react';
import { ArrowDown01Icon, Loading03Icon, Refresh01Icon } from 'hugeicons-react';
import PanelMenu from './PanelMenu';
import EffortSlider from './EffortSlider';
import ProviderMark from '../../lib/provider-marks';
import {
    PROVIDER_NAMES,
    mergedModelRows,
    currentModelRow,
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
 * Neither list is written here, and neither has a hardcoded stand-in.
 * `catalogs` is what each agent reported it can run, and the effort scale is
 * narrowed to the levels the chosen model actually takes, which is not the same
 * five for all of them. An agent that has not answered yet puts no rows here at
 * all: the note under them says whether that is a read still in flight or one
 * that came back with nothing, which is what a row standing in for the answer
 * used to hide.
 *
 * Every agent switched on in settings has its models here, in one list. That is
 * the whole point of letting several be on: choosing between Opus and Grok is
 * the same kind of choice as choosing between Opus and Haiku, made in the same
 * moment and about the same question, and sending someone to a settings page
 * for one of them and not the other was never a real distinction. Picking a row
 * moves the agent as well as the model, because a model belongs to exactly one
 * of them.
 */

/**
 * What the list is doing, when it is not simply there.
 *
 * Reading a catalog means starting the agent's runtime, which takes about a
 * second and sometimes fails, and a menu with one row in it looks the same
 * either way. So it says which: still coming, or came back with nothing and
 * here is the button to ask again.
 *
 * `partial` is the case that only exists now that several agents can be on at
 * once: three of them answered and the fourth did not. "No models reported"
 * under a menu full of models reads as a bug in the menu, so it says which of
 * the two happened.
 */
function ModelNote({ loading, partial, onRefresh }) {
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
            {t(partial ? 'assistant.someNoModels' : 'assistant.noModels')}
        </button>
    );
}

export default function ModelMenu({ settings, catalogs, providers, loading, onRefresh, onChange }) {
    const t = useT();
    const rows = useMemo(
        () => mergedModelRows(catalogs, providers, settings),
        [catalogs, providers, settings]
    );

    // Undefined when nothing is pinned and the agent has not named a default,
    // which includes every agent that has not answered yet. The chip says which
    // agent it is in that case, since that much is true and known, and the menu
    // ticks nothing: a list with no choice marked is what "no choice made"
    // looks like.
    const model = currentModelRow(rows, settings);
    const stops = useMemo(() => effortStops(model), [model]);

    // What the dial shows, which is the saved level unless this model does not
    // have that stop. The setting itself is not rewritten: switching back to a
    // model that has it should show the choice, not the compromise.
    const shown = nearestEffort(stops, settings.effort);
    const effort = stops.find(option => option.value === shown);

    // Marks only once there is more than one agent to tell apart. With one on,
    // every row would carry the same mark, which is decoration: it answers a
    // question nobody in that situation is asking.
    const marked = providers.length > 1;

    // The agents that have not answered. One with nothing still contributes its
    // "whatever it is set to" row, so the list is never empty; what the note is
    // for is saying that some of it is still coming, or came back empty and can
    // be asked for again.
    const missing = providers.filter(provider => !isDiscovered(catalogs?.[provider]));

    const sections = [
        {
            heading: t('assistant.model'),
            // Nothing under the rows once every list is there: the rows are the
            // answer, and a refresh button under a working menu is furniture.
            note: missing.length > 0 ? (
                <ModelNote
                    loading={loading}
                    partial={missing.length < providers.length}
                    onRefresh={onRefresh}
                />
            ) : null,
            value: model?.key,
            // The effort travels with the model, because the scales differ:
            // picking one that stops at "extra high" while "ultra" is saved
            // would leave a setting no menu shows and the agent cannot honour.
            // Written here rather than silently on render, since this is the
            // user changing something.
            //
            // The agent travels with it too. A row names one model of one
            // agent's, so the pair goes over together and the settings take
            // them as one change rather than as a switch of agent that throws
            // the model away.
            onChange: (key) => {
                const picked = rows.find(row => row.key === key);
                if (!picked) return;
                onChange({
                    provider: picked.provider,
                    model: picked.value,
                    effort: nearestEffort(effortStops(picked), settings.effort),
                });
            },
            options: rows.map(row => ({
                ...row,
                // The menu matches and keys on this, and a model id alone is
                // not unique across agents: every agent that keeps its default
                // to itself offers a row valued ''.
                value: row.key,
                icon: marked ? <ProviderMark provider={row.provider} size={14} /> : null,
            })),
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
                    {/* The chip says which agent as well as which model once
                        there is more than one it could be. Two of them can
                        offer a model called `sonnet`, and the name on its own
                        would not say whose plan the next question is spending. */}
                    {marked && (
                        <span className="shrink-0 flex items-center">
                            <ProviderMark provider={model?.provider || settings.provider} size={13} />
                        </span>
                    )}
                    <span className="font-medium">
                        {model?.short || PROVIDER_NAMES[settings.provider] || ''}
                    </span>
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
