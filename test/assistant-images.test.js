const assert = require('assert');

const images = require('../src/main/ai/images');
const claude = require('../src/main/ai/providers/claude-code');

/** A base64 string that decodes to `bytes` bytes. */
function base64Of(bytes) {
    return Buffer.alloc(bytes, 1).toString('base64');
}

function run() {
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

    // Only Claude Code takes pictures, and it says so.
    assert.strictEqual(claude.supportsImages, true);
    for (const name of ['codex', 'opencode', 'grok', 'kimi', 'local']) {
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

run();
