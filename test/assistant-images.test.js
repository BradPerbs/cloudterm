const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const images = require('../src/main/ai/images');
const claude = require('../src/main/ai/providers/claude-code');
const codex = require('../src/main/ai/providers/codex');

/** A base64 string that decodes to `bytes` bytes. */
function base64Of(bytes) {
    return Buffer.alloc(bytes, 1).toString('base64');
}

async function run() {
    const png = { name: 'shot.png', mediaType: 'image/png', data: base64Of(300) };

    // Nothing attached is the ordinary message, not an error.
    assert.deepStrictEqual(images.readImages(undefined), { images: [], error: '' });
    assert.deepStrictEqual(images.readImages([]), { images: [], error: '' });

    const ok = images.readImages([png, { name: '  a   b.jpg ', mediaType: 'IMAGE/JPEG', data: base64Of(10) }]);
    assert.strictEqual(ok.error, '');
    assert.strictEqual(ok.images.length, 2);
    assert.deepStrictEqual(ok.images[0], png);
    assert.strictEqual(ok.images[1].name, 'a b.jpg', 'names are tidied, not trusted');
    assert.strictEqual(ok.images[1].mediaType, 'image/jpeg', 'the type is normalised to what the API spells');

    // One bad image refuses the whole message: the text was about all of them.
    const mixed = images.readImages([png, { name: 'doc.pdf', mediaType: 'application/pdf', data: base64Of(10) }]);
    assert.strictEqual(mixed.images.length, 0);
    assert.match(mixed.error, /doc\.pdf/);

    assert.match(images.readImages([{ mediaType: 'image/png', data: 'not base64!!' }]).error, /could not be read/);
    assert.match(images.readImages([{ mediaType: 'image/png', data: '' }]).error, /could not be read/);
    assert.match(images.readImages('nope').error, /not a list/);

    const huge = { name: 'huge.png', mediaType: 'image/png', data: base64Of(images.MAX_IMAGE_BYTES + 1) };
    assert.match(images.readImages([huge]).error, /larger than/);
    const exact = { name: 'edge.png', mediaType: 'image/png', data: base64Of(images.MAX_IMAGE_BYTES) };
    assert.strictEqual(images.readImages([exact]).error, '', 'the ceiling itself is allowed');

    const many = Array.from({ length: images.MAX_IMAGES + 1 }, () => png);
    assert.match(images.readImages(many).error, /at most/);

    // What goes to disk has no bytes in it.
    assert.deepStrictEqual(images.stripImages([png]), [{ name: 'shot.png', mediaType: 'image/png' }]);

    // The turn as Claude Code receives it.
    assert.strictEqual(claude.userContent('hello', []), 'hello', 'text alone stays a string');
    const blocks = claude.userContent('what is this?', [png]);
    assert.deepStrictEqual(blocks, [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } },
        { type: 'text', text: 'what is this?' },
    ], 'images first, then the words about them');
    assert.deepStrictEqual(
        claude.userContent('', [png]).map(block => block.type),
        ['image'],
        'no empty text block, which the API refuses'
    );

    // The turn as Codex receives it: files on disk, named on the input.
    assert.strictEqual(codex.turnInput('hello', []), 'hello', 'text alone stays a string');
    assert.deepStrictEqual(codex.turnInput('what is this?', ['/tmp/a.png', '/tmp/b.jpg']), [
        { type: 'local_image', path: '/tmp/a.png' },
        { type: 'local_image', path: '/tmp/b.jpg' },
        { type: 'text', text: 'what is this?' },
    ], 'images first, then the words about them');
    assert.deepStrictEqual(
        codex.turnInput('', ['/tmp/a.png']),
        [{ type: 'local_image', path: '/tmp/a.png' }, { type: 'text', text: 'See the attached image.' }],
        'the CLI wants some text with a picture sent on its own'
    );
    assert.strictEqual(codex.turnInput('', ['/a', '/b'])[2].text, 'See the attached images.');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudterm-test-'));
    try {
        const none = await codex.stageImages([], root);
        assert.deepStrictEqual(none.paths, []);
        await none.cleanup();
        assert.deepStrictEqual(fs.readdirSync(root), [], 'nothing to stage writes nothing');

        const jpeg = { name: 'photo.jpg', mediaType: 'image/jpeg', data: Buffer.from('jpeg-bytes').toString('base64') };
        const staged = await codex.stageImages([png, jpeg], root);
        assert.strictEqual(staged.paths.length, 2);
        assert.ok(staged.paths[0].endsWith('image-1.png'), 'named by position, with the extension the type implies');
        assert.ok(staged.paths[1].endsWith('image-2.jpg'));
        assert.strictEqual(path.dirname(staged.paths[0]), path.dirname(staged.paths[1]), 'one directory per turn');
        assert.ok(path.dirname(staged.paths[0]).startsWith(root));
        assert.deepStrictEqual(fs.readFileSync(staged.paths[0]), Buffer.from(png.data, 'base64'), 'the bytes, decoded');
        assert.strictEqual(fs.readFileSync(staged.paths[1], 'utf8'), 'jpeg-bytes');

        await staged.cleanup();
        assert.ok(!fs.existsSync(path.dirname(staged.paths[0])), 'the directory goes with the turn');
        await staged.cleanup();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }

    // Claude Code and Codex take pictures, and say so. Grok Build takes them
    // as files named on the turn's prompt. The rest do not.
    assert.strictEqual(claude.supportsImages, true);
    assert.strictEqual(codex.supportsImages, true);
    const grokBuild = require('../src/main/ai/providers/grok');
    assert.strictEqual(grokBuild.supportsImages, true);
    for (const name of ['opencode', 'kimi', 'local']) {
        const provider = require(`../src/main/ai/providers/${name}`);
        assert.notStrictEqual(provider.supportsImages, true, `${name} does not claim to read images`);
    }

    // The turn as Grok Build receives it: pictures staged to disk and named on
    // the prompt, since a headless run takes text rather than image blocks.
    assert.strictEqual(grokBuild.promptWithImages('hello', []), 'hello', 'text alone stays as it was');
    assert.strictEqual(
        grokBuild.promptWithImages('what is this?', ['/tmp/image-1.png']),
        'what is this?\n\nAttached images (open each file to view it):\n- /tmp/image-1.png',
        'pictures named under the words about them'
    );
    assert.strictEqual(
        grokBuild.promptWithImages('', ['/tmp/image-1.png']).split('\n')[0],
        'See the attached images.',
        'a picture sent on its own still carries words'
    );
    // A picture that cannot be shown is said, not dropped.
    const unseen = grokBuild.promptWithUnseenImages('what is this?', 2, 'local tools are off');
    assert.ok(unseen.startsWith('what is this?\n\n'));
    assert.ok(/2 images, which could not be shown to you: local tools are off/.test(unseen), unseen);

    // Which of Grok Build's models read pictures. The cache's own word wins;
    // without one, the Grok 4 family does and the coding models and anything
    // from another endpoint do not.
    assert.strictEqual(grokBuild.readsImages('grok-4.6', {}), true);
    assert.strictEqual(grokBuild.readsImages('grok-4-fast', { model: 'grok-4-fast-reasoning' }), true);
    assert.strictEqual(grokBuild.readsImages('grok-code-fast-1', {}), false);
    assert.strictEqual(grokBuild.readsImages('grok-3', {}), false);
    assert.strictEqual(grokBuild.readsImages('my-llama', { model: 'llama-3.1-70b' }), false);
    assert.strictEqual(grokBuild.readsImages('grok-4.6', { supports_images: false }), false, 'a flag in the cache wins');
    assert.strictEqual(grokBuild.readsImages('my-llava', { input_modalities: ['text', 'image'] }), true);
    assert.strictEqual(grokBuild.readsImages('grok-4.6', { input_modalities: ['text'] }), false);

    const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudterm-grok-'));
    try {
        fs.writeFileSync(path.join(grokHome, 'models_cache.json'), JSON.stringify({ models: {
            'grok-4.6': { info: { id: 'grok-4.6', name: 'Grok 4.6' } },
            'grok-code-fast-1': { info: { id: 'grok-code-fast-1', name: 'Grok Code Fast' } },
        } }));
        const rows = grokBuild.cachedModels({ source: grokHome });
        assert.deepStrictEqual(rows.map(row => [row.value, row.images]), [
            ['grok-4.6', true],
            ['grok-code-fast-1', false],
        ], 'each row of the menu says whether its model reads pictures');
    } finally {
        fs.rmSync(grokHome, { recursive: true, force: true });
    }

    // The gate main asks before it takes a picture, and the composer asks
    // before it offers one: the runtime, then the model, then the local tools
    // for a runtime that opens pictures as files.
    const { imageRefusal } = require('../src/main/ai/image-gate');
    const catalog = [
        { value: 'grok-4.6', label: 'Grok 4.6', images: true, preferred: true },
        { value: 'grok-code-fast-1', label: 'Grok Code Fast', images: false },
    ];
    assert.strictEqual(imageRefusal({ provider: claude, settings: { model: 'opus' } }), '');
    assert.match(imageRefusal({ provider: require('../src/main/ai/providers/kimi'), settings: {} }), /cannot read images/);
    assert.strictEqual(imageRefusal({ provider: grokBuild, settings: { model: 'grok-4.6' }, catalog }), '');
    assert.strictEqual(imageRefusal({ provider: grokBuild, settings: { model: '' }, catalog }), '', 'the default row is the one asked');
    assert.match(
        imageRefusal({ provider: grokBuild, settings: { model: 'grok-code-fast-1' }, catalog }),
        /^Grok Code Fast cannot read images/
    );
    assert.strictEqual(
        imageRefusal({ provider: grokBuild, settings: { model: 'grok-9' }, catalog }),
        '',
        'a model the list does not name is given the runtime\'s answer'
    );
    assert.strictEqual(imageRefusal({ provider: grokBuild, settings: { model: 'grok-4.6' } }), '', 'nor does a list not read yet refuse');
    assert.match(
        imageRefusal({ provider: grokBuild, settings: { model: 'grok-4.6', allowLocalTools: false }, catalog }),
        /local tools are switched off/
    );
    assert.strictEqual(
        imageRefusal({ provider: codex, settings: { allowLocalTools: false } }),
        '',
        'a runtime that takes pictures directly does not need the local tools'
    );

    // The composer's copy of the same gate, which is ESM for the bundler.
    const { canReadImages } = await import(pathToFileURL(
        path.join(__dirname, '..', 'src', 'renderer', 'lib', 'image-gate.js')
    ).href);
    const known = {
        imageProviders: ['claude', 'codex', 'grok'],
        localImageProviders: ['grok'],
        catalogs: { grok: catalog },
    };
    assert.strictEqual(canReadImages({ provider: 'claude', model: '' }, known), true);
    assert.strictEqual(canReadImages({ provider: 'kimi', model: '' }, known), false);
    assert.strictEqual(canReadImages({ provider: 'grok', model: 'grok-4.6' }, known), true);
    assert.strictEqual(canReadImages({ provider: 'grok', model: 'grok-code-fast-1' }, known), false);
    assert.strictEqual(canReadImages({ provider: 'grok', model: 'grok-4.6', allowLocalTools: false }, known), false);
    assert.strictEqual(canReadImages(null, known), false, 'nothing is offered before the settings arrive');

    // The web is not a local tool. This is what "the assistant has no
    // internet" turned out to be.
    for (const name of claude.WEB_TOOLS) {
        assert.ok(!claude.LOCAL_TOOLS.includes(name), `${name} is not gated by the local-tools switch`);
    }
    assert.deepStrictEqual(claude.WEB_TOOLS, ['WebFetch', 'WebSearch']);
    const grok = require('../src/main/ai/providers/grok');
    const kimi = require('../src/main/ai/providers/kimi');
    assert.ok(!grok.LOCAL_TOOLS.some(name => /^Web/.test(name)));
    assert.ok(!kimi.LOCAL_TOOLS.some(name => /^Web|^Fetch/.test(name)));

    console.log('assistant images: ok');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
