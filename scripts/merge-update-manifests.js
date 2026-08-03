#!/usr/bin/env node
/**
 * Folds the per-arch update manifests into the one file the updater reads.
 *
 * electron-builder writes a `latest-mac.yml` beside whatever it just built, and
 * the release workflow builds the two macOS architectures on two runners,
 * because each has to carry a different Claude binary. So two manifests arrive,
 * each describing only its own half of the release, and one release can only
 * publish one of them.
 *
 * Letting the second overwrite the first is the bug this exists to prevent, and
 * it is a quiet one. electron-updater picks from the file list by looking for
 * `process.arch` in the name and falls back to the first entry when nothing
 * matches, so a manifest listing only `CloudTerm-arm64.zip` does not fail on an
 * Intel Mac. It hands over the arm64 build, and the failure surfaces later as
 * an app that will not start.
 *
 * Merging is a list splice and not a YAML rewrite on purpose. The output has to
 * stay byte-for-byte the file electron-builder would have written, sha512s and
 * all, and the surest way to keep it that way is to move the lines it wrote
 * without reformatting a single one. Everything this assumes about the shape is
 * asserted below, so a change in electron-builder's output fails the release
 * rather than shipping a manifest nobody checked.
 *
 *     node scripts/merge-update-manifests.js <output> <input...>
 */

const fs = require('fs');

// `version: 1.2.3` and friends. The indented lines under `files:` are the ones
// this must not match, which is what anchoring to column zero buys.
const TOP_LEVEL = /^([A-Za-z][\w-]*):(.*)$/;

// `  - url: CloudTerm-arm64.zip`, the first line of an entry. Later lines of
// the same entry are indented further and carry no dash.
const ENTRY_START = /^\s+-\s+\S/;

const URL = /^\s*(?:-\s+)?url:\s*(.+?)\s*$/;

function fail(message) {
    console.error(`merge-update-manifests: ${message}`);
    process.exit(1);
}

/**
 * A manifest split into the three parts a merge cares about: everything before
 * the file list, the entries themselves, and everything after.
 */
function parse(file) {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');

    // The trailing newline leaves an empty last element that would otherwise be
    // read as part of whichever block happens to come last.
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

    const start = lines.findIndex(line => line.startsWith('files:'));

    if (start === -1) fail(`${file} has no "files:" list`);

    let end = start + 1;
    while (end < lines.length && !TOP_LEVEL.test(lines[end])) end += 1;

    const entries = [];

    for (const line of lines.slice(start + 1, end)) {
        if (ENTRY_START.test(line)) entries.push([]);
        else if (!entries.length) fail(`${file} has a "files:" list that does not start with an entry`);

        entries[entries.length - 1].push(line);
    }

    if (!entries.length) fail(`${file} has an empty "files:" list`);

    const version = lines
        .map(line => TOP_LEVEL.exec(line))
        .find(match => match?.[1] === 'version')?.[2]?.trim();

    if (!version) fail(`${file} has no "version:"`);

    return {
        file,
        version,
        head: lines.slice(0, start + 1),
        tail: lines.slice(end),
        entries: entries.map((entryLines) => {
            const url = entryLines.map(line => URL.exec(line)?.[1]).find(Boolean);

            if (!url) fail(`${file} has a file entry with no "url:"`);

            return { url, lines: entryLines };
        }),
    };
}

function merge(inputs) {
    const parsed = inputs.map(parse);
    const [base] = parsed;

    // Two runners building different tags would produce a manifest that is
    // internally inconsistent and impossible to debug from the outside.
    for (const manifest of parsed) {
        if (manifest.version !== base.version) {
            fail(`${manifest.file} is version ${manifest.version}, but ${base.file} is ${base.version}`);
        }
    }

    const seen = new Set();
    const entries = [];

    for (const manifest of parsed) {
        for (const entry of manifest.entries) {
            // The same artifact from two runners is not a conflict worth
            // failing over, and the first copy is as good as the second.
            if (seen.has(entry.url)) continue;

            seen.add(entry.url);
            entries.push(entry);
        }
    }

    return {
        version: base.version,
        urls: entries.map(entry => entry.url),
        // The head and tail of the first input, because everything in them is
        // either identical across the inputs or, like `releaseDate`, arbitrary
        // between two builds of one tag.
        text: `${[...base.head, ...entries.flatMap(entry => entry.lines), ...base.tail].join('\n')}\n`,
    };
}

function main(argv) {
    const [output, ...inputs] = argv;

    if (!output || !inputs.length) {
        fail('usage: merge-update-manifests.js <output> <input...>');
    }

    const missing = inputs.filter(file => !fs.existsSync(file));

    if (missing.length) fail(`no such file: ${missing.join(', ')}`);

    const result = merge(inputs);

    fs.writeFileSync(output, result.text);

    console.log(`${output}: version ${result.version}, ${result.urls.length} files`);
    for (const url of result.urls) console.log(`  ${url}`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { merge, parse };
