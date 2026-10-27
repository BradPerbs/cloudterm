/**
 * How the transcript turns calls into rows.
 *
 * Two pure modules. `group-rows` folds back-to-back calls into one group,
 * with a thought (narration or thinking) standing outside and ending the
 * group above it. `tool-bucket` names what each call is: the verb on its row,
 * the bucket a group counts it in, the file it shows as a chip, and the kind
 * of work the working line describes while it runs.
 *
 * Both are ESM for the bundler, so they are imported dynamically.
 */
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

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

const LIB = path.join(__dirname, '..', 'src', 'renderer', 'lib');
const load = name => import(pathToFileURL(path.join(LIB, name)).href);

const tool = (id, name = 'read_file', extra = {}) => ({ kind: 'tool', id, name, status: 'done', input: {}, ...extra });
const said = (id, text, thinking = '') => ({ kind: 'assistant', id, text, thinking });
const user = id => ({ kind: 'user', id, text: 'hi' });

/** The rows as short labels: an item's id, or a group as kind[ids]. */
const shape = rows => rows.map(row => (row.items ? `${row.kind}[${row.items.map(item => item.id).join(',')}]` : row.id));

async function main() {
    const { groupRows } = await load('group-rows.js');
    const { verbFor, toolBucket, chipFor, todoProgress, activityOf, toolKey } = await load('tool-bucket.js');

    console.log('group rows');

    check('a thought between calls stands outside and starts a new group', () => {
        const { rows } = groupRows([
            user('u'), tool('t1'), tool('t2'), said('a1', 'Now the config.'), tool('t3'), tool('t4'), said('a2', 'Done.'),
        ]);
        assert.deepStrictEqual(shape(rows), ['u', 'tools[t1,t2]', 'a1', 'tools[t3,t4]', 'a2']);
    });

    check('thinking with no words splits the run the same way', () => {
        const { rows } = groupRows([tool('t1'), tool('t2'), said('a1', '', 'hmm'), tool('t3'), tool('t4')]);
        assert.deepStrictEqual(shape(rows), ['tools[t1,t2]', 'a1', 'tools[t3,t4]']);
    });

    check('a lone call between thoughts stays its own row', () => {
        const { rows } = groupRows([said('a0', 'Looking.'), tool('t1'), said('a1', 'Next.'), tool('t2'), tool('t3')]);
        assert.deepStrictEqual(shape(rows), ['a0', 't1', 'a1', 'tools[t2,t3]']);
    });

    check('an empty assistant message does not split a run', () => {
        const { rows } = groupRows([tool('t1'), said('a1', '  '), tool('t2'), tool('t3')]);
        assert.deepStrictEqual(shape(rows), ['tools[t1,t2,t3]']);
    });

    check('a call waiting on a question ends the group above it', () => {
        const pending = tool('t3', 'run_command', { approval: { status: 'pending' } });
        const { rows } = groupRows([tool('t1'), tool('t2'), pending, tool('t4'), tool('t5')]);
        assert.deepStrictEqual(shape(rows), ['tools[t1,t2]', 't3', 'tools[t4,t5]']);
    });

    check('a notice or a divider ends a group too', () => {
        const { rows } = groupRows([
            tool('t1'), tool('t2'), { kind: 'divider', id: 'd', text: 'x' }, tool('t3'), { kind: 'notice', id: 'n' }, tool('t4'),
        ]);
        assert.deepStrictEqual(shape(rows), ['tools[t1,t2]', 'd', 't3', 'n', 't4']);
    });

    check('switched off, every call is its own row and the list is the one given', () => {
        const items = [tool('t1'), tool('t2'), tool('t3')];
        const { rows } = groupRows(items, { enabled: false });
        assert.strictEqual(rows, items);
    });

    check('a group is the same object while its members are, a new one once one changes', () => {
        const t1 = tool('t1');
        const t2 = tool('t2');
        const first = groupRows([t1, t2]);
        const again = groupRows([t1, t2], { previous: first.kept });
        assert.strictEqual(again.rows[0], first.rows[0]);
        const changed = groupRows([t1, { ...t2, status: 'error' }], { previous: again.kept });
        assert.notStrictEqual(changed.rows[0], first.rows[0]);
        assert.strictEqual(changed.rows[0].id, first.rows[0].id, 'same id, so the row keeps its open state');
    });

    console.log('\ntool bucket');

    check('every one of CloudTerm\'s own tools has a verb', () => {
        const own = [
            'list_hosts', 'list_sessions', 'read_terminal', 'run_command', 'send_input', 'list_directory',
            'read_file', 'write_file', 'connect_host', 'disconnect_session',
            'edit_file', 'ask_user', 'list_snippets', 'read_snippet', 'save_snippet',
            'watch_metric', 'read_metric', 'stop_metric',
        ];
        for (const name of own) assert.ok(verbFor(name), name);
    });

    check('the runtimes\' own tools have verbs, whatever case they are spelled in', () => {
        const expected = {
            Read: 'read', Edit: 'edit', MultiEdit: 'edit', Write: 'write', Bash: 'run', Grep: 'search',
            Glob: 'search', WebFetch: 'fetch', WebSearch: 'search', TodoWrite: 'todo', Task: 'subagent',
            AskUserQuestion: 'ask', NotebookEdit: 'edit', LS: 'list',
            apply_patch: 'edit', file_change: 'edit', command_execution: 'run',
            bash: 'run', read: 'read', edit: 'edit', webfetch: 'fetch', todowrite: 'todo', list: 'list',
            Shell: 'run', ReadFile: 'read', WriteFile: 'write', StrReplaceFile: 'edit', SearchWeb: 'search',
            FetchURL: 'fetch', SetTodoList: 'todo', Think: 'think',
            view_file: 'read', create_file: 'write', str_replace_editor: 'edit', create_todo_list: 'todo',
        };
        for (const [name, verb] of Object.entries(expected)) assert.strictEqual(verbFor(name)?.verb, verb, name);
    });

    check('the terminal is read, not run, and a session is a connection', () => {
        assert.strictEqual(toolBucket('read_terminal'), 'views');
        assert.strictEqual(toolBucket('send_input'), 'commands');
        assert.strictEqual(toolBucket('connect_host'), 'connections');
        assert.strictEqual(toolBucket('disconnect_session'), 'connections');
    });

    check('a tool from another MCP server is read past its prefix', () => {
        assert.strictEqual(toolKey('mcp__github__search_issues'), 'search_issues');
        assert.strictEqual(verbFor('mcp__github__search_issues').verb, 'search');
    });

    check('an unknown tool has no verb and counts as other', () => {
        for (const name of ['frobnicate', 'mcp__x__allocate_ip', '', undefined]) {
            assert.strictEqual(verbFor(name), null, String(name));
            assert.strictEqual(toolBucket(name), 'other', String(name));
        }
    });

    check('a call on one file shows it as a chip, by its base name', () => {
        assert.deepStrictEqual(chipFor('read_file', { path: '/etc/nginx/nginx.conf' }), { base: 'nginx.conf', full: '/etc/nginx/nginx.conf' });
        assert.deepStrictEqual(chipFor('Edit', { file_path: 'C:\\app\\main.js' }), { base: 'main.js', full: 'C:\\app\\main.js' });
        assert.deepStrictEqual(chipFor('edit', { filePath: 'src/a.ts' }), { base: 'a.ts', full: 'src/a.ts' });
        assert.deepStrictEqual(chipFor('apply_patch', { changes: [{ path: 'x/y.py' }] }), { base: 'y.py', full: 'x/y.py' });
    });

    check('no chip for what is not one file', () => {
        assert.strictEqual(chipFor('run_command', { command: 'cat /etc/hosts' }), null);
        assert.strictEqual(chipFor('list_directory', { path: '/var/log' }), null);
        assert.strictEqual(chipFor('read_terminal', { lines: 50 }), null);
        assert.strictEqual(chipFor('apply_patch', { changes: [{ path: 'a' }, { path: 'b' }] }), null);
        assert.strictEqual(chipFor('read_file', { path: '  ' }), null);
    });

    check('a todo list is counted, whichever word its runtime uses for done', () => {
        assert.deepStrictEqual(todoProgress({ todos: [{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }] }), { done: 1, total: 3 });
        assert.deepStrictEqual(todoProgress({ todos: [{ status: 'Done' }, { status: 'Pending' }] }), { done: 1, total: 2 });
        assert.strictEqual(todoProgress({}), null);
    });

    check('the working line reads the kind of work from the running call', () => {
        assert.strictEqual(activityOf('run_command'), 'shell');
        assert.strictEqual(activityOf('read_terminal'), 'shell');
        assert.strictEqual(activityOf('Bash'), 'shell');
        assert.strictEqual(activityOf('read_file'), 'read');
        assert.strictEqual(activityOf('Grep'), 'read');
        assert.strictEqual(activityOf('edit_file'), 'write');
        assert.strictEqual(activityOf('connect_host'), 'connect');
        assert.strictEqual(activityOf('ask_user'), 'think');
        assert.strictEqual(activityOf(''), 'think');
    });

    console.log(`\n${passed} checks passed${failed > 0 ? `, ${failed} failed` : ''}`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
