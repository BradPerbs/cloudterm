const zodModule = require('zod');
const catalog = require('../tools');

// As in `tools.js`: zod 4 answers to either name depending on how it is
// reached, and taking whichever exists keeps this working on both builds.
const z = zodModule.z || zodModule;

/**
 * The agent loop, for servers that speak the OpenAI chat API and nothing else.
 *
 * The other three providers each drive a coding agent that someone installed:
 * the agent owns the loop, the tool calling and the model, and the file next to
 * this one is a translator between its stream and this app's transcript. There
 * is no such agent behind a model server. LM Studio, Ollama, llama.cpp and vLLM
 * answer one request with one completion, so the loop has to live here: send
 * the conversation with the tool definitions attached, run whatever tools come
 * back, send the results, repeat until the model stops asking for tools.
 *
 * That is the whole of this file, and it is deliberately not specific to any
 * one of them. `local.js` points it at a server on this machine and `grok.js`
 * at api.x.ai when the Grok Build CLI is not installed. Anything else that
 * speaks the same shape is a caller away.
 *
 * Two consequences worth knowing.
 *
 * There are no local tools here. The model gets the tools this app hands it and
 * has no others, so the "may it touch this machine" switch has nothing to turn
 * off: every call goes to a server through `tools.js`, and every one of them
 * passes the same approval gate the other providers stop at.
 *
 * The conversation lives in this process. An agent CLI keeps its own history on
 * disk and takes a session id to resume; here the messages are the history, so
 * they are kept in `histories` below and a conversation that is parked and
 * picked up again finds them.
 */

/** How long one request may take before it is abandoned. */
const REQUEST_TIMEOUT = 10 * 60 * 1000;

/**
 * How many messages a conversation carries into the next request.
 *
 * Local models are the reason there is a cap at all: a 8k context is common,
 * and a conversation that has run for twenty tool calls will not fit in one.
 * The oldest go first, which loses the beginning of a long session rather than
 * failing the next request outright.
 */
const MAX_MESSAGES = 80;

/** How many conversations keep their history once they are parked. */
const MAX_HISTORIES = 12;

/** sessionId -> the message array that is that conversation. */
const histories = new Map();

let counter = 0;

