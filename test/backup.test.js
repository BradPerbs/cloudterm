/**
 * Exercises the backup envelope and a full export -> restore round trip,
 * with `electron` stubbed so it runs under plain node.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

let userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-a-'));

const electronStub = {
    app: {
        getPath: (what) => (what === 'userData' ? userData : os.tmpdir()),
        getVersion: () => '1.0.0',
    },
    // No OS keystore: the vault falls back to storing the data key unwrapped,
    // which is the Linux-without-a-keyring path and is fine for a test.
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

/* ---------------- envelope ---------------- */

console.log('\nbackup envelope');

const backup = fresh('backup.js');
const PAYLOAD = { hosts: [{ id: 'h1', name: 'prod', password: 'hunter2' }], nested: { a: [1, 2] } };
const PASS = 'correct horse battery';

check('round trips an identical payload', () => {
    const opened = backup.unseal(backup.seal(PAYLOAD, PASS), PASS);
    assert.deepStrictEqual(opened, PAYLOAD);
});

check('never writes the plaintext into the envelope', () => {
    const sealed = JSON.stringify(backup.seal(PAYLOAD, PASS));
    assert.ok(!sealed.includes('hunter2'), 'password appears in the envelope');
    assert.ok(!sealed.includes('prod'), 'host name appears in the envelope');
});

check('rejects the wrong passphrase', () => {
    assert.strictEqual(backup.unseal(backup.seal(PAYLOAD, PASS), 'wrong passphrase'), null);
});

check('rejects a tampered ciphertext', () => {
    const sealed = backup.seal(PAYLOAD, PASS);
    const raw = Buffer.from(sealed.payload, 'base64');
    raw[raw.length - 1] ^= 0xff;
    sealed.payload = raw.toString('base64');
    assert.strictEqual(backup.unseal(sealed, PASS), null);
});

check('rejects a KDF cost downgraded in the header', () => {
    const sealed = backup.seal(PAYLOAD, PASS);
    sealed.kdf.N = 2; // what an attacker would want, to make guessing cheap
    assert.strictEqual(backup.unseal(sealed, PASS), null);
});

check('rejects a swapped salt', () => {
    const sealed = backup.seal(PAYLOAD, PASS);
    sealed.kdf.salt = 'ab'.repeat(32);
    assert.strictEqual(backup.unseal(sealed, PASS), null);
});

check('throws on a file that is not a backup', () => {
    assert.throws(() => backup.unseal({ hello: 'world' }, PASS), /not a CloudBlast backup/i);
});

check('throws on a newer format version', () => {
    const sealed = backup.seal(PAYLOAD, PASS);
    sealed.version = 99;
    assert.throws(() => backup.unseal(sealed, PASS), /newer version/i);
});

check('throws on a truncated payload', () => {
    const sealed = backup.seal(PAYLOAD, PASS);
    sealed.payload = Buffer.from('short').toString('base64');
    assert.throws(() => backup.unseal(sealed, PASS), /truncated/i);
});

check('requires a passphrase of at least 8 characters', () => {
    assert.ok(backup.validatePassphrase('short'));
    assert.strictEqual(backup.validatePassphrase('longenough'), '');
});

check('writes and reads a file', () => {
    const file = path.join(userData, 'test.cbbackup');
    backup.writeFile(file, backup.seal(PAYLOAD, PASS));
    assert.deepStrictEqual(backup.unseal(backup.readFile(file), PASS), PAYLOAD);
});

/* ---------------- export -> restore ---------------- */

console.log('\nexport and restore');

const storeA = fresh('store.js');
const knownA = fresh('known-hosts.js');

storeA.saveHost({
    id: 'host-1', name: 'prod-web', host: '10.0.0.5', port: 22,
    username: 'deploy', authMethod: 'password', password: 'sup3rsecret',
    tunnels: [{ id: 't1', type: 'local', listenPort: 5432, destHost: 'db', destPort: 5432 }],
});
storeA.saveHost({
    id: 'host-2', name: 'bastion', host: '10.0.0.1', username: 'root',
    authMethod: 'key', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n', passphrase: 'kp',
});
storeA.saveFolder({ id: 'folder-1', name: 'Production' });
storeA.saveKey({ id: 'key-1', name: 'work', privateKey: 'PRIVATE-MATERIAL', passphrase: 'keypass' });
storeA.saveSnippet({ id: 'snip-1', name: 'restart', command: 'systemctl restart {{svc}}' });
knownA.trust('10.0.0.5', 22, Buffer.concat([
    Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from('keyblob'),
]));

const exported = { ...storeA.exportAll(), knownHosts: knownA.exportAll() };

check('export carries secrets in the clear inside the payload', () => {
    assert.strictEqual(exported.hosts.find(h => h.id === 'host-1').password, 'sup3rsecret');
    assert.strictEqual(exported.keys.find(k => k.id === 'key-1').privateKey, 'PRIVATE-MATERIAL');
    assert.strictEqual(exported.keys.find(k => k.id === 'key-1').passphrase, 'keypass');
});

check('export includes every collection', () => {
    assert.strictEqual(exported.hosts.length, 2);
    assert.strictEqual(exported.folders.length, 1);
    assert.strictEqual(exported.keys.length, 1);
    assert.strictEqual(exported.snippets.length, 1);
    assert.strictEqual(Object.keys(exported.knownHosts).length, 1);
});

