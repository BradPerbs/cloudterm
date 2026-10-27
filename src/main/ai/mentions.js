const { readSpecs, specBlock, MAX_SPECS } = require('./specs');
const { composeSnippet } = require('../snippet-config');

/**
 * The things a message can point at, tagged in the composer with `@` (and a
 * skill, invoked with `/`).
 *
 * A mention is `{ kind, id }` on the wire and nothing else. The renderer sends
 * ids, never text, for the same reason the spec attachment always did: the
 * store is the authority on what a host's address or a runbook's contents are,
 * the panel's cached copy of either can be a save behind, and a
 * sixty-thousand-character document should not cross the bridge twice.
 * Everything the model sees is assembled here, from the records the main
 * process already holds.
 *
 * This replaces the spec menu, which was the same idea for one kind of thing.
 * A spec is now a mention of a snippet that happens to be a document, and it
 * reads to the model exactly as an attached spec always did: `specs.js` still
 * resolves it and still writes its block. The same gesture reaches a host, a
 * command, a package, a proxy or a key.
 *
 * Nothing secret ever goes into the prompt. A host is described the way
 * `list_hosts` describes one, a proxy by its type and address, a key by its
 * type and fingerprint. The records handed in here are the store's redacted
 * ones anyway, and only named fields are read from them, so a password or a
 * private key has no path to the model even if one were left on a record.
 *
 * Kept free of Electron so it can be tested on its own: the caller hands in
 * the records to resolve against.
 */

/** A sanity cap. Twenty things on one question is a question about the list. */
const MAX_MENTIONS = 20;

/** How much of a document rides along. Past this it is a file, not a mention. */
const MAX_TEXT = 60000;

/** The kinds that can be tagged. */
const KINDS = ['host', 'snippet', 'proxy', 'key', 'skill'];

/** Where each kind is found in the records the caller hands in. */
const SOURCE = {
    host: 'hosts',
    snippet: 'snippets',
    proxy: 'proxies',
    key: 'keys',
    skill: 'skills',
};

