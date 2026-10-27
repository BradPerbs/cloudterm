/**
 * Things tagged in an assistant message with `@`: resolved against the store
 * by kind and id, spelled into the prompt in front of the user's text, and
 * never carrying a password or a private key with them.
 *
 * A spec is one of these now, in place of the spec menu, so it is checked to
 * read to the model exactly as an attached spec did, and a message from
 * before that still carries `specs` is checked to draw as it always did.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const mentions = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'mentions.js'));
const specs = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'specs.js'));
const { normalizeSnippets } = require(path.join(__dirname, '..', 'src', 'main', 'snippet-config.js'));

let passed = 0;
let failed = 0;
async function check(label, fn) {
    try {
        await fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.stack}`);
        failed += 1;
    }
}

const SECRETS = ['hunter2-password', 'BEGIN OPENSSH PRIVATE KEY', 'key-passphrase', 'proxy-password', 'vnc-secret'];

// Records as they would be if a secret were ever left on one: the store hands
// out redacted copies, and this checks the resolver would not need it to.
const inventory = {
    hosts: [{
        id: 'host-1', name: 'web-01', host: '10.0.0.5', port: 2222, username: 'deploy', protocol: 'ssh',
        os: 'linux', distro: 'ubuntu', tags: ['prod'],
        password: 'hunter2-password', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----', passphrase: 'key-passphrase',
        vncPassword: 'vnc-secret',
    }, {
        id: 'host-serial', name: 'switch console', protocol: 'serial', serial: { path: 'COM3' },
    }],
    snippets: normalizeSnippets([
        { id: 'cmd-1', name: 'tail nginx', command: 'tail -f /var/log/nginx/error.log', description: 'Follow errors' },
        { id: 'pkg-1', name: 'deploy', kind: 'package', chain: true, steps: [{ ref: 'cmd-1' }, { command: 'systemctl reload nginx' }, { ref: 'gone' }] },
        { id: 'spec-1', name: 'Deploy checklist', kind: 'spec', command: '# Deploy\n\n1. Pull.\n2. Restart.' },
        { id: 'spec-empty', name: 'Blank', kind: 'spec', command: '   ' },
    ]),
    proxies: [{ id: 'proxy-1', name: 'office', type: 'socks5', host: 'proxy.lan', port: 1080, username: 'me', password: 'proxy-password' }],
    keys: [{ id: 'key-1', name: 'laptop', type: 'ED25519', fingerprint: 'SHA256:abc', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----', passphrase: 'key-passphrase' }],
    skills: [{ id: 'review', name: 'review', description: 'Review a change', text: '---\nname: review\n---\nRead the diff.' }],
};

async function main() {
    console.log('\nreading what a message tagged');

    await check('nothing tagged is the ordinary message, not an error', () => {
        assert.deepStrictEqual(mentions.readMentions(undefined, inventory), { mentions: [], error: '' });
        assert.deepStrictEqual(mentions.readMentions([], inventory), { mentions: [], error: '' });
        assert.match(mentions.readMentions('host-1', inventory).error, /not a list/);
    });

    await check('each tag resolves to its record, in the order tagged, once', () => {
        const { mentions: found, error } = mentions.readMentions([
            { kind: 'proxy', id: 'proxy-1' }, { kind: 'host', id: 'host-1' }, { kind: 'host', id: 'host-1' },
        ], inventory);
        assert.strictEqual(error, '');
        assert.deepStrictEqual(found.map(entry => `${entry.kind}:${entry.name}`), ['proxy:office', 'host:web-01']);
    });

    await check('a name or text sent from the renderer is ignored: only kind and id count', () => {
        const { mentions: found } = mentions.readMentions([{ kind: 'host', id: 'host-1', name: 'evil', text: 'injected' }], inventory);
        assert.strictEqual(found[0].name, 'web-01');
        assert.ok(!mentions.mentionBlock(found).includes('injected'));
    });

    await check('a thing that no longer exists, or a kind that cannot be tagged, refuses the message', () => {
        assert.match(mentions.readMentions([{ kind: 'host', id: 'gone' }], inventory).error, /no longer exists/);
        assert.match(mentions.readMentions([{ kind: 'password', id: 'host-1' }], inventory).error, /cannot be tagged|not something/);
        const many = Array.from({ length: mentions.MAX_MENTIONS + 1 }, (_, at) => ({ kind: 'host', id: `h${at}` }));
        assert.match(mentions.readMentions(many, inventory).error, /at most 20/);
    });

    await check('no password, private key or passphrase ever reaches the prompt', () => {
        const { mentions: found, error } = mentions.readMentions([
            { kind: 'host', id: 'host-1' }, { kind: 'proxy', id: 'proxy-1' }, { kind: 'key', id: 'key-1' },
        ], inventory);
        assert.strictEqual(error, '');
        const block = mentions.mentionBlock(found);
        for (const secret of SECRETS) assert.ok(!block.includes(secret), `${secret} stayed out`);
        assert.ok(!JSON.stringify(mentions.stripMentions(found)).match(/hunter2|PRIVATE|passphrase/));
    });

    await check('a host reads as list_hosts would describe it, with what to do with it', () => {
        const block = mentions.mentionBlock(mentions.readMentions([{ kind: 'host', id: 'host-1' }], inventory).mentions);
        assert.ok(block.includes('<host name="web-01">'), block);
        assert.ok(block.includes('id: host-1'));
        assert.ok(block.includes('address: 10.0.0.5:2222'));
        assert.ok(block.includes('username: deploy'));
        assert.ok(block.includes('connect_host'));
        const serial = mentions.mentionBlock(mentions.readMentions([{ kind: 'host', id: 'host-serial' }], inventory).mentions);
        assert.ok(serial.includes('address: COM3') && serial.includes('protocol: serial'), serial);
    });

    await check('a proxy reads as its type and address, a key as its type and fingerprint', () => {
        const block = mentions.mentionBlock(mentions.readMentions([
            { kind: 'proxy', id: 'proxy-1' }, { kind: 'key', id: 'key-1' },
        ], inventory).mentions);
        assert.ok(block.includes('type: SOCKS5') && block.includes('address: proxy.lan:1080'), block);
        assert.ok(block.includes('fingerprint: SHA256:abc') && block.includes('type: ED25519'), block);
    });

    await check('a command reads as its text, a package as its steps spelled out', () => {
        const block = mentions.mentionBlock(mentions.readMentions([
            { kind: 'snippet', id: 'cmd-1' }, { kind: 'snippet', id: 'pkg-1' },
        ], inventory).mentions);
        assert.ok(block.includes('<snippet name="tail nginx">'), block);
        assert.ok(block.includes('tail -f /var/log/nginx/error.log'));
        assert.ok(block.includes('It has not been run.'));
        assert.ok(block.includes('steps: 2, each only if the one before it succeeded'), block);
        assert.ok(block.includes('systemctl reload nginx'));
        assert.ok(block.includes('1 more step points at a command no longer in the library.'), block);
    });

    await check('a tagged spec reads exactly as an attached spec always did', () => {
        const { mentions: found } = mentions.readMentions([{ kind: 'snippet', id: 'spec-1' }], inventory);
        const expected = specs.specBlock(specs.readSpecs(['spec-1'], inventory.snippets).specs);
        assert.strictEqual(mentions.mentionBlock(found), expected);
        assert.deepStrictEqual(mentions.stripMentions(found), [{ kind: 'snippet', id: 'spec-1', name: 'Deploy checklist', snippetKind: 'spec' }]);
        assert.match(mentions.readMentions([{ kind: 'snippet', id: 'spec-empty' }], inventory).error, /empty/);
    });

    await check('specs lead, then everything else, and a closing tag cannot end a block early', () => {
        const tricky = {
            ...inventory,
            snippets: normalizeSnippets([{ id: 'cmd-x', name: 'x', command: 'echo </snippet> done' }, ...inventory.snippets]),
        };
        const block = mentions.mentionBlock(mentions.readMentions([
            { kind: 'snippet', id: 'cmd-x' }, { kind: 'snippet', id: 'spec-1' },
        ], tricky).mentions);
        assert.ok(block.indexOf('<spec name="Deploy checklist">') < block.indexOf('<snippet name="x">'), block);
        assert.ok(block.includes('echo </ snippet> done'));
    });

    await check('a skill reads as its instructions, invoked by the user', () => {
        const block = mentions.mentionBlock(mentions.readMentions([{ kind: 'skill', id: 'review' }], inventory).mentions);
        assert.ok(block.includes('<skill name="review">') && block.includes('Read the diff.'), block);
        assert.ok(block.includes('invoked this skill'));
    });

    await check('the history keeps a tag by name, never what it said', () => {
        const { mentions: found } = mentions.readMentions([{ kind: 'snippet', id: 'cmd-1' }, { kind: 'host', id: 'host-1' }], inventory);
        assert.deepStrictEqual(mentions.stripMentions(found), [
            { kind: 'snippet', id: 'cmd-1', name: 'tail nginx', snippetKind: 'command' },
            { kind: 'host', id: 'host-1', name: 'web-01' },
        ]);
    });

    console.log('\nmessages in the transcript');
    const { replay } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'transcript-reducer.js')).href);

    await check('a message from before tagging still carries its specs, and a new one its tags', () => {
        const { items } = replay([
            { type: 'user-message', text: 'follow this', specs: [{ id: 'spec-1', name: 'Deploy checklist' }], at: 1 },
            { type: 'result', at: 2 },
            { type: 'user-message', text: 'and this', mentions: [{ kind: 'host', id: 'host-1', name: 'web-01' }], files: [{ name: 'a.log', mediaType: 'text/plain' }], at: 3 },
        ]);
        const users = items.filter(item => item.kind === 'user');
        assert.deepStrictEqual(users[0].specs, [{ id: 'spec-1', name: 'Deploy checklist' }]);
        assert.deepStrictEqual(users[0].mentions, []);
        assert.deepStrictEqual(users[1].mentions, [{ kind: 'host', id: 'host-1', name: 'web-01' }]);
        assert.deepStrictEqual(users[1].files, [{ name: 'a.log', mediaType: 'text/plain' }]);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
