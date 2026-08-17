const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * How the assistant is configured.
 *
 * Kept in its own file next to the session log's, rather than in the main
 * store, for the same reason that one is: none of it is a host, a key or a
 * snippet, and the store's shape is the thing that syncs between machines.
 * A model choice belongs to the machine the model runs on.
 *
 * The secrets here are API keys, and nothing writes them any more. The
 * assistant runs the agents already installed and already signed in on this
 * machine, which is the whole proposition of driving the user's own agent, and
 * an agent that is not on the machine is refused when it is switched on. A key
 * box beside that offered the opposite: an agent accepted on the promise of a
 * credential, and a failure saved up for the middle of a question. What remains
 * is read so that a key an older version stored is still handed to the agent it
 * belongs to, and nobody's working setup breaks on an update.
 */

const CONFIG_VERSION = 2;

const PROVIDERS = new Set(['claude-code', 'codex', 'opencode', 'grok', 'kimi', 'local']);

/**
 * Every level any agent here offers, low to high. The union, not one agent's
 * scale: Codex's newest models carry an `ultra` above `max`, Claude Code stops
 * at `max`, and which of them a menu shows is decided per model by what that
 * model says it supports. This is only the list of what can be stored.
 */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

/**
 * When to stop and ask.
 *
 *   always   every tool call waits for a person, including reads
 *   writes   reads run on their own; anything that changes a system asks
 *   never    nothing asks
 *
 * `writes` is the default because it is the only one of the three that is
 * useful and safe at the same time. `always` turns reading a log file into a
 * dialog and trains people to click through; `never` hands a shell on every
 * saved host to a model with no one watching.
 */
const APPROVALS = new Set(['always', 'writes', 'never']);

/**
 * Where a command runs.
 *
 *   terminal    typed into the session the user is watching
 *   background  a separate exec channel, invisible
 *
 * `terminal` is the default because watching the assistant work is most of
 * what makes it possible to trust it, and a command that ran somewhere you
 * cannot see is one you have to take on faith. The background channel is
 * tidier (a real exit code, nothing typed at your prompt, no shell history)
 * and it is there for anyone who would rather have that.
 */
const COMMAND_MODES = new Set(['terminal', 'background']);

/**
 * Where a local model server is listening.
 *
 * LM Studio's default, because it is the one most people arrive with and the
 * only one of these that ships a server switched on by a button. Anything that
 * speaks the same OpenAI-shaped API works by typing its address here: Ollama
 * is `http://localhost:11434/v1`, llama.cpp `http://localhost:8080/v1`, vLLM
 * `http://localhost:8000/v1`.
 */
const DEFAULT_LOCAL_URL = 'http://localhost:1234/v1';

const DEFAULTS = {
    enabled: true,
    /**
     * Every agent that is switched on, and the one that is answering.
     *
     * Two settings rather than one because they answer two questions. The list
     * is what the user set up: the agents they have a login or a key for, and
     * whose models the composer's menu is allowed to offer. `provider` is which
     * of those the next message goes to, and it moves every time a model is
     * picked out of that menu, because a model belongs to exactly one of them.
     *
     * `provider` is always a member of `providers`, and `providers` is never
     * empty. Both are enforced in `sanitize`, so nothing downstream has to
     * check: a conversation still starts one agent, the same as it always did.
     */
    providers: ['claude-code'],
    provider: 'claude-code',
    // Only read when the provider is `local`. Kept here rather than in a
    // provider file because it is a setting the user types, and the settings
    // page is what has to hand it back to them next time.
    localBaseUrl: DEFAULT_LOCAL_URL,
    // Empty means whatever the installed agent is already set to use.
    // Inheriting is the right default for a feature whose selling point is
    // that it is the user's own agent: a model pinned here would
    // silently override the choice they made there.
    model: '',
    effort: 'high',
    approval: 'writes',
    commandMode: 'terminal',
    // A ceiling on tool calls per turn, so a loop that is not converging stops
    // on its own rather than when someone notices.
    maxTurns: 40,
    // How much terminal output a single read hands back.
    transcriptLines: 240,
    // Whether the assistant may touch this machine (its filesystem, its shell)
    // as well as the servers. Off: the panel is for managing remote hosts, and
    // a local shell is a much larger surface than anyone asked for.
    allowLocalTools: false,
    // Commands that never need approval no matter the mode above, matched on
    // the first word. Seeded with the ones whose whole purpose is to look.
    autoApproveCommands: ['ls', 'cat', 'head', 'tail', 'grep', 'ps', 'df', 'du', 'uptime', 'whoami', 'systemctl status', 'journalctl'],
    /**
     * Commands the assistant is never allowed to run, whatever else is set.
     *
     * The opposite end of the list above, and not a mirror of it. Being absent
     * from `autoApproveCommands` only means "ask first", so a second list that
     * also meant "ask first" would say nothing. These are refused outright: no
     * approval card, no way to say yes, and `never ask` does not reach them
     * either. That is the only reading that earns the setting its place.
     *
     * Seeded with the one command that is nearly always a mistake when it comes
     * from something other than a person who meant it.
     */
    blockedCommands: ['rm -rf'],
    // One-click questions on the empty panel. Empty on purpose: a canned list
    // of things nobody here asked for is filler, and the useful ones are the
    // ones a particular person asks their particular fleet over and over.
    quickPrompts: [],
};

