/**
 * The update path, in the two places it fails silently rather than loudly.
 *
 * Version comparison decides whether anybody is told a release exists at all,
 * and it fails by simply never firing: a build where `1.10.0` is judged older
 * than `1.9.0` reports "up to date" forever and nobody files a bug about an
 * update they were never offered.
 *
 * Manifest merging decides which architecture a Mac is handed, and it fails one
 * step further along still. A manifest listing only one arch does not error, it
 * hands over the wrong build, and that only shows up as an app that will not
 * open on somebody else's machine.
 *
 * `electron` is stubbed so this runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-updates-'));

const electronStub = {
    app: {
        getPath: () => userData,
        getVersion: () => '1.0.0',
        // Everything that installs rather than notifies is gated behind this,
        // so a test run is a notify-mode app and never loads electron-updater.
        isPackaged: false,
        on: () => {},
    },
    net: { fetch: async () => { throw new Error('offline'); } },
    shell: { openExternal: async () => true },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const updates = require(path.join(__dirname, '..', 'src', 'main', 'updates.js'));
const { merge } = require(path.join(__dirname, '..', 'scripts', 'merge-update-manifests.js'));

let passed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        process.exitCode = 1;
    }
};

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

console.log('\nupdates: version comparison');

const { compareVersions } = updates;

check('orders by number and not by text', () => {
    // The whole reason this function exists rather than a `>` on two strings.
    assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1);
    assert.strictEqual(compareVersions('1.9.0', '1.10.0'), -1);
    assert.strictEqual(compareVersions('2.0.0', '1.99.99'), 1);
});

check('ignores a leading v and surrounding space', () => {
    assert.strictEqual(compareVersions('v1.2.3', '1.2.3'), 0);
    assert.strictEqual(compareVersions(' V1.2.4 ', 'v1.2.3'), 1);
});

check('treats a missing part as zero', () => {
    assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
    assert.strictEqual(compareVersions('1.2.1', '1.2'), 1);
});

check('puts a release ahead of its own prereleases', () => {
    assert.strictEqual(compareVersions('1.2.0', '1.2.0-rc.1'), 1);
    assert.strictEqual(compareVersions('1.2.0-rc.1', '1.2.0'), -1);
    assert.strictEqual(compareVersions('1.2.0-rc.2', '1.2.0-rc.1'), 1);
});

check('survives the junk a release tag can contain', () => {
    // Nothing here should ever reach a tag, and none of it should throw on the
    // way to deciding there is no update. A tag that parses to no numbers at
    // all reads as 0.0.0, and its trailing word reads as a prerelease of it.
    assert.strictEqual(compareVersions('', '1.0.0'), -1);
    assert.strictEqual(compareVersions(null, undefined), 0);
    assert.strictEqual(compareVersions('release-candidate', '0.0.0'), -1);
});

/* ------------------------------------------------------------------ *
 * Release notes
 * ------------------------------------------------------------------ */

console.log('\nupdates: release notes');

const { stripHtml } = updates;

check('unwraps the HTML the releases feed hands back', () => {
    const html = '<p>Fixed the thing.</p><ul><li>One</li><li>Two</li></ul>';
    assert.strictEqual(stripHtml(html), 'Fixed the thing.\n- One\n- Two\n');
});

check('decodes the entities that would otherwise be read aloud', () => {
    assert.strictEqual(
        stripHtml('<p>Use &lt;Ctrl&gt; &amp; &quot;shift&quot;</p>'),
        'Use <Ctrl> & "shift"\n',
    );
});

check('leaves plain markdown alone', () => {
    assert.strictEqual(stripHtml('- One\n- Two'), '- One\n- Two');
    assert.strictEqual(stripHtml(null), '');
});

/* ------------------------------------------------------------------ *
 * Manifest merging
 * ------------------------------------------------------------------ */

console.log('\nupdates: mac manifest merging');

const manifest = (arch) => [
    'version: 1.4.0',
    'files:',
    `  - url: CloudTerm-${arch}.zip`,
    `    sha512: zip-${arch}-hash`,
    '    size: 104857600',
    '    blockMapSize: 112233',
    `  - url: CloudTerm-${arch}.dmg`,
    `    sha512: dmg-${arch}-hash`,
    '    size: 104857600',
    `path: CloudTerm-${arch}.zip`,
    `sha512: zip-${arch}-hash`,
    "releaseDate: '2026-08-03T10:00:00.000Z'",
].join('\n') + '\n';

const write = (name, content) => {
    const file = path.join(userData, name);
    fs.writeFileSync(file, content);
    return file;
};

check('carries both architectures into one file list', () => {
    const result = merge([
        write('latest-mac-x64.yml', manifest('x64')),
        write('latest-mac-arm64.yml', manifest('arm64')),
    ]);

    assert.deepStrictEqual(result.urls, [
        'CloudTerm-x64.zip',
        'CloudTerm-x64.dmg',
        'CloudTerm-arm64.zip',
        'CloudTerm-arm64.dmg',
    ]);
});

check('keeps every line electron-builder wrote', () => {
    const result = merge([
        write('latest-mac-x64.yml', manifest('x64')),
        write('latest-mac-arm64.yml', manifest('arm64')),
    ]);

    // The sha512s are the point. A merge that reformatted them, or dropped the
    // blockMapSize that makes a differential download possible, would produce a
    // manifest that parses and then fails to verify what it downloaded.
    for (const line of ['    sha512: zip-arm64-hash', '    blockMapSize: 112233', '    sha512: dmg-x64-hash']) {
        assert.ok(result.text.includes(`${line}\n`), `missing ${line.trim()}`);
    }

    assert.strictEqual(result.version, '1.4.0');
    // Exactly one of each top-level key, and the first input's copy of it.
    assert.strictEqual(result.text.match(/^version:/gm).length, 1);
    assert.strictEqual(result.text.match(/^path:/gm).length, 1);
    assert.ok(result.text.includes('path: CloudTerm-x64.zip'));
});

check('names arm64 so the updater can tell it from x64', () => {
    const result = merge([
        write('latest-mac-x64.yml', manifest('x64')),
        write('latest-mac-arm64.yml', manifest('arm64')),
    ]);

    // electron-updater picks the entry whose url contains `process.arch` and
    // falls back to the first zip. So the arm64 name must not match an x64
    // machine, which it does not, and each arch must find its own.
    const zips = result.urls.filter(url => url.endsWith('.zip'));

    assert.strictEqual(zips.filter(url => url.includes('x64')).length, 1);
    assert.strictEqual(zips.filter(url => url.includes('arm64')).length, 1);
    assert.ok(!'CloudTerm-arm64.zip'.includes('x64'));
});

check('drops an artifact listed by both runners', () => {
    const result = merge([
        write('latest-mac-x64.yml', manifest('x64')),
        write('latest-mac-x64-again.yml', manifest('x64')),
    ]);

    assert.deepStrictEqual(result.urls, ['CloudTerm-x64.zip', 'CloudTerm-x64.dmg']);
});

check('passes a single manifest through unchanged', () => {
    const only = manifest('arm64');
    const result = merge([write('latest-mac-solo.yml', only)]);

    assert.strictEqual(result.text, only);
});

console.log(`\n${passed} passed`);

Module._load = realLoad;
fs.rmSync(userData, { recursive: true, force: true });
