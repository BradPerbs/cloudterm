/**
 * Keys and tokens pasted into the chat, found so they can be kept off disk.
 *
 * People paste a key into the assistant to get a job done: "here is the API
 * token, put it in the app's env file". The agent needs the value for that
 * turn, so it goes to the agent as typed. What it must not do is sit in the
 * saved history for ever, in a file that is not encrypted and that the history
 * menu reads back every morning. There is no secrets store here to move it
 * into, so the value is masked instead: in the transcript, in the history file
 * and in the activity log, everywhere the conversation is recorded.
 *
 * Found by shape rather than by asking. Two kinds of evidence count:
 *
 *   - a prefix a provider puts on its keys (`sk-ant-`, `ghp_`, `AKIA` and the
 *     rest), a private key block, a JWT, or a URL with a password in it
 *   - a value after a name that says what it is: `token: ...`, `password=...`,
 *     `Authorization: Bearer ...`
 *
 * And one weaker kind, for the bare tokens of hosting APIs that carry no
 * prefix at all: a long run of letters and digits in both cases, which a word,
 * a path, a hash or a UUID never is. A false positive costs a few characters
 * of history; a miss costs a live credential in a plain file.
 *
 * Only what the user writes is searched. Once found, a value is masked
 * wherever it turns up in that conversation afterwards, including in a command
 * the agent runs with it or a reply that quotes it back.
 */

/** What a found value becomes. Language-neutral on purpose. */
const MASK = '••••';

/** Shorter than this and masking would eat ordinary words wherever they appear. */
const MIN_LENGTH = 8;

/** Values recognisable on their own, by a prefix or a shape nothing else has. */
const SHAPES = [
    // A private key, armour and all.
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    // OpenAI, and the many APIs that copied its shape.
    /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
    /\bxai-[A-Za-z0-9]{20,}/g,
    /\bgsk_[A-Za-z0-9]{20,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
    /\bglpat-[A-Za-z0-9_-]{20,}/g,
    /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    /\bAIza[A-Za-z0-9_-]{35}/g,
    /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
    /\bhf_[A-Za-z0-9]{30,}/g,
    /\bnpm_[A-Za-z0-9]{36}\b/g,
    /\bdop_v1_[a-f0-9]{64}\b/g,
    /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
];

/**
 * Values that are secrets because of what they are next to. The first group
 * is the value; the rest of the match stays readable.
 */
const LABELLED = [
    // `token: x`, `API_KEY=x`, `"password": "x"`, `client-secret x`.
    /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|api[_-]?token|access[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|secret[_-]?access[_-]?key|client[_-]?secret|private[_-]?token|password|passwd|passphrase|token|secret)["']?\s*[:=]\s*["']?([^\s"'`,;]+)/gi,
    // `Authorization: Bearer x`, `Token x`.
    /\b(?:Bearer|Token)\s+([A-Za-z0-9._~+/=-]{16,})/g,
    // The password in `postgres://app:password@db`.
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@/gi,
];

/**
 * A bare token with nothing around it: long, unbroken, and mixing upper case,
 * lower case and digits. A hash is one case of hex, a UUID has dashes in fixed
 * places, and a word or a path has neither the length nor the mix.
 */
const BARE = /(?<![A-Za-z0-9_/.-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_/.-])/g;

function mixed(value) {
    return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

/**
 * Whether a labelled value looks like a credential rather than prose.
 *
 * `password: required` is a sentence about a password. A value with a digit or
 * a symbol in it, or one too long to be a word, is the password.
 */
function plausible(value) {
    if (value.length < MIN_LENGTH) return false;
    // A reference or a placeholder rather than the thing itself.
    if (/^(?:\$|%|\{\{|<|\*{3,}|x{6,}$)/i.test(value)) return false;
    return /[^A-Za-z]/.test(value) || value.length >= 20;
}

/** Every distinct secret-looking value in a piece of text, longest first. */
function find(text) {
    const source = String(text || '');
    if (source.length < MIN_LENGTH) return [];
    const found = new Set();

    for (const pattern of SHAPES) {
        for (const match of source.matchAll(pattern)) {
            if (match[0].length >= MIN_LENGTH) found.add(match[0]);
        }
    }
    for (const pattern of LABELLED) {
        for (const match of source.matchAll(pattern)) {
            const value = match[1] || '';
            if (plausible(value)) found.add(value);
        }
    }
    for (const match of source.matchAll(BARE)) {
        if (mixed(match[0])) found.add(match[0]);
    }

    // Longest first, so a value that contains another is masked whole rather
    // than leaving the tail of the longer one behind.
    return [...found].sort((a, b) => b.length - a.length);
}

/** A string with every held value masked. The same string when nothing matched. */
function mask(text, values) {
    if (typeof text !== 'string' || !values || values.size === 0 || text.length < MIN_LENGTH) return text;
    let out = text;
    for (const value of [...values].sort((a, b) => b.length - a.length)) {
        if (out.includes(value)) out = out.split(value).join(MASK);
    }
    return out;
}

/**
 * The same through objects and arrays, for an event and the tool input in it.
 * Returns the very same object when nothing in it changed, so a caller can
 * tell cheaply whether there was anything to mask.
 */
function maskDeep(value, values, depth = 0) {
    if (!values || values.size === 0) return value;
    if (typeof value === 'string') return mask(value, values);
    if (!value || typeof value !== 'object' || depth > 8) return value;

    if (Array.isArray(value)) {
        let out = value;
        value.forEach((entry, index) => {
            const cleaned = maskDeep(entry, values, depth + 1);
            if (cleaned === entry) return;
            if (out === value) out = value.slice();
            out[index] = cleaned;
        });
        return out;
    }

    let out = value;
    for (const [key, entry] of Object.entries(value)) {
        const cleaned = maskDeep(entry, values, depth + 1);
        if (cleaned === entry) continue;
        if (out === value) out = { ...value };
        out[key] = cleaned;
    }
    return out;
}

module.exports = { MASK, find, mask, maskDeep };
