/**
 * Exercises the remote-desktop bridge, with `electron` stubbed so it runs under
 * plain node.
 *
 * Three things here are worth a test rather than a careful read:
 *
 *   - the DES. It is hand-rolled because OpenSSL 3 dropped `des-ecb` from the
 *     default provider, and a wrong DES fails in exactly one way: every server
 *     says "bad password". Checked against the published FIPS vectors, not
 *     against another implementation of the same guesswork.
 *   - the RFB handshake, against a scripted server. Short reads and version
 *     branches are the classic place for a protocol to work on loopback and
 *     fail over a real link.
 *   - that the VNC password stays in the main process. That is the reason the
 *     handshake happens there at all, so it is asserted rather than assumed.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');

let userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-v-'));

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

/* ---------------- DES ---------------- */

console.log('\nVNC authentication (DES)');

const vncAuth = fresh('vnc-auth.js');

check('matches the published DES worked example', () => {
    const out = vncAuth.encrypt(
        Buffer.from('133457799BBCDFF1', 'hex'),
        Buffer.from('0123456789ABCDEF', 'hex')
    );
    assert.strictEqual(out.toString('hex').toUpperCase(), '85E813540F0AB405');
});

check('matches a FIPS 46-3 known-answer vector', () => {
    const out = vncAuth.encrypt(
        Buffer.from('0101010101010101', 'hex'),
        Buffer.from('95F8A5E5DD31D900', 'hex')
    );
    assert.strictEqual(out.toString('hex').toUpperCase(), '8000000000000000');
});

check('encrypts each block independently (ECB)', () => {
    const key = Buffer.from('133457799BBCDFF1', 'hex');
    const block = Buffer.from('0123456789ABCDEF', 'hex');
    const doubled = vncAuth.encrypt(key, Buffer.concat([block, block]));
    assert.strictEqual(
        doubled.subarray(0, 8).toString('hex'),
        doubled.subarray(8).toString('hex')
    );
});

check('reverses the bits of every key byte', () => {
    // 'a' is 0x61 = 0b0110_0001; reversed it is 0b1000_0110 = 0x86.
    assert.strictEqual(vncAuth.keyFromPassword('a').toString('hex'), '8600000000000000');
});

check('pads a short password with zeros and truncates a long one', () => {
    assert.strictEqual(vncAuth.keyFromPassword('').toString('hex'), '0000000000000000');
    const long = vncAuth.keyFromPassword('123456789abcdef');
    assert.strictEqual(long.length, 8);
    // The 9th character must not have reached the key.
    assert.deepStrictEqual(long, vncAuth.keyFromPassword('12345678'));
});

check('answers a challenge with 16 bytes', () => {
    const response = vncAuth.respond('secret', Buffer.alloc(16, 7));
    assert.strictEqual(response.length, 16);
    assert.notDeepStrictEqual(response, Buffer.alloc(16, 7));
});

check('refuses a challenge that is not 16 bytes', () => {
    assert.throws(() => vncAuth.respond('secret', Buffer.alloc(8)), /16 bytes/);
});

/* ---------------- desktop config ---------------- */

console.log('\ndesktop config');

const desktopConfig = fresh('desktop-config.js');

check('defaults to a tunnelled desktop on the server loopback', () => {
    const desktop = desktopConfig.normalizeDesktop({ enabled: true });
    assert.strictEqual(desktop.transport, 'tunnel');
    assert.strictEqual(desktop.host, '127.0.0.1');
    assert.strictEqual(desktop.port, 5900);
    assert.strictEqual(desktop.shared, true);
});

check('leaves a direct desktop with no address rather than inventing one', () => {
    const desktop = desktopConfig.normalizeDesktop({ enabled: true, transport: 'direct' });
    assert.strictEqual(desktop.host, '');
    assert.strictEqual(desktopConfig.validateDesktop(desktop), 'A VNC address is required');
});

check('rejects a nonsense transport, port and scaling mode', () => {
    const desktop = desktopConfig.normalizeDesktop({
        enabled: true,
        transport: 'telepathy',
        port: 99999,
        scaling: 'sideways',
        quality: 42,
    });
    assert.strictEqual(desktop.transport, 'tunnel');
    assert.strictEqual(desktop.port, 5900);
    assert.strictEqual(desktop.scaling, 'fit');
    assert.strictEqual(desktop.quality, 6);
});

check('normalises absent and disabled to the same thing', () => {
    assert.deepStrictEqual(
        desktopConfig.normalizeDesktop(undefined),
        desktopConfig.normalizeDesktop({ enabled: false })
    );
});

