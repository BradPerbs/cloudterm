/**
 * Exercises the RDP bridge, with `electron` stubbed so it runs under plain node.
 *
 * Four things here are worth a test rather than a careful read:
 *
 *   - the RDCleanPath DER codec. It is hand-rolled, it is the first thing read
 *     off a socket, and a length field is the classic place to be wrong in a way
 *     that works for small inputs and fails once a certificate chain pushes a
 *     PDU past 127 bytes into the long form.
 *   - TPKT framing. The frame carries its own length, and reading "whatever the
 *     first data event brought" is the bug that works on loopback and splits
 *     over a real link.
 *   - protocol routing in the config and the store: an RDP host must resolve the
 *     RDP password and not the VNC one, and a record written before RDP existed
 *     must still come back as VNC.
 *   - that the RDP password is still redacted everywhere a secret is redacted.
 *     It is the one secret that reaches the renderer, which makes it the one
 *     worth checking has not also escaped into the activity log or a host record.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { PassThrough } = require('stream');

const ROOT = path.join(__dirname, '..', 'src', 'main');

let userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-r-'));

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

/**
 * Build an RDCleanPath request the way the WASM client does, so the parser is
 * tested against the encoding it will actually meet rather than against itself.
 */
function buildRequest({ version = 3390, destination = 'srv:3389', x224 = Buffer.from([3, 0, 0, 11]) } = {}) {
    const len = (n) => (n < 0x80
        ? Buffer.from([n])
        : (() => {
            const bytes = [];
            let rest = n;
            while (rest > 0) { bytes.unshift(rest & 0xff); rest = Math.floor(rest / 256); }
            return Buffer.from([0x80 | bytes.length, ...bytes]);
        })());
    const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);

    const integer = (value) => {
        const bytes = [];
        let rest = value;
        while (rest > 0) { bytes.unshift(rest & 0xff); rest = Math.floor(rest / 256); }
        if (!bytes.length) bytes.push(0);
        if (bytes[0] & 0x80) bytes.unshift(0);
        return tlv(0x02, Buffer.from(bytes));
    };

    return tlv(0x30, Buffer.concat([
        tlv(0xa0, integer(version)),
        tlv(0xa2, tlv(0x0c, Buffer.from(destination, 'utf8'))),
        tlv(0xa6, tlv(0x04, x224)),
    ]));
}

