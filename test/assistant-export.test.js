/**
 * A conversation as Markdown: what the document says, and what it never says.
 *
 * The format first: the messages under headings, each tool call as a line with
 * its own result beneath it (even when results arrive out of order), long
 * results cut in the plain cut and kept in the full one, and a result that
 * prints a fence of its own unable to break out of the block it is put in.
 *
 * Then the masking. The stored events are masked when they are recorded, and
 * the export goes over the whole document again, because it leaves the app:
 * a key the user pasted stays a mask wherever it turns up, including in an
 * event recorded before it was known, and a credential in a tool input or a
 * result is masked even though nobody pasted it.
 */
const path = require('path');
const assert = require('assert');

const { toMarkdown, fileName, DEFAULT_LABELS } = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'export'));

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

const T0 = Date.UTC(2026, 9, 27, 9, 30, 0);

/** A conversation as ai/index.js holds one. */
function conversation(events, extra = {}) {
    return {
        id: 'conv-abc-1',
        title: 'Why is nginx down on web-01',
        createdAt: T0,
        provider: 'claude-code',
        secrets: new Set(),
        events: events.map((event, index) => ({ at: T0 + index * 1000, ...event })),
        ...extra,
    };
}

const basic = () => conversation([
    { type: 'user-message', text: 'Why is nginx down?' },
    { type: 'text-delta', text: 'Let me' },
    { type: 'assistant-text', text: 'Let me look at the service.' },
    { type: 'tool-call', id: 't1', name: 'run_command', input: { session: 's1', command: 'systemctl status nginx' } },
    { type: 'tool-result', id: 't1', text: 'Active: failed (Result: exit-code)', isError: false },
    { type: 'assistant-text', text: 'It failed on a config error.' },
    { type: 'result', subtype: 'success', costUsd: 0.01 },
]);

console.log('\nthe format');

check('a title, when it started, then the messages under headings', () => {
    const text = toMarkdown(basic(), { now: T0 + 60000 });
    assert.ok(text.startsWith('# Why is nginx down on web-01\n'), text.slice(0, 80));
    assert.ok(text.includes('Started 2026-10-27T09:30:00.000Z · exported 2026-10-27T09:31:00.000Z'));
    assert.ok(text.includes('## You\n\nWhy is nginx down?'));
    assert.ok(text.includes('## AI Agent\n\nLet me look at the service.'));
    assert.ok(text.includes('## AI Agent\n\nIt failed on a config error.'));
});

check('a tool call is a line, with its result fenced under it', () => {
    const text = toMarkdown(basic());
    assert.ok(text.includes('**run_command** `systemctl status nginx`\n\n```\nActive: failed (Result: exit-code)\n```'), text);
});

check('a stream preview, a cost and a result say nothing in the document', () => {
    const text = toMarkdown(basic());
    assert.ok(!text.includes('Let me\n'), 'the delta is not printed');
    assert.ok(!/costUsd|0\.01|success/.test(text));
});

check('no blank-line runs, and one newline at the end', () => {
    const text = toMarkdown(basic());
    assert.ok(!/\n{3,}/.test(text));
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});

check('results that come back out of order are printed under their own calls', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'a', name: 'run_command', input: { command: 'uptime' } },
        { type: 'tool-call', id: 'b', name: 'run_command', input: { command: 'df -h' } },
        { type: 'tool-result', id: 'b', text: 'DISK-RESULT' },
        { type: 'tool-result', id: 'a', text: 'UPTIME-RESULT' },
    ]));
    const uptime = text.indexOf('`uptime`');
    const df = text.indexOf('`df -h`');
    assert.ok(uptime < text.indexOf('UPTIME-RESULT') && text.indexOf('UPTIME-RESULT') < df, text);
    assert.ok(df < text.indexOf('DISK-RESULT'), text);
    assert.strictEqual(text.split('UPTIME-RESULT').length, 2, 'printed once');
});

check('a result whose call the log no longer holds is still printed', () => {
    const text = toMarkdown(conversation([{ type: 'tool-result', id: 'gone', text: 'ORPHAN' }]));
    assert.ok(text.includes('```\nORPHAN\n```'));
});

check('a call with no command names its arguments, without the session', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'r', name: 'read_file', input: { session: 's1', path: '/etc/nginx/nginx.conf' } },
    ]));
    assert.ok(text.includes('**read_file** `path: /etc/nginx/nginx.conf`'), text);
});

