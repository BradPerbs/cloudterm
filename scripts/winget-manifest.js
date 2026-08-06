#!/usr/bin/env node
/**
 * Writes the three files winget wants in order to describe one release.
 *
 * A winget package is not a build artifact. It is a directory of YAML inside
 * microsoft/winget-pkgs saying where an installer lives and what its hash is,
 * and it gets there by pull request. Every release after the first opens that
 * pull request on its own, from the `winget` job in release.yml, which copies
 * the previous version's manifest forward and changes the version, the URL and
 * the hash. The first release has nothing to copy from, so this writes it.
 *
 *     node scripts/winget-manifest.js [tag]
 *
 * The tag defaults to `v` followed by the version in package.json. The files
 * land in dist/winget/, in the same directory layout winget-pkgs uses, so the
 * whole version directory can be copied into a fork of it unchanged.
 *
 * Nothing below is typed in twice. The installer URL, its SHA256 and the
 * release date all come from the GitHub release itself, so this cannot
 * describe a build that was never published, and the ProductCode is derived
 * the way electron-builder derives it rather than pasted from a machine that
 * happened to have the app installed.
 *
 * docs/winget.md is the surrounding process: what to do with the output, and
 * the one-time setup that lets later releases skip this script entirely.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pkg = require('../package.json');

const REPO = 'BradPerbs/cloudterm';

// winget names a package Publisher.Package and keys everything off that name,
// including the directory it lives in and what people type to install it.
// Changing it later means submitting a new package and asking for the old one
// to be taken down, so it is a decision rather than a detail.
const IDENTIFIER = 'CloudBlast.CloudTerm';

// The installer, and only the installer. The portable build is the other .exe
// on the release, and there is nothing for winget to install it into.
const INSTALLER = 'CloudTerm-Setup-x64.exe';

// Which manifest schema these are written against. winget-pkgs still accepts
// older ones, so this only moves when there is a reason: bump it, then read
// what changed at aka.ms/winget-manifest.installer.<version>.schema.json.
const SCHEMA = '1.12.0';

// Electron 43 is Chromium, and Chromium stopped starting on anything older
// than Windows 10 1809. Saying so here turns "installs, then will not launch"
// into winget declining the install with a reason.
const MINIMUM_WINDOWS = '10.0.17763.0';

// electron-builder's NSIS installer registers its uninstall entry under a GUID
// rather than under a name, and derives that GUID as a UUID v5 of the appId in
// a namespace of its own. Handing winget the same GUID is the whole reason
// `winget upgrade` can see an installed CloudTerm: the entry is named
// "CloudTerm 1.2.0", version and all, so matching it by name would break on
// every release.
//
// Derived rather than pasted so it tracks appId. Worth knowing that appId is
// now load-bearing for something other than Electron: every copy already
// installed keeps the GUID it was installed with, so moving appId orphans them
// all from winget's point of view.
const ELECTRON_BUILDER_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3';

const LOCALE = {
    PackageLocale: 'en-US',
    Publisher: 'CloudBlast',
    PublisherUrl: 'https://cloudblast.io',
    PublisherSupportUrl: `https://github.com/${REPO}/issues`,
    Author: 'CloudBlast',
    PackageName: 'CloudTerm',
    PackageUrl: `https://github.com/${REPO}`,
    License: 'CloudTerm License 1.0',
    LicenseUrl: `https://github.com/${REPO}/blob/main/LICENSE`,
    Copyright: 'Copyright 2026 CloudBlast. All rights reserved.',
    CopyrightUrl: `https://github.com/${REPO}/blob/main/LICENSE`,
    ShortDescription: 'SSH, SFTP, Telnet and Windows RDP, all in one terminal',
    Description: [
        'CloudTerm keeps every way you reach a server in one window. Open an SSH',
        'session, move files over SFTP, forward a port and take a Windows desktop,',
        'all on the same connection and the same tab strip.',
        '',
        'It speaks SSH, SFTP, Telnet, RDP, VNC and serial, and adds split panes,',
        'tabbed sessions, saved snippets, port forwarding, session logging, and an',
        'AI agent that can drive the terminal for you. Hosts, keys, snippets and',
        'settings sync between machines, encrypted on your own machine first.',
        '',
        'Built with Electron, React and xterm.js by CloudBlast, and free to use.',
    ].join('\n'),
    Moniker: 'cloudterm',
    Tags: [
        'ssh',
        'ssh-client',
        'sftp',
        'telnet',
        'rdp',
        'vnc',
        'serial',
        'terminal',
        'console',
        'remote-desktop',
        'port-forwarding',
        'file-transfer',
        'developer-tools',
    ],
};

function fail(message) {
    console.error(`winget-manifest: ${message}`);
    process.exit(1);
}

function uuidV5(name, namespace) {
    const hash = crypto
        .createHash('sha1')
        .update(Buffer.concat([Buffer.from(namespace.replace(/-/g, ''), 'hex'), Buffer.from(name, 'utf8')]))
        .digest();

    const bytes = Buffer.from(hash.subarray(0, 16));

    // Version 5 in the high nibble of byte 6, and the RFC 4122 variant in the
    // top bits of byte 8. Without these two the string is a hash, not a UUID,
    // and electron-builder's would not match.
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString('hex');

    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

async function fetchRelease(tag) {
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cloudterm-winget-manifest',
    };

    // Only to lift the rate limit. The repository is public, so an unauthenticated
    // run works right up until the sixtieth one in an hour.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers });

    if (response.status === 404) fail(`${REPO} has no release tagged ${tag}`);
    if (!response.ok) fail(`GitHub answered ${response.status} asking for the ${tag} release`);

    return response.json();
}

/**
 * The SHA256 winget checks the download against before it runs it.
 *
 * GitHub computes one per asset on upload and hands it back on the API, so in
 * the ordinary case this is a field lookup. Assets uploaded before that field
 * existed carry nothing, and the only way to learn the hash of those is to
 * fetch the installer and hash it, which is 117MB and slow but still correct.
 */
