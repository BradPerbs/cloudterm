/**
 * Exercises the activity log: what it records, what it refuses to record, how
 * it filters and pages, and that a host edit going through the store leaves a
 * readable trail. `electron` is stubbed so it runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

let userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-act-'));

const electronStub = {
    app: {
        getPath: (what) => (what === 'userData' ? userData : os.tmpdir()),
        getVersion: () => '1.0.0',
        // The log registers a flush on quit; the real app supplies this.
        on: () => {},
    },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const fresh = (name) => {
    for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}main${path.sep}`)) delete require.cache[key];
    }
    return require(path.join(ROOT, name));
};

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

/* ---------------- recording ---------------- */

console.log('\nactivity log');

const activity = fresh('activity.js');

check('records an entry and hands it back newest first', () => {
    activity.record({ category: 'connection', action: 'session.open', target: 'prod-web' });
    activity.record({ category: 'files', action: 'file.delete', target: '/etc/nginx/old.conf' });

    const { entries } = activity.list({});
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].action, 'file.delete');
    assert.strictEqual(entries[1].action, 'session.open');
});

check('stamps every entry with the OS account that did it', () => {
    const [entry] = activity.list({ limit: 1 }).entries;
    assert.ok(entry.actor.user, 'no actor recorded');
    assert.strictEqual(typeof entry.actor.machine, 'string');
});

check('falls back to a known category rather than storing junk', () => {
    activity.record({ category: 'nonsense', action: 'x.y', target: 't' });
    assert.strictEqual(activity.list({ limit: 1 }).entries[0].category, 'data');
});

check('defaults an unknown outcome to success and keeps the ones it knows', () => {
    activity.record({ category: 'data', action: 'a.b', outcome: 'sideways' });
    assert.strictEqual(activity.list({ limit: 1 }).entries[0].outcome, 'success');

    activity.record({ category: 'security', action: 'hostkey.replace', outcome: 'warning' });
    assert.strictEqual(activity.list({ limit: 1 }).entries[0].outcome, 'warning');
});

check('a bad call is dropped rather than thrown back at the caller', () => {
    const before = activity.list({}).total;
    assert.doesNotThrow(() => activity.record(null));
    assert.strictEqual(activity.list({}).total, before);
});

check('trims a field that would bloat the file', () => {
    activity.record({ category: 'files', action: 'file.edit', target: 'x'.repeat(5000) });
    assert.ok(activity.list({ limit: 1 }).entries[0].target.length < 500);
});

/* ---------------- filtering and paging ---------------- */

console.log('\nfiltering');

check('filters by category', () => {
    const { entries } = activity.list({ category: 'connection' });
    assert.ok(entries.length > 0);
    assert.ok(entries.every(entry => entry.category === 'connection'));
});

check('accepts several outcomes at once, for "problems only"', () => {
    activity.record({ category: 'connection', action: 'session.open', outcome: 'failure', target: 'dead' });
    const { entries } = activity.list({ outcome: ['failure', 'warning'] });
    assert.ok(entries.length >= 2);
    assert.ok(entries.every(entry => entry.outcome === 'failure' || entry.outcome === 'warning'));
});

check('searches across target, detail and message', () => {
    activity.record({
        category: 'files',
        action: 'file.rename',
        target: '/srv/app/config.yml',
        detail: 'to /srv/app/config.yml.bak',
    });
    assert.strictEqual(activity.list({ search: 'config.yml' }).entries.length, 1);
    assert.strictEqual(activity.list({ search: 'nothing here' }).entries.length, 0);
});

check('reports whether the caller has reached the end', () => {
    assert.strictEqual(activity.list({ limit: 1 }).exhausted, false);
    assert.strictEqual(activity.list({ limit: 5000 }).exhausted, true);
});

check('paging with `before` walks backwards without skipping an entry', () => {
    const all = activity.list({ limit: 5000 }).entries;
    const firstPage = activity.list({ limit: 3 }).entries;
    const rest = activity.list({ limit: 5000, before: firstPage[firstPage.length - 1].at }).entries;

    const seen = new Set(firstPage.map(entry => entry.id));
    const merged = [...firstPage, ...rest.filter(entry => !seen.has(entry.id))];

    assert.deepStrictEqual(merged.map(entry => entry.id), all.map(entry => entry.id));
});

check('counts per category line up with the entries', () => {
    const summary = activity.summary();
    assert.strictEqual(summary.all, activity.list({ limit: 5000 }).entries.length);
    assert.strictEqual(summary.connection, activity.list({ category: 'connection', limit: 5000 }).entries.length);
    assert.ok(summary.capacity > 0);
});

/* ---------------- persistence ---------------- */

console.log('\npersistence');

check('survives a restart', () => {
    activity.flush();
    const reopened = fresh('activity.js');
    assert.ok(reopened.list({ limit: 5000 }).entries.length > 0);
    assert.strictEqual(reopened.list({ limit: 1 }).entries[0].action, 'file.rename');
});