check('the plain cut stops a long result and says how much is left out', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'x', name: 'run_command', input: { command: 'cat big.log' } },
        { type: 'tool-result', id: 'x', text: 'a'.repeat(5000) },
    ]));
    assert.ok(text.includes(`\n${'a'.repeat(4000)}\n\`\`\``));
    assert.ok(text.includes('_Characters not shown: 1000_'));
});

check('the full cut keeps the result, every input as JSON, the setup and the times', () => {
    const text = toMarkdown(conversation([
        { type: 'user-message', text: 'go' },
        { type: 'tool-call', id: 'x', name: 'run_command', input: { session: 's1', command: 'cat big.log' } },
        { type: 'tool-result', id: 'x', text: 'b'.repeat(5000) },
    ]), {
        full: true,
        agents: { 'claude-code': 'Claude Code' },
        settings: { model: 'opus', effort: 'high', approval: 'writes' },
    });
    assert.ok(text.includes('Agent: Claude Code · model opus · effort high · approvals writes'), text);
    assert.ok(text.includes('Conversation id: conv-abc-1'));
    assert.ok(text.includes('## You <sub>09:30:00</sub>'));
    assert.ok(text.includes('```json\n{\n  "session": "s1",\n  "command": "cat big.log"\n}\n```'));
    assert.ok(text.includes('b'.repeat(5000)));
    assert.ok(!text.includes('not shown'));
});

check('with no model set, the full cut says the agent uses its own', () => {
    const text = toMarkdown(conversation([]), { full: true, settings: { effort: 'high', approval: 'writes' } });
    assert.ok(text.includes('model its own default'), text);
    assert.ok(text.includes('Agent: claude-code'), 'the id when no name was passed');
});

check('a result that prints a fence of its own cannot close the block', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'f', name: 'read_file', input: { path: 'README.md' } },
        { type: 'tool-result', id: 'f', text: 'intro\n```\nrm -rf /\n```\n# Not a heading' },
    ]));
    const inside = text.slice(text.indexOf('```\nintro'), text.lastIndexOf('```') + 3);
    assert.strictEqual((inside.match(/^```$/gm) || []).length, 2, inside);
});

check('a backtick in a command does not split its line', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'q', name: 'run_command', input: { command: 'echo `date`' } },
    ]));
    assert.ok(text.includes("**run_command** `echo 'date'`"), text);
});

check('a question in its own words, how approvals went, errors, warnings and stops', () => {
    const text = toMarkdown(conversation([
        { type: 'approval-request', requestId: 'q1', question: true, name: 'ask_user', input: { questions: [{ question: 'Restart it now?' }] } },
        { type: 'approval-settled', requestId: 'q1', status: 'approved' },
        { type: 'approval-request', requestId: 'a1', question: false, name: 'run_command', input: { command: 'reboot' } },
        { type: 'approval-settled', requestId: 'a1', status: 'denied' },
        { type: 'approval-settled', requestId: 'a2', status: 'expired' },
        { type: 'error', message: 'The runtime exited.' },
        { type: 'warning', message: 'Rate limited, retrying.' },
        { type: 'interrupted' },
        { type: 'notice', text: 'The app closed before this turn finished.' },
    ]));
    assert.ok(text.includes('> **Asked:** Restart it now?'));
    assert.ok(!text.includes('reboot'), 'an approval adds no line of its own');
    assert.ok(text.includes('_Allowed_') && text.includes('_Declined_') && text.includes('_Timed out_'));
    assert.ok(text.includes('> **Error:** The runtime exited.'));
    assert.ok(text.includes('> **Warning:** Rate limited, retrying.'));
    assert.ok(text.includes('_Stopped._'));
    assert.ok(text.includes('_The app closed before this turn finished._'));
});

check('pictures and specs sent with a message are named', () => {
    const text = toMarkdown(conversation([
        { type: 'user-message', text: 'what is this', images: [{ name: 'error.png', mediaType: 'image/png', data: 'AAAA' }], specs: [{ id: 's', name: 'Runbook' }] },
    ]));
    assert.ok(text.includes('## You\n\n[Image: error.png]\n[Spec: Runbook]\nwhat is this'), text);
    assert.ok(!text.includes('AAAA'), 'never the bytes');
});

check('the renderer\'s words replace the English, and anything that is not a string is ignored', () => {
    const text = toMarkdown(basic(), { labels: { you: 'Вы', agent: 'ИИ-ассистент', error: 42, untitled: { x: 1 } } });
    assert.ok(text.includes('## Вы\n'));
    assert.ok(text.includes('## ИИ-ассистент\n'));
    const untitled = toMarkdown(conversation([], { title: '' }), { labels: { untitled: { x: 1 } } });
    assert.ok(untitled.startsWith(`# ${DEFAULT_LABELS.untitled}\n`));
});

check('nothing to export is an empty string, not a throw', () => {
    assert.strictEqual(toMarkdown(null), '');
    assert.ok(toMarkdown({ id: 'x', title: 't' }).startsWith('# t\n'));
});

console.log('\nsecrets stay masked');

check('a key the user pasted is masked everywhere, even in an event recorded before it was known', () => {
    const key = 'Zq8xW2vR7tY4uI1oP6aS3dF9gH5jK0lM';
    const text = toMarkdown(conversation([
        { type: 'user-message', text: 'here is the token: ••••' },
        { type: 'tool-call', id: 'w', name: 'run_command', input: { command: `echo ${key} > /etc/app/token` } },
        { type: 'tool-result', id: 'w', text: `wrote ${key}` },
        { type: 'assistant-text', text: `Saved ${key}.` },
    ], { title: `use ${key}`, secrets: new Set([key]) }), { full: true });
    assert.ok(!text.includes(key), text);
    assert.ok(text.includes('here is the token: ••••'), 'what was masked stays masked');
});

check('a credential in a tool input is masked though nobody pasted it', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'm', name: 'run_command', input: { command: 'mysql -u root --password=Tr0ub4dor&3xyz' } },
    ]));
    assert.ok(!text.includes('Tr0ub4dor&3xyz'), text);
    const full = toMarkdown(conversation([
        { type: 'tool-call', id: 'm', name: 'save_snippet', input: { name: 'deploy', api_key: 'sk-proj-AbCdEfGhIjKlMnOpQrStUv12' } },
    ]), { full: true });
    assert.ok(!full.includes('sk-proj-AbCdEfGhIjKlMnOpQrStUv12'), full);
});

