const { scrub } = require('./pasted-secrets');

/**
 * A conversation as Markdown, for the clipboard or a file.
 *
 * Two cuts of the same document. The plain one is for a ticket or a hand-over:
 * what was said, and each tool call as a line with its result under it, cut
 * short where a result runs long. The full one is for a bug report, or for
 * pasting into another chat and saying "look at this": the agent and settings
 * it ran under, every tool input as it was sent, results as they came back
 * rather than the first screen of them, and the time of each step.
 *
 * Built from the stored events, which were masked on the way in (see
 * `pasted-secrets.js`), and then passed through the same finder again as a
 * whole. A file or a clipboard leaves the app, so the export does not rely on
 * every event having been masked when it was recorded: a key the agent put in
 * a command, or a server printed in a result, is masked here even where the
 * transcript shows it. A false positive costs a few characters of a document;
 * a miss puts a live credential in someone's ticket.
 *
 * The words are the renderer's, which has the translations, passed in as
 * `labels`; English stands in for anything it leaves out, which is also what
 * the tests read.
 */

const DEFAULT_LABELS = {
    untitled: 'New conversation',
    when: 'Started {started} · exported {exported}',
    setup: 'Agent: {agent} · model {model} · effort {effort} · approvals {approval}',
    defaultModel: 'its own default',
    id: 'Conversation id: {id}',
    you: 'You',
    agent: 'AI Agent',
    asked: 'Asked',
    error: 'Error',
    warning: 'Warning',
    approved: 'Allowed',
    denied: 'Declined',
    expired: 'Timed out',
    stopped: 'Stopped.',
    image: 'Image: {name}',
    spec: 'Spec: {name}',
    more: 'Characters not shown: {count}',
};

/** How much of one result the plain cut keeps, and the full one. */
const RESULT_CAP = 4000;
const FULL_RESULT_CAP = 20000;

const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
));

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const iso = (time) => {
    const date = new Date(Number(time) || 0);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

/**
 * A fence that cannot be closed from inside. A result that prints three
 * backticks of its own would otherwise end the block early and turn the rest
 * of the document into whatever the server printed.
 */
const fence = (text, lang = '') => `\`\`\`${lang}\n${String(text ?? '').replace(/```/g, '``​`')}\n\`\`\``;

/** Inline code, with any backtick in it turned into a quote so it stays one span. */
const code = (text) => `\`${String(text).replace(/`/g, '\'')}\``;

/**
 * A call's input as one line: the command for a command, the arguments
 * otherwise. Each value is masked before it is cut short, so a key cut in
 * half is not left with half of it showing.
 */
function summarise(event, secrets) {
    const input = event.input && typeof event.input === 'object' ? event.input : {};
    if (typeof input.command === 'string' && input.command.trim()) return oneLine(input.command);
    return Object.entries(input)
        .filter(([key]) => key !== 'session')
        .map(([key, value]) => {
            const text = scrub(oneLine(typeof value === 'string' ? value : JSON.stringify(value)), secrets);
            return `${key}: ${text.slice(0, 120)}`;
        })
        .join(', ')
        .slice(0, 300);
}

/** Only the labels that are strings, so a stray value cannot put an object in the document. */
function readLabels(labels) {
    const out = { ...DEFAULT_LABELS };
    if (!labels || typeof labels !== 'object') return out;
    for (const key of Object.keys(DEFAULT_LABELS)) {
        if (typeof labels[key] === 'string' && labels[key].trim()) out[key] = labels[key];
    }
    return out;
}

/**
 * The document, from a conversation as `ai/index.js` holds it: `{ id, title,
 * createdAt, provider, events, secrets }`.
 *
 * `settings` is what the full cut's header reports (the model, effort and
 * approvals); `agents` names the runtimes by id.
 */
