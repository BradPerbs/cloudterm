/**
 * Exercises the CloudBlast server sync against a real store, with `electron`
 * and the account API stubbed so it runs under plain node.
 *
 * The rules under test are the ones a user would notice being broken:
 * syncing twice must not duplicate a host, a rename upstream must follow, the
 * way someone chose to connect must survive, and a sync must never delete a
 * host it did not create.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-sync-'));

const electronStub = {
    app: {
        getPath: (what) => (what === 'userData' ? userData : os.tmpdir()),
        getVersion: () => '1.0.0',
    },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
    powerMonitor: { on: () => {} },
};

// What the console would return. Reassigned per scenario.
let fakeServers = [];
let fakeCredentials = {};

const accountStub = {
    status: () => ({ connected: true, account: { email: 'user@example.com' } }),
    servers: async () => fakeServers,
    credentials: async (uuid) => {
        if (!fakeCredentials[uuid]) throw new Error('no credentials');
        return fakeCredentials[uuid];
    },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === './account') return accountStub;
    return realLoad.call(this, request, parent, isMain);
};

const store = require(path.join(ROOT, 'store.js'));
const sync = require(path.join(ROOT, 'server-sync.js'));

let passed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        process.exitCode = 1;
    }
};

const server = (uuid, hostname, address, extra = {}) => ({
    uuid,
    uuid_short: uuid.slice(0, 8),
    id: extra.id ?? 1,
    name: extra.name ?? `display-${uuid}`,
    hostname,
    status: extra.status ?? 'active',
    ip_addresses: address ? [{ address, type: 'ipv4' }] : [],
    ...(extra.os !== undefined ? { os: extra.os } : {}),
    ...(extra.os_version !== undefined ? { os_version: extra.os_version } : {}),
    ...(extra.folder !== undefined ? { folder: extra.folder } : {}),
});

const folderById = (id) => store.getFolders().find(f => f.id === id);

const byId = (id) => store.getHosts().find(h => h.id === id);

async function run() {
    console.log('\ncloudblast server sync');

    /* ---------------- first sync ---------------- */

    fakeServers = [
        server('uuid-a', 'web-01.example.com', '10.0.0.1'),
        server('uuid-b', 'db-01.example.com', '10.0.0.2'),
    ];
    fakeCredentials = {
        'uuid-a': { username: 'root', password: 'pw-a', passwordStatus: 'ready', ipv4: '10.0.0.1' },
        'uuid-b': { username: 'root', password: 'pw-b', passwordStatus: 'ready', ipv4: '10.0.0.2' },
    };

    const first = await sync.sync();

    await check('adds a host per server', () => {
        assert.strictEqual(first.added, 2, JSON.stringify(first));
        assert.strictEqual(store.getHosts().length, 2);
    });

    await check('names the host after the CloudBlast hostname', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').name, 'web-01.example.com');
    });

    await check('dials the IPv4 address', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').host, '10.0.0.1');
    });

    await check('stores the root password so the host can connect', () => {
        assert.strictEqual(store.resolveCredentials('cloudblast-uuid-a').password, 'pw-a');
        assert.strictEqual(byId('cloudblast-uuid-a').username, 'root');
    });

    await check('files them under the CloudBlast folder', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').folderId, 'cloudblast');
        assert.ok(store.getFolders().some(f => f.id === 'cloudblast'));
    });

    /* ---------------- idempotency ---------------- */

    const second = await sync.sync();

    await check('syncing twice does not duplicate anything', () => {
        assert.strictEqual(second.added, 0, JSON.stringify(second));
        assert.strictEqual(second.updated, 2);
        assert.strictEqual(store.getHosts().length, 2);
    });

    /* ---------------- what the panel owns ---------------- */

    fakeServers = [
        server('uuid-a', 'web-01-renamed.example.com', '10.9.9.9'),
        server('uuid-b', 'db-01.example.com', '10.0.0.2'),
    ];

    await sync.sync();

    await check('a rename in the panel follows', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').name, 'web-01-renamed.example.com');
    });

    await check('a new address in the panel follows', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').host, '10.9.9.9');
    });

    /* ---------------- what the user owns ---------------- */

    store.saveHost({
        ...byId('cloudblast-uuid-b'),
        authMethod: 'agent',
        username: 'deploy',
        port: 2222,
    });

    await sync.sync();

    await check('the way the user chose to connect is never overwritten', () => {
        const host = byId('cloudblast-uuid-b');
        assert.strictEqual(host.authMethod, 'agent', 'auth method was reset');
        assert.strictEqual(host.username, 'deploy', 'username was reset');
        assert.strictEqual(host.port, 2222, 'port was reset');
    });

    /* ---------------- a password that is not ready ---------------- */

    fakeCredentials['uuid-a'] = {
        username: 'root', password: '', passwordStatus: 'generating', ipv4: '10.9.9.9',
    };

    await sync.sync();

    await check('a still-installing server does not wipe a working password', () => {
        assert.strictEqual(store.resolveCredentials('cloudblast-uuid-a').password, 'pw-a');
    });

    /* ---------------- OS from the panel ---------------- */

    // The two standing servers stay on the account throughout this section.
    // Dropping them would remove their hosts, and the removal checks further
    // down need a host that is still there to be removed for the right reason.
    const standing = () => [
        server('uuid-a', 'web-01-renamed.example.com', '10.9.9.9'),
        server('uuid-b', 'db-01.example.com', '10.0.0.2'),
    ];

    fakeServers = [
        ...standing(),
        server('uuid-os', 'os-01.example.com', '10.0.0.9', { os: 'Ubuntu 22.04' }),
    ];
    fakeCredentials = {
        'uuid-os': { username: 'root', password: 'pw', passwordStatus: 'ready', ipv4: '10.0.0.9' },
    };

    await sync.sync();

    await check('a host gets its OS from the panel without ever connecting', () => {
        const host = byId('cloudblast-uuid-os');
        assert.strictEqual(host.os, 'linux');
        assert.strictEqual(host.distro, 'ubuntu');
    });

    await check('the template it came from is remembered', () => {
        assert.strictEqual(byId('cloudblast-uuid-os').cloudblast.os, 'Ubuntu 22.04');
    });

    // What a live session would have written after connecting.
    store.saveHost({ ...byId('cloudblast-uuid-os'), os: 'linux', distro: 'debian' });

    await sync.sync();

    await check('an OS learned from the server itself is not overwritten', () => {
        assert.strictEqual(byId('cloudblast-uuid-os').distro, 'debian',
            'the template guess overrode what the session reported');
    });

    fakeServers = [
        ...standing(),
        server('uuid-os', 'os-01.example.com', '10.0.0.9', { os: 'Rocky Linux 9' }),
    ];

    await sync.sync();

    await check('a rebuild onto a different image does update the OS', () => {
        assert.strictEqual(byId('cloudblast-uuid-os').distro, 'rocky');
    });

    fakeServers = [
        ...standing(),
        server('uuid-os', 'os-01.example.com', '10.0.0.9', { os: 'Custom image' }),
    ];

    await sync.sync();

    await check('an unidentifiable template leaves the existing OS alone', () => {
        assert.strictEqual(byId('cloudblast-uuid-os').distro, 'rocky');
    });

    store.deleteHost('cloudblast-uuid-os');

    /* ---------------- projects ---------------- */

    fakeServers = [
        server('uuid-a', 'web-01-renamed.example.com', '10.9.9.9', {
            folder: { id: 7, name: 'Production' },
        }),
        server('uuid-b', 'db-01.example.com', '10.0.0.2', {
            folder: { id: 8, name: 'Staging' },
        }),
        server('uuid-loose', 'loose.example.com', '10.0.0.7'),
    ];

    await sync.sync();

    await check('each CloudBlast project becomes a folder', () => {
        assert.strictEqual(folderById('cloudblast-folder-7')?.name, 'Production');
        assert.strictEqual(folderById('cloudblast-folder-8')?.name, 'Staging');
    });

    await check('project folders nest inside the CloudBlast folder', () => {
        assert.strictEqual(folderById('cloudblast-folder-7').parentId, 'cloudblast');
    });

    await check('servers land in the project they are in upstream', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').folderId, 'cloudblast-folder-7');
        assert.strictEqual(byId('cloudblast-uuid-b').folderId, 'cloudblast-folder-8');
    });

    await check('a server in no project sits at the CloudBlast root', () => {
        assert.strictEqual(byId('cloudblast-uuid-loose').folderId, 'cloudblast');
    });

    // Moved between projects in the panel.
    fakeServers = [
        server('uuid-a', 'web-01-renamed.example.com', '10.9.9.9', {
            folder: { id: 8, name: 'Staging' },
        }),
        server('uuid-b', 'db-01.example.com', '10.0.0.2', {
            folder: { id: 8, name: 'Staging' },
        }),
        server('uuid-loose', 'loose.example.com', '10.0.0.7'),
    ];

    const moved = await sync.sync();

    await check('moving a server between projects moves its host', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').folderId, 'cloudblast-folder-8');
    });

    await check('a project with nothing left in it is removed', () => {
        assert.strictEqual(folderById('cloudblast-folder-7'), undefined);
        assert.strictEqual(moved.foldersRemoved, 1, JSON.stringify(moved));
    });

    // Renamed in the panel.
    fakeServers = fakeServers.map(s => (
        s.folder ? { ...s, folder: { id: 8, name: 'Staging EU' } } : s
    ));

    await sync.sync();

    await check('renaming a project renames the folder', () => {
        assert.strictEqual(folderById('cloudblast-folder-8').name, 'Staging EU');
    });

    await check('a hand-made folder is never pruned', () => {
        const mine = store.saveFolder({ name: 'my own folder', parentId: '' });
        return sync.sync().then(() => {
            assert.ok(folderById(mine.id), 'the hand-made folder was deleted');
        });
    });

    // Back to no projects for the removal checks below.
    fakeServers = standing();

    await sync.sync();

    await check('dropping every project returns hosts to the CloudBlast root', () => {
        assert.strictEqual(byId('cloudblast-uuid-a').folderId, 'cloudblast');
        assert.strictEqual(folderById('cloudblast-folder-8'), undefined);
    });

    store.deleteHost('cloudblast-uuid-loose');

    /* ---------------- removal ---------------- */

    const manual = store.saveHost({ name: 'my own box', host: '192.168.1.5', username: 'me' });

    fakeServers = [server('uuid-b', 'db-01.example.com', '10.0.0.2')];

    const fourth = await sync.sync();

    await check('a server deleted in the panel loses its host', () => {
        assert.strictEqual(fourth.removed, 1, JSON.stringify(fourth));
        assert.strictEqual(byId('cloudblast-uuid-a'), undefined);
    });

    await check('a host the user made by hand is never touched', () => {
        const mine = byId(manual.id);
        assert.ok(mine, 'the hand-made host was deleted');
        assert.strictEqual(mine.name, 'my own box');
    });

    /* ---------------- degraded cases ---------------- */

    // uuid-b stays on the account here: the next check needs a synced host that
    // a *failed* sync could wrongly remove, and one dropped upstream would have
    // been removed legitimately.
    fakeServers = [
        server('uuid-b', 'db-01.example.com', '10.0.0.2'),
        server('uuid-c', 'no-ip.example.com', ''),
    ];
    fakeCredentials = {};

    const fifth = await sync.sync();

    await check('a server with no address and no credentials is skipped, not added broken', () => {
        assert.strictEqual(byId('cloudblast-uuid-c'), undefined);
        assert.strictEqual(fifth.added, 0, JSON.stringify(fifth));
    });

    await check('an upstream failure reports rather than throwing', async () => {
        const servers = accountStub.servers;
        accountStub.servers = async () => { throw new Error('network down'); };
        const result = await sync.sync();
        accountStub.servers = servers;
        assert.strictEqual(result.error, 'network down');
    });

    await check('a failed sync deletes nothing', () => {
        assert.ok(byId('cloudblast-uuid-b'), 'a host was removed by a failed sync');
        assert.ok(byId(manual.id), 'the hand-made host was removed by a failed sync');
    });

    /* -------------------------------------------------------------- *
     * Windows servers are routed to RDP rather than SSH
     * -------------------------------------------------------------- */

    const { remoteDesktopFor } = sync;
    const WIN = { os: 'windows', distro: '' };
    const CREDS = { username: 'Administrator' };

    await check('a new Windows server is set up for RDP, direct, without SSH', () => {
        const desktop = remoteDesktopFor(WIN, undefined, CREDS);
        assert.deepStrictEqual(desktop, {
            enabled: true,
            protocol: 'rdp',
            transport: 'direct',
            only: true,
            port: 3389,
            username: 'Administrator',
        });
    });

    await check('a Linux server is left alone', () => {
        assert.strictEqual(remoteDesktopFor({ os: 'linux', distro: 'debian' }, undefined, CREDS), null);
    });

    await check('a host that already knows it is Windows still counts', () => {
        // osFor returns null when the template has not changed, which is the
        // normal case for a host that has been synced before.
        assert.ok(remoteDesktopFor(null, { os: 'windows' }, CREDS));
    });

    await check('an RDP desktop stuck on a tunnel is repaired', () => {
        const desktop = remoteDesktopFor(null, {
            os: 'windows',
            cloudblast: { desktopSetup: true },
            desktop: {
                enabled: true, protocol: 'rdp', transport: 'tunnel', only: false,
                host: '127.0.0.1', port: 3389, username: 'Administrator',
                scaling: 'actual', quality: 9,
            },
        }, CREDS);

        assert.strictEqual(desktop.transport, 'direct');
        assert.strictEqual(desktop.only, true);
        // The trap: 127.0.0.1 means the *server's* loopback under a tunnel.
        // Carried into a direct dial it would point at this machine instead.
        assert.strictEqual(desktop.host, '');
        // Settings that were the user's are kept.
        assert.strictEqual(desktop.scaling, 'actual');
        assert.strictEqual(desktop.quality, 9);
    });

    await check('a working direct desktop is not touched', () => {
        assert.strictEqual(remoteDesktopFor(null, {
            os: 'windows',
            cloudblast: { desktopSetup: true },
            desktop: { enabled: true, protocol: 'rdp', transport: 'direct', only: true },
        }, CREDS), null);
    });

    await check('a desktop switched off after setup stays off', () => {
        assert.strictEqual(remoteDesktopFor(null, {
            os: 'windows',
            cloudblast: { desktopSetup: true },
            desktop: { enabled: false, protocol: 'rdp', transport: 'direct' },
        }, CREDS), null);
    });

    await check('a deliberate VNC desktop on Windows is left alone', () => {
        assert.strictEqual(remoteDesktopFor(null, {
            os: 'windows',
            cloudblast: { desktopSetup: true },
            desktop: { enabled: true, protocol: 'vnc', transport: 'tunnel' },
        }, CREDS), null);
    });

    await check('a username the user set is preferred over the panel\'s', () => {
        const desktop = remoteDesktopFor(WIN, {
            os: 'windows',
            desktop: { enabled: true, protocol: 'rdp', transport: 'tunnel', username: 'bradp' },
        }, CREDS);
        assert.strictEqual(desktop.username, 'bradp');
    });

    console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}\n`);
}

run();
