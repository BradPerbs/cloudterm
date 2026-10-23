const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The local model server's API key.
 *
 * This covers a wiring gap rather than a protocol one. Sending the key was
 * never the missing half: `local.js` reads `current.apiKey` and
 * `openai-compatible.js` puts it on every request as `Authorization: Bearer`.
 * What was missing was anything that could put a value there — `sanitize()`
 * builds the config from `DEFAULTS` and never carries an `apiKey`, no code
 * wrote one to the `keys` side of the file, and the settings page had no field
 * for it. So `current.apiKey` was permanently `undefined`, the header was never
 * sent, and a server behind a token answered 401 to everything with nothing on
 * screen to explain it.
 *
 * These cases hold both halves together: a key can be stored, the provider is
 * handed it, and it reaches the wire. `electron` is stubbed so this runs under
 * plain node, with a reversible stand-in for `safeStorage` — reversible so the
 * "no plaintext on disk" case can tell a real check from a coincidence.
 */

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-local-key-'));

const electronStub = {
    app: {
        getPath: () => userData,
        getVersion: () => '1.0.0',
        on: () => {},
        whenReady: () => new Promise(() => {}),
    },
    safeStorage: {
        available: true,
        isEncryptionAvailable() {
            return this.available;
        },
        // Not base64 of the key alone: the prefix keeps the ciphertext
        // distinguishable from the plaintext in the file assertion below.
        encryptString: (value) => Buffer.from(`stub:${value}`, 'utf8'),
        decryptString: (buffer) => {
            const text = Buffer.from(buffer).toString('utf8');
            if (!text.startsWith('stub:')) throw new Error('not our ciphertext');
            return text.slice('stub:'.length);
        },
    },
    ipcMain: { handle: () => {}, on: () => {} },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return realLoad.call(this, request, parent, isMain);
};

const settings = require('../src/main/ai/settings');
const local = require('../src/main/ai/providers/local');

const KEY = 'sk-local-abc123';

/** What `index.js` hands a provider: the view, plus that provider's key. */
const resolvedFor = (provider) => ({
    ...settings.get(),
    provider,
    apiKey: settings.readApiKey(provider),
});

const stateFile = () => path.join(userData, 'assistant.json');
const stateText = () => (fs.existsSync(stateFile()) ? fs.readFileSync(stateFile(), 'utf8') : '');

/** A streamed answer, as the reader in `openai-compatible.js` pulls from. */
function sseResponse(lines) {
    const body = lines.map(line => `data: ${JSON.stringify(line)}\n`).join('') + 'data: [DONE]\n';
    const chunks = [Buffer.from(body, 'utf8')];
    let index = 0;

    return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
            getReader: () => ({
                read: async () => (index < chunks.length
                    ? { value: chunks[index++], done: false }
                    : { value: undefined, done: true }),
            }),
        },
        text: async () => body,
    };
}

/** Runs `body` with `fetch` answered by `handler`, and always puts it back. */
async function withFetch(handler, body) {
    const original = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options: options || {} });
        return handler(url, options || {});
    };
    try {
        return await body(calls);
    } finally {
        global.fetch = original;
    }
}

const jsonResponse = (payload) => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
});

let passed = 0;
let failed = 0;

