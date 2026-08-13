const engine = require('./openai-compatible');
const settings = require('../settings');

/**
 * The local model provider.
 *
 * A model running on the user's own machine, reached over the OpenAI-shaped
 * HTTP API that every one of these servers speaks: LM Studio, Ollama,
 * llama.cpp's server, vLLM, Jan, text-generation-webui. There is no CLI to
 * find and no account to sign in to. There is an address, and something
 * listening on it.
 *
 * That is the whole appeal, and it is a different one from the other agents
 * here. Nothing leaves the machine: the terminal output, the file contents and
 * the hostnames of an estate all stay on the same computer the model is
 * running on, which for a fleet that cannot legally be described to a vendor is
 * the difference between having this panel and not.
 *
 * What it costs is the agent. The other three providers are harnesses somebody
 * else wrote and maintains; this one is a loop in `openai-compatible.js` and a
 * model that has to be good enough to drive it. A small model with weak tool
 * calling will flounder here in ways Claude Code does not, and that is a
 * property of the model rather than of the wiring.
 */

const LABEL = 'The local model server';

/** Where to reach it, as a settings value that always has a shape. */
function baseUrl(current) {
    return current?.localBaseUrl || settings.DEFAULT_LOCAL_URL;
}

function endpoint(current) {
    return {
        baseUrl: baseUrl(current),
        // Most of these want no key at all, and the ones that do accept
        // anything. It is sent when the user stored one, because a server
        // behind an API key on a home network is a reasonable thing to have.
        apiKey: current.apiKey || '',
        label: LABEL,
    };
}

/**
 * Which model to ask for when the user has not pinned one.
 *
 * Unlike an agent CLI, a model server has no opinion to inherit: the request
 * carries a model id and is refused without one. So the server is asked what
 * it has, and the first answer is used, which on LM Studio and Ollama is the
 * model that is actually loaded. Cached against the address it was read from,
 * so pointing the setting at a different server asks that one instead of
 * carrying a name it has never heard of.
 */
let known = { url: '', model: '' };

async function resolveModel(current) {
    if (current.model) return current.model;

    const url = baseUrl(current);
    if (known.url === url && known.model) return known.model;

    const rows = await engine.listModels({
        baseUrl: url,
        apiKey: current.apiKey || '',
        label: LABEL,
    });
    if (!rows?.length) {
        throw new Error(`${LABEL} has no models loaded. Load one in the server, then try again.`);
    }

    known = { url, model: rows[0].value };
    return known.model;
}

async function start(options) {
    return engine.start({
        ...options,
        label: LABEL,
        prefix: 'local',
        endpoint,
        model: resolveModel,
    });
}

/**
 * What this machine has loaded.
 *
 * The first row is marked preferred rather than leaving the menu to offer a
 * "use the default" row: there is no default to inherit, and the row would be
 * describing a decision nobody made. Marking it says the true thing instead,
 * which is that an unpinned conversation goes to whatever the server lists
 * first, and `resolveModel` above is the code that makes that true.
 */
async function listModels({ settings: current = {} } = {}) {
    const rows = await engine.listModels({
        baseUrl: baseUrl(current),
        apiKey: current.apiKey || '',
        label: LABEL,
    });
    if (!rows?.length) return null;

    return rows.map((row, index) => ({ ...row, preferred: index === 0 }));
}

module.exports = {
    start,
    listModels,
    endpoint,
    resolveModel,
    LABEL,
    _test: { forget: () => { known = { url: '', model: '' }; } },
};
