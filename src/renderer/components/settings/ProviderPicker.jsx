import { ChatGptIcon, CpuIcon, Tick02Icon } from 'hugeicons-react';
import openCodeLogoDark from '../../assets/icons/opencode-logo-dark-square.png';
import openCodeLogoLight from '../../assets/icons/opencode-logo-light-square.png';
import { useT } from '../../i18n';

/**
 * Which agent runs behind the assistant.
 *
 * Cards rather than a dropdown, because this is the one setting on the
 * page that changes what the whole feature is: everything below it (the model
 * list, the effort scale, what a tool call even looks like) belongs to
 * whichever of these is chosen. A row of a select box does not read like that
 * kind of decision, and they are recognised by their marks long before
 * anyone reads the names.
 *
 * Which cards can be picked is not written here. `available` is the list of
 * providers the main process actually has, so one that has not been built yet
 * says so and cannot be selected, and the day its file lands this picker
 * offers it without being touched.
 */

/**
 * Claude Code's mark, as the single path Simple Icons publishes for it. The
 * path data is CC0; the mark itself is Anthropic's, used here to name their
 * product and nothing else.
 */
function ClaudeCodeMark({ size = 22 }) {
    return (
        <svg
            role="img"
            aria-hidden="true"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z" />
        </svg>
    );
}

function OpenCodeMark({ size = 22 }) {
    return (
        <>
            <img
                src={openCodeLogoLight}
                alt=""
                aria-hidden="true"
                width={size}
                height={size}
                className="block dark:hidden"
            />
            <img
                src={openCodeLogoDark}
                alt=""
                aria-hidden="true"
                width={size}
                height={size}
                className="hidden dark:block"
            />
        </>
    );
}

/**
 * Grok's mark, as the two filled strokes xAI draws it with. The mark is
 * theirs, used here to name their product and nothing else.
 *
 * What stood here before was a glyph of our own: a slash with a broken
 * diagonal across it, which is xAI's corporate mark rather than Grok's, so the
 * card carried the wrong logo for the thing it names. A card that is read by
 * its mark before its name has to carry the right one.
 */
function GrokMark({ size = 22 }) {
    return (
        <svg
            role="img"
            aria-hidden="true"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            fillRule="evenodd"
        >
            <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
        </svg>
    );
}

const PROVIDERS = [
    {
        value: 'claude-code',
        name: 'Claude Code',
        hintKey: 'settings.assistant.provider.claudeCode',
        mark: ClaudeCodeMark,
    },
    {
        value: 'codex',
        name: 'Codex',
        hintKey: 'settings.assistant.provider.codex',
        mark: ({ size = 22 }) => <ChatGptIcon size={size} strokeWidth={1.5} />,
    },
    {
        value: 'opencode',
        name: 'OpenCode',
        hintKey: 'settings.assistant.provider.opencode',
        mark: OpenCodeMark,
    },
    {
        value: 'grok',
        name: 'Grok Build',
        hintKey: 'settings.assistant.provider.grok',
        mark: GrokMark,
    },
    {
        value: 'local',
        // Not the name of one product, because it is not one product: the card
        // is for whatever is listening on the address below it.
        name: 'Local model',
        hintKey: 'settings.assistant.provider.local',
        mark: ({ size = 22 }) => <CpuIcon size={size} strokeWidth={1.5} />,
    },
];

// Three across, wrapping. A row of five is how the names start breaking in
// half, and these are read by their marks and their names rather than by
// sitting on one line.
const CARD = `relative min-w-0 p-3 rounded-xl border text-left transition-colors outline-none
    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

export default function ProviderPicker({ value, available = [], onChange }) {
    const t = useT();

    return (
        <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((provider) => {
                const Mark = provider.mark;
                const ready = available.includes(provider.value);
                const selected = provider.value === value;

                return (
                    <button
                        key={provider.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!ready}
                        onClick={() => !selected && onChange(provider.value)}
                        className={`${CARD} ${selected
                            ? 'border-gray-900 dark:border-white bg-gray-50 dark:bg-white/[0.06]'
                            : 'border-gray-200 dark:border-surface-control hover:border-gray-300 '
                                + 'dark:hover:border-white/25'}
                            ${ready ? '' : 'opacity-50 cursor-not-allowed hover:border-gray-200'}`}
                    >
                        {selected && (
                            <Tick02Icon
                                size={14}
                                strokeWidth={2.5}
                                className="absolute top-2.5 right-2.5 text-gray-900 dark:text-white"
                            />
                        )}

                        <span className="flex items-center gap-2 min-w-0 text-gray-900 dark:text-white">
                            <span className="shrink-0 leading-none">
                                <Mark size={22} />
                            </span>
                            <span className="text-sm font-semibold truncate">{provider.name}</span>
                        </span>

                        <span className="mt-1.5 block text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                            {ready ? t(provider.hintKey) : t('settings.assistant.provider.unavailable')}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