check('will not open a desktop that is not enabled', () => {
    const desktop = desktopConfig.normalizeDesktop({ host: '10.0.0.5', port: 5901 });
    assert.match(desktopConfig.validateDesktop(desktop), /not enabled/);
});

/* ---------------- security type choice ---------------- */

console.log('\nsecurity negotiation');

const vnc = fresh('vnc.js');

check('prefers VNC authentication when a password is configured', () => {
    assert.strictEqual(vnc.chooseSecurity([1, 2], true), 2);
});

check('takes None when there is no password to send', () => {
    assert.strictEqual(vnc.chooseSecurity([1, 2], false), 1);
});

check('asks for a password when that is the only thing missing', () => {
    assert.throws(
        () => vnc.chooseSecurity([2], false),
        (error) => error.needsPassword === true && /requires a password/.test(error.message)
    );
});

check('names what it could not use', () => {
    assert.throws(() => vnc.chooseSecurity([19, 30], true), /VeNCrypt.*Apple Remote Desktop/);
});

check('reads a version banner and clamps it to what it implements', () => {
    assert.strictEqual(vnc.parseVersion(Buffer.from('RFB 003.008\n')), 8);
    assert.strictEqual(vnc.parseVersion(Buffer.from('RFB 003.007\n')), 7);
    // 3.4 and 3.6 exist in the wild and mean 3.3.
    assert.strictEqual(vnc.parseVersion(Buffer.from('RFB 003.004\n')), 3);
    assert.strictEqual(vnc.parseVersion(Buffer.from('RFB 003.889\n')), 8);
});

check('refuses something that is not a VNC server', () => {
    assert.throws(() => vnc.parseVersion(Buffer.from('SSH-2.0-Open')), /does not look like/);
    assert.throws(() => vnc.parseVersion(Buffer.from('RFB 004.000\n')), /major version 4/);
});

/* ---------------- a scripted RFB server ---------------- */

/**
 * Enough of a VNC server to complete a handshake and then say something.
 *
 * `MARKER` stands in for ServerInit: it is what proves the stream was handed
 * over intact rather than merely authenticated.
 */
const MARKER = Buffer.from('SERVER-INIT-WOULD-BE-HERE');

function scriptedServer({ version = '003.008', types = [2], password = 'secret' } = {}) {
    const state = { challenge: null, clientInit: null, response: null };

    const server = net.createServer((socket) => {
        const reader = new vnc.Reader(socket);

        (async () => {
            socket.write(Buffer.from(`RFB ${version}\n`, 'latin1'));
            await reader.read(12);

            let chosen;
            const minor = Number(version.split('.')[1]);

            if (minor >= 7) {
                socket.write(Buffer.from([types.length, ...types]));
                chosen = (await reader.read(1))[0];
            } else {
                socket.write(Buffer.from([0, 0, 0, types[0]]));
                chosen = types[0];
            }

            let ok = true;
            if (chosen === 2) {
                state.challenge = Buffer.alloc(16, 0x5a);
                socket.write(state.challenge);
                state.response = await reader.read(16);
                ok = state.response.equals(vncAuth.respond(password, state.challenge));
            }

            if (!(chosen === 1 && minor < 8)) {
                socket.write(ok ? Buffer.alloc(4) : Buffer.from([0, 0, 0, 1]));
                if (!ok && minor >= 8) {
                    const reason = Buffer.from('Authentication failure', 'utf8');
                    const header = Buffer.alloc(4);
                    header.writeUInt32BE(reason.length, 0);
                    socket.write(Buffer.concat([header, reason]));
                }
            }
            if (!ok) {
                socket.end();
                return;
            }

            // Past the handshake: wait for ClientInit, then answer, exactly as a
            // real server would.
            state.clientInit = await reader.read(1);
            socket.write(MARKER);
        })().catch(() => socket.destroy());
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ port: server.address().port, server, state });
        });
    });
}

/** Drive the client half of the handshake against a stream. */
async function clientHandshake(stream, password) {
    const reader = new vnc.Reader(stream);
    const result = await vnc.negotiateWithServer(reader, stream, password);
    return { result, reader };
}

