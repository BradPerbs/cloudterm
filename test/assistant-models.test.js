/**
 * Reading an agent's model list again.
 *
 * The model menu's refresh asks every agent that is switched on, and a re-read
 * that failed used to drop the list that agent already had, so one runtime
 * that was slow to answer emptied a menu that was working a moment before.
 *
 * `electron` is stubbed so it runs under plain node, and the local provider is
 * replaced by one whose answers the test decides.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-models-'));

const electronStub = {
    app: {
        getPath: () => userData,
        getVersion: () => '1.0.0',
        on: () => {},
        whenReady: () => new Promise(() => {}),
    },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); },
    },
    MessageChannelMain: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    ipcMain: { handle: () => {}, on: () => {} },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

// What the next read of the local agent's models does.
let next = async () => null;
const LOCAL = require.resolve(path.join(ROOT, 'ai', 'providers', 'local'));
require.cache[LOCAL] = {
    id: LOCAL,
    filename: LOCAL,
    loaded: true,
    exports: { listModels: () => next() },
};

const ai = require(path.join(ROOT, 'ai'));

const ROWS = [{ value: 'qwen3', label: 'Qwen 3', effort: [] }];

async function main() {
    const pushed = [];
    ai.setNotifier((channel, payload) => pushed.push({ channel, payload }));

    next = async () => ROWS;
    assert.deepStrictEqual(await ai.models({ provider: 'local' }), ROWS, 'the first read is kept');

    next = async () => { throw new Error('connection refused'); };
    const quiet = console.error;
    console.error = () => {};
    try {
        assert.deepStrictEqual(await ai.models({ provider: 'local', refresh: true }), ROWS,
            'a re-read that fails keeps the list it had');
    } finally {
        console.error = quiet;
    }
    assert.deepStrictEqual(await ai.models({ provider: 'local' }), ROWS, 'and it is still held');

    next = async () => [];
    assert.deepStrictEqual(await ai.models({ provider: 'local', refresh: true }), ROWS,
        'so does one that comes back empty');

    const newer = [...ROWS, { value: 'qwen3.5', label: 'Qwen 3.5', effort: [] }];
    next = async () => newer;
    assert.deepStrictEqual(await ai.models({ provider: 'local', refresh: true }), newer,
        'a re-read that answers replaces it');
    assert.deepStrictEqual(pushed.at(-1), { channel: 'ai-models', payload: { provider: 'local', models: newer } });

    console.log('assistant-models tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
