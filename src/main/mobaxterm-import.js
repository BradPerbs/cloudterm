const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const common = require('./import-common');

/**
 * Bring MobaXterm sessions in from its `MobaXterm.ini`, or from a
 * `.mxtsessions` file (its own "Export sessions" format, which is just the
 * bookmark sections extracted from the ini).
 *
 * The format is not documented, so this reads only what has stayed stable
 * across versions: `[Bookmarks_n]` sections, one folder each (`SubRep`), one
 * session per line as `Name=#icon#type%field%field%...`. The leading fields
 * (host, port, username) are fixed per session type; anything this parser
 * does not recognise is counted and reported rather than guessed at.
 *
 * The `[Passwords]` section is never read. The encryption on it is
 * MobaXterm's own, tied to its master password, and those secrets are not
 * ours to take. Imported SSH hosts use a key file where one is named, and
 * the agent otherwise.
 *
 * Same scan/apply split as the other importers: the renderer only sends back
 * which sessions to take, and the file is re-read on apply.
 */

const LABEL = 'MobaXterm';

/**
 * The session types this app can hold, by MobaXterm's type number.
 * 7 is SFTP; this app does SFTP over its SSH sessions, so it imports as one.
 */
const TYPES = {
    0: { protocol: 'ssh' },
    1: { protocol: 'telnet' },
    4: { protocol: 'rdp' },
    5: { protocol: 'vnc' },
    7: { protocol: 'ssh', note: 'was an SFTP bookmark' },
};

/** Names for the types that are recognised but have no record shape here. */
const SKIP_LABELS = { 2: 'Rsh', 3: 'Xdmcp', 6: 'FTP', 8: 'local shell', 9: 'browser', 10: 'Mosh' };

const DEFAULT_PORTS = { ssh: 22, telnet: 23, rdp: 3389, vnc: 5900 };

/** MobaXterm escapes characters that collide with its own separators. */
function unescapeField(value) {
    return String(value || '')
        .replace(/__PIPE__/g, '|')
        .replace(/__PTVIRG__/g, ';')
        .replace(/__DBLQUO__/g, '"')
        .replace(/__DIEZE__/g, '#')
        .replace(/__PERCENT__/g, '%')
        .trim();
}

/** Where the installed and portable editions keep the ini. */
function candidatePaths() {
    const home = os.homedir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
        path.join(home, 'Documents', 'MobaXterm', 'MobaXterm.ini'),
        path.join(home, 'OneDrive', 'Documents', 'MobaXterm', 'MobaXterm.ini'),
        path.join(appData, 'MobaXterm', 'MobaXterm.ini'),
    ];
}

function detect() {
    const found = candidatePaths().find(candidate => fs.existsSync(candidate));
    return { found: Boolean(found), label: LABEL, path: found || '' };
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * The bookmark sections of an ini, as `{ subRep, sessions: [{name, value}] }`.
 * Everything outside `[Bookmarks*]` (settings, passwords) is not read.
 */
function parseBookmarks(text) {
    const sections = [];
    let current = null;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';')) continue;

        const header = line.match(/^\[(.+)\]$/);
        if (header) {
            if (/^Bookmarks(_\d+)?$/i.test(header[1])) {
                current = { subRep: '', sessions: [] };
                sections.push(current);
            } else {
                current = null;
            }
            continue;
        }
        if (!current) continue;

        const split = line.indexOf('=');
        if (split <= 0) continue;

        const key = line.slice(0, split).trim();
        const value = line.slice(split + 1).trim();

        if (key === 'SubRep') {
            current.subRep = value;
            continue;
        }
        if (key === 'ImgNum') continue;
        // A session's value always starts with its icon: `#109#0%...`.
        if (value.startsWith('#')) current.sessions.push({ name: key, value });
    }

    return sections;
}

/** `Folder\Sub` (with MobaXterm's escaping) to clean segments. */
function folderSegments(subRep) {
    return String(subRep || '')
        .split(/[\\/]/)
        .map(unescapeField)
        .filter(Boolean);
}

function toPort(value, fallback) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

/** `<default>` means "no username of its own", not a name. */
function cleanUsername(value) {
    const username = unescapeField(value);
    return /^<.*>$/.test(username) ? '' : username;
}

/**
 * MobaXterm writes key paths with the drive letter abstracted away so a
 * portable install can move between machines. Ours is not portable, so it
 * resolves to the drive the home directory is on.
 */
function resolveKeyPath(value) {
    const drive = (path.parse(os.homedir()).root || 'C:\\').charAt(0);
    return unescapeField(value).replace(/_CurrentDrive_/g, drive);
}

/** Plausibly a host or address, and not one of the "unset" placeholder values. */
function looksLikeHost(value) {
    return /^[A-Za-z0-9._-]+$/.test(value) && /[A-Za-z.]/.test(value);
}

/** `user@host:port` with the protocol's standard port left off. */
function describeAddress(protocol, host, port, username) {
    const where = port === DEFAULT_PORTS[protocol] ? host : `${host}:${port}`;
    return username ? `${username}@${where}` : where;
}

