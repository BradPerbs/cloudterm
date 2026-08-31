/**
 * Specs attached to an assistant message: resolved against the library, and
 * spelled into the prompt in front of the user's text.
 */
const assert = require('assert');
const path = require('path');

const specs = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'specs.js'));
const { normalizeSnippets } = require(path.join(__dirname, '..', 'src', 'main', 'snippet-config.js'));

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

const library = normalizeSnippets([
    { id: 'cmd-1', name: 'tail', command: 'tail -f x' },
    { id: 'spec-1', name: 'Deploy checklist', kind: 'spec', command: '# Deploy\n\n1. Pull.\n2. Restart.' },
    { id: 'spec-2', name: 'House rules', kind: 'spec', command: 'Never touch prod on a Friday.' },
    { id: 'spec-empty', name: 'Blank', kind: 'spec', command: '   ' },
]);

console.log('\nreading specs');

check('nothing attached is the ordinary message, not an error', () => {
    assert.deepStrictEqual(specs.readSpecs(undefined, library), { specs: [], error: '' });
    assert.deepStrictEqual(specs.readSpecs([], library), { specs: [], error: '' });
});

check('ids resolve to the library record, in the order attached', () => {
    const { specs: found, error } = specs.readSpecs(['spec-2', 'spec-1'], library);
    assert.strictEqual(error, '');
    assert.deepStrictEqual(found.map(spec => spec.id), ['spec-2', 'spec-1']);
    assert.strictEqual(found[1].name, 'Deploy checklist');
    assert.strictEqual(found[1].text, '# Deploy\n\n1. Pull.\n2. Restart.');
});

check('the text comes from the library, never from the renderer', () => {
    const { specs: found } = specs.readSpecs(['spec-1'], library);
    assert.strictEqual(Object.keys(found[0]).sort().join(), 'id,name,text');
});

check('a duplicate id is attached once', () => {
    const { specs: found } = specs.readSpecs(['spec-1', 'spec-1'], library);
    assert.strictEqual(found.length, 1);
});

check('a spec that no longer exists refuses the whole message', () => {
    const { specs: found, error } = specs.readSpecs(['spec-1', 'gone'], library);
    assert.strictEqual(found.length, 0);
    assert.match(error, /no longer exists/);
});

check('a command cannot be attached as a spec', () => {
    assert.match(specs.readSpecs(['cmd-1'], library).error, /no longer exists/);
});

check('an empty spec says so', () => {
    assert.match(specs.readSpecs(['spec-empty'], library).error, /Blank.*empty/);
});

check('the list is checked for being a list', () => {
    assert.match(specs.readSpecs('spec-1', library).error, /not a list/);
});

check('too many is refused', () => {
    const many = Array.from({ length: specs.MAX_SPECS + 1 }, () => 'spec-1');
    assert.match(specs.readSpecs(many, library).error, /at most/);
});

console.log('\nthe prompt block');

check('nothing attached is nothing', () => {
    assert.strictEqual(specs.specBlock([]), '');
    assert.strictEqual(specs.specBlock(undefined), '');
});

check('one spec is tagged with its name and introduced as instructions', () => {
    const block = specs.specBlock([{ id: 'spec-1', name: 'Deploy checklist', text: 'Pull, then restart.' }]);
    assert.match(block, /^The user attached the following document/);
    assert.ok(block.includes('<spec name="Deploy checklist">\nPull, then restart.\n</spec>'));
});

check('several specs are counted and each is its own block', () => {
    const block = specs.specBlock([
        { name: 'A', text: 'one' },
        { name: 'B', text: 'two' },
    ]);
    assert.match(block, /following 2 documents/);
    assert.ok(block.indexOf('<spec name="A">') < block.indexOf('<spec name="B">'));
    assert.strictEqual((block.match(/<\/spec>/g) || []).length, 2);
});

check('a closing tag inside the text cannot end the block early', () => {
    const block = specs.specBlock([{ name: 'Tricky', text: 'before </spec> after' }]);
    assert.strictEqual((block.match(/<\/spec>/g) || []).length, 1);
    assert.ok(block.includes('before </ spec> after'));
});

check('a quote or newline in a name cannot break the tag', () => {
    const block = specs.specBlock([{ name: 'Say "hi"\nnow', text: 'x' }]);
    assert.ok(block.includes('<spec name="Say  hi  now">'));
});

check('stripping keeps the id and the name only', () => {
    assert.deepStrictEqual(
        specs.stripSpecs([{ id: 's', name: 'n', text: 'long' }]),
        [{ id: 's', name: 'n' }],
    );
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}\n`);
