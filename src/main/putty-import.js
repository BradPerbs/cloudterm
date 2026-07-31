const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./store');
const common = require('./import-common');
const { normalizeTunnel, splitHostPort } = require('./tunnel-config');
const { normalizeSerial, describeSerial } = require('./protocol-config');

/**
 * Bring PuTTY (or KiTTY) sessions in.
 *
 * On Windows both keep every saved session as a subkey of one well-known key,
 * one value per setting. Rather than walking that with `reg query` per session,
 * the key is exported once with `reg export`: a single invocation, and the .reg
 * file it writes is UTF-16LE with a declared format, so there is no console
 * codepage to guess at.
 *
 * PuTTY's Unix port has no registry to use, so it writes one file per session
 * under `~/.putty/sessions` instead. Different container, same setting names,
 * so only the reading differs and everything downstream is shared. KiTTY is a
 * Windows-only fork and has no equivalent.
 *
 * The same scan/apply split as the OpenSSH importer, for the same reason: the
 * renderer only ever sends back *which* sessions to take, and the sessions are
 * re-read on apply, so nothing on the renderer's word becomes a record.
 */

const SOURCES = {
    putty: {
        label: 'PuTTY',
        key: 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions',
        // Read lazily: the home directory is not this module's business to
        // resolve at load time.
        dir: () => path.join(os.homedir(), '.putty', 'sessions'),
    },
    kitty: { label: 'KiTTY', key: 'HKCU\\Software\\9bis.com\\KiTTY\\Sessions' },
};

/** PuTTY writes session names "munged": anything unsafe becomes %XX. */
const unmunge = (name) =>
    name.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/* ------------------------------------------------------------------ *
 * Registry reading
 * ------------------------------------------------------------------ */

function exportKey(rootKey) {
    const tmp = path.join(os.tmpdir(), `cloudblast-reg-${process.pid}-${Date.now()}.reg`);
    try {
        execFileSync('reg.exe', ['export', rootKey, tmp, '/y'], { windowsHide: true, stdio: 'pipe' });
        let text = fs.readFileSync(tmp, 'utf16le');
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        return text;
    } finally {
        try { fs.unlinkSync(tmp); } catch { /* already gone, or never written */ }
    }
}

const unescapeReg = (text) => text.replace(/\\(.)/g, '$1');

/**
 * Parse a .reg export into `name -> Map(valueName -> string|number)`.
 *
 * Only REG_SZ (`"a"="b"`) and REG_DWORD (`"a"=dword:1f`) are read, which is
 * all PuTTY uses for the settings that matter here. Hex blobs and their
 * continuation lines match neither pattern and fall through harmlessly.
 */
function parseRegistryExport(text, rootKey) {
    const prefix = (rootKey.replace(/^HKCU/i, 'HKEY_CURRENT_USER') + '\\').toLowerCase();
    const sessions = new Map();
    let current = null;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';')) continue;

        if (line.startsWith('[')) {
            current = null;
            const section = line.slice(1, -1);
            if (!section.toLowerCase().startsWith(prefix)) continue;

            const name = section.slice(prefix.length);
            // Direct children only. Neither program nests deeper, and anything
            // that does is not a session.
            if (name && !name.includes('\\')) {
                current = new Map();
                sessions.set(unmunge(name), current);
            }
            continue;
        }
        if (!current) continue;

        const match = line.match(/^"((?:[^"\\]|\\.)*)"=(.*)$/);
        if (!match) continue;

        const name = unescapeReg(match[1]);
        const data = match[2];

        if (data.startsWith('"')) {
            const body = data.match(/^"((?:[^"\\]|\\.)*)"/);
            if (body) current.set(name, unescapeReg(body[1]));
        } else if (data.toLowerCase().startsWith('dword:')) {
            current.set(name, parseInt(data.slice(6), 16));
        }
    }

    return sessions;
}

/**
 * The Unix port's session files, in the shape `parseRegistryExport` returns.
 *
 * One file per session, named with the same %XX munging the registry uses, and
 * inside it a `Key=Value` line per setting. The value runs to the end of the
 * line and is taken literally: there is no quoting to undo, which is why this
 * is so much shorter than the .reg parser.
 *
 * A directory that is not there is not an error. It only means PuTTY has never
 * run, or never saved anything, and the caller reports that as "not found".
 */
function readUnixSessions(dir) {
    const sessions = new Map();

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return sessions;
    }

    for (const entry of entries) {
        if (!entry.isFile()) continue;

        let text;
        try {
            text = fs.readFileSync(path.join(dir, entry.name), 'utf8');
        } catch {
            // One unreadable file should not cost the whole import.
            continue;
        }

        const values = new Map();
        for (const line of text.split(/\r?\n/)) {
            const at = line.indexOf('=');
            if (at > 0) values.set(line.slice(0, at), line.slice(at + 1));
        }

        // An empty file is not a session, and neither is whatever else has
        // found its way into the directory.
        if (values.size > 0) sessions.set(unmunge(entry.name), values);
    }

    return sessions;
}

/* ------------------------------------------------------------------ *
 * Field mapping
 * ------------------------------------------------------------------ */