/**
 * One bookmark line as an import candidate, or `{ skip }` naming why not.
 * `fields` is the `%`-separated group after the icon: `[type, host, port, ...]`.
 */
function candidateFrom(name, value, folder, existing) {
    const groups = value.split('#');
    const fields = (groups[2] ?? groups[1] ?? '').split('%');
    const type = Number(fields[0]);

    if (!Number.isInteger(type) || fields.length < 3) return { skip: 'unreadable' };

    const shape = TYPES[type];
    if (!shape) return { skip: SKIP_LABELS[type] || `type ${type}` };

    const protocol = shape.protocol;
    const host = unescapeField(fields[1]);
    if (!host) return { skip: 'without an address' };

    const port = toPort(fields[2], DEFAULT_PORTS[protocol]);
    const username = protocol === 'ssh' || protocol === 'rdp' ? cleanUsername(fields[3]) : '';

    const warnings = [];
    const notes = shape.note ? [shape.note] : [];

    const candidate = {
        key: `${folder.join('\\')}>${name}`,
        name: unescapeField(name),
        protocol,
        host,
        port,
        username,
        folder: folder.join(' / '),
        address: describeAddress(protocol, host, port, username),
        tunnels: [],
        identityPath: '',
        identityName: '',
        identityState: '',
        jump: null,
        notes,
        warnings,
    };

    // The trailing fields are the ones that drift between versions, so each is
    // taken only when it looks like what it is documented to be.
    if (type === 0) {
        const keyPath = resolveKeyPath(fields[14]);
        if (keyPath && /[\\/]/.test(keyPath)) {
            const inspected = common.inspectIdentityFile(keyPath);
            candidate.identityPath = keyPath;
            candidate.identityName = path.basename(keyPath);
            candidate.identityState = inspected.state;

            if (inspected.state === 'ppk') {
                warnings.push(
                    `${candidate.identityName} is a PuTTY key. Export it as an OpenSSH key `
                    + 'with PuTTYgen (Conversions menu), then attach it in Keychain. '
                    + 'Until then this host is set to use your SSH agent'
                );
            } else if (inspected.state === 'encrypted') {
                warnings.push('Its key is passphrase-protected. Add the passphrase in Keychain after importing');
            } else if (inspected.state === 'unreadable') {
                warnings.push(`Key ${candidate.identityName}: ${inspected.reason}`);
            }
        }

        // The SSH gateway, MobaXterm's jump host: hosts, ports and users as
        // parallel pipe-separated lists. Linked at its last hop, the one this
        // host is actually reached through, same as the OpenSSH importer.
        const gateways = String(fields[8] || '').split('__PIPE__').map(unescapeField).filter(looksLikeHost);
        if (gateways.length > 0) {
            const ports = String(fields[9] || '').split('__PIPE__');
            const users = String(fields[10] || '').split('__PIPE__');
            const last = gateways.length - 1;

            candidate.jump = {
                host: gateways[last],
                port: toPort(ports[last], 22),
                username: cleanUsername(users[last]),
            };

            if (gateways.length > 1) {
                warnings.push(
                    `Relayed through ${gateways.join(' then ')}; only the last hop, `
                    + `${gateways[last]}, is linked here. Set the rest on their own records`
                );
            }
        }
    }

    const match = common.matchExistingHost(existing, candidate);
    candidate.status = match ? 'present' : 'new';
    candidate.existingName = match?.name || '';

    return candidate;
}

/* ------------------------------------------------------------------ *
 * Scan / apply
 * ------------------------------------------------------------------ */

function scan(options = {}) {
    const filePath = options.path || detect().path;
    const base = { source: 'mobaxterm', label: LABEL, path: filePath, hosts: [], warnings: [], stats: null };

    if (!filePath) {
        return { ...base, error: 'No MobaXterm.ini found. Choose the file, or a .mxtsessions export' };
    }

    let text;
    try {
        // MobaXterm writes Windows-1252, not UTF-8. latin1 keeps every byte.
        text = fs.readFileSync(filePath, 'latin1');
    } catch (error) {
        return { ...base, error: error.code === 'ENOENT' ? 'File not found' : error.message };
    }

    const sections = parseBookmarks(text);
    if (sections.length === 0) {
        return { ...base, error: 'No bookmark sections in this file' };
    }

    const existing = store.getHosts();
    const hosts = [];
    const skipped = new Map();
    let total = 0;

    for (const section of sections) {
        const folder = folderSegments(section.subRep);
        for (const session of section.sessions) {
            total += 1;
            const candidate = candidateFrom(session.name, session.value, folder, existing);
            if (candidate.skip) {
                skipped.set(candidate.skip, (skipped.get(candidate.skip) || 0) + 1);
                continue;
            }
            hosts.push(candidate);
        }
    }

    // Whether each gateway can actually be linked is a question about the whole
    // scan, so it is answered after one: against the saved hosts first, then
    // against the other sessions being offered alongside.
    const reachable = (jump) => (host) => (host.protocol || 'ssh') === 'ssh'
        && common.sameText(host.host, jump.host)
        && (host.port || 22) === jump.port
        && (!jump.username || common.sameText(host.username, jump.username));

    for (const candidate of hosts) {
        if (!candidate.jump) continue;
        const matches = reachable(candidate.jump);
        if (!existing.some(matches) && !hosts.some(other => other !== candidate && matches(other))) {
            candidate.warnings.push(
                `Reached through gateway ${candidate.jump.host}, which is neither saved here `
                + 'nor in this file, so it cannot be linked'
            );
            candidate.jump = null;
        }
    }

    const skippedNote = [...skipped.entries()]
        .map(([reason, count]) => `${count} ${reason}`)
        .join(', ');

    return {
        ...base,
        hosts,
        stats: { total, skippedNote: skippedNote ? `${skippedNote} skipped` : '' },
        error: '',
    };
}

