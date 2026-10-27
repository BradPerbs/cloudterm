/**
 * The conversation history cap, and what it may and may not throw away.
 *
 * With twenty conversations saved, opening a new chat used to delete it on the
 * spot: the trim ran after the new conversation went in, and it takes untitled
 * ones first, so the newest one, the only untitled one, was the one it took.
 * The first message into it then found the conversation gone.
 *
 * `electron` is stubbed so it runs under plain node, and the history is read
 * from a file written here, the way a real launch reads it.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-history-'));

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

// Twenty saved conversations, each with something said in it, an hour apart.
const hour = 60 * 60 * 1000;
const start = Date.now() - 30 * hour;
const saved = Array.from({ length: 20 }, (_, index) => ({
    id: `saved-${index}`,
    scope: 'session',
    sessionId: '',
    title: `Saved chat ${index}`,
    createdAt: start + index * hour,
    updatedAt: start + index * hour,
    events: [{ type: 'user-message', text: `message ${index}`, at: start + index * hour }],
}));
fs.writeFileSync(
    path.join(userData, 'assistant-history.json'),
    JSON.stringify({ version: 1, conversations: saved }),
    'utf8'
);

const ai = require(path.join(ROOT, 'ai'));

let passed = 0;
let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        failed++;
    }
};

console.log('\nassistant history');

check('the saved history is read back in full', () => {
    assert.strictEqual(ai.list().length, 20);
});

let first;
check('a new chat survives being opened with the history full', () => {
    first = ai.create({}).conversationId;
    assert(ai.get(first), 'the new conversation is still there');
    assert.strictEqual(ai.list().length, 20, 'the cap still holds');
});

check('the room is made by the oldest saved conversation', () => {
    assert.strictEqual(ai.get('saved-0'), undefined);
    assert(ai.get('saved-1'), 'the next oldest stays');
});

check('a second new chat does not push out the first one', () => {
    const second = ai.create({}).conversationId;
    assert(ai.get(second), 'the second one is there');
    assert(ai.get(first), 'the first one, still empty, is there too');
    assert.strictEqual(ai.get('saved-1'), undefined, 'a saved one made the room instead');
    assert.strictEqual(ai.list().length, 20);
});

check('an empty chat stops being protected once it is a minute old', () => {
    ai.get(first).createdAt = Date.now() - 2 * 60 * 1000;
    const third = ai.create({}).conversationId;
    assert(ai.get(third));
    assert.strictEqual(ai.get(first), undefined, 'the stale empty one goes before any saved chat');
    assert(ai.get('saved-2'), 'and the saved chats are left alone');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
