/**
 * The cloud setup snapshot: what goes in it, what must never go in it, and the
 * key-based envelope it travels in.
 *
 * The exclusion rule is the one worth guarding hardest. Servers synced from
 * CloudBlast are rebuilt from the API on every device; carrying them in the
 * snapshot as well would mean a stale copy could resurrect hosts for servers
 * that have since been deleted.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-snap-'));

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

/**
 * A stand-in console. Stores exactly what the real one does -- the payload as
 * an opaque string -- so a push/pull pair that disagrees about serialisation
 * shows up here rather than on a second device.
 */
const remote = { key: Buffer.alloc(32, 3).toString('base64'), payload: null, revision: 0 };

const accountStub = {
    status: () => ({ connected: true }),
    deviceName: () => 'test device',
    snapshotKey: async () => remote.key,
    snapshotMeta: async () => ({ exists: Boolean(remote.payload), revision: remote.revision }),
    snapshotGet: async () =>
        remote.payload ? { ...remote, updated_at: null, device_name: 'test device' } : null,
    snapshotPut: async ({ payload, baseRevision }) => {
        if (baseRevision !== remote.revision) return { conflict: true, revision: remote.revision };
        remote.payload = payload;
        remote.revision += 1;
        return { conflict: false, revision: remote.revision };
    },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === './account') return accountStub;
    return realLoad.call(this, request, parent, isMain);
};

const store = require(path.join(ROOT, 'store.js'));
const byId = (id) => store.getHosts().find(h => h.id === id);
const backup = require(path.join(ROOT, 'backup.js'));
const snapshot = require(path.join(ROOT, 'cloud-snapshot.js'));

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

/* ---------------- the keyed envelope ---------------- */

console.log('\ncloud snapshot: envelope');

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const PAYLOAD = { hosts: [{ id: 'h1', name: 'prod', password: 'hunter2' }], settings: { theme: 'dark' } };

check('round trips a payload', () => {
    assert.deepStrictEqual(backup.unsealWithKey(backup.sealWithKey(PAYLOAD, KEY), KEY), PAYLOAD);
});

check('never writes plaintext into the envelope', () => {
    const sealed = JSON.stringify(backup.sealWithKey(PAYLOAD, KEY));
    assert.ok(!sealed.includes('hunter2'), 'a password appears in the envelope');
    assert.ok(!sealed.includes('prod'), 'a host name appears in the envelope');
});

check('refuses the wrong key', () => {
    assert.strictEqual(backup.unsealWithKey(backup.sealWithKey(PAYLOAD, KEY), OTHER_KEY), null);
});

check('refuses a tampered payload', () => {
    const sealed = backup.sealWithKey(PAYLOAD, KEY);
    const raw = Buffer.from(sealed.payload, 'base64');
    raw[raw.length - 1] ^= 0xff;
    sealed.payload = raw.toString('base64');
    assert.strictEqual(backup.unsealWithKey(sealed, KEY), null);
});

check('refuses a tampered header', () => {
    const sealed = backup.sealWithKey(PAYLOAD, KEY);
    sealed.createdAt = '1999-01-01T00:00:00.000Z';
    assert.strictEqual(backup.unsealWithKey(sealed, KEY), null);
});

check('rejects a key that is not 256 bits', () => {
    assert.throws(() => backup.sealWithKey(PAYLOAD, Buffer.alloc(16).toString('base64')));
});

check('will not open a passphrase backup as a snapshot', () => {
    assert.throws(() => backup.unsealWithKey(backup.seal(PAYLOAD, 'a passphrase here'), KEY));
});

/* ---------------- what is collected ---------------- */

console.log('\ncloud snapshot: contents');

store.saveHost({ id: 'mine-1', name: 'my laptop box', host: '10.0.0.1', username: 'me', password: 'local-secret' });
store.saveFolder({ id: 'my-folder', name: 'Personal', parentId: '' });
store.saveKey({ id: 'key-1', name: 'work key', privateKey: 'PRIVATE-KEY-BODY' });
store.saveSnippet({ id: 'snip-1', name: 'restart nginx', command: 'systemctl restart nginx' });

// What the CloudBlast server sync owns.
store.saveFolder({ id: 'cloudblast', name: 'CloudBlast', parentId: '' });
store.saveFolder({ id: 'cloudblast-folder-7', name: 'Production', parentId: 'cloudblast' });
store.saveHost({ id: 'cloudblast-uuid-a', name: 'web-01', host: '10.9.9.9', username: 'root', folderId: 'cloudblast-folder-7' });

const collected = snapshot.collect();

check('includes the hosts the user made', () => {
    assert.ok(collected.hosts.some(h => h.id === 'mine-1'), 'the user host is missing');
});

check('carries credentials so another device can connect', () => {
    assert.strictEqual(collected.hosts.find(h => h.id === 'mine-1').password, 'local-secret');
    assert.strictEqual(collected.keys.find(k => k.id === 'key-1').privateKey, 'PRIVATE-KEY-BODY');
});

check('includes folders, keys and snippets', () => {
    assert.ok(collected.folders.some(f => f.id === 'my-folder'));
    assert.ok(collected.keys.some(k => k.id === 'key-1'));
    assert.ok(collected.snippets.some(s => s.id === 'snip-1'));
});

check('excludes hosts synced from CloudBlast', () => {
    assert.ok(!collected.hosts.some(h => h.id === 'cloudblast-uuid-a'),
        'a synced host would be duplicated and could outlive its server');
});

check('excludes the CloudBlast folder and its projects', () => {
    assert.ok(!collected.folders.some(f => f.id === 'cloudblast'));
    assert.ok(!collected.folders.some(f => f.id === 'cloudblast-folder-7'));
});