/**
 * `PortForwardings` is one string: comma-separated entries, each
 * `[4|6]L<[bind:]port>=<host:port>`, `R...` likewise, or `D<[bind:]port>`.
 */
function parseForwardings(text, warnings) {
    const tunnels = [];

    for (const raw of String(text || '').split(',')) {
        const entry = raw.trim();
        if (!entry) continue;

        const match = entry.match(/^[46]?([LRDlrd])(.+)$/);
        const complain = () => warnings.push(`Could not read port forwarding "${entry}"`);
        if (!match) { complain(); continue; }

        const kind = match[1].toUpperCase();
        const rest = match[2];

        if (kind === 'D') {
            const listen = splitHostPort(rest);
            if (!listen?.port) { complain(); continue; }
            tunnels.push(normalizeTunnel({
                type: 'dynamic',
                listenHost: listen.host,
                listenPort: listen.port,
                autoStart: true,
            }));
            continue;
        }

        const split = rest.indexOf('=');
        const listen = split > 0 ? splitHostPort(rest.slice(0, split)) : null;
        const dest = split > 0 ? splitHostPort(rest.slice(split + 1)) : null;
        if (!listen?.port || !dest?.host || !dest?.port) { complain(); continue; }

        tunnels.push(normalizeTunnel({
            type: kind === 'L' ? 'local' : 'remote',
            listenHost: listen.host,
            listenPort: listen.port,
            destHost: dest.host,
            destPort: dest.port,
            autoStart: true,
        }));
    }

    return tunnels;
}

// PuTTY stores these as small integers; the arrays map them to our words.
const SERIAL_PARITIES = ['none', 'odd', 'even', 'mark', 'space'];
const SERIAL_FLOWS = ['none', 'xonxoff', 'rtscts'];
const STOP_HALFBITS = { 2: 1, 3: 1.5, 4: 2 };

function serialFrom(values, warnings) {
    // Flow control 3 is DSR/DTR, which our serial layer does not drive.
    if (Number(values.get('SerialFlowControl')) === 3) {
        warnings.push('Uses DSR/DTR flow control, which is not supported here; set to none');
    }

    return normalizeSerial({
        path: values.get('SerialLine') || '',
        baudRate: values.get('SerialSpeed'),
        dataBits: values.get('SerialDataBits'),
        stopBits: STOP_HALFBITS[Number(values.get('SerialStopHalfbits'))],
        parity: SERIAL_PARITIES[Number(values.get('SerialParity'))],
        flowControl: SERIAL_FLOWS[Number(values.get('SerialFlowControl'))],
    });
}

const PROXY_LABELS = { 1: 'SOCKS4', 2: 'SOCKS5', 3: 'HTTP', 4: 'telnet', 5: 'local-command' };

/** `user@host:port` with the standard port left off, for the list row. */
function describeNetwork(protocol, host, port, username) {
    const standard = protocol === 'telnet' ? 23 : 22;
    const where = port === standard ? host : `${host}:${port}`;
    return username ? `${username}@${where}` : where;
}

/**
 * One registry session as an import candidate, or `{ skip }` naming why it
 * cannot be one.
 */
