/**
 * Which pasted text counts as a key or a token.
 *
 * Both directions matter. A miss leaves a live credential in a history file
 * that is not encrypted. A false positive masks part of someone's history for
 * no reason, and enough of those and the masking is what people complain
 * about rather than what protects them. The negatives below are the shapes
 * that sit closest to a secret in an operations chat: hashes, UUIDs, paths,
 * placeholders, and sentences about passwords.
 */
const path = require('path');
const assert = require('assert');

const pasted = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'pasted-secrets'));

let passed = 0;
let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
        passed += 1;
    } catch (error) {
        console.log(`  FAIL ${label}`);
        console.log(`       ${error.message}`);
        failed += 1;
    }
};

console.log('\npasted secrets');

check('provider keys are found by their prefix', () => {
    const keys = [
        'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
        'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx0123',
        'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
        'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuv',
        'glpat-AbCdEfGhIjKlMnOpQrSt',
        'xoxb-123456789012-abcdefghijkl',
        'AKIAIOSFODNN7EXAMPLE',
        'AIzaSyA-abcdefghijklmnopqrstuvwxyz01234',
        'sk_live_AbCdEfGhIjKlMnOp1234',
        'hf_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ];
    for (const key of keys) {
        assert.deepStrictEqual(pasted.find(`here is the key ${key} thanks`), [key], key);
    }
});

check('a private key is found whole, armour included', () => {
    const block = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQyNTUxOQAAACD\n-----END OPENSSH PRIVATE KEY-----';
    assert.deepStrictEqual(pasted.find(`use this:\n${block}\nok?`), [block]);
});

check('a value is found by the name in front of it', () => {
    assert.deepStrictEqual(pasted.find('the API_KEY=Zx81kd02ma9 goes in .env'), ['Zx81kd02ma9']);
    assert.deepStrictEqual(pasted.find('password: hunter2024'), ['hunter2024']);
    assert.deepStrictEqual(pasted.find('{"client_secret": "a8f3-22x-PLM"}'), ['a8f3-22x-PLM']);
    assert.deepStrictEqual(pasted.find('curl -H "Authorization: Bearer abcdEFGH12345678xyz"'), ['abcdEFGH12345678xyz']);
    assert.deepStrictEqual(pasted.find('DATABASE_URL=postgres://app:s3cretPass@db:5432/x'), ['s3cretPass']);
    assert.deepStrictEqual(pasted.find('my hetzner token: correcthorsebatterystaple'), ['correcthorsebatterystaple'],
        'a long value needs no digit');
});

check('a bare hosting token is found by its mix of cases and digits', () => {
    const token = 'Xk2mP9qR4tV7wY1zA3bC5dE8fG0hJ6kL';
    assert.deepStrictEqual(pasted.find(`token is ${token}`), [token]);
});

check('the shapes nearest to a secret are left alone', () => {
    const innocent = [
        'the password: required for sudo',
        'set the token: later',
        'commit 3f786850e387550fdab836ed7e6dc881de23001b broke it',
        'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        'container 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        'id 123e4567-e89b-12d3-a456-426614174000',
        'see /var/lib/docker/overlay2/AbCdEf0123456789AbCdEf0123456789/merged',
        'password=$DB_PASSWORD',
        'api_key: {{api_key}}',
        'restart nginx and check the max_tokens=4096 setting',
        'Token based auth works fine',
    ];
    for (const text of innocent) {
        assert.deepStrictEqual(pasted.find(text), [], text);
    }
});

check('masking replaces every copy, the longest value first', () => {
    const values = new Set(['abcdEFGH12345678', 'abcdEFGH12345678xyz']);
    assert.strictEqual(
        pasted.mask('a abcdEFGH12345678xyz b abcdEFGH12345678 c', values),
        `a ${pasted.MASK} b ${pasted.MASK} c`
    );
});

check('masking an object hands back the same object when nothing changed', () => {
    const values = new Set(['hunter2024']);
    const clean = { type: 'tool-call', input: { command: 'ls' } };
    assert.strictEqual(pasted.maskDeep(clean, values), clean);

    const dirty = { type: 'tool-call', input: { command: 'echo hunter2024', list: ['x', 'hunter2024'] } };
    const masked = pasted.maskDeep(dirty, values);
    assert.notStrictEqual(masked, dirty);
    assert.strictEqual(masked.input.command, `echo ${pasted.MASK}`);
    assert.deepStrictEqual(masked.input.list, ['x', pasted.MASK]);
    assert.strictEqual(dirty.input.command, 'echo hunter2024', 'the original is not touched');
    assert.strictEqual(pasted.maskDeep(dirty, undefined), dirty, 'no values, nothing to do');
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