function nextSessionId(prefix) {
    counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/* ------------------------------------------------------------------ *
 * The tools, as this API wants them
 * ------------------------------------------------------------------ */

let toolCache = null;

/**
 * The catalog as OpenAI function definitions.
 *
 * `tools.js` describes its arguments in zod, because that is what the Claude
 * SDK and the MCP server both take. This API wants JSON Schema, and zod 4
 * writes it, so the shapes are converted once rather than maintained twice.
 * The `$schema` line goes: it says which dialect the document is in, which is
 * true and which several servers reject as an unknown key.
 */
function functionTools() {
    if (toolCache) return toolCache;

    toolCache = catalog.TOOLS.map((definition) => {
        const { $schema, ...parameters } = z.toJSONSchema(z.object(definition.shape), {
            target: 'draft-7',
            io: 'input',
        });
        return {
            type: 'function',
            function: {
                name: definition.name,
                description: definition.description,
                parameters,
            },
        };
    });

    return toolCache;
}

/* ------------------------------------------------------------------ *
 * Reading the stream
 * ------------------------------------------------------------------ */

/**
 * Server-sent events, one JSON payload at a time.
 *
 * Chunks arrive on byte boundaries rather than line boundaries, so a payload
 * routinely spans two of them. This holds the tail until it has a whole line.
 * `[DONE]` is the sentinel that ends the stream and is not JSON, so it is
 * dropped here rather than at every call site.
 */
function createSseReader() {
    let buffer = '';

    return {
        push(text) {
            buffer += text;
            const payloads = [];

            let index = buffer.indexOf('\n');
            while (index >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf('\n');

                if (!line.startsWith('data:')) continue;
                const body = line.slice(5).trim();
                if (!body || body === '[DONE]') continue;
                try {
                    payloads.push(JSON.parse(body));
                } catch {
                    // A half-written payload, or a server writing something
                    // that is not JSON on this channel. Neither is worth
                    // ending a turn over.
                }
            }

            return payloads;
        },
    };
}

/**
 * One completion, assembled from however many chunks it arrived in.
 *
 * Both shapes are read: a streamed `delta` and, for the servers that ignore
 * `stream`, a whole `message`. The reasoning field has three spellings in the
 * wild and they are all taken, since which one a server uses is a property of
 * whose fork it was built from rather than of anything the user chose.
 */
function createCollector(onEvent) {
    const calls = new Map();
    let content = '';
    let usage = null;
    let finish = '';

    const readCall = (raw, position) => {
        const key = raw.index ?? raw.id ?? position;
        const call = calls.get(key) || { id: '', name: '', args: '' };
        if (raw.id) call.id = raw.id;
        if (raw.function?.name) call.name = raw.function.name;
        if (typeof raw.function?.arguments === 'string') call.args += raw.function.arguments;
        calls.set(key, call);
    };

    return {
        chunk(payload) {
            if (payload?.usage) usage = payload.usage;

            const choice = payload?.choices?.[0];
            if (!choice) return;
            if (choice.finish_reason) finish = choice.finish_reason;

            const part = choice.delta || choice.message;
            if (!part) return;

            const thinking = part.reasoning_content ?? part.reasoning ?? part.thinking;
            if (typeof thinking === 'string' && thinking) {
                onEvent({ type: 'thinking-delta', text: thinking });
            }

            if (typeof part.content === 'string' && part.content) {
                content += part.content;
                onEvent({ type: 'text-delta', text: part.content });
            }

            (part.tool_calls || []).forEach(readCall);
        },
        result() {
            return {
                content,
                usage,
                finish,
                // Anything without a name is a fragment of a call the stream
                // never finished, which is what a cut-off response looks like.
                toolCalls: [...calls.values()]
                    .filter(call => call.name)
                    .map((call, position) => ({ ...call, id: call.id || `call-${position}` })),
            };
        },
    };
}

/**
 * What the server said went wrong, in a sentence rather than a status code.
 *
 * Model servers put the reason in a JSON body far more often than in the
 * status line, and "400" on its own sends people to the wrong place entirely
 * when the actual answer is "this model was loaded without tool support".
 */
async function httpFailure(response, label) {
    let detail = '';
    try {
        const body = (await response.text()).slice(0, 2000);
        try {
            const parsed = JSON.parse(body);
            detail = parsed?.error?.message || parsed?.error || parsed?.message || body;
        } catch {
            detail = body;
        }
    } catch {
        // Nothing readable on the wire.
    }
    detail = String(detail || '').trim();
    return new Error(`${label} answered ${response.status}${detail ? `: ${detail}` : ''}`);
}

/**
 * One request, streamed if the server is willing.
 *
 * A server that ignores `stream` and answers with one JSON document is not
 * broken, it is just older, and the collector reads that shape too. So the
 * content type decides how the body is read rather than which code path the
 * conversation is on.
 */
async function complete({ endpoint, messages, model, tools, extra, signal, onEvent }) {
    const headers = { 'Content-Type': 'application/json', ...(endpoint.headers || {}) };
    if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
            ...extra,
        }),
    });

    if (!response.ok) throw await httpFailure(response, endpoint.label);

    const collector = createCollector(onEvent);
    const streaming = String(response.headers.get('content-type') || '').includes('event-stream');

    if (!streaming) {
        const payload = await response.json();
        collector.chunk(payload);
        return collector.result();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = createSseReader();

    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
            collector.chunk(payload);
        }
    }

    return collector.result();
}

/* ------------------------------------------------------------------ *
 * The conversation
 * ------------------------------------------------------------------ */

/**
 * The messages to send, once the oldest have been dropped to fit.
 *
 * The system message is kept whatever happens: it is what tells the model it
 * is operating servers rather than writing code, and a conversation that
 * forgets that is worse than one that forgets its first ten turns.
 *
 * The one rule about where to cut is that a `tool` message must answer a call
 * that is still in the list. Left at the front it answers nothing, and every
 * server refuses the request rather than ignoring the orphan.
 */
function trimHistory(messages, max = MAX_MESSAGES) {
    if (messages.length <= max) return messages;

    const head = messages[0]?.role === 'system' ? [messages[0]] : [];
    const rest = messages.slice(head.length).slice(-(max - head.length));
    while (rest.length > 0 && rest[0].role === 'tool') rest.shift();
    return [...head, ...rest];
}

/** Whatever a tool handler returned, as the string a `tool` message carries. */
function resultText(result) {
    const text = String(result?.text ?? '');
    return text.trim() ? text : '(the tool returned nothing)';
}

/**
 * Run one tool call, under the same policy every other provider stops at.
 *
 * The order matters and is the same as in `mcp-host.js`: blocked outright,
 * then the approval gate, then the handler. A blocked command never becomes a
 * card, because there is no answer to that card that would let it run.
 */
