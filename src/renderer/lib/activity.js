/**
 * How an activity entry is phrased on screen.
 *
 * The main process records structure (an action, a target, a subject) and
 * nothing about wording. All of the English lives here, so a log written months
 * ago reads in whatever the app says today, and the file on disk stays a record
 * rather than a pile of sentences.
 */

export const CATEGORY_LABELS = {
    connection: 'Connections',
    data: 'Changes',
    files: 'Files',
    security: 'Security',
};

/**
 * verb   phrasing, with %s standing in for the target
 * kind   which glyph the row gets
 */
const ACTIONS = {
    'session.open': { verb: 'Connected to %s', failed: 'Could not connect to %s', kind: 'connect' },
    'session.close': { verb: 'Disconnected from %s', kind: 'disconnect' },
    'tunnel.start': { verb: 'Started port forward %s', failed: 'Could not start port forward %s', kind: 'tunnel' },
    'tunnel.stop': { verb: 'Stopped port forward %s', kind: 'tunnel' },
    'desktop.open': { verb: 'Opened the desktop at %s', failed: 'Could not open the desktop at %s', kind: 'desktop' },
    'desktop.close': { verb: 'Closed the desktop at %s', kind: 'desktop' },

    'host.create': { verb: 'Added host %s', kind: 'add' },
    'host.update': { verb: 'Edited host %s', kind: 'edit' },
    'host.delete': { verb: 'Deleted host %s', kind: 'delete' },
    // One row for a whole selection, so the target is either a host's name or
    // "12 hosts"; the tags that moved are in the detail.
    'host.tag': { verb: 'Tagged %s', kind: 'edit' },
    'folder.create': { verb: 'Created folder %s', kind: 'add' },
    'folder.update': { verb: 'Edited folder %s', kind: 'edit' },
    'folder.delete': { verb: 'Deleted folder %s', kind: 'delete' },
    'snippet.create': { verb: 'Added snippet %s', kind: 'add' },
    'snippet.update': { verb: 'Edited snippet %s', kind: 'edit' },
    'snippet.delete': { verb: 'Deleted snippet %s', kind: 'delete' },
    'import.apply': { verb: 'Imported from %s', kind: 'add' },

    'key.create': { verb: 'Added key %s', kind: 'key' },
    'key.update': { verb: 'Edited key %s', kind: 'key' },
    'key.delete': { verb: 'Deleted key %s', kind: 'delete' },

    'file.upload': { verb: 'Uploaded %s', failed: 'Upload failed: %s', kind: 'upload' },
    'file.download': { verb: 'Downloaded %s', failed: 'Download failed: %s', kind: 'download' },
    'file.edit': { verb: 'Edited %s', failed: 'Could not save %s', kind: 'edit' },
    'file.create': { verb: 'Created %s', failed: 'Could not create %s', kind: 'add' },
    'file.mkdir': { verb: 'Created folder %s', failed: 'Could not create folder %s', kind: 'add' },
    'file.delete': { verb: 'Deleted %s', failed: 'Could not delete %s', kind: 'delete' },
    'file.rename': { verb: 'Renamed %s', failed: 'Could not rename %s', kind: 'edit' },
    'file.chmod': { verb: 'Changed permissions on %s', failed: 'Could not change permissions on %s', kind: 'edit' },
    'file.copy': { verb: 'Copied %s', failed: 'Could not copy %s', kind: 'copy' },
    'file.move': { verb: 'Moved %s', failed: 'Could not move %s', kind: 'copy' },

    'hostkey.trust': { verb: 'Trusted the host key for %s', kind: 'shield' },
    'hostkey.replace': { verb: 'Accepted a changed host key for %s', kind: 'shield' },
    'hostkey.reject': { verb: 'Refused the host key for %s', kind: 'shield' },
    'hostkey.forget': { verb: 'Forgot the host key for %s', kind: 'shield' },

    'lock.enable': { verb: 'Set the opening password', kind: 'lock' },
    'lock.change': { verb: 'Changed the opening password', failed: 'Failed to change the opening password', kind: 'lock' },
    'lock.disable': { verb: 'Removed the opening password', failed: 'Failed to remove the opening password', kind: 'lock' },
    'lock.lock': { verb: 'Locked the app', kind: 'lock' },
    'lock.unlock': { verb: 'Unlocked the app', failed: 'Failed to unlock the app', kind: 'lock' },

    'backup.export': { verb: 'Exported a backup to %s', failed: 'Backup export failed', kind: 'download' },
    'backup.restore': { verb: 'Restored from %s', failed: 'Restore failed', kind: 'upload' },
};

