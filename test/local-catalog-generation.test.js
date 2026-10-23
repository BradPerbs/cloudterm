const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * A model list that was read before the key changed.
 *
 * `models()` starts a request, and a refresh bypasses the pending-ask dedupe, so
 * two reads can be in flight across a key change: one started under the old
 * credentials, one under the new. Without a generation marker the older one
 * lands last and caches the answer it was given — the models visible without the
 * key, or the `null` a 401 produces — as though it described the server now.
 *
 * The panel then shows a menu that the new key never produced, and an unpinned
 * conversation runs a model chosen from it.
 *
 * `electron` is stubbed so this runs under plain node.
 */

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-catalog-'));

const electronStub = {
    app: {
        getPath: () => userData,
        getVersion: () => '1.0.0',
        on: () => {},
        whenReady: () => new Promise(() => {}),
    },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(`stub:${value}`, 'utf8'),
        decryptString: (buffer) => Buffer.from(buffer).toString('utf8').slice('stub:'.length),
    },
    ipcMain: { handle: () => {}, on: () => {} },
    BrowserWindow: class { static fromWebContents() { return null; } },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const ai = require('../src/main/ai');

/** A JSON answer, as `fetch` would hand it back. */
function jsonResponse(payload) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => payload,
        text: async () => JSON.stringify(payload),
    };
}

/** Waits until `fetch` has actually been called, rather than guessing. */
async function untilCalled(state) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (state.calls > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the request was never made');
}

async function run() {
    const state = { calls: 0 };
    let release;
    const held = new Promise((resolve) => { release = resolve; });

    global.fetch = async () => {
        state.calls += 1;
        return held;
    };

    // A read starts under the credentials in force now...
    const stale = ai.models({ provider: 'local' });
    await untilCalled(state);

    // ...and the key changes while it is still in flight.
    ai.setLocalKey('sk-changed-mid-flight');

    release(jsonResponse({ data: [{ id: 'stale-model' }] }));
    const answer = await stale;

    assert.strictEqual(answer?.[0]?.value, 'stale-model',
        'the caller is still answered — it asked a question and something replied');
    assert.strictEqual(ai.status().catalogs.local, undefined,
        'but that answer is not cached as this server\'s catalogue');

    // A read that nothing superseded is cached, as it always was.
    state.calls = 0;
    global.fetch = async () => {
        state.calls += 1;
        return jsonResponse({ data: [{ id: 'fresh-model' }] });
    };

    const fresh = await ai.models({ provider: 'local', refresh: true });
    assert.strictEqual(fresh?.[0]?.value, 'fresh-model');
    assert.strictEqual(ai.status().catalogs.local?.[0]?.value, 'fresh-model',
        'a current read is kept');

    console.log('catalog generation tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
