import { ChatGptIcon, Tick02Icon } from 'hugeicons-react';
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
];

const CARD = `relative flex-1 min-w-0 p-3 rounded-xl border text-left transition-colors outline-none
    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

export default function ProviderPicker({ value, available = [], onChange }) {
    const t = useT();

    return (
        <div className="flex gap-2">
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

                        <span className="flex items-center gap-2 text-gray-900 dark:text-white">
                            <Mark size={22} />
                            <span className="text-sm font-semibold">{provider.name}</span>
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