async function sha256(asset) {
    const published = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '');

    if (published) return published[1];

    const megabytes = Math.round(asset.size / 1024 / 1024);

    console.log(`${asset.name} carries no digest, so hashing it means downloading ${megabytes}MB first`);

    const response = await fetch(asset.browser_download_url);

    if (!response.ok) fail(`GitHub answered ${response.status} downloading ${asset.name}`);

    const hash = crypto.createHash('sha256');

    for await (const chunk of response.body) hash.update(chunk);

    return hash.digest('hex');
}

/**
 * One YAML value, left bare unless leaving it bare would change what it means.
 *
 * A double-quoted YAML scalar takes the same escapes JSON does, so falling
 * back to JSON.stringify is always correct. The point of the test is only that
 * URLs and ordinary prose stay readable, which is how every other manifest in
 * winget-pkgs looks.
 */
function scalar(value) {
    const risky =
        value === ''
        || value !== value.trim()
        || /^[-?:,[\]{}#&*!|>'"%@`]/.test(value)
        || /:\s/.test(value)
        || /\s#/.test(value);

    return risky ? JSON.stringify(value) : value;
}

function field(key, value) {
    if (Array.isArray(value)) return [`${key}:`, ...value.map(item => `- ${scalar(item)}`)];

    // Prose long enough to wrap is a block scalar, so it reads as the paragraphs
    // it is rather than as one line that runs off the side of the file.
    if (value.includes('\n')) {
        return [`${key}: |-`, ...value.split('\n').map(line => (line ? `  ${line}` : ''))];
    }

    return [`${key}: ${scalar(value)}`];
}

function manifest(type, body) {
    const lines = [
        `# Written by scripts/winget-manifest.js in ${REPO}`,
        `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${SCHEMA}.schema.json`,
        '',
        ...body,
        `ManifestType: ${type}`,
        `ManifestVersion: ${SCHEMA}`,
    ];

    // LF, and no trailing whitespace anywhere. winget-pkgs runs a linter over
    // every pull request and both are things it has an opinion about.
    return `${lines.map(line => line.replace(/\s+$/, '')).join('\n')}\n`;
}

function build({ version, tag, url, hash, releaseDate }) {
    const head = [`PackageIdentifier: ${IDENTIFIER}`, `PackageVersion: ${version}`];

    return {
        [`${IDENTIFIER}.installer.yaml`]: manifest('installer', [
            ...head,
            'Platform:',
            '- Windows.Desktop',
            `MinimumOSVersion: ${MINIMUM_WINDOWS}`,
            'InstallerType: nullsoft',
            // perMachine is false in the electron-builder config, so the app
            // installs under the user's own AppData and never asks to elevate.
            'Scope: user',
            'InstallModes:',
            '- interactive',
            '- silent',
            '- silentWithProgress',
            // The NSIS installer takes the previous version out itself, as part
            // of installing over it. Asking winget to uninstall first would
            // only add a step that can fail.
            'UpgradeBehavior: install',
            `ReleaseDate: ${releaseDate}`,
            'AppsAndFeaturesEntries:',
            `- ProductCode: ${uuidV5(pkg.build.appId, ELECTRON_BUILDER_NAMESPACE)}`,
            'Installers:',
            '- Architecture: x64',
            `  InstallerUrl: ${url}`,
            `  InstallerSha256: ${hash.toUpperCase()}`,
        ]),

        [`${IDENTIFIER}.locale.en-US.yaml`]: manifest('defaultLocale', [
            ...head,
            ...Object.entries(LOCALE).flatMap(([key, value]) => field(key, value)),
            `ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/${tag}`,
        ]),

        // Small on purpose. This file exists to point winget at the locale that
        // carries the description, and to nothing else.
        [`${IDENTIFIER}.yaml`]: manifest('version', [
            ...head,
            `DefaultLocale: ${LOCALE.PackageLocale}`,
        ]),
    };
}

async function main(argv) {
    const tag = argv[0] || `v${pkg.version}`;

    // winget versions do not carry the `v` that git tags do, and a manifest
    // that disagrees with itself about the version is rejected on submission.
    const version = tag.replace(/^v/, '');

    const release = await fetchRelease(tag);

    if (release.draft) fail(`the ${tag} release is still a draft, so its assets are not public yet`);

    const asset = release.assets.find(candidate => candidate.name === INSTALLER);

    if (!asset) {
        fail(
            `the ${tag} release has no ${INSTALLER}. It has: `
            + (release.assets.map(candidate => candidate.name).join(', ') || 'nothing'),
        );
    }

    const files = build({
        version,
        tag,
        url: asset.browser_download_url,
        hash: await sha256(asset),
        // Date only. The schema takes an ISO date and rejects a timestamp.
        releaseDate: (release.published_at || release.created_at).slice(0, 10),
    });

    // The layout winget-pkgs itself uses: first letter of the identifier,
    // lowercased, then the publisher, the package and the version. Copying the
    // version directory into a fork puts it exactly where it belongs.
    const out = path.join(
        __dirname,
        '..',
        'dist',
        'winget',
        'manifests',
        IDENTIFIER[0].toLowerCase(),
        ...IDENTIFIER.split('.'),
        version,
    );

    fs.mkdirSync(out, { recursive: true });

    for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(out, name), text);
        console.log(path.relative(path.join(__dirname, '..'), path.join(out, name)));
    }

    console.log(`\n${IDENTIFIER} ${version}, from ${asset.browser_download_url}`);
    console.log('Copy the version directory into a fork of microsoft/winget-pkgs. docs/winget.md has the rest.');
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => fail(error.message));
}

module.exports = { build, uuidV5, scalar };