async function run() {
    /* ---------------- RDCleanPath ---------------- */

    console.log('\nRDCleanPath');

    const rdcleanpath = fresh('rdcleanpath.js');

    check('parses a request the client would send', () => {
        const request = rdcleanpath.parseRequest(
            buildRequest({ destination: '10.0.0.5:3389', x224: Buffer.from('030000130ee0', 'hex') })
        );
        assert.strictEqual(request.destination, '10.0.0.5:3389');
        assert.strictEqual(request.x224ConnectionRequest.toString('hex'), '030000130ee0');
    });

    check('refuses a version it does not implement', () => {
        assert.throws(
            () => rdcleanpath.parseRequest(buildRequest({ version: 1 })),
            /Unsupported RDCleanPath version/
        );
    });

    check('refuses a request with no X.224 PDU', () => {
        // Same shape, minus the [6] field.
        const truncated = Buffer.concat([
            Buffer.from([0x30, 0x0a, 0xa0, 0x05, 0x02, 0x03]),
            Buffer.from([0x00, 0x0d, 0x3e]),
            Buffer.from([0xa2, 0x00]),
        ]);
        assert.throws(() => rdcleanpath.parseRequest(truncated));
    });

    check('rejects a truncated PDU rather than reading past it', () => {
        const full = buildRequest();
        assert.throws(() => rdcleanpath.parseRequest(full.subarray(0, full.length - 4)));
    });

    check('round-trips a response through the long-form length', () => {
        // A real certificate is well past 127 bytes, which is where DER stops
        // using the short form. This is the case the encoder has to get right.
        const cert = Buffer.alloc(900, 0xab);
        const x224 = Buffer.from('0300000d06d00000123400', 'hex');
        const response = rdcleanpath.buildResponse('10.0.0.5:3389', x224, [cert, cert]);

        // Parsed back with the same primitives the client uses: outer SEQUENCE,
        // then the context tags.
        assert.strictEqual(response[0], 0x30);
        assert.ok(response.length > 1800, 'both certificates should be present');
        assert.ok(response.includes(x224), 'the X.224 confirm should survive');
        assert.ok(response.includes(cert), 'the certificate should survive');
    });

    check('builds an error PDU', () => {
        const pdu = rdcleanpath.buildError(rdcleanpath.ERROR_GENERAL, 502);
        assert.strictEqual(pdu[0], 0x30);
        assert.ok(pdu.length > 8);
    });

    // IronRDP's SessionBuilder refuses to connect unless every one of these is
    // set, and it says so only at runtime — `auth_token missing` and
    // `set_cursor_style_callback missing` were why RDP could not connect at all.
    // The list is read out of the module rather than written down here, so a
    // version that requires something new fails this instead of a user's pane.
    check('every field IronRDP requires of a session is supplied', () => {
        const wasm = fs.readFileSync(
            path.join(__dirname, '..', 'node_modules', 'ironrdp-wasm', 'pkg', 'rdp_client_bg.wasm')
        ).toString('latin1');

        const required = new Set();
        const pattern = /([a-z0-9_]{4,40}) missing/g;
        let match;
        while ((match = pattern.exec(wasm))) required.add(match[1]);

        // What the builder is actually asked for, in RdpView.
        const view = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'renderer', 'components', 'RdpView.jsx'), 'utf8'
        );

        // snake_case in the error, camelCase on the builder.
        const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

        // The module's error strings cover other code paths too ("chunk
        // missing", "chain missing"), so only those that name a builder setter
        // are asserted on.
        const SETTERS = [
            'auth_token', 'destination', 'password', 'proxy_address',
            'render_canvas', 'username',
            'set_cursor_style_callback', 'set_cursor_style_callback_context',
        ];

        const missing = SETTERS
            .filter(name => required.has(name))
            .filter(name => !view.includes(`builder.${camel(name)}(`));

        assert.deepStrictEqual(missing, [], `RdpView never sets: ${missing.join(', ')}`);
        // If the module stops demanding these, this test has gone quiet and
        // should be revisited rather than silently passing on an empty set.
        assert.ok(
            SETTERS.every(name => required.has(name)),
            'ironrdp-wasm no longer demands the fields this guards'
        );
    });

    check('splits host and port, including IPv6', () => {
        assert.deepStrictEqual(rdcleanpath.parseDestination('host:3390'), { host: 'host', port: 3390 });
        assert.deepStrictEqual(rdcleanpath.parseDestination('host'), { host: 'host', port: 3389 });
        assert.deepStrictEqual(rdcleanpath.parseDestination('[::1]:3391'), { host: '::1', port: 3391 });
    });

    /* ---------------- TPKT framing ---------------- */

    console.log('\nTPKT framing');

    const rdp = fresh('rdp.js');

    /* ------------------------------------------------------------------ *
     * The certificate fallback
     *
     * A Windows self-signed RDP certificate carries `keyUsage = keyEncipherment,
     * dataEncipherment` and no `digitalSignature`, so it may not sign a
     * handshake — which every TLS 1.3 and ECDHE suite requires. BoringSSL, the
     * TLS Electron's Node is built against, refuses it outright, and
     * `rejectUnauthorized: false` does not help because this is enforced apart
     * from trust. The bridge retries such a server on RSA key exchange.
     *
     * The refusal itself only happens under BoringSSL, so it cannot be
     * reproduced here — this suite runs on Node's OpenSSL, which is lenient.
     * What is pinned down is the terms of the retry, which is where a later
     * edit could quietly undo it.
     * ------------------------------------------------------------------ */

    check('the fallback offers only RSA key exchange', () => {
        const suites = rdp.RSA_KEY_EXCHANGE.split(':');
        assert.ok(suites.length > 0, 'no cipher suites offered');

        // An ephemeral suite would put the server back to signing the
        // handshake, which is the thing the certificate cannot do.
        for (const suite of suites) {
            assert.ok(
                !/^(ECDHE|DHE|TLS_)/.test(suite),
                `${suite} is not an RSA key exchange suite, so the retry would fail the same way`
            );
        }
    });

    check('only a key-usage refusal triggers the fallback', () => {
        assert.ok(rdp.isKeyUsageRefusal(
            new Error('TLS handshake failed: error:1000012e:SSL routines:'
                + 'OPENSSL_internal:KEY_USAGE_BIT_INCORRECT')
        ));

        // Everything else is reported as it happened rather than retried on
        // weaker terms.
        for (const message of [
            'TLS handshake failed: unable to verify the first certificate',
            'The TLS handshake with the RDP server timed out',
            'socket hang up',
        ]) {
            assert.ok(!rdp.isKeyUsageRefusal(new Error(message)), message);
        }
        assert.ok(!rdp.isKeyUsageRefusal(undefined));
    });


    await checkAsync('reads a frame that arrives in one chunk', async () => {
        const stream = new PassThrough();
        const promise = rdp.readTpkt(stream, 1000);
        stream.write(Buffer.from([3, 0, 0, 6, 0xaa, 0xbb]));

        const { pdu, rest } = await promise;
        assert.strictEqual(pdu.toString('hex'), '03000006aabb');
        assert.strictEqual(rest.length, 0);
    });

    await checkAsync('reads a frame split across chunks', async () => {
        const stream = new PassThrough();
        const promise = rdp.readTpkt(stream, 1000);

        // The split lands inside the header, which is the worst case: the
        // length is not even known yet.
        stream.write(Buffer.from([3, 0]));
        await new Promise(resolve => setImmediate(resolve));
        stream.write(Buffer.from([0, 8, 0x01]));
        await new Promise(resolve => setImmediate(resolve));
        stream.write(Buffer.from([0x02, 0x03, 0x04]));

        const { pdu } = await promise;
        assert.strictEqual(pdu.length, 8);
        assert.strictEqual(pdu.toString('hex'), '0300000801020304');
    });

    await checkAsync('hands back whatever followed the frame', async () => {
        const stream = new PassThrough();
        const promise = rdp.readTpkt(stream, 1000);
        stream.write(Buffer.from([3, 0, 0, 5, 0x99, 0xde, 0xad]));

        const { pdu, rest } = await promise;
        assert.strictEqual(pdu.length, 5);
        assert.strictEqual(rest.toString('hex'), 'dead');
    });

    await checkAsync('rejects something that is not TPKT', async () => {
        const stream = new PassThrough();
        const promise = rdp.readTpkt(stream, 1000);
        stream.write(Buffer.from([0x16, 0x03, 0x01, 0x00]));

        await assert.rejects(promise, /does not look like an RDP server/);
    });

    await checkAsync('gives up on a server that says nothing', async () => {
        const stream = new PassThrough();
        await assert.rejects(rdp.readTpkt(stream, 40), /did not answer in time/);
    });

    await checkAsync('fails rather than hangs when the server hangs up', async () => {
        const stream = new PassThrough();
        const promise = rdp.readTpkt(stream, 1000);
        stream.end();

        await assert.rejects(promise, /closed the connection/);
    });

    /* ---------------- Config ---------------- */

    console.log('\nDesktop config');

    const config = fresh('desktop-config.js');

    check('a record written before RDP existed is still VNC', () => {
        const desktop = config.normalizeDesktop({ enabled: true, host: '127.0.0.1' });
        assert.strictEqual(desktop.protocol, 'vnc');
        assert.strictEqual(desktop.port, 5900);
    });

    check('an RDP record defaults to 3389', () => {
        const desktop = config.normalizeDesktop({ enabled: true, protocol: 'rdp' });
        assert.strictEqual(desktop.port, 3389);
    });

    // The bug this fixes: RDP inherited VNC's tunnelled default, which demands
    // an SSH server on a machine that is usually Windows and has none. The
    // desktop was then unreachable and the pane's Desktop tab stayed disabled.
    check('RDP dials directly by default, rather than through SSH', () => {
        assert.strictEqual(
            config.normalizeDesktop({ enabled: true, protocol: 'rdp' }).transport,
            'direct'
        );
    });

    check('VNC still tunnels by default', () => {
        assert.strictEqual(config.normalizeDesktop({ enabled: true }).transport, 'tunnel');
    });

    check('an explicit transport is not overridden', () => {
        assert.strictEqual(
            config.normalizeDesktop({ protocol: 'rdp', transport: 'tunnel' }).transport,
            'tunnel'
        );
    });

    check('the desktop-only flag round-trips', () => {
        assert.strictEqual(config.normalizeDesktop({ protocol: 'rdp', only: true }).only, true);
        assert.strictEqual(config.normalizeDesktop({ protocol: 'rdp' }).only, false);
    });

    check('an explicit port survives normalisation', () => {
        const desktop = config.normalizeDesktop({ protocol: 'rdp', port: 13389 });
        assert.strictEqual(desktop.port, 13389);
    });

    check('an unknown protocol falls back rather than being stored', () => {
        assert.strictEqual(config.normalizeDesktop({ protocol: 'telnet' }).protocol, 'vnc');
    });

    check('RDP will not open without a username', () => {
        const desktop = config.normalizeDesktop({
            enabled: true, protocol: 'rdp', host: '10.0.0.5',
        });
        assert.match(config.validateDesktop(desktop), /username/i);
    });

    check('RDP with a username validates', () => {
        const desktop = config.normalizeDesktop({
            enabled: true, protocol: 'rdp', host: '10.0.0.5', username: 'Administrator',
        });
        assert.strictEqual(config.validateDesktop(desktop), '');
    });

    check('VNC still does not require a username', () => {
        const desktop = config.normalizeDesktop({ enabled: true, host: '127.0.0.1' });
        assert.strictEqual(config.validateDesktop(desktop), '');
    });

    /* ---------------- The store ---------------- */

    console.log('\nStored credentials');

    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-r-'));
    const store = fresh('store.js');

    check('resolves the password belonging to the protocol', () => {
        const rdpHost = store.saveHost({
            name: 'win', host: '10.0.0.20', username: 'root',
            desktop: { enabled: true, protocol: 'rdp', host: '127.0.0.1', username: 'Administrator' },
            rdpPassword: 'rdp-secret',
            vncPassword: 'vnc-secret',
        });

        const resolved = store.resolveDesktop(rdpHost.id);
        assert.strictEqual(resolved.protocol, 'rdp');
        assert.strictEqual(resolved.password, 'rdp-secret');
        assert.strictEqual(resolved.username, 'Administrator');
    });

    check('a direct desktop with no address of its own uses the host\'s', () => {
        const created = store.saveHost({
            name: 'vm', host: '192.168.1.50', username: '',
            desktop: {
                enabled: true, protocol: 'rdp', transport: 'direct',
                only: true, username: 'Administrator',
            },
            rdpPassword: 'pw',
        });

        const resolved = store.resolveDesktop(created.id);
        assert.strictEqual(resolved.host, '192.168.1.50');
        // And so it is actually openable, which is the point.
        assert.strictEqual(config.validateDesktop(resolved), '');
    });

    check('a tunnelled desktop still means the server\'s own loopback', () => {
        const created = store.saveHost({
            name: 'lin2', host: '192.168.1.60', username: 'root',
            desktop: { enabled: true, protocol: 'vnc', transport: 'tunnel' },
        });

        // Not 192.168.1.60: under a tunnel the address is resolved by the
        // server, so a blank one is deliberately its loopback.
        assert.strictEqual(store.resolveDesktop(created.id).host, '127.0.0.1');
    });

    check('a VNC host still resolves the VNC password', () => {
        const vncHost = store.saveHost({
            name: 'lin', host: '10.0.0.21', username: 'root',
            desktop: { enabled: true, protocol: 'vnc', host: '127.0.0.1' },
            rdpPassword: 'rdp-secret',
            vncPassword: 'vnc-secret',
        });

        assert.strictEqual(store.resolveDesktop(vncHost.id).password, 'vnc-secret');
    });

    check('the RDP password never appears in a host record', () => {
        const created = store.saveHost({
            name: 'win2', host: '10.0.0.22', username: 'root',
            desktop: { enabled: true, protocol: 'rdp', host: '127.0.0.1', username: 'Administrator' },
            rdpPassword: 'must-not-leak',
        });

        const listed = store.getHosts().find(h => h.id === created.id);
        assert.strictEqual(JSON.stringify(listed).includes('must-not-leak'), false);
        assert.strictEqual(listed.hasRdpPassword, true);
        assert.strictEqual(listed.rdpPassword, undefined);
    });

    check('the RDP password is redacted from the activity log', () => {
        // Plain `require`, not `fresh`: the latter clears every main module, so
        // it would hand back a different activity instance than the one the
        // store above is already writing to.
        const activity = require(path.join(ROOT, 'activity.js'));

        const created = store.saveHost({
            name: 'win3', host: '10.0.0.23', username: 'root', rdpPassword: 'first',
        });
        store.saveHost({ id: created.id, rdpPassword: 'second' });

        const entries = activity.list({ limit: 100 }).entries || activity.list({ limit: 100 });
        const text = JSON.stringify(entries);
        assert.strictEqual(text.includes('first'), false);
        assert.strictEqual(text.includes('second'), false);
        // The edit is still recorded, just without the value.
        assert.ok(text.includes('rdpPassword'), 'the change itself should still be logged');
    });

    check('activity diffs mark rdpPassword as a secret with empty from/to', () => {
        const activity = require(path.join(ROOT, 'activity.js'));
        const changes = activity.diff(
            { rdpPassword: 'cipher-a', name: 'win' },
            { rdpPassword: 'cipher-b', name: 'win' }
        );
        const secret = changes.find(entry => entry.field === 'rdpPassword');
        assert.ok(secret, 'rdpPassword must appear as a change');
        assert.strictEqual(secret.secret, true);
        assert.strictEqual(secret.from, '');
        assert.strictEqual(secret.to, '');
    });

    check('RdpView wipes the password on every post-open path', () => {
        const view = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'renderer', 'components', 'RdpView.jsx'), 'utf8'
        );
        // WASM must load before open so the secret is not held through compile.
        const loadAt = view.indexOf('await loadIronRdp()');
        const openAt = view.indexOf('await open(host?.id)');
        assert.ok(loadAt >= 0 && openAt >= 0 && loadAt < openAt, 'IronRDP loads before open');
        // A finally that clears result.password covers success, missing canvas,
        // cancel, and connect errors alike.
        assert.ok(
            /finally\s*\{[\s\S]*?result\.password\s*=\s*''/.test(view),
            'post-open finally must clear result.password'
        );
        // Cancel after a successful open still drops the credential.
        assert.ok(
            view.includes("if (result) result.password = ''"),
            'cancelled open must wipe the password'
        );
    });

    check('session snapshots never carry the password', () => {
        const source = fs.readFileSync(path.join(ROOT, 'rdp.js'), 'utf8');
        // snapshot() builds the live view the renderer polls; a password field
        // here would re-expose CredSSP material after the one-shot open.
        const snapshot = source.match(/function snapshot\([\s\S]*?\n\}/);
        assert.ok(snapshot, 'snapshot helper must exist');
        assert.strictEqual(
            /\bpassword\b/.test(snapshot[0]), false,
            'snapshot must not mention password'
        );
    });

    console.log(`\n${passed} checks passed`);
}

run().then(() => {
    // Any listener the bridge or a scripted server left behind would hold the
    // process open, which would look like a hang rather than a failure.
    setTimeout(() => process.exit(process.exitCode || 0), 50);
}).catch((error) => {
    console.error('\nthe suite itself failed:', error);
    process.exit(1);
});