function toMarkdown(conversation, { full = false, labels = null, agents = null, settings = null, now = Date.now() } = {}) {
    if (!conversation) return '';
    const say = readLabels(labels);
    const events = Array.isArray(conversation.events) ? conversation.events : [];
    const resultCap = full ? FULL_RESULT_CAP : RESULT_CAP;
    const stamp = (event) => (full && event.at ? ` <sub>${iso(event.at).slice(11, 19)}</sub>` : '');

    const lines = [
        `# ${oneLine(conversation.title) || say.untitled}`,
        '',
        fill(say.when, { started: iso(conversation.createdAt), exported: iso(now) }),
        '',
    ];

    if (full) {
        const provider = conversation.provider || settings?.provider || '';
        lines.push(
            fill(say.setup, {
                agent: (agents && typeof agents[provider] === 'string' && agents[provider]) || provider || '?',
                model: settings?.model || say.defaultModel,
                effort: settings?.effort || '?',
                approval: settings?.approval || '?',
            }),
            fill(say.id, { id: conversation.id || '' }),
            '',
        );
    }

    /**
     * A result is printed under the call it answers rather than where it fell.
     *
     * An agent that makes three calls at once produces three calls and then
     * three results, and in a flat transcript each result reads as the answer
     * to the call just above it, which is the wrong one. Both events carry the
     * call's id, so they are put back together here.
     */
    const resultFor = new Map();
    for (const event of events) {
        if (event.type === 'tool-result' && event.id) resultFor.set(event.id, event);
    }
    const printed = new Set();
    const pushResult = (event) => {
        if (!event?.text) return;
        // Masked before it is cut, as a summary is.
        const text = scrub(String(event.text), conversation.secrets);
        lines.push(fence(text.slice(0, resultCap)), '');
        if (text.length > resultCap) lines.push(`_${fill(say.more, { count: text.length - resultCap })}_`, '');
    };

    for (const event of events) {
        switch (event.type) {
            case 'user-message': {
                const attached = [
                    ...(Array.isArray(event.images) ? event.images : []).map(image => `[${fill(say.image, { name: image?.name || '' })}]`),
                    ...(Array.isArray(event.specs) ? event.specs : []).map(spec => `[${fill(say.spec, { name: spec?.name || '' })}]`),
                ];
                lines.push(`## ${say.you}${stamp(event)}`, '', [...attached, event.text || ''].filter(Boolean).join('\n'), '');
                break;
            }
            case 'assistant-text':
                if (String(event.text || '').trim()) lines.push(`## ${say.agent}${stamp(event)}`, '', event.text, '');
                break;
            case 'tool-call': {
                if (full) {
                    lines.push(`**${event.name}**${stamp(event)}`, '');
                    if (event.input && typeof event.input === 'object' && Object.keys(event.input).length) {
                        lines.push(fence(JSON.stringify(event.input, null, 2), 'json'), '');
                    }
                } else {
                    const input = summarise(event, conversation.secrets);
                    lines.push(`**${event.name}**${input ? ` ${code(input)}` : ''}`, '');
                }
                // Its own answer, here, whether or not other calls came between.
                const answer = resultFor.get(event.id);
                if (answer) {
                    printed.add(answer);
                    pushResult(answer);
                }
                break;
            }
            case 'tool-result':
                // Only the ones no call claimed: a result whose call the log no
                // longer holds is still worth reading.
                if (!printed.has(event)) pushResult(event);
                break;
            case 'approval-request':
                // A question is put in the words it was asked in. An approval
                // needs nothing here: its call is the line above, and how it
                // was settled is the line below.
                if (event.question) {
                    const asked = Array.isArray(event.input?.questions)
                        ? event.input.questions.map(entry => oneLine(entry?.question)).filter(Boolean).join(' / ')
                        : oneLine(event.input?.question);
                    if (asked) lines.push(`> **${say.asked}:** ${asked}`, '');
                }
                break;
            case 'approval-settled': {
                const status = { approved: say.approved, denied: say.denied, expired: say.expired }[event.status];
                if (status) lines.push(`_${status}_`, '');
                break;
            }
            case 'error':
                lines.push(`> **${say.error}:** ${oneLine(event.message || event.text)}`, '');
                break;
            case 'warning':
                lines.push(`> **${say.warning}:** ${oneLine(event.message)}`, '');
                break;
            case 'tool-failed':
                lines.push(`> **${say.warning}:** ${oneLine(`${event.name}: ${event.message}`)}`, '');
                break;
            case 'notice':
            case 'model-changed':
                if (event.text) lines.push(`_${oneLine(event.text)}_`, '');
                break;
            case 'interrupted':
                lines.push(`_${say.stopped}_`, '');
                break;
            default:
                // Stream previews, accounts, results and the rest: how the turn
                // ran, not what was said in it.
                break;
        }
    }

    return scrub(`${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`, conversation.secrets);
}

/**
 * A name for the file, from the title: letters, digits, spaces and dashes in
 * any script, so a Russian or Chinese title is not reduced to nothing.
 */
function fileName(title) {
    const base = oneLine(title)
        .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .trim();
    return `${base || 'conversation'}.md`;
}

module.exports = { toMarkdown, fileName, DEFAULT_LABELS };