/** The headline for one row. */
export function describeEntry(entry) {
    const spec = ACTIONS[entry.action];
    const template = (entry.outcome === 'failure' && spec?.failed) || spec?.verb;

    if (!template) {
        // An action added by a newer build than this page knows about. Show it
        // rather than an empty row: the raw verb is still readable.
        return entry.target ? `${entry.action} ${entry.target}` : entry.action;
    }

    return template.includes('%s')
        ? template.replace('%s', entry.target || 'it')
        : template;
}

export const kindOf = (entry) => ACTIONS[entry.action]?.kind || 'edit';

/** Field names as the forms that write them spell them. */
const FIELD_LABELS = {
    name: 'name',
    host: 'address',
    port: 'port',
    username: 'username',
    authMethod: 'auth method',
    keychainKeyId: 'keychain key',
    privateKey: 'private key',
    password: 'password',
    passphrase: 'passphrase',
    folderId: 'folder',
    parentId: 'parent folder',
    initCommand: 'connect command',
    legacyAlgorithms: 'legacy algorithms',
    agentPath: 'agent path',
    agentForward: 'agent forwarding',
    tunnels: 'port forwards',
    command: 'command',
    description: 'description',
    tags: 'tags',
    hostIds: 'scope',
    runImmediately: 'run on insert',
    kind: 'kind',
    steps: 'steps',
    chain: 'stop on first failure',
    type: 'type',
    color: 'colour',
};

const labelFor = (field) => FIELD_LABELS[field] || field;

/** "port 22 → 2222", or just "password" for something that must not be shown. */
export function describeChange(change) {
    const label = labelFor(change.field);
    if (change.secret) return `${label} changed`;
    if (!change.from) return `${label} set to ${change.to}`;
    if (!change.to) return `${label} cleared`;
    return `${label} ${change.from} → ${change.to}`;
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;

/**
 * The clock time, to the second, in its own column.
 *
 * Deliberately not "6m ago". Relative times are friendly on a feed you glance
 * at, and wrong for this: half the log lands in the same minute, so a column of
 * "1m ago · 1m ago · 9m ago" says less than the timestamps it replaced, and the
 * question actually asked of an audit log, *when* did this happen, needs the
 * real answer. `hourCycle` pins it to 24h so the column cannot change width
 * between 09:59 and 10:00, which is what makes it scan.
 */
export const formatClock = (at) =>
    new Date(at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });

export const fullDate = (at) =>
    new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const fullStamp = (at) => new Date(at).toLocaleString();

const startOfDay = (at) => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

/** The heading a run of entries sits under. */
export function dayLabel(at) {
    const today = startOfDay(Date.now());
    const day = startOfDay(at);

    if (day === today) return 'Today';
    if (day === today - DAY) return 'Yesterday';
    if (today - day < 7 * DAY) return new Date(at).toLocaleDateString(undefined, { weekday: 'long' });

    return new Date(at).toLocaleDateString(undefined, {
        year: startOfDay(Date.now()) - day > 300 * DAY ? 'numeric' : undefined,
        month: 'short',
        day: 'numeric',
    });
}

/** Whether an entry was recorded by whoever is sitting here now. */
export const isSameActor = (actor, current) =>
    Boolean(current)
    && (actor?.user || '') === (current.user || '')
    && (actor?.machine || '') === (current.machine || '');

/** Entries in order, split into day-labelled runs the page can render as sections. */
export function groupByDay(entries) {
    const groups = [];
    for (const entry of entries) {
        const label = dayLabel(entry.at);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.entries.push(entry);
        else groups.push({ label, key: `${label}-${startOfDay(entry.at)}`, entries: [entry] });
    }
    return groups;
}