check('a key a server printed in a result is masked', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'e', name: 'read_file', input: { path: '.env' } },
        { type: 'tool-result', id: 'e', text: 'GITHUB_TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\nPORT=8080' },
    ]));
    assert.ok(!text.includes('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), text);
    assert.ok(text.includes('PORT=8080'), 'the rest of the result is left alone');
});

check('a key that straddles the point a result is cut at leaves no half showing', () => {
    const token = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const text = toMarkdown(conversation([
        { type: 'tool-call', id: 'c', name: 'run_command', input: { command: 'cat creds' } },
        { type: 'tool-result', id: 'c', text: `${'log line\n'.repeat(443)}TOKEN ${token}\n${'y'.repeat(100)}` },
    ]));
    assert.ok(text.includes('TOKEN ••••'), 'masked whole before the cut');
    assert.ok(!text.includes('ghp_'), 'not even its first part');
});

check('ordinary text that looks nothing like a key is left as it was', () => {
    const text = toMarkdown(conversation([
        { type: 'tool-result', id: 'h', text: 'commit 3f9a2c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39\nuuid 123e4567-e89b-12d3-a456-426614174000' },
    ]));
    assert.ok(text.includes('3f9a2c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39'));
    assert.ok(text.includes('123e4567-e89b-12d3-a456-426614174000'));
});

console.log('\nthe file name');

check('the title, in any script, without what a file name cannot hold', () => {
    assert.strictEqual(fileName('Why is nginx down on web-01?'), 'Why is nginx down on web-01.md');
    assert.strictEqual(fileName('Почему упал nginx / web-01'), 'Почему упал nginx web-01.md');
    assert.strictEqual(fileName('为什么 nginx 挂了'), '为什么 nginx 挂了.md');
    assert.strictEqual(fileName('a:b*c?"d<e>f|g'), 'abcdefg.md');
    assert.strictEqual(fileName('••••'), 'conversation.md');
    assert.strictEqual(fileName(''), 'conversation.md');
    assert.ok(fileName('x'.repeat(200)).length <= 63);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