check('carries terminal settings once the renderer has reported them', () => {
    snapshot.setSettings({ 'terminal.appearance': '{"fontSize":14}', theme: 'dark' });
    assert.strictEqual(snapshot.collect().settings.theme, 'dark');
});

check('a collected snapshot survives the round trip intact', () => {
    const full = snapshot.collect();
    const opened = backup.unsealWithKey(backup.sealWithKey(full, KEY), KEY);
    assert.deepStrictEqual(opened, full);
});

/* ---------------- guards ---------------- */

console.log('\ncloud snapshot: guards');

// Awaited explicitly: `check` is synchronous, so handing it an async function
// would report ok before the assertion inside had run.
const checkAsync = async (label, fn) => {
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

(async () => {
    await checkAsync('reports being signed out rather than uploading nothing', async () => {
        const connected = accountStub.status;
        accountStub.status = () => ({ connected: false });
        const result = await snapshot.push();
        accountStub.status = connected;
        assert.ok(result.skipped, JSON.stringify(result));
    });

    /* ---------------- the round trip ---------------- */

    console.log('\ncloud snapshot: push and pull');

    await checkAsync('pushes to the console', async () => {
        const result = await snapshot.push();
        assert.ok(result.pushed, JSON.stringify(result));
        assert.strictEqual(typeof remote.payload, 'string', 'the console was handed a non-string');
    });

    // What a second device sees: the payload as the console stored it. This is
    // the seam a push that serialises and a pull that does not would fall
    // through, and it did.
    await checkAsync('pulls back what it pushed', async () => {
        store.deleteHost('mine-1');
        assert.strictEqual(byId('mine-1'), undefined, 'setup failed');

        const result = await snapshot.pull({ force: true });

        assert.ok(!result.error, `pull failed: ${result.error}`);
        assert.ok(result.pulled, JSON.stringify(result));
        assert.ok(byId('mine-1'), 'the host did not come back');
    });

    await checkAsync('restores the credentials with it', () => {
        assert.strictEqual(store.resolveCredentials('mine-1').password, 'local-secret');
    });

    /**
     * Arrangement, not just contents. Nesting, which folder a host sits in and
     * the manual drag order are all plain fields on the records, so they travel
     * with them -- but only because the snapshot carries whole records rather
     * than a hand-picked set of columns. This is the check that notices if
     * someone later starts curating which fields go in.
     */
    await checkAsync('keeps the folder tree, placement and manual order', async () => {
        store.saveFolder({ id: 'parent-f', name: 'Work', parentId: '', order: 0 });
        store.saveFolder({ id: 'child-f', name: 'Clients', parentId: 'parent-f', order: 1 });
        store.saveHost({ id: 'nested-1', name: 'client box', host: '10.0.0.8', folderId: 'child-f', order: 3 });

        await snapshot.push();

        store.deleteHost('nested-1');
        store.deleteFolder('child-f');
        store.deleteFolder('parent-f');

        const result = await snapshot.pull({ force: true });
        assert.ok(!result.error, `pull failed: ${result.error}`);

        const folders = store.getFolders();
        const parent = folders.find(f => f.id === 'parent-f');
        const child = folders.find(f => f.id === 'child-f');
        const host = byId('nested-1');

        assert.ok(parent && child, 'the folders did not come back');
        assert.strictEqual(child.parentId, 'parent-f', 'nesting was lost');
        assert.strictEqual(child.order, 1, 'folder order was lost');
        assert.ok(host, 'the nested host did not come back');
        assert.strictEqual(host.folderId, 'child-f', 'the host lost its folder');
        assert.strictEqual(host.order, 3, 'host order was lost');
    });

    /**
     * Signing out and into a different account.
     *
     * Without the reset, this device's revision is whatever the previous
     * account reached, and the new account's snapshot -- which starts its own
     * count from 1 -- looks older than something already seen. The pull that
     * should restore it decides there is nothing to do, and the user sees an
     * empty app with no error to explain it.
     */
    await checkAsync('a different account still restores after sign-out', async () => {
        // Push a few times so this device's revision climbs.
        await snapshot.push();
        await snapshot.push();
        assert.ok(snapshot.status().revision >= 2, 'setup: revision did not advance');

        snapshot.reset();

        assert.strictEqual(snapshot.status().revision, 0, 'reset left a revision behind');
        assert.strictEqual(snapshot.status().enabled, true, 'reset should keep the preference');

        // The new account: its own key, its own snapshot, revision 1.
        const fresh = Buffer.alloc(32, 5).toString('base64');
        remote.key = fresh;
        remote.revision = 1;
        remote.payload = JSON.stringify(backup.sealWithKey({
            version: 1,
            hosts: [{ id: 'other-account-host', name: 'their box', host: '10.1.2.3', username: 'them' }],
            folders: [], keys: [], snippets: [], knownHosts: {}, settings: null,
        }, fresh));

        const result = await snapshot.pull();

        assert.ok(!result.error, `pull failed: ${result.error}`);
        assert.ok(result.pulled, `nothing was pulled: ${JSON.stringify(result)}`);
        assert.ok(byId('other-account-host'), 'the new account\'s host did not arrive');
    });

    await checkAsync('a corrupted payload is reported, not applied', async () => {
        const good = remote.payload;
        remote.payload = 'not json at all';
        remote.revision += 1;

        const result = await snapshot.pull({ force: true });
        remote.payload = good;

        assert.ok(result.error, 'a corrupt payload was accepted');
    });

    await checkAsync('a push with no key provisioned reports rather than throwing', async () => {
        const result = await snapshot.push();
        assert.ok(result.pushed || result.error || result.skipped, JSON.stringify(result));
    });

    console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}\n`);
})();