const stateFile = () => path.join(app.getPath('userData'), 'assistant.json');

let config = null;

/**
 * The stored keys, one per provider, each encrypted by the OS keychain.
 *
 * Filled from disk and never added to. Kept keyed by provider rather than
 * flattened, because that is how they were written and because a key handed to
 * the wrong agent is not a fallback, it is a login failure with a confusing
 * message.
 */
let secrets = {};

function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.floor(number), min), max);
}

/**
 * An address for a local model server, or the default if it is not one.
 *
 * Only http and https, and nothing with credentials or a query on it: this is
 * pasted from a server's own console and then used to build request URLs, so
 * the shapes that would surprise someone are refused here rather than being
 * discovered halfway through a conversation. The trailing slash goes so
 * `${base}/models` never has two of them.
 */
function cleanUrl(value, fallback) {
    const text = String(value ?? '').trim();
    if (!text) return fallback;
    try {
        const url = new URL(text);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
        if (url.username || url.password) return fallback;
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`.slice(0, 300);
    } catch {
        return fallback;
    }
}

/**
 * Which agents are switched on, as a list with no gaps in it.
 *
 * A config written before more than one could be on at a time has no list at
 * all, only the agent it was set to. That one is the answer: it was the only
 * one running, so it is the only one switched on, and the machine goes on
 * behaving exactly as it did.
 *
 * Never empty. An empty list is a settings page with no agent to offer and a
 * composer with nothing in its menu, so the agent that was selected stays on
 * whatever the patch said.
 */
function readProviders(raw, provider) {
    const kept = Array.isArray(raw.providers)
        ? [...new Set(raw.providers.filter(name => PROVIDERS.has(name)))]
        : [];
    if (kept.length > 0) return kept;
    return [provider];
}

function sanitize(raw) {
    const next = {
        ...DEFAULTS,
        providers: [...DEFAULTS.providers],
        autoApproveCommands: [...DEFAULTS.autoApproveCommands],
        blockedCommands: [...DEFAULTS.blockedCommands],
        quickPrompts: [...DEFAULTS.quickPrompts],
    };
    if (raw && typeof raw === 'object') {
        if ('enabled' in raw) next.enabled = Boolean(raw.enabled);
        if (PROVIDERS.has(raw.provider)) next.provider = raw.provider;
        next.providers = readProviders(raw, next.provider);
        // The agent answering has to be one of the agents that are on.
        // Whichever way the two disagree the list wins, because the list is
        // what the user was changing: switching off the agent you were on
        // hands the conversation to the first one still standing rather than
        // leaving a model menu that cannot offer what is selected.
        if (!next.providers.includes(next.provider)) next.provider = next.providers[0];
        if ('localBaseUrl' in raw) next.localBaseUrl = cleanUrl(raw.localBaseUrl, DEFAULTS.localBaseUrl);
        // Long enough for the publisher-and-repository ids a local server
        // reports, which run past the 80 characters an alias needs.
        if (typeof raw.model === 'string') next.model = raw.model.trim().slice(0, 160);
        if (EFFORTS.has(raw.effort)) next.effort = raw.effort;
        if (APPROVALS.has(raw.approval)) next.approval = raw.approval;
        if (COMMAND_MODES.has(raw.commandMode)) next.commandMode = raw.commandMode;
        next.maxTurns = clampNumber(raw.maxTurns, DEFAULTS.maxTurns, 1, 200);
        next.transcriptLines = clampNumber(raw.transcriptLines, DEFAULTS.transcriptLines, 20, 2000);
        if ('allowLocalTools' in raw) next.allowLocalTools = Boolean(raw.allowLocalTools);
        if (Array.isArray(raw.autoApproveCommands)) {
            next.autoApproveCommands = raw.autoApproveCommands
                .map(entry => String(entry || '').trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 100);
        }
        // Only replaced when the patch actually carries a list. An older config
        // written before this setting existed leaves the default in place, so
        // upgrading the app does not quietly unblock anything.
        if (Array.isArray(raw.blockedCommands)) {
            next.blockedCommands = raw.blockedCommands
                .map(entry => String(entry || '').replace(/\s+/g, ' ').trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 100);
        }
        if (Array.isArray(raw.quickPrompts)) {
            // Kept as written, case and all: these are sentences a person typed
            // for themselves, not identifiers to be matched against anything.
            next.quickPrompts = raw.quickPrompts
                .map(entry => String(entry || '').replace(/\s+/g, ' ').trim().slice(0, 300))
                .filter(Boolean)
                .slice(0, 12);
        }
    }
    return next;
}

/**
 * The keys as they are on disk, whichever version wrote them.
 *
 * A file from before there was one key per provider has a single `apiKey`, and
 * the provider it belonged to is the one that was selected when it was typed.
 * So it is filed under that provider rather than dropped or copied to all of
 * them: the machine goes on working exactly as it did, and nothing else
 * inherits a credential meant for somebody else's API.
 */
function readSecrets(parsed, provider) {
    const stored = parsed?.keys;
    if (stored && typeof stored === 'object') {
        const kept = {};
        for (const [name, value] of Object.entries(stored)) {
            if (PROVIDERS.has(name) && typeof value === 'string' && value) kept[name] = value;
        }
        return kept;
    }
    return typeof parsed?.apiKey === 'string' && parsed.apiKey
        ? { [provider]: parsed.apiKey }
        : {};
}

function load() {
    if (config) return config;
    try {
        if (fs.existsSync(stateFile())) {
            const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
            config = sanitize(parsed?.config);
            secrets = readSecrets(parsed, config.provider);
        } else {
            config = sanitize(null);
        }
    } catch (error) {
        console.error('Could not read the assistant settings:', error.message);
        config = sanitize(null);
    }
    return config;
}

function persist() {
    try {
        fs.writeFileSync(
            stateFile(),
            JSON.stringify({ version: CONFIG_VERSION, config, keys: secrets }),
            'utf8'
        );
    } catch (error) {
        console.error('Could not save the assistant settings:', error.message);
    }
}

/**
 * The settings as the renderer reads them. The key itself never comes back
 * across the bridge, only whether there is one, which is the same rule the
 * host store follows for passwords.
 */
function get() {
    const current = load();
    return {
        ...current,
        // Whether the agent now answering is running on a key left here by an
        // older version, which is what the usage chip in the composer needs to
        // know: a metered key and a plan are charged differently and it says
        // which. Whether, never which key.
        hasApiKey: Boolean(secrets[current.provider]),
        // What the app shipped with, so a settings page can offer the way back
        // without keeping a second copy of these lists that drifts from this
        // one. Read-only: `set` works from `load()`, not from here, so nothing
        // on this view can be written back into the config by echoing it.
        defaults: {
            autoApproveCommands: [...DEFAULTS.autoApproveCommands],
            blockedCommands: [...DEFAULTS.blockedCommands],
        },
    };
}

function set(patch) {
    const before = load();
    const next = sanitize({ ...before, ...patch });

    // A model name belongs to the agent that offers it. Claude Code's
    // `opus[1m]` means nothing to Codex, and handing it over would either be
    // refused or, worse, quietly run something else. Switching agents drops
    // back to "whatever it is already set to", which is the one answer that
    // is right for both.
    //
    // Unless the change names both at once, which is what the composer's menu
    // does now that it lists every switched-on agent's models together: one
    // click there is a change of model and of the agent that owns it, and
    // clearing the model it just asked for would undo half of the request.
    if (next.provider !== before.provider && !(patch && 'model' in patch)) {
        next.model = '';
    }

    config = next;
    persist();
    return get();
}

/**
 * The decrypted key, for the provider only. Never leaves the main process.
 *
 * Read, never written. Nothing in the app stores a key any more: the assistant
 * runs the agents that are already installed and already signed in on this
 * machine, and an agent that is not there is refused when it is switched on
 * rather than accepted against a credential typed into a box. What is left here
 * is what an older version wrote, which is still handed to the agent it belongs
 * to so that nobody's working setup stops working on an update.
 */
function readApiKey(provider = load().provider) {
    const secret = secrets[provider];
    if (!secret) return '';
    try {
        return safeStorage.decryptString(Buffer.from(secret, 'base64'));
    } catch (error) {
        console.error('Could not read the stored assistant key:', error.message);
        return '';
    }
}

module.exports = {
    get,
    set,
    readApiKey,
    DEFAULTS,
    APPROVALS,
    COMMAND_MODES,
    EFFORTS,
    PROVIDERS,
    DEFAULT_LOCAL_URL,
    _test: { sanitize, readSecrets, cleanUrl },
};
