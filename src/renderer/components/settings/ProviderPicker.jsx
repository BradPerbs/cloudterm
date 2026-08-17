import { Loading03Icon } from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import ProviderMark from '../../lib/provider-marks';
import { PROVIDER_NAMES, PROVIDER_ORDER } from '../../lib/ai-catalog';
import { useT } from '../../i18n';

/**
 * Which agents run behind the assistant.
 *
 * Cards rather than a dropdown, because this is the one setting on the
 * page that changes what the whole feature is: everything below it (the model
 * list, the effort scale, what a tool call even looks like) belongs to
 * whichever agents are running. A row of a select box does not read like that
 * kind of decision, and they are recognised by their marks long before
 * anyone reads the names.
 *
 * More than one can be on. They used to be radio buttons, one agent at a time,
 * and switching meant coming to this page: a person with a Claude plan and an
 * xAI key had to choose between them per question rather than per app. Switched
 * on here, an agent's models join the composer's menu, and picking one there is
 * what decides which of them answers the next message.
 *
 * So these are the app's own checkbox, in its card variant, rather than a card
 * of our own with a tick drawn in the corner. A tick that only appears once you
 * are already on says what the state is; an empty box says what the control
 * does, which is the question someone arriving at this page is asking.
 *
 * At least one stays on. Nothing switched on is a model menu with no models and
 * an assistant that cannot answer, which is the `enabled` toggle's job to say
 * rather than something to arrive at by unticking six boxes.
 *
 * A tick is a request rather than the setting itself: the card spins while the
 * machine is searched for that agent, and the box only fills if it was found.
 * The three that answer over HTTP on a stored key have nothing on disk to look
 * for and are through in the time of one IPC round trip, which is the honest
 * answer for them rather than a wait invented to make the spinner visible.
 *
 * Which cards can be picked is not written here. `available` is the list of
 * providers the main process actually has, so one that has not been built yet
 * says so and cannot be selected, and the day its file lands this picker
 * offers it without being touched.
 */

const HINT_KEYS = {
    'claude-code': 'settings.assistant.provider.claudeCode',
    codex: 'settings.assistant.provider.codex',
    opencode: 'settings.assistant.provider.opencode',
    grok: 'settings.assistant.provider.grok',
    kimi: 'settings.assistant.provider.kimi',
    local: 'settings.assistant.provider.local',
};

/**
 * Why a tick was refused, in the agent's own terms.
 *
 * Anything not named here falls back to "that check could not be finished",
 * which is the honest answer to a reason this build does not recognise: it says
 * the check did not conclude rather than inventing a cause for it.
 */
const REASONS = {
    notFound: 'settings.assistant.provider.notFound',
    noServer: 'settings.assistant.provider.noServer',
    notSignedIn: 'settings.assistant.provider.notSignedIn',
};

/**
 * What the card says under its name.
 *
 * The one line does three jobs, because they are three answers to the same
 * question and putting them in three places would mean a card that grows a row
 * when it is refused and shoves the grid around underneath the pointer.
 */
function CardNote({ provider, ready, checking, rejected }) {
    const t = useT();

    if (checking) {
        return (
            <span className="flex items-center gap-1.5">
                <Loading03Icon size={12} strokeWidth={2.5} className="shrink-0 animate-spin" />
                {t('settings.assistant.provider.checking')}
            </span>
        );
    }

    if (rejected) {
        return (
            <span className="text-amber-600 dark:text-amber-400">
                {t(REASONS[rejected] || 'settings.assistant.provider.checkFailed')}
            </span>
        );
    }

    return ready ? t(HINT_KEYS[provider]) : t('settings.assistant.provider.unavailable');
}

// Three across, wrapping. One long row is how the names start breaking in
// half, and these are read by their marks and their names rather than by
// sitting on one line.
//
// The count comes from the width the grid has rather than being written down as
// three, for the reason CARD_GRID works that way: with the assistant open the
// card these sit in can be half the width it usually is, and a fixed three
// columns there is three cards too narrow to hold a provider's name. Thirteen
// rem is the floor that still gives three across at the card's full width.
const GRID = 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(13rem,100%),1fr))]';

export default function ProviderPicker({
    values = [],
    available = [],
    checking = '',
    rejected = null,
    onToggle,
}) {
    const t = useT();
    const only = values.length === 1;

    return (
        <div className={GRID} role="group">
            {PROVIDER_ORDER.map((provider) => {
                const ready = available.includes(provider);
                const on = values.includes(provider);
                // The last one standing keeps its box ticked, and says why on
                // hover rather than swallowing the click in silence.
                const stuck = on && only;
                const looking = checking === provider;

                return (
                    <div key={provider} title={stuck ? t('settings.assistant.provider.keepOne') : undefined}>
                        <Checkbox
                            variant="card"
                            className="h-full"
                            checked={on}
                            // Held while the machine is being searched for it,
                            // so a second click cannot start a second search
                            // for the same agent.
                            disabled={!ready || looking}
                            onChange={() => !stuck && onToggle(provider)}
                            label={
                                <span className="flex items-center gap-2 min-w-0
                                    text-gray-900 dark:text-white">
                                    <span className="shrink-0 leading-none">
                                        <ProviderMark provider={provider} size={20} />
                                    </span>
                                    <span className="truncate">{PROVIDER_NAMES[provider]}</span>
                                </span>
                            }
                            description={
                                <CardNote
                                    provider={provider}
                                    ready={ready}
                                    checking={looking}
                                    rejected={rejected?.provider === provider ? rejected.reason : ''}
                                />
                            }
                        />
                    </div>
                );
            })}
        </div>
    );
}