const sealedFile = path.join(userData, 'roundtrip.cbbackup');
backup.writeFile(sealedFile, backup.seal(exported, PASS));

// A second machine: new user-data directory, nothing in it.
userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-b-'));
const storeB = fresh('store.js');
const knownB = fresh('known-hosts.js');
const backupB = fresh('backup.js');

const restored = backupB.unseal(backupB.readFile(sealedFile), PASS);

check('preview reports everything as new on a fresh machine', () => {
    const preview = storeB.previewImport(restored);
    assert.strictEqual(preview.hosts.total, 2);
    assert.strictEqual(preview.hosts.new, 2);
    assert.strictEqual(preview.hosts.existing, 0);
});

const summary = storeB.importAll(restored, { overwrite: false });
knownB.importAll(restored.knownHosts, { overwrite: false });

check('restore reports what it added', () => {
    assert.strictEqual(summary.hosts.added, 2);
    assert.strictEqual(summary.keys.added, 1);
    assert.strictEqual(summary.folders.added, 1);
    assert.strictEqual(summary.snippets.added, 1);
});

check('restored secrets decrypt back to the originals', () => {
    const one = storeB.resolveCredentials('host-1');
    assert.strictEqual(one.password, 'sup3rsecret');
    const two = storeB.resolveCredentials('host-2');
    assert.strictEqual(two.privateKey, '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n');
    assert.strictEqual(two.passphrase, 'kp');
});

check('restored secrets are re-encrypted at rest, not stored in the clear', () => {
    const onDisk = fs.readFileSync(path.join(userData, 'sessions.json'), 'utf8');
    assert.ok(!onDisk.includes('sup3rsecret'), 'host password is on disk in the clear');
    assert.ok(!onDisk.includes('PRIVATE-MATERIAL'), 'key material is on disk in the clear');
    assert.ok(onDisk.includes('v2:'), 'secrets are not under the vault key');
});

check('keychain auth resolves through the restored key', () => {
    storeB.saveHost({ id: 'host-3', name: 'via-keychain', host: 'h', username: 'u',
        authMethod: 'keychain', keychainKeyId: 'key-1' });
    const creds = storeB.resolveCredentials('host-3');
    assert.strictEqual(creds.privateKey, 'PRIVATE-MATERIAL');
    assert.strictEqual(creds.passphrase, 'keypass');
});

check('tunnels survive the round trip', () => {
    const tunnels = storeB.getHostTunnels('host-1');
    assert.strictEqual(tunnels.length, 1);
    assert.strictEqual(tunnels[0].listenPort, 5432);
});

check('trusted host keys come back', () => {
    const list = knownB.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].host, '10.0.0.5');
    assert.strictEqual(list[0].entries.length, 1);
});

/* ---------------- merge behaviour ---------------- */

console.log('\nmerge behaviour');

check('restoring twice is a no-op by default', () => {
    const again = storeB.importAll(restored, { overwrite: false });
    assert.strictEqual(again.hosts.added, 0);
    assert.strictEqual(again.hosts.skipped, 2);
    assert.strictEqual(storeB.getHosts().filter(h => h.id === 'host-1').length, 1);
});

check('a local edit survives a default restore', () => {
    storeB.saveHost({ id: 'host-1', name: 'renamed-locally' });
    storeB.importAll(restored, { overwrite: false });
    assert.strictEqual(storeB.getHosts().find(h => h.id === 'host-1').name, 'renamed-locally');
});

check('overwrite makes the machine match the backup', () => {
    const result = storeB.importAll(restored, { overwrite: true });
    assert.strictEqual(result.hosts.replaced, 2);
    assert.strictEqual(storeB.getHosts().find(h => h.id === 'host-1').name, 'prod-web');
    assert.strictEqual(storeB.resolveCredentials('host-1').password, 'sup3rsecret');
});

check('preview marks existing records once they are there', () => {
    const preview = storeB.previewImport(restored);
    assert.strictEqual(preview.hosts.existing, 2);
    assert.strictEqual(preview.hosts.new, 0);
});

check('a secret that looks like ciphertext is still stored encrypted', () => {
    // The "does this already look encrypted" heuristic used on the save path
    // would store this as-is; the restore path must not use it.
    storeB.importAll({ hosts: [{ id: 'odd', name: 'odd', password: 'v2:notreallyciphertext' }] },
        { overwrite: true });
    assert.strictEqual(storeB.resolveCredentials('odd').password, 'v2:notreallyciphertext');
    const onDisk = fs.readFileSync(path.join(userData, 'sessions.json'), 'utf8');
    assert.ok(!onDisk.includes('v2:notreallyciphertext'), 'stored verbatim instead of encrypted');
});

check('known-hosts merge is additive and deduplicated', () => {
    const before = knownB.list()[0].entries.length;
    knownB.importAll(restored.knownHosts, { overwrite: false });
    assert.strictEqual(knownB.list()[0].entries.length, before, 'a duplicate fingerprint was added');
});

check('malformed records are skipped, not fatal', () => {
    const result = storeB.importAll({ hosts: [null, { name: 'no id' }, undefined] }, {});
    assert.strictEqual(result.hosts.added, 0);
    assert.strictEqual(result.hosts.skipped, 3);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}\n`);