async function run() {
    console.log('\nhandshake against a scripted server');

    await checkAsync('completes VNC password authentication on 3.8', async () => {
        const { port, server, state } = await scriptedServer({ password: 'hunter2' });
        const socket = net.connect(port, '127.0.0.1');
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('error', reject);
        });

        const { result } = await clientHandshake(socket, 'hunter2');
        assert.strictEqual(result.chosen, 2);
        assert.strictEqual(result.version, 8);
        // The response has to be the DES of the challenge, not the password.
        assert.ok(state.response && !state.response.includes(Buffer.from('hunter2')));

        socket.destroy();
        server.close();
    });

    await checkAsync('reports a rejected password as an auth failure', async () => {
        const { port, server } = await scriptedServer({ password: 'right' });
        const socket = net.connect(port, '127.0.0.1');
        await new Promise((resolve) => socket.once('connect', resolve));

        await assert.rejects(
            clientHandshake(socket, 'wrong'),
            (error) => error.authFailed === true && /Authentication failure/.test(error.message)
        );

        socket.destroy();
        server.close();
    });

    await checkAsync('completes a passwordless 3.3 handshake with no SecurityResult', async () => {
        const { port, server } = await scriptedServer({ version: '003.003', types: [1] });
        const socket = net.connect(port, '127.0.0.1');
        await new Promise((resolve) => socket.once('connect', resolve));

        const { result } = await clientHandshake(socket, '');
        assert.strictEqual(result.version, 3);
        assert.strictEqual(result.chosen, 1);

        socket.destroy();
        server.close();
    });

    await checkAsync('gives up on a server that offers nothing it can use', async () => {
        const { port, server } = await scriptedServer({ types: [19] });
        const socket = net.connect(port, '127.0.0.1');
        await new Promise((resolve) => socket.once('connect', resolve));

        await assert.rejects(clientHandshake(socket, 'secret'), /VeNCrypt/);

        socket.destroy();
        server.close();
    });

    /* ---------------- end to end ---------------- */

    console.log('\nthe bridge, end to end');

    const store = fresh('store.js');
    // vnc.js and store.js have to be the same instances the bridge uses, so the
    // module cache is not cleared again between here and the end of the file.
    const bridge = require(path.join(ROOT, 'vnc.js'));
    const WebSocket = require('ws');

    bridge.setNotifier(() => {});

    await checkAsync('authenticates in main and hands the renderer a clean stream', async () => {
        const { port, server, state } = await scriptedServer({ password: 'topsecret' });

        const host = store.saveHost({
            name: 'desktop box',
            host: '127.0.0.1',
            username: 'root',
            vncPassword: 'topsecret',
            desktop: {
                enabled: true,
                transport: 'direct',
                host: '127.0.0.1',
                port,
            },
        });

        // The password must not have come back over the (notional) bridge.
        assert.strictEqual(host.vncPassword, undefined);
        assert.strictEqual(host.hasVncPassword, true);

        const opened = await bridge.open('pane-e2e', host.id);
        assert.ok(opened.success, `open failed: ${opened.message}`);
        assert.match(opened.url, /^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
        // Nothing secret is in what the renderer is given.
        assert.strictEqual(JSON.stringify(opened).includes('topsecret'), false);

        const ws = new WebSocket(opened.url);
        ws.binaryType = 'nodebuffer';

        // Collect frames, and serve fixed-size reads out of them.
        let inbox = Buffer.alloc(0);
        let waiter = null;
        ws.on('message', (data) => {
            inbox = Buffer.concat([inbox, Buffer.from(data)]);
            if (waiter && inbox.length >= waiter.want) {
                const { want, resolve } = waiter;
                waiter = null;
                const taken = inbox.subarray(0, want);
                inbox = inbox.subarray(want);
                resolve(taken);
            }
        });
        const expect = (want) => new Promise((resolve) => {
            if (inbox.length >= want) {
                const taken = inbox.subarray(0, want);
                inbox = inbox.subarray(want);
                resolve(taken);
                return;
            }
            waiter = { want, resolve };
        });

        await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        });

        // The bridge should be offering a plain 3.8 "no authentication" session.
        assert.strictEqual((await expect(12)).toString('latin1'), 'RFB 003.008\n');
        ws.send(Buffer.from('RFB 003.008\n', 'latin1'));

        assert.deepStrictEqual([...(await expect(2))], [1, 1], 'expected one security type: None');
        ws.send(Buffer.from([1]));

        assert.deepStrictEqual([...(await expect(4))], [0, 0, 0, 0], 'expected SecurityResult OK');

        // From here it is a transparent pipe in both directions.
        ws.send(Buffer.from([1])); // ClientInit, shared
        const init = await expect(MARKER.length);
        assert.strictEqual(init.toString(), MARKER.toString());
        assert.deepStrictEqual(state.clientInit, Buffer.from([1]), 'ClientInit did not reach the server');

        const live = bridge.get('pane-e2e');
        assert.strictEqual(live.state, 'active');
        assert.ok(live.bytesDown >= MARKER.length);
        // The snapshot the renderer reads must not carry the password either.
        assert.strictEqual(JSON.stringify(live).includes('topsecret'), false);

        ws.close();
        bridge.close('pane-e2e');
        assert.strictEqual(bridge.get('pane-e2e'), null);
        server.close();
    });

    await checkAsync('refuses a viewer that does not know the token', async () => {
        const { port, server } = await scriptedServer({ types: [1] });

        const host = store.saveHost({
            name: 'no auth box',
            host: '127.0.0.1',
            username: 'root',
            desktop: { enabled: true, transport: 'direct', host: '127.0.0.1', port },
        });

        const opened = await bridge.open('pane-token', host.id);
        assert.ok(opened.success, `open failed: ${opened.message}`);

        const wrong = opened.url.replace(/\/[0-9a-f]{32}$/, `/${'0'.repeat(32)}`);
        await assert.rejects(
            new Promise((resolve, reject) => {
                const ws = new WebSocket(wrong);
                ws.once('open', () => { ws.close(); resolve(); });
                ws.once('error', reject);
            }),
            /Unexpected server response/
        );

        bridge.close('pane-token');
        server.close();
    });

    await checkAsync('reports a refused port instead of hanging', async () => {
        // Port 1 on loopback: nothing is listening and nothing can be.
        const host = store.saveHost({
            name: 'nothing there',
            host: '127.0.0.1',
            username: 'root',
            desktop: { enabled: true, transport: 'direct', host: '127.0.0.1', port: 1 },
        });

        const opened = await bridge.open('pane-refused', host.id);
        assert.strictEqual(opened.success, false);
        assert.match(opened.message, /127\.0\.0\.1:1/);
        bridge.close('pane-refused');
    });

    await checkAsync('will not open a desktop for a host that has none', async () => {
        const host = store.saveHost({ name: 'shell only', host: '127.0.0.1', username: 'root' });
        const opened = await bridge.open('pane-none', host.id);
        assert.strictEqual(opened.success, false);
        assert.match(opened.message, /not enabled/);
    });

    /* ---------------- the password stays put ---------------- */

    console.log('\nsecret handling');

    await checkAsync('keeps the VNC password out of the renderer and in the backup', async () => {
        const host = store.saveHost({
            name: 'secret box',
            host: '10.0.0.9',
            username: 'root',
            vncPassword: 'vnc-pass',
            desktop: { enabled: true, transport: 'tunnel', host: '127.0.0.1', port: 5901 },
        });

        // Redacted on the way out.
        const listed = store.getHosts().find(entry => entry.id === host.id);
        assert.strictEqual(listed.vncPassword, undefined);
        assert.strictEqual(listed.hasVncPassword, true);

        // Encrypted at rest.
        const onDisk = fs.readFileSync(path.join(userData, 'sessions.json'), 'utf8');
        assert.strictEqual(onDisk.includes('vnc-pass'), false);

        // Available to the bridge, which is the whole point.
        const resolved = store.resolveDesktop(host.id);
        assert.strictEqual(resolved.password, 'vnc-pass');
        assert.strictEqual(resolved.port, 5901);

        // Present in a backup, so restoring one does not produce a desktop that
        // cannot log in.
        const exported = store.exportAll();
        const backedUp = exported.hosts.find(entry => entry.id === host.id);
        assert.strictEqual(backedUp.vncPassword, 'vnc-pass');
    });

    await checkAsync('keeps the stored password when a save omits it', async () => {
        const created = store.saveHost({
            name: 'keeper',
            host: '10.0.0.10',
            username: 'root',
            vncPassword: 'original',
        });

        store.saveHost({ id: created.id, name: 'keeper renamed' });
        assert.strictEqual(store.resolveDesktop(created.id).password, 'original');

        // Explicit null is how the editor asks for it to be removed.
        store.saveHost({ id: created.id, vncPassword: null });
        assert.strictEqual(store.resolveDesktop(created.id).password, '');
    });

    await checkAsync('never records the password in the activity log', async () => {
        const activity = require(path.join(ROOT, 'activity.js'));
        const created = store.saveHost({
            name: 'logged',
            host: '10.0.0.11',
            username: 'root',
            vncPassword: 'first',
        });
        store.saveHost({ id: created.id, vncPassword: 'second' });

        const entries = activity.list({ limit: 100 }).entries || activity.list({ limit: 100 });
        const text = JSON.stringify(entries);
        assert.strictEqual(text.includes('first'), false);
        assert.strictEqual(text.includes('second'), false);
        // The edit is still recorded, just without the value.
        assert.ok(text.includes('vncPassword'), 'the change itself should still be logged');
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
