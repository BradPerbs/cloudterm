const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

    // Claude Code and Codex take pictures, and say so. The rest do not.
    assert.strictEqual(claude.supportsImages, true);
    assert.strictEqual(codex.supportsImages, true);
    for (const name of ['opencode', 'grok', 'kimi', 'local']) {
        const provider = require(`../src/main/ai/providers/${name}`);
        assert.notStrictEqual(provider.supportsImages, true, `${name} does not claim to read images`);
    }

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