/** What each kind is called when the block introduces it. */
const LABEL = {
    host: 'host',
    snippet: 'snippet',
    proxy: 'proxy',
    key: 'key',
    skill: 'skill',
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** A host, as much as the model has any business seeing: see `publicHost` in tools.js. */
function fromHost(host) {
    const address = host.protocol === 'serial'
        ? (host.serial?.path || '')
        : [host.host, host.port].filter(Boolean).join(':');

    return {
        name: host.name || address || host.id,
        lines: [
            `id: ${host.id}`,
            address ? `address: ${address}` : '',
            host.username ? `username: ${host.username}` : '',
            `protocol: ${host.protocol || 'ssh'}`,
            host.os ? `os: ${[host.distro, host.os].filter(Boolean).join(' / ')}` : '',
            host.tags?.length ? `tags: ${host.tags.join(', ')}` : '',
        ].filter(Boolean),
        note: 'A saved host. Use this id with connect_host to open a session on it.',
    };
}

/**
 * A command or a package. A package is spelled out the way it would be sent,
 * steps resolved against the library, so the model reads what it does rather
 * than a list of ids. Neither has been run: it is something the user keeps.
 */
function fromSnippet(snippet, library) {
    const description = snippet.description ? [`description: ${snippet.description}`] : [];

    if (snippet.kind === 'package') {
        const { text, missing, steps } = composeSnippet(snippet, library);
        return {
            name: snippet.name,
            snippetKind: 'package',
            text: String(text || '').slice(0, MAX_TEXT),
            lines: [
                ...description,
                `steps: ${steps.length}${snippet.chain ? ', each only if the one before it succeeded' : ''}`,
                missing.length === 1 ? '1 more step points at a command no longer in the library.' : '',
                missing.length > 1 ? `${missing.length} more steps point at commands no longer in the library.` : '',
            ].filter(Boolean),
            note: 'A series of commands the user keeps. It has not been run.',
        };
    }

    return {
        name: snippet.name,
        snippetKind: 'command',
        text: String(snippet.command || '').slice(0, MAX_TEXT),
        lines: description,
        note: 'A command the user keeps. It has not been run.',
    };
}

const RESOLVE = {
    host: (record) => fromHost(record),
    proxy: (record) => ({
        name: record.name || record.host,
        lines: [
            `id: ${record.id}`,
            `type: ${String(record.type || '').toUpperCase()}`,
            `address: ${[record.host, record.port].filter(Boolean).join(':')}`,
        ],
        note: 'A saved proxy. Its credentials stay in the app.',
    }),
    key: (record) => ({
        name: record.name,
        // The public half's fingerprint and nothing else. There is no path
        // from here to a private key, and there never should be.
        lines: [
            `id: ${record.id}`,
            record.type ? `type: ${record.type}` : '',
            record.fingerprint ? `fingerprint: ${record.fingerprint}` : '',
        ].filter(Boolean),
        note: 'A key in the user\'s keychain. Its private half stays in the app.',
    }),
    skill: (record) => ({
        name: record.name,
        text: String(record.text || '').slice(0, MAX_TEXT),
        lines: record.description ? [`description: ${record.description}`] : [],
        note: 'The user invoked this skill with `/`. Treat it as the instructions for this request.',
    }),
};

const isSpec = mention => mention.kind === 'snippet' && mention.snippetKind === 'spec';

/**
 * The mentions as records, in the order they were tagged, or the reason one of
 * them cannot be sent.
 *
 * All or nothing, as attachments have always been: the message was written
 * about all of them, and a question answered against half of what it named is
 * worse than one that was refused and asked again.
 */
function readMentions(raw, inventory = {}) {
    if (raw === undefined || raw === null) return { mentions: [], error: '' };
    if (!Array.isArray(raw)) return { mentions: [], error: 'The mentions were not a list' };
    if (raw.length > MAX_MENTIONS) {
        return { mentions: [], error: `A message can carry at most ${MAX_MENTIONS} mentions` };
    }

    const seen = new Set();
    const mentions = [];

    for (const entry of raw) {
        const kind = clean(entry?.kind);
        const id = clean(entry?.id);
        if (!kind || !id) continue;
        if (!KINDS.includes(kind)) {
            return { mentions: [], error: `“${kind}” is not something that can be tagged` };
        }

        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const records = inventory[SOURCE[kind]] || [];
        const record = records.find(item => item.id === id);
        if (!record) {
            return {
                mentions: [],
                error: 'One of the things this message tags no longer exists. Take it off and try again.',
            };
        }

        // A spec is read the way the spec menu always read one, errors and
        // all, so tagging a runbook behaves exactly as attaching it did.
        if (kind === 'snippet' && record.kind === 'spec') {
            const { specs, error } = readSpecs([id], records);
            if (error) return { mentions: [], error };
            mentions.push({ kind, id, name: specs[0].name, snippetKind: 'spec', text: specs[0].text });
            continue;
        }

        const resolved = kind === 'snippet' ? fromSnippet(record, records) : RESOLVE[kind](record);
        if (resolved.text !== undefined && !String(resolved.text).trim()) {
            return { mentions: [], error: `“${resolved.name}” is empty` };
        }

        mentions.push({ kind, id, ...resolved });
    }

    if (mentions.filter(isSpec).length > MAX_SPECS) {
        return { mentions: [], error: `A message can carry at most ${MAX_SPECS} specs` };
    }

    return { mentions, error: '' };
}

/** Everything but the specs: one tagged block per thing, after a line that says what they are. */
function inventoryBlock(mentions) {
    const lines = [
        mentions.length === 1
            ? 'The user tagged the following in their message. It is what they are referring to.'
            : `The user tagged the following ${mentions.length} things in their message. They are what it refers to.`,
        '',
    ];

    for (const mention of mentions) {
        const tag = LABEL[mention.kind] || 'item';
        const name = String(mention.name || tag).replace(/["\n\r]/g, ' ').trim();

        lines.push(`<${tag} name="${name}">`);
        for (const line of mention.lines || []) lines.push(line);
        if (mention.note) lines.push(mention.note);
        if (mention.text) {
            if (mention.lines?.length || mention.note) lines.push('');
            // A closing tag inside the text would end the block early, so it
            // is spelled out of harm's way rather than trusted.
            lines.push(String(mention.text).replace(new RegExp(`</${tag}>`, 'gi'), `</ ${tag}>`));
        }
        lines.push(`</${tag}>`, '');
    }

    return lines.join('\n').trimEnd();
}

/**
 * What goes in front of the user's text.
 *
 * Specs first, in the very block `specs.js` has always written for them, so a
 * runbook tagged with `@` is read as the user's instructions just as one
 * attached from the old menu was. Then everything else, tagged and named, so
 * the model can tell what was pointed at from what was asked and can refer
 * back to "web-01" by name.
 */
function mentionBlock(mentions) {
    if (!mentions?.length) return '';

    const blocks = [];
    const specs = mentions.filter(isSpec);
    const rest = mentions.filter(mention => !isSpec(mention));
    if (specs.length > 0) blocks.push(specBlock(specs.map(({ id, name, text }) => ({ id, name, text }))));
    if (rest.length > 0) blocks.push(inventoryBlock(rest));
    return blocks.join('\n\n');
}

/** The same mentions without their text, for the transcript: enough for a chip. */
function stripMentions(mentions) {
    return (mentions || []).map(({ kind, id, name, snippetKind }) => (
        snippetKind ? { kind, id, name, snippetKind } : { kind, id, name }
    ));
}

module.exports = { readMentions, mentionBlock, stripMentions, MAX_MENTIONS, KINDS };
