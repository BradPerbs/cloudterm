/**
 * `cloudterm://` links, from the command line to a quick-connect host.
 *
 * What is under test is the boundary: a link is untrusted input from a
 * browser, so the parser has to refuse anything that is not the one shape the
 * app understands, a code has to be redeemed rather than trusted, a link with
 * no code has to be put in front of the user before it dials, and nothing
 * that arrives before the renderer is listening may be lost or delivered
 * twice.
 *
 * `electron` and the account API are stubbed so this runs under plain node.
 * The store is real: the host a link produces has to be one the connection
 * path can resolve credentials for.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-deep-link-'));

// What the dialog answers, and what it was asked. Reassigned per scenario.
let dialogAnswer = 0;
let dialogAsked = null;

const electronStub = {
    app: {
        getPath: (what) => (what === 'userData' ? userData : os.tmpdir()),
        getVersion: () => '1.0.0',
        isPackaged: false,
        setAsDefaultProtocolClient: () => true,
    },
    dialog: {
        showMessageBox: async (window, options) => {
            dialogAsked = options;
            return { response: dialogAnswer };
        },
    },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
    powerMonitor: { on: () => {} },
};

// What the connected account would answer to a redeem. Reassigned per scenario.
let redeem = async () => { throw new Error('Not signed in'); };
let redeemedWith = [];

const accountStub = {
    redeemConnectCode: async (code) => {
        redeemedWith.push(code);
        return redeem(code);
    },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === './account') return accountStub;
    return realLoad.call(this, request, parent, isMain);
};

const store = require(path.join(ROOT, 'store.js'));
const deepLink = require(path.join(ROOT, 'deep-link.js'));

let passed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        process.exitCode = 1;
    }
};

const GOOD_CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKl';

(async () => {
    console.log('deep-link.test.js');

    /* ---------------- parse ---------------- */

    await check('parses a connect link with a code and an address', () => {
        const link = deepLink.parse(`cloudterm://connect?code=${GOOD_CODE}&address=root%4010.0.0.5`);
        assert.deepStrictEqual(link, { action: 'connect', code: GOOD_CODE, address: 'root@10.0.0.5' });
    });

    await check('parses a connect link with only an address', () => {
        const link = deepLink.parse('cloudterm://connect?address=deploy@box.example.com:2222');
        assert.deepStrictEqual(link, { action: 'connect', code: '', address: 'deploy@box.example.com:2222' });
    });

    await check('accepts the action in the path as well as the host', () => {
        const link = deepLink.parse('cloudterm:///connect?address=10.0.0.5');
        assert.strictEqual(link?.action, 'connect');
        assert.strictEqual(link?.address, '10.0.0.5');
    });

    await check('is not fooled by case in the action', () => {
        assert.strictEqual(deepLink.parse('cloudterm://Connect?address=10.0.0.5')?.action, 'connect');
    });

    await check('refuses another scheme', () => {
        assert.strictEqual(deepLink.parse('ssh://root@10.0.0.5'), null);
        assert.strictEqual(deepLink.parse('https://connect?address=10.0.0.5'), null);
    });

    await check('refuses an action it does not know', () => {
        assert.strictEqual(deepLink.parse('cloudterm://save?address=10.0.0.5'), null);
        assert.strictEqual(deepLink.parse('cloudterm://'), null);
    });

    await check('refuses a code that is not the shape a connect code has', () => {
        assert.strictEqual(deepLink.parse('cloudterm://connect?code=../../etc&address=10.0.0.5'), null);
        assert.strictEqual(deepLink.parse('cloudterm://connect?code=short&address=10.0.0.5'), null);
    });

    await check('refuses garbage without throwing', () => {
        assert.strictEqual(deepLink.parse(''), null);
        assert.strictEqual(deepLink.parse(null), null);
        assert.strictEqual(deepLink.parse('not a url'), null);
    });

    /* ---------------- extract ---------------- */

    await check('finds the link among the other arguments', () => {
        const argv = ['C:\\CloudTerm.exe', '--allow-file-access', 'cloudterm://connect?address=10.0.0.5'];
        assert.strictEqual(deepLink.extract(argv), 'cloudterm://connect?address=10.0.0.5');
    });

    await check('finds nothing on an ordinary launch', () => {
        assert.strictEqual(deepLink.extract(['C:\\CloudTerm.exe']), null);
        assert.strictEqual(deepLink.extract([]), null);
        assert.strictEqual(deepLink.extract(undefined), null);
    });

    /* ---------------- resolve: the code path ---------------- */

    await check('a redeemed code dials with the login the account answered', async () => {
        redeem = async () => ({
            host: '10.0.0.5', port: 22, username: 'root', password: 's3cret', passwordStatus: 'ready', name: 'web-01',
        });
        redeemedWith = [];

        const result = await deepLink.resolve(deepLink.parse(`cloudterm://connect?code=${GOOD_CODE}&address=root%4010.0.0.5`));

        assert.deepStrictEqual(redeemedWith, [GOOD_CODE]);
        assert.ok(result.host, 'a host was produced');
        assert.strictEqual(result.host.ephemeral, true);
        assert.strictEqual(result.host.name, 'web-01');
        assert.strictEqual(result.host.hasPassword, true);
        assert.strictEqual(result.host.password, undefined, 'the redacted record carries no password');
        assert.strictEqual(result.notice, '');

        // What the connection path sees: the password in hand, nothing to ask.
        const credentials = store.resolveCredentials(result.host.id);
        assert.strictEqual(credentials.password, 's3cret');
        assert.strictEqual(credentials.username, 'root');
        assert.strictEqual(credentials.promptCredentials, false);
    });

    await check('a server with no password yet still opens, and says so', async () => {
        redeem = async () => ({
            host: '10.0.0.6', port: 22, username: 'root', password: '', passwordStatus: 'generating', name: 'new-box',
        });

        const result = await deepLink.resolve(deepLink.parse(`cloudterm://connect?code=${GOOD_CODE}`));

        assert.ok(result.host);
        assert.strictEqual(result.host.hasPassword, false);
        assert.match(result.notice, /no password/);
        assert.strictEqual(store.resolveCredentials(result.host.id).promptCredentials, true);
    });

    await check('nothing is written to disk for any of it', () => {
        const onDisk = fs.existsSync(path.join(userData, 'sessions.json'))
            ? fs.readFileSync(path.join(userData, 'sessions.json'), 'utf8')
            : '';
        assert.ok(!onDisk.includes('s3cret'), 'the password is not on disk');
        assert.ok(!onDisk.includes('10.0.0.5'), 'the address is not on disk');
    });

    /* ---------------- resolve: falling back to the address ---------------- */

    await check('a code that cannot be redeemed falls back to the address, after asking', async () => {
        redeem = async () => { throw new Error('This connect link expired'); };
        dialogAnswer = 0;
        dialogAsked = null;

        const result = await deepLink.resolve(deepLink.parse(`cloudterm://connect?code=${GOOD_CODE}&address=root%4010.0.0.7`));

        assert.ok(dialogAsked, 'the user was asked');
        assert.match(dialogAsked.message, /root@10\.0\.0\.7/);
        assert.match(dialogAsked.detail, /expired/);
        assert.ok(result.host);
        assert.strictEqual(result.host.host, '10.0.0.7');
        assert.strictEqual(result.host.hasPassword, false);
        assert.match(result.notice, /expired/);
        assert.match(result.notice, /password on the pane/);
        assert.strictEqual(store.resolveCredentials(result.host.id).promptCredentials, true);
    });

    await check('a link with no code asks before it dials', async () => {
        dialogAnswer = 0;
        dialogAsked = null;
        redeemedWith = [];

        const result = await deepLink.resolve(deepLink.parse('cloudterm://connect?address=10.0.0.8:2222'));

        assert.deepStrictEqual(redeemedWith, [], 'nothing was sent to the account');
        assert.ok(dialogAsked);
        assert.match(dialogAsked.detail, /outside CloudTerm/);
        assert.ok(result.host);
        assert.strictEqual(result.host.port, 2222);
        assert.strictEqual(result.notice, '');
    });

    await check('cancelling the question opens nothing', async () => {
        dialogAnswer = 1;

        const result = await deepLink.resolve(deepLink.parse('cloudterm://connect?address=10.0.0.9'));

        assert.strictEqual(result.host, null);
        assert.strictEqual(result.notice, '');
        dialogAnswer = 0;
    });

    await check('a link with neither a code nor a usable address is an error', async () => {
        const result = await deepLink.resolve(deepLink.parse('cloudterm://connect?address=not%20an%20address'));
        assert.strictEqual(result.host, null);
        assert.strictEqual(result.level, 'error');
        assert.match(result.notice, /no address/);
    });

    /* ---------------- the queue ---------------- */

    await check('a link that arrives before the renderer waits for it, then is delivered once', async () => {
        redeem = async () => ({
            host: '10.0.0.10', port: 22, username: 'root', password: 'pw', passwordStatus: 'ready', name: 'queued',
        });

        const delivered = [];
        deepLink.setNotifier((channel, payload) => delivered.push({ channel, payload }), () => null);
        deepLink.reset();

        await deepLink.open(`cloudterm://connect?code=${GOOD_CODE}`);
        assert.strictEqual(delivered.length, 0, 'held until the renderer is listening');

        deepLink.markReady();
        assert.strictEqual(delivered.length, 1);
        assert.strictEqual(delivered[0].channel, 'deep-link-connect');
        assert.strictEqual(delivered[0].payload.host.name, 'queued');

        deepLink.markReady();
        assert.strictEqual(delivered.length, 1, 'not delivered again');

        await deepLink.open(`cloudterm://connect?code=${GOOD_CODE}`);
        assert.strictEqual(delivered.length, 2, 'delivered straight away once listening');

        deepLink.reset();
        await deepLink.open(`cloudterm://connect?code=${GOOD_CODE}`);
        assert.strictEqual(delivered.length, 2, 'held again after a lock');
        deepLink.markReady();
        assert.strictEqual(delivered.length, 3);
    });

    await check('a link the app does not understand is dropped without reaching the renderer', async () => {
        const delivered = [];
        deepLink.setNotifier((channel, payload) => delivered.push(payload), () => null);
        deepLink.markReady();

        await deepLink.open('cloudterm://format-disk?address=10.0.0.5');
        assert.strictEqual(delivered.length, 0);
    });

    /* ---------------- the store's side of it ---------------- */

    await check('the same address asked for again keeps a login it already has', () => {
        const first = store.openQuickConnect({ host: '10.0.0.11', port: 22, username: 'root', password: 'learned' });
        const again = store.openQuickConnect({ host: '10.0.0.11', port: 22, username: 'root' });
        assert.strictEqual(again.id, first.id, 'one record, not two');
        assert.strictEqual(store.resolveCredentials(again.id).password, 'learned');
    });

    await check('a login that arrives later fills in a record that had none', () => {
        const first = store.openQuickConnect({ host: '10.0.0.12', port: 22, username: 'root' });
        assert.strictEqual(store.resolveCredentials(first.id).promptCredentials, true);
        const again = store.openQuickConnect({ host: '10.0.0.12', port: 22, username: 'root', password: 'now', name: 'named' });
        assert.strictEqual(again.id, first.id);
        assert.strictEqual(again.name, 'named');
        assert.strictEqual(store.resolveCredentials(again.id).password, 'now');
        assert.strictEqual(store.resolveCredentials(again.id).promptCredentials, false);
    });

    await check('locking the app forgets every login a link brought in', () => {
        const host = store.openQuickConnect({ host: '10.0.0.13', port: 22, username: 'root', password: 'gone' });
        store.forgetQuickConnects();
        assert.strictEqual(store.resolveCredentials(host.id), null);
    });

    console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
    fs.rmSync(userData, { recursive: true, force: true });
})();