async function runTool({ call, toolContext, requestApproval, onEvent }) {
    const definition = catalog.BY_NAME.get(call.name);
    if (!definition) {
        return `There is no tool called ${call.name}. Use one of the tools you were given.`;
    }

    let input;
    try {
        input = call.args.trim() ? JSON.parse(call.args) : {};
    } catch {
        return `The arguments for ${call.name} were not valid JSON, so nothing was run. `
            + 'Send the call again with a well-formed JSON object.';
    }

    onEvent({ type: 'tool-call', id: call.id, name: call.name, input, local: false });

    const context = toolContext();
    const settings = context.settings;

    const blocked = catalog.blockedReason(call.name, input, settings);
    if (blocked) {
        onEvent({ type: 'tool-blocked', name: call.name, rule: blocked });
        const message = catalog.blockedMessage(blocked);
        onEvent({ type: 'tool-result', id: call.id, text: message, isError: true });
        return message;
    }

    if (!catalog.isAutoApproved(call.name, input, settings)) {
        const verdict = await requestApproval({
            toolName: call.name,
            name: call.name,
            input,
            local: false,
        });
        if (!verdict.approved) {
            const message = verdict.message || 'The user declined that.';
            onEvent({ type: 'tool-result', id: call.id, text: message, isError: true });
            return message;
        }
    }

    try {
        const result = await definition.handler(input, context);
        const text = resultText(result);
        onEvent({ type: 'tool-result', id: call.id, text, isError: Boolean(result?.isError) });
        return text;
    } catch (error) {
        // Handed back rather than thrown, for the reason the Claude provider
        // gives: a returned error lets the model read what went wrong and try
        // something else, where a thrown one ends the turn.
        onEvent({ type: 'tool-failed', name: call.name, message: error.message });
        const text = `The ${call.name} tool failed: ${error.message}`;
        onEvent({ type: 'tool-result', id: call.id, text, isError: true });
        return text;
    }
}

/**
 * Start a conversation against an OpenAI-shaped endpoint.
 *
 *   label       what to call this server when something goes wrong
 *   prefix      what its session ids look like, for the history above
 *   endpoint    a function of the current settings returning
 *               `{ baseUrl, apiKey, headers, label }`. Read per turn, so an
 *               address or a key changed in settings lands on the next message
 *   model       a function of the current settings returning the model id to
 *               ask for, since what "no choice" means differs by provider. It
 *               may answer with a promise: a local server has to be asked what
 *               it has loaded before anything can be sent to it
 *   extra       a function of the current settings returning fields to merge
 *               into the request body, for reasoning effort and its friends
 *
 * The rest is the shape every provider in this folder is started with.
 */
async function start({
    label,
    prefix = 'chat',
    endpoint,
    model,
    extra = () => ({}),
    settings,
    getSettings = () => settings,
    systemPrompt,
    toolContext,
    requestApproval,
    onEvent,
    resumeSessionId = '',
}) {
    const sessionId = resumeSessionId && histories.has(resumeSessionId)
        ? resumeSessionId
        : nextSessionId(prefix);

    const messages = histories.get(sessionId) || [{ role: 'system', content: systemPrompt }];
    // Deleted before it is set so it moves to the end of the map: a
    // conversation being picked up again is the last thing that should be
    // forgotten, and a plain `set` would leave it where it first landed.
    histories.delete(sessionId);
    histories.set(sessionId, messages);

    // Oldest first, so the map is capped by forgetting conversations nobody
    // has been near rather than the one being started.
    for (const key of [...histories.keys()].slice(0, Math.max(0, histories.size - MAX_HISTORIES))) {
        histories.delete(key);
    }

    onEvent({ type: 'session', sessionId, model: settings.model || '' });

    const tools = functionTools();
    let abort = null;
    let running = Promise.resolve();
    let closed = false;
    // Stop is not only about the request in flight. A turn spends most of its
    // time in a tool call, waiting on an approval or on a command running over
    // ssh, and aborting the fetch does nothing to either: without this the loop
    // would come back from the tool and cheerfully start the next request.
    let stopped = false;

    async function turn(text) {
        const current = getSettings();
        const target = endpoint(current);
        const name = await model(current);

        stopped = false;
        messages.push({ role: 'user', content: text });

        // The step cap is the same setting the other agents are given, and it
        // does the same job: a model that has decided to read one more file
        // forever stops on its own rather than when somebody notices.
        const limit = Math.max(1, current.maxTurns || 40);

        for (let step = 0; step < limit; step += 1) {
            if (stopped) return;
            messages.splice(0, messages.length, ...trimHistory(messages));

            abort = new AbortController();
            const timer = setTimeout(() => abort?.abort(), REQUEST_TIMEOUT);
            let reply;
            try {
                reply = await complete({
                    endpoint: target,
                    messages,
                    model: name,
                    tools,
                    extra: extra(current),
                    signal: abort.signal,
                    onEvent,
                });
            } finally {
                clearTimeout(timer);
            }

            messages.push({
                role: 'assistant',
                content: reply.content,
                ...(reply.toolCalls.length > 0 ? {
                    tool_calls: reply.toolCalls.map(call => ({
                        id: call.id,
                        type: 'function',
                        function: { name: call.name, arguments: call.args || '{}' },
                    })),
                } : {}),
            });

            // Before the tool calls, as the Claude provider does: the panel
            // treats the finished block as authoritative and clears whatever
            // streamed, so a call announced first would have the text land
            // underneath it.
            if (reply.content.trim()) onEvent({ type: 'assistant-text', text: reply.content });

            if (reply.toolCalls.length === 0) {
                onEvent({
                    type: 'result',
                    subtype: 'success',
                    isError: false,
                    costUsd: 0,
                    usage: reply.usage,
                });
                return;
            }

            for (const call of reply.toolCalls) {
                // Every call still gets an answer, even once the user has
                // stopped: the model's next request has to see a result for
                // each call it made, or the conversation cannot be resumed at
                // all. What stops is the next request, at the top of the loop.
                const text = stopped
                    ? 'The user stopped the run before this could be done.'
                    : await runTool({ call, toolContext, requestApproval, onEvent });
                messages.push({ role: 'tool', tool_call_id: call.id, content: text });
            }
        }

        onEvent({ type: 'result', subtype: 'error_max_turns', isError: true, costUsd: 0 });
    }

    return {
        send(text) {
            running = running
                .then(() => turn(text))
                .catch((error) => {
                    // A request the user aborted is not a failure to report.
                    // The panel has already said "Stopped."
                    if (closed || stopped || abort?.signal.aborted) return;
                    onEvent({ type: 'error', message: describeFailure(error, label) });
                })
                .finally(() => { abort = null; });
        },
        // Both are read from the settings when the next request is built, so
        // there is nothing to push at a running query.
        async setModel() {},
        async setEffort() {},
        async interrupt() {
            stopped = true;
            abort?.abort();
        },
        async close() {
            closed = true;
            stopped = true;
            abort?.abort();
            await running.catch(() => {});
            // The history stays: parking a conversation is meant to be
            // survivable, and for this provider the messages are the only
            // copy of it there is.
        },
    };
}

