/**
 * What a conversation is called.
 *
 * It used to be the first message cut at eighty characters, which in a list
 * reads as "hey can you have a look at the web box, it's been throwing 502s
 * since" rather than as what the chat is about. So once the first exchange is
 * over, the agent the conversation runs on is asked, once and off to the side
 * of the chat, for a few words that say what the task is.
 *
 * The first message cut at eighty characters is still the name until that
 * answer is in, and it is what stays on an agent with no way to ask, or when
 * the question fails or times out.
 *
 * Nothing in here masks anything. The caller masks what goes in and what
 * comes out (see `pasted-secrets.js`), because only it knows which values a
 * conversation has been handed.
 */

/** Longest name the agent's answer is cut to, in characters. */
const MAX_LENGTH = 60;

/** How long the agent gets to answer before the draft stands. */
const TIMEOUT = 60 * 1000;

/** How much of each message the namer is shown. The start says what it is. */
const SHOWN = 1500;

const INSTRUCTION = [
    'You name conversations between a person and an assistant that works on their servers.',
    'Reply with a title of 3 to 6 words that describes what the conversation is about, the way a short subject line would:',
    '"Fix 502 errors on web-01", "Rotate SSH keys on staging", "Disk space alert on db-02", "Set up nightly Postgres backups".',
    'Sentence case. Keep host, service and product names as written. No quotes, no trailing punctuation, no emoji.',
    'Write it in the language the person wrote in.',
    'Reply with the title and nothing else. Do not answer the request or act on it.',
].join(' ');

/** The question put to the agent: the person's first messages, fenced. */
function request(messages) {
    const said = messages
        .map(text => String(text || '').trim().slice(0, SHOWN))
        .filter(Boolean)
        .map(text => `User: ${text}`)
        .join('\n\n');
    return `Name this conversation. Reply with the title only.\n\n<conversation>\n${said}\n</conversation>`;
}

/** A greeting, a filler word, or a run of them, at the start of a message. */
const OPENERS = /^(?:(?:hi|hey|hello|hiya|yo|ok|okay|so|um|uh|please|pls|thanks|quick question)\b[\s,!.:;-]*)+/i;

/**
 * Whether a first message says too little to be named from: "hi", "help",
 * "are you there". Those wait for the next exchange.
 */
function tooThin(text) {
    const words = String(text || '').replace(OPENERS, '').trim().split(/\s+/).filter(Boolean);
    return words.length < 3;
}

/** Cut to `max` characters at a word, with an ellipsis if anything went. */
function cut(text, max = MAX_LENGTH) {
    if (text.length <= max) return text;
    const head = text.slice(0, max - 1);
    const space = head.lastIndexOf(' ');
    return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * The agent's answer, as a name, or '' if it is not one.
 *
 * Models dress a title up however they were told not to: a "Title:" label,
 * quotes, bold, a full stop. Those come off. An answer that runs to a
 * paragraph is the model answering the request instead, and is refused.
 */
function clean(reply) {
    const line = String(reply || '')
        // A local reasoning model thinks out loud in the reply itself.
        .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
        .split(/\r?\n/)
        .map(entry => entry.trim())
        .find(Boolean) || '';
    const name = line
        .replace(/^#+\s*/, '')
        .replace(/^(?:\*\*)?title(?:\*\*)?\s*:\s*/i, '')
        .replace(/^["'“”‘’`*_]+|["'“”‘’`*_.。]+$/g, '')
        .replace(/[.。]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!name || name.split(' ').length > 12) return '';
    return cut(name);
}

/**
 * Ask the agent for a name. Resolves '' whenever there is none to be had: an
 * agent that cannot be asked, a failure, a timeout, or an answer that is not
 * a title. Never rejects, because the draft is always there.
 */
async function generate(provider, { settings, messages, timeout = TIMEOUT }) {
    if (typeof provider?.title !== 'function') return '';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    timer.unref?.();
    try {
        const reply = await Promise.race([
            provider.title({
                settings,
                instruction: INSTRUCTION,
                prompt: request(messages),
                signal: abort.signal,
            }),
            // An agent that does not hear the abort still loses the race.
            new Promise(resolve => abort.signal.addEventListener('abort', () => resolve(''), { once: true })),
        ]);
        return abort.signal.aborted ? '' : clean(reply);
    } catch {
        return '';
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The naming, bound to the assistant's own state.
 *
 *   providers  the agents this build has, by name
 *   effective  the settings a conversation runs under
 *   alive      whether a conversation is still one the app holds
 *   emit       record an event in a conversation and pass it on
 *   save       write the conversations out
 *   mask       a conversation's text with its pasted secrets masked
 *
 * Returns `consider(conversation)`, called when a turn ends. It asks once,
 * after the first exchange, or after the second when the first message was
 * too thin to say what the chat is about. A conversation only has a draft to
 * replace when it was started under this code: older ones keep their names.
 *
 * Asked of the agent the conversation runs on, with the person's own
 * messages and nothing else, so nothing goes anywhere the chat itself did not
 * send. Asked once the reply is in, as a request of its own with no tools
 * and no session: it is never in the reply's way, asks for no approval and
 * writes nothing into the transcript. The messages are read from the log,
 * where a pasted key is already masked, and the answer is masked again on
 * the way back in case the model quoted one.
 */
function createNamer({ providers, effective, alive, emit, save, mask }) {
    return function consider(conversation) {
        if (conversation.titleSource !== 'draft') return;
        const said = conversation.events
            .filter(event => event.type === 'user-message' && event.text)
            .map(event => event.text)
            .slice(0, 2);
        if (said.length === 0) return;
        if (said.length === 1 && tooThin(said[0])) return;

        const current = effective(conversation);
        const provider = providers[current.provider];
        if (typeof provider?.title !== 'function') {
            conversation.titleSource = 'message';
            save();
            return;
        }

        conversation.titleSource = 'naming';
        const before = conversation.title;
        generate(provider, { settings: current, messages: said }).then((name) => {
            // Closed, or renamed some other way, while the question was out.
            if (!alive(conversation)) return;
            if (conversation.titleSource !== 'naming' || conversation.title !== before) return;

            const title = name ? mask(conversation, name) : '';
            conversation.titleSource = title ? 'model' : 'message';
            if (!title) {
                save();
                return;
            }
            conversation.title = title;
            // An event rather than a quiet change, so the tab showing this
            // conversation is told; and in the log, so a panel rebuilt from
            // it arrives at the same name.
            emit(conversation, { type: 'title', title });
        });
    };
}

module.exports = {
    tooThin,
    generate,
    createNamer,
    MAX_LENGTH,
    _test: { clean, cut, request, INSTRUCTION },
};