async function check(label, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ok  ${label}`);
    } catch (error) {
        failed += 1;
        console.log(`  FAIL ${label}\n       ${error.message}`);
    }
}

async function run() {
    /* ---------------- Storing one ---------------- */

    await check('a stored key is reported as stored, and never echoed back', () => {
        const next = settings.setLocalApiKey(`  ${KEY}\n`);

        assert.strictEqual(next.hasLocalApiKey, true, 'the row can say a key is set');
        assert.strictEqual(next.apiKey, undefined, 'the view carries no key of its own');
        assert.ok(
            !JSON.stringify(next).includes(KEY),
            'nothing in the settings view is the key'
        );
    });

    await check('the key is trimmed, so a pasted newline cannot break the header', () => {
        assert.strictEqual(settings.readApiKey('local'), KEY);
    });

    await check('no other agent is handed it', () => {
        // The write is deliberately local-only, and the read is per provider:
        // a key meant for one endpoint must not travel with an agent that
        // signed in for itself.
        for (const provider of ['claude-code', 'codex', 'opencode', 'grok', 'kimi']) {
            assert.strictEqual(settings.readApiKey(provider), '', `${provider} gets no key`);
        }
    });

    await check('on disk it is ciphertext, and not in the configuration block', () => {
        const text = stateText();
        assert.ok(text, 'the settings file was written');
        assert.ok(!text.includes(KEY), 'the plaintext key is not in the file');

        const parsed = JSON.parse(text);
        assert.ok(parsed.keys?.local, 'the key lives in keys, not in config');
        assert.strictEqual(parsed.config.apiKey, undefined,
            'the configuration object still has no key field to copy out');
    });

    await check('the models to offer are kept as typed, and capped', () => {
        // The same part of the file as the address, because it is the same
        // question: what this server should offer. Nonsense is dropped rather
        // than stored, and the list cannot grow without bound.
        const next = settings.set({
            localModelFilter: ['  deepseek-flash  ', '', 'gpt-6-luna', ...Array(30).fill('x')],
        });

        assert.deepStrictEqual(next.localModelFilter.slice(0, 2), ['deepseek-flash', 'gpt-6-luna']);
        assert.strictEqual(next.localModelFilter.length, 20, 'twenty at most');
        assert.ok(!next.localModelFilter.includes(''), 'blanks are dropped');
    });

    await check('clearing it is a list, not a reset to something else', () => {
        const next = settings.set({ localModelFilter: [] });
        assert.deepStrictEqual(next.localModelFilter, []);
    });

    /* ---------------- Reaching the provider, and the wire ---------------- */

    await check('the provider is handed it in the shape it reads', () => {
        const endpoint = local.endpoint(resolvedFor('local'));

        assert.strictEqual(endpoint.baseUrl, settings.get().localBaseUrl);
        assert.strictEqual(endpoint.apiKey, KEY);
    });

    await check('a model list is asked for with the key', async () => {
        await withFetch(() => jsonResponse({ data: [{ id: 'qwen3-8b' }] }), async (calls) => {
            const rows = await local.listModels({ settings: resolvedFor('local') });

            assert.strictEqual(rows.length, 1);
            assert.strictEqual(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
        });
    });

    await check('a completion is asked for with the key that was stored', async () => {
        // Through `local.start` rather than a hand-built endpoint: the point is
        // that the key arrives here from the settings file, which is the hop
        // the old test could not make because it fabricated `apiKey` itself.
        const current = { ...resolvedFor('local'), model: 'qwen3-8b' };
        const stream = sseResponse([
            { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
        ]);

        const events = [];
        let done;
        const finished = new Promise((resolve) => { done = resolve; });

        await withFetch(() => stream, async (calls) => {
            const session = await local.start({
                settings: current,
                getSettings: () => current,
                systemPrompt: 'You operate servers.',
                toolContext: () => ({ settings: current, scope: 'global', boundSessionId: '' }),
                requestApproval: async () => ({ approved: false, message: 'Not in this test.' }),
                onEvent: (event) => {
                    events.push(event);
                    if (event.type === 'result' || event.type === 'error') done();
                },
            });

            session.send('hello');
            await finished;

            const post = calls.find(call => call.url.endsWith('/chat/completions'));
            assert.ok(post, 'a completion was asked for');
            assert.strictEqual(post.options.headers.Authorization, `Bearer ${KEY}`);
        });

        assert.ok(events.some(event => event.type === 'result'), 'the turn finished');
    });

    /* ---------------- Taking one back ---------------- */

    await check('an empty key clears it, and the header goes with it', async () => {
        const next = settings.setLocalApiKey('');

        assert.strictEqual(next.hasLocalApiKey, false);
        assert.strictEqual(settings.readApiKey('local'), '');
        assert.strictEqual(JSON.parse(stateText()).keys.local, undefined);

        await withFetch(() => jsonResponse({ data: [{ id: 'qwen3-8b' }] }), async (calls) => {
            await local.listModels({ settings: resolvedFor('local') });
            assert.strictEqual(calls[0].options.headers.Authorization, undefined,
                'a server on this machine is asked without a header');
        });
    });

    await check('a write that fails is reported as a failed save, and undone', () => {
        // The file is what makes a key survive a restart. A save that only ever
        // reached memory would have the panel saying the key works right up
        // until the next launch, which is a worse answer than refusing it.
        settings.setLocalApiKey('sk-kept');

        const fs = require('fs');
        const real = fs.writeFileSync;
        fs.writeFileSync = () => { throw new Error('EROFS: read-only file system'); };

        try {
            assert.throws(
                () => settings.setLocalApiKey('sk-replacement'),
                /could not be written/i,
                'the caller is told the save failed'
            );
        } finally {
            fs.writeFileSync = real;
        }

        assert.strictEqual(settings.readApiKey('local'), 'sk-kept',
            'the key that was already stored is still the one in force');
        assert.strictEqual(settings.get().hasLocalApiKey, true);

        // Back to empty for the checks that follow.
        settings.setLocalApiKey('');
    });

    await check('a settings write that fails leaves the previous settings in force', () => {
        // The same rule as the key: a change the file never received is a change
        // the user loses at the next restart, so it is a failure now.
        const before = settings.get().maxTurns;
        const fs = require('fs');
        const real = fs.writeFileSync;
        fs.writeFileSync = () => { throw new Error('EROFS: read-only file system'); };

        try {
            assert.throws(() => settings.set({ maxTurns: 99 }), /were not saved/i);
        } finally {
            fs.writeFileSync = real;
        }

        assert.strictEqual(settings.get().maxTurns, before, 'and it did not half-apply');
    });

    /* ---------------- The one refusal ---------------- */

    await check('a machine that cannot encrypt refuses, and stores nothing', () => {
        electronStub.safeStorage.available = false;

        assert.throws(
            () => settings.setLocalApiKey('sk-should-not-persist'),
            /cannot encrypt/i,
            'the caller is told why rather than getting a silent no-op'
        );
        assert.strictEqual(settings.readApiKey('local'), '');
        assert.ok(!stateText().includes('sk-should-not-persist'), 'nothing was written');

        electronStub.safeStorage.available = true;
    });

    console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
    if (failed > 0) process.exit(1);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