/**
 * What a server says it can run.
 *
 * Every one of these publishes `/models`, and it is the only honest source for
 * the menu: which models are loaded is a decision the user made in LM Studio
 * or Ollama a minute ago, and no list written here could know it.
 */
async function listModels({ baseUrl, apiKey = '', headers = {}, label = 'The server' }) {
    if (!baseUrl) return null;

    const request = { ...headers };
    if (apiKey) request.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/models`, {
        headers: request,
        // Long enough for a machine that is busy loading a model, short enough
        // that a menu is not left spinning on an address nobody is listening at.
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw await httpFailure(response, label);

    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    return rows
        .filter(row => row && typeof row.id === 'string' && row.id)
        .map(row => ({
            value: row.id,
            resolved: row.id,
            label: row.id,
            // LM Studio and Ollama name a model by the repository it came
            // from, which is a path. The chip in the composer has room for the
            // last part of it, and the menu still shows the whole thing.
            short: row.id.split('/').pop(),
            description: String(row.owned_by || row.publisher || '').slice(0, 200),
            // Reasoning effort is not a field this API has. A model that thinks
            // does it because of how it was built, and a dial that changed
            // nothing would be a lie in the composer.
            effort: [],
        }))
        .slice(0, 100);
}

/**
 * A failure, in words that say what to do about it.
 *
 * The two that matter are the two that happen: nothing listening on the
 * address, and a model that was loaded without tool support. Both look like
 * "the assistant is broken" from the panel, and neither is.
 */
function describeFailure(error, label = 'The model server') {
    const text = String(error?.message || error || 'Unknown error');

    if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH|network|Failed to fetch/i.test(text)) {
        return `${label} could not be reached. Check that it is running and that the address in the `
            + `assistant settings is the one it is listening on. (${text})`;
    }
    if (/timeout|timed out|aborted/i.test(text)) {
        return `${label} did not answer in time. A large model on a busy machine can take a while; `
            + 'if it never answers, check the server\'s own log.';
    }
    if (/tool|function.*(not|un)support|does not support tools/i.test(text)) {
        return `${label} refused the tool definitions. This assistant works by calling tools, so it `
            + 'needs a model with tool support. Load one that has it, then try again.';
    }
    if (/401|403|unauthor|invalid.*api.?key|missing.*api.?key/i.test(text)) {
        return `${label} rejected the credentials. Add or correct the API key in the assistant settings.`;
    }
    if (/404|no such model|model.*not found/i.test(text)) {
        return `${label} does not have the selected model loaded. Pick another one from the model menu, `
            + 'or load it on the server.';
    }
    return text;
}

module.exports = {
    start,
    listModels,
    functionTools,
    describeFailure,
    createSseReader,
    createCollector,
    trimHistory,
    _test: { histories, runTool },
};
