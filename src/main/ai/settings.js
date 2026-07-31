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
 * The one secret here is an API key, which only the providers that are not
 * Claude Code will ever need. Claude Code is driven through the copy already
 * installed on this machine and signed in to the user's own account, so the
 * common case stores no credential at all.
 */

const CONFIG_VERSION = 1;

const PROVIDERS = new Set(['claude-code', 'codex']);

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

const DEFAULTS = {
    enabled: true,
    provider: 'claude-code',
    // Empty means whatever the installed Claude Code is already set to use.
    // Inheriting is the right default for a feature whose selling point is
    // that it is the user's own Claude Code: a model pinned here would
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
    // One-click questions on the empty panel. Empty on purpose: a canned list
    // of things nobody here asked for is filler, and the useful ones are the
    // ones a particular person asks their particular fleet over and over.
    quickPrompts: [],
};

const stateFile = () => path.join(app.getPath('userData'), 'assistant.json');

let config = null;
let secret = null;

function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.floor(number), min), max);
}

function sanitize(raw) {
    const next = {
        ...DEFAULTS,
        autoApproveCommands: [...DEFAULTS.autoApproveCommands],
        quickPrompts: [...DEFAULTS.quickPrompts],
    };
    if (raw && typeof raw === 'object') {
        if ('enabled' in raw) next.enabled = Boolean(raw.enabled);
        if (PROVIDERS.has(raw.provider)) next.provider = raw.provider;
        if (typeof raw.model === 'string') next.model = raw.model.trim().slice(0, 80);
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

function load() {
    if (config) return config;
    try {
        if (fs.existsSync(stateFile())) {
            const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
            config = sanitize(parsed?.config);
            secret = typeof parsed?.apiKey === 'string' ? parsed.apiKey : null;
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
            JSON.stringify({ version: CONFIG_VERSION, config, apiKey: secret }),
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
    return { ...load(), hasApiKey: Boolean(secret), encryptionAvailable: isEncryptionAvailable() };
}

function set(patch) {
    const before = load();
    const next = { ...before, ...patch };

    // A model name belongs to the agent that offers it. Claude Code's
    // `opus[1m]` means nothing to Codex, and handing it over would either be
    // refused or, worse, quietly run something else. Switching agents drops
    // back to "whatever it is already set to", which is the one answer that
    // is right for both.
    if (patch && 'provider' in patch && patch.provider !== before.provider) {
        next.model = '';
    }

    config = sanitize(next);
    persist();
    return get();
}

function isEncryptionAvailable() {
    try {
        return safeStorage.isEncryptionAvailable();
    } catch {
        return false;
    }
}

/**
 * Store or clear the API key.
 *
 * Refused rather than stored in the clear when the OS keychain is unavailable.
 * A credential written to a JSON file in plain text is worse than no feature:
 * the user believes it is protected because they were asked to type it into
 * something that looked like a password field.
 */
function setApiKey(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        secret = null;
        persist();
        return { success: true, hasApiKey: false };
    }
    if (!isEncryptionAvailable()) {
        return { success: false, message: 'This system has no secure store available, so a key cannot be saved here' };
    }
    try {
        secret = safeStorage.encryptString(text).toString('base64');
        persist();
        return { success: true, hasApiKey: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/** The decrypted key, for the provider only. Never leaves the main process. */
function readApiKey() {
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
    setApiKey,
    readApiKey,
    isEncryptionAvailable,
    DEFAULTS,
    APPROVALS,
    COMMAND_MODES,
    EFFORTS,
    PROVIDERS,
};