check('clears to empty and stays cleared', () => {
    const reopened = fresh('activity.js');
    reopened.clear();
    assert.strictEqual(reopened.list({}).entries.length, 0);
    assert.strictEqual(fresh('activity.js').list({}).entries.length, 0);
});

check('drops the oldest once it is full', () => {
    const capped = fresh('activity.js');
    const capacity = capped.summary().capacity;
    for (let index = 0; index < capacity + 25; index++) {
        capped.record({ category: 'data', action: 'host.update', target: `host-${index}` });
    }
    const summary = capped.summary();
    assert.strictEqual(summary.all, capacity);
    // The newest survived, the very first did not.
    assert.strictEqual(capped.list({ limit: 1 }).entries[0].target, `host-${capacity + 24}`);
    assert.strictEqual(capped.list({ search: 'host-0', limit: 5000 }).entries.length, 0);
    capped.clear();
});

/* ---------------- change detection ---------------- */

console.log('\nchange detection');

const act = fresh('activity.js');

check('reports only the fields that really differ', () => {
    const changes = act.diff(
        { name: 'web', host: '10.0.0.1', port: 22 },
        { name: 'web', host: '10.0.0.2', port: 22 },
    );
    assert.deepStrictEqual(changes, [{ field: 'host', from: '10.0.0.1', to: '10.0.0.2' }]);
});

check('ignores bookkeeping the app writes on its own', () => {
    const changes = act.diff(
        { name: 'web', lastConnectedAt: 1, os: 'linux' },
        { name: 'web', lastConnectedAt: 2, os: 'macos', distro: 'arch' },
    );
    assert.deepStrictEqual(changes, []);
});

check('never carries a secret, only the fact that it moved', () => {
    const changes = act.diff({ password: 'old-cipher' }, { password: 'new-cipher' });
    assert.deepStrictEqual(changes, [{ field: 'password', secret: true, from: '', to: '' }]);
});

check('summarises a collection rather than dumping it', () => {
    const [change] = act.diff({ tunnels: [] }, { tunnels: [{ id: 'a' }, { id: 'b' }] });
    assert.strictEqual(change.field, 'tunnels');
    assert.strictEqual(change.to, '2 entries');
});

/* ---------------- through the store ---------------- */

console.log('\nstore integration');

userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-act-store-'));
const store = fresh('store.js');
const log = require(path.join(ROOT, 'activity.js'));

check('creating a host records who added what', () => {
    store.saveHost({ id: 'h1', name: 'prod-db', host: '10.0.0.9', port: 2222, username: 'root' });
    const [entry] = log.list({ limit: 1 }).entries;
    assert.strictEqual(entry.action, 'host.create');
    assert.strictEqual(entry.target, 'prod-db');
    assert.strictEqual(entry.subject, 'root@10.0.0.9:2222');
    assert.strictEqual(entry.hostId, 'h1');
    // A create has no "before", so nothing is described as having changed.
    assert.strictEqual(entry.changes, undefined);
});

check('editing one records the fields that changed', () => {
    store.saveHost({ id: 'h1', name: 'prod-db', host: '10.0.0.9', port: 22, username: 'deploy' });
    const [entry] = log.list({ limit: 1 }).entries;
    assert.strictEqual(entry.action, 'host.update');

    const fields = entry.changes.map(change => change.field).sort();
    assert.deepStrictEqual(fields, ['port', 'username']);
});

check('a connect timestamp on its own is not an edit', () => {
    const before = log.summary().all;
    store.saveHost({ id: 'h1', lastConnectedAt: Date.now(), os: 'linux', distro: 'debian' });
    assert.strictEqual(log.summary().all, before, 'bookkeeping was logged as a user edit');
});

check('a stored password never reaches the log', () => {
    store.saveHost({ id: 'h1', password: 'hunter2' });
    const [entry] = log.list({ limit: 1 }).entries;
    assert.deepStrictEqual(entry.changes, [{ field: 'password', secret: true, from: '', to: '' }]);
    assert.ok(!JSON.stringify(log.list({ limit: 5000 })).includes('hunter2'));
});

check('the file on disk holds no secret either', () => {
    log.flush();
    const onDisk = fs.readFileSync(path.join(userData, 'activity.json'), 'utf8');
    assert.ok(!onDisk.includes('hunter2'), 'a password was written to the activity log');
});

check('deleting a host records it by name, not by id alone', () => {
    store.deleteHost('h1');
    const [entry] = log.list({ limit: 1 }).entries;
    assert.strictEqual(entry.action, 'host.delete');
    assert.strictEqual(entry.target, 'prod-db');
});

check('keys and snippets are recorded in their own categories', () => {
    store.saveKey({ id: 'k1', name: 'deploy key', type: 'ED25519', privateKey: 'PRIVATE' });
    assert.strictEqual(log.list({ limit: 1 }).entries[0].category, 'security');

    store.saveSnippet({ id: 's1', name: 'restart nginx', command: 'systemctl restart nginx' });
    const [entry] = log.list({ limit: 1 }).entries;
    assert.strictEqual(entry.action, 'snippet.create');
    assert.strictEqual(entry.category, 'data');
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}\n`);
