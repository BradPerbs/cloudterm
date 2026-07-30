/**
 * Host tags: what a tag normalises to, and what an add/remove edit produces.
 *
 * `host-tags.js` has no dependencies, so nothing needs stubbing here.
 */
const path = require('path');
const assert = require('assert');

const {
    normalizeTag,
    normalizeTags,
    applyTagEdit,
    sameTags,
    MAX_TAGS,
    MAX_TAG_LENGTH,
} = require(path.join(__dirname, '..', 'src', 'main', 'host-tags.js'));

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

/* ---------------- one tag ---------------- */

console.log('\ntag normalisation');

check('case is dropped, so Prod and prod are one tag', () => {
    assert.strictEqual(normalizeTag('Prod'), 'prod');
    assert.strictEqual(normalizeTag('PROD'), 'prod');
});

check('surrounding space goes and interior runs collapse', () => {
    assert.strictEqual(normalizeTag('  web  '), 'web');
    assert.strictEqual(normalizeTag('web   server'), 'web server');
});

check('a comma cannot survive inside a tag: it is the separator', () => {
    assert.ok(!normalizeTag('a,b').includes(','));
});

check('nothing in, nothing out', () => {
    assert.strictEqual(normalizeTag('   '), '');
    assert.strictEqual(normalizeTag(null), '');
    assert.strictEqual(normalizeTag(undefined), '');
});

check('a tag is capped, and the cap does not leave a trailing space', () => {
    const long = normalizeTag(`${'a'.repeat(MAX_TAG_LENGTH - 1)} bbbb`);
    assert.strictEqual(long.length, MAX_TAG_LENGTH - 1);
    assert.strictEqual(long, long.trim());
});

/* ---------------- a list of them ---------------- */

console.log('\ntag lists');

check('a comma-separated string is a list', () => {
    assert.deepStrictEqual(normalizeTags('prod, web , db'), ['db', 'prod', 'web']);
});

check('an array entry holding commas is split too, which is what a paste does', () => {
    assert.deepStrictEqual(normalizeTags(['prod, web']), ['prod', 'web']);
});

check('duplicates go, whatever case they were typed in', () => {
    assert.deepStrictEqual(normalizeTags(['Prod', 'prod', ' PROD ']), ['prod']);
});

check('the result is sorted, so re-saving in another order is not an edit', () => {
    assert.deepStrictEqual(normalizeTags(['web', 'db', 'app']), ['app', 'db', 'web']);
});

check('empties are dropped rather than stored', () => {
    assert.deepStrictEqual(normalizeTags(['prod', '', '  ', null]), ['prod']);
});

check('nothing at all normalises to an empty list, not a crash', () => {
    assert.deepStrictEqual(normalizeTags(undefined), []);
    assert.deepStrictEqual(normalizeTags(null), []);
    assert.deepStrictEqual(normalizeTags(42), []);
});

check('the list is capped', () => {
    const many = Array.from({ length: MAX_TAGS + 10 }, (unused, index) => `tag${index}`);
    assert.strictEqual(normalizeTags(many).length, MAX_TAGS);
});

/* ---------------- editing a list ---------------- */

console.log('\ntag edits');

check('adding puts a tag on, and the result stays sorted', () => {
    assert.deepStrictEqual(applyTagEdit(['web'], { add: ['db'] }), ['db', 'web']);
});

check('adding a tag that is already there changes nothing', () => {
    assert.deepStrictEqual(applyTagEdit(['web'], { add: ['web'] }), ['web']);
});

check('removing takes a tag off and leaves the rest', () => {
    assert.deepStrictEqual(applyTagEdit(['db', 'web'], { remove: ['db'] }), ['web']);
});

check('removing something that is not there changes nothing', () => {
    assert.deepStrictEqual(applyTagEdit(['web'], { remove: ['db'] }), ['web']);
});

check('a tag in both add and remove ends up on: removals are applied first', () => {
    assert.deepStrictEqual(applyTagEdit(['web'], { add: ['db'], remove: ['db'] }), ['db', 'web']);
});

check('an edit normalises what it is given, so "Prod" removes "prod"', () => {
    assert.deepStrictEqual(applyTagEdit(['prod', 'web'], { remove: ['PROD'] }), ['web']);
});

check('an empty edit is the list it started with', () => {
    assert.deepStrictEqual(applyTagEdit(['web', 'db'], {}), ['db', 'web']);
    assert.deepStrictEqual(applyTagEdit(['web'], undefined), ['web']);
});

check('a host with no tags at all can still be tagged', () => {
    assert.deepStrictEqual(applyTagEdit(undefined, { add: ['prod'] }), ['prod']);
});

/* ---------------- comparison ---------------- */

console.log('\ncomparing lists');

check('two normalised lists agreeing are the same', () => {
    assert.strictEqual(sameTags(['a', 'b'], ['a', 'b']), true);
});

check('length and contents both count', () => {
    assert.strictEqual(sameTags(['a'], ['a', 'b']), false);
    assert.strictEqual(sameTags(['a', 'b'], ['a', 'c']), false);
});

check('an unchanged edit compares equal, which is what stops a needless write', () => {
    const before = normalizeTags(['web', 'db']);
    const after = applyTagEdit(before, { add: ['db'] });
    assert.strictEqual(sameTags(before, after), true);
});

console.log(`\n${passed} checks passed\n`);