function candidateFrom(name, values, existing) {
    const protocol = String(values.get('Protocol') || '').toLowerCase();
    const warnings = [];

    if (protocol === 'serial') {
        const serial = serialFrom(values, warnings);
        if (!serial.path) return { skip: 'without an address' };

        const match = common.matchExistingHost(existing, { protocol: 'serial', serial });
        return {
            key: name,
            name,
            protocol: 'serial',
            serial,
            address: describeSerial(serial),
            tunnels: [],
            identityState: '',
            status: match ? 'present' : 'new',
            existingName: match?.name || '',
            warnings,
        };
    }

    if (protocol !== 'ssh' && protocol !== 'telnet') {
        return { skip: protocol || 'without a protocol' };
    }

    let host = String(values.get('HostName') || '').trim();
    let username = String(values.get('UserName') || '').trim();
    if (!host) return { skip: 'without an address' };

    // `user@host` typed straight into the host box is common enough to honour.
    const at = host.lastIndexOf('@');
    if (at > 0) {
        if (!username) username = host.slice(0, at);
        host = host.slice(at + 1);
    }

    const port = Number(values.get('PortNumber')) || (protocol === 'telnet' ? 23 : 22);

    const candidate = {
        key: name,
        name,
        protocol,
        host,
        port,
        // Telnet asks for a login over the connection itself; a stored one
        // would sit on the record doing nothing.
        username: protocol === 'ssh' ? username : '',
        address: describeNetwork(protocol, host, port, protocol === 'ssh' ? username : ''),
        tunnels: [],
        identityPath: '',
        identityName: '',
        identityState: '',
        warnings,
    };

    if (protocol === 'ssh') {
        candidate.tunnels = parseForwardings(values.get('PortForwardings'), warnings);

        const keyFile = String(values.get('PublicKeyFile') || '').trim();
        if (keyFile) {
            const inspected = common.inspectIdentityFile(keyFile);
            candidate.identityPath = keyFile;
            candidate.identityName = path.basename(keyFile);
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

        const proxyMethod = Number(values.get('ProxyMethod') ?? values.get('ProxyType')) || 0;
        const proxyHost = String(values.get('ProxyHost') || '').trim();
        if (proxyMethod > 0 && proxyHost) {
            const label = PROXY_LABELS[proxyMethod];
            const proxyPort = Number(values.get('ProxyPort')) || 0;
            warnings.push(
                `Dialled through a ${label ? `${label} ` : ''}proxy `
                + `(${proxyHost}${proxyPort ? `:${proxyPort}` : ''}). Recreate it under Proxies `
                + 'and link it on this host after importing'
            );
        }
    }

    const match = common.matchExistingHost(existing, candidate);
    candidate.status = match ? 'present' : 'new';
    candidate.existingName = match?.name || '';

    return candidate;
}

/* ------------------------------------------------------------------ *
 * Detect / scan / apply
 * ------------------------------------------------------------------ */

function detect(source) {
    const root = SOURCES[source];
    if (!root) return { found: false, label: source };

    if (process.platform !== 'win32') {
        // KiTTY has no Unix build, so there is nowhere to look.
        if (!root.dir) return { found: false, label: root.label };

        const dir = root.dir();
        const sessions = readUnixSessions(dir).size;
        return { found: sessions > 0, label: root.label, sessions, path: dir };
    }

    try {
        const out = execFileSync('reg.exe', ['query', root.key], { windowsHide: true, stdio: 'pipe' })
            .toString();
        const marker = '\\sessions\\';
        const sessions = out.split(/\r?\n/)
            .map(line => line.trim().toLowerCase())
            .filter(line => line.startsWith('hkey_') && line.includes(marker)
                && !line.endsWith('\\default%20settings'))
            .length;
        return { found: sessions > 0, label: root.label, sessions };
    } catch {
        return { found: false, label: root.label };
    }
}

function scan(source) {
    const root = SOURCES[source];
    if (!root) {
        return { source, label: source, path: '', hosts: [], warnings: [], stats: null, error: `Unknown source: ${source}` };
    }

    const windows = process.platform === 'win32';
    const location = windows ? root.key : (root.dir ? root.dir() : '');
    const base = { source, label: root.label, path: location, hosts: [], warnings: [], stats: null };

    let sessions;
    if (windows) {
        try {
            sessions = parseRegistryExport(exportKey(root.key), root.key);
        } catch {
            return { ...base, error: `No saved sessions found in the registry for ${root.label}` };
        }
    } else if (!location) {
        return { ...base, error: `${root.label} only runs on Windows, so there are no sessions to read` };
    } else {
        sessions = readUnixSessions(location);
        if (sessions.size === 0) {
            return { ...base, error: `No saved sessions found in ${location}` };
        }
    }

    const existing = store.getHosts();
    const hosts = [];
    const skipped = new Map();

    for (const [name, values] of sessions) {
        // Not a session: it is the template every new one starts from.
        if (name === 'Default Settings') continue;

        const candidate = candidateFrom(name, values, existing);
        if (candidate.skip) {
            skipped.set(candidate.skip, (skipped.get(candidate.skip) || 0) + 1);
            continue;
        }
        hosts.push(candidate);
    }

    hosts.sort((a, b) => a.name.localeCompare(b.name));

    const skippedNote = [...skipped.entries()]
        .map(([reason, count]) => `${count} ${reason}`)
        .join(', ');

    return {
        ...base,
        hosts,
        stats: { total: sessions.size, skippedNote: skippedNote ? `${skippedNote} skipped` : '' },
        error: '',
    };
}

/**
 * Import the selected sessions. `keys` only filters what a fresh scan finds,
 * so the renderer never gets to invent a record.
 */
function apply(source, { keys = [], importIdentityFiles = true } = {}) {
    const report = {
        hosts: { imported: 0, skipped: 0, failed: 0 },
        keys: { imported: 0, reused: 0 },
        folders: { created: 0 },
        notes: [],
    };
    if (keys.length === 0) return { success: true, ...report };

    const scanned = scan(source);
    if (scanned.error) return { success: false, ...report, notes: [scanned.error] };

    const wanted = new Set(keys);
    const cache = new Map();

    for (const candidate of scanned.hosts) {
        if (!wanted.has(candidate.key)) continue;
        if (candidate.status === 'present') {
            report.hosts.skipped += 1;
            continue;
        }

        const record = {
            id: common.freshId('host'),
            name: candidate.name,
            protocol: candidate.protocol,
            folderId: '',
        };

        if (candidate.protocol === 'serial') {
            record.serial = candidate.serial;
        } else {
            record.host = candidate.host;
            record.port = candidate.port;
        }

        if (candidate.protocol === 'ssh') {
            record.username = candidate.username;
            record.tunnels = candidate.tunnels;
            record.authMethod = 'agent';

            if (importIdentityFiles && candidate.identityPath) {
                const key = common.importIdentity(candidate.identityPath, cache);
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
        } catch (error) {
            report.hosts.failed += 1;
            report.notes.push(`${candidate.name}: ${error.message}`);
        }
    }

    return { success: true, ...report };
}

module.exports = { SOURCES, detect, scan, apply };