/**
 * Find or create the folder chain for a bookmark section, reusing existing
 * folders by name at each level so a re-import files hosts into the same
 * place rather than a duplicate tree.
 */
function ensureFolders(folderDisplay, cache, report) {
    const segments = String(folderDisplay || '').split(' / ').filter(Boolean);
    let parentId = '';

    for (const name of segments) {
        const key = `${parentId}\u0000${name.toLowerCase()}`;
        let id = cache.get(key);

        if (!id) {
            const existing = store.getFolders()
                .find(folder => (folder.parentId || '') === parentId && common.sameText(folder.name, name));
            if (existing) {
                id = existing.id;
            } else {
                id = store.saveFolder({ id: common.freshId('folder'), name, parentId }).id;
                report.folders.created += 1;
            }
            cache.set(key, id);
        }

        parentId = id;
    }

    return parentId;
}

/**
 * Import the selected sessions. `keys` only filters what a fresh scan of the
 * file finds; nothing the renderer sends becomes record content.
 */
function apply({ path: filePath, keys = [], importIdentityFiles = true } = {}) {
    const report = {
        hosts: { imported: 0, skipped: 0, failed: 0, relayed: 0 },
        keys: { imported: 0, reused: 0 },
        folders: { created: 0 },
        notes: [],
    };
    if (keys.length === 0) return { success: true, ...report };

    const scanned = scan({ path: filePath });
    if (scanned.error) return { success: false, ...report, notes: [scanned.error] };

    const wanted = new Set(keys);
    const keyCache = new Map();
    const folderCache = new Map();
    const jumpLinks = [];

    for (const candidate of scanned.hosts) {
        if (!wanted.has(candidate.key)) continue;
        if (candidate.status === 'present') {
            report.hosts.skipped += 1;
            continue;
        }

        const record = {
            id: common.freshId('host'),
            name: candidate.name,
            folderId: ensureFolders(candidate.folder, folderCache, report),
            host: candidate.host,
        };

        if (candidate.protocol === 'rdp' || candidate.protocol === 'vnc') {
            // A host with no shell: `desktop.only` is what the rest of the app
            // reads, and `direct` because there is no SSH session to tunnel
            // through. Same shape the host editor's Desktop kind produces.
            record.protocol = 'ssh';
            record.desktop = {
                enabled: true,
                only: true,
                protocol: candidate.protocol,
                transport: 'direct',
                host: candidate.host,
                port: candidate.port,
                username: candidate.username,
            };
        } else {
            record.protocol = candidate.protocol;
            record.port = candidate.port;
        }

        if (candidate.protocol === 'ssh') {
            record.username = candidate.username;
            record.tunnels = candidate.tunnels;
            record.authMethod = 'agent';

            if (importIdentityFiles && candidate.identityPath) {
                const key = common.importIdentity(candidate.identityPath, keyCache);
                if (key) {
                    record.authMethod = 'keychain';
                    record.keychainKeyId = key.id;
                    if (key.created) report.keys.imported += 1;
                    else report.keys.reused += 1;
                }
            }
        }

        try {
            store.saveHost(record);
            report.hosts.imported += 1;
            if (candidate.jump) jumpLinks.push({ id: record.id, jump: candidate.jump });
        } catch (error) {
            report.hosts.failed += 1;
            report.notes.push(`${candidate.name}: ${error.message}`);
        }
    }

    // Linked once everything this run writes exists, so a gateway imported in
    // the same batch can be found. The write is a partial save: id and the one
    // field, everything else on the record untouched.
    for (const { id, jump } of jumpLinks) {
        const target = store.getHosts().find(host => host.id !== id
            && (host.protocol || 'ssh') === 'ssh'
            && common.sameText(host.host, jump.host)
            && (host.port || 22) === jump.port
            && (!jump.username || common.sameText(host.username, jump.username)));
        if (!target) continue;

        try {
            store.saveHost({ id, jumpHostId: target.id });
            report.hosts.relayed += 1;
        } catch (error) {
            report.notes.push(`Could not link ${jump.host} as a jump host: ${error.message}`);
        }
    }

    return { success: true, ...report };
}

module.exports = { detect, scan, apply };
