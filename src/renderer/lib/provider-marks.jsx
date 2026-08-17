import { ChatGptIcon, CpuIcon } from 'hugeicons-react';
import openCodeLogoDark from '../assets/icons/opencode-logo-dark-square.png';
import openCodeLogoLight from '../assets/icons/opencode-logo-light-square.png';

/**
 * The mark each agent goes by.
 *
 * These lived inside the settings picker while a card on that page was the only
 * place an agent was ever named. More than one agent can be switched on now, so
 * the composer's model menu lists several agents' models together and every row
 * has to say whose it is: a mark does that in the width of a checkbox, where the
 * name would take the room the model's own name needs.
 *
 * Each is drawn in `currentColor` so it takes the tint of whatever it sits in,
 * except OpenCode's, which is artwork rather than a glyph and comes as a light
 * and a dark copy.
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

/**
 * Kimi's mark, as the dot and the stroke Moonshot draw it with. The mark is
 * theirs, used here to name their product and nothing else.
 */
function KimiMark({ size = 22 }) {
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
            <path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z" />
            <path d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z" />
        </svg>
    );
}

const MARKS = {
    'claude-code': ClaudeCodeMark,
    codex: ({ size = 22 }) => <ChatGptIcon size={size} strokeWidth={1.5} />,
    opencode: OpenCodeMark,
    grok: GrokMark,
    kimi: KimiMark,
    // Not one product's mark, because it is not one product: whatever is
    // listening on the address the user typed.
    local: ({ size = 22 }) => <CpuIcon size={size} strokeWidth={1.5} />,
};

/** One agent's mark, or nothing at all for a name we do not draw. */
export default function ProviderMark({ provider, size = 22 }) {
    const Mark = MARKS[provider];
    return Mark ? <Mark size={size} /> : null;
}
