/**
 * When the assistant raises a desktop notification, and when it keeps quiet.
 *
 * The rule is "something needs you and you are not looking": a turn ends, a
 * question is asked or an approval waits in a chat that is not the one in
 * front in the focused window. Both halves are checked, since a notification
 * over the chat someone is reading is as wrong as a silent one for a chat
 * they left running. Then the promises that keep it from becoming noise: one
 * per event, one on screen per conversation, taken down once it has nothing
 * left to say; and the ones that keep it safe: what the agent wrote goes
 * through the same masking as the history.
 *
 * Electron is not loaded: the module takes its Notification class and its
 * idea of which window has the focus as arguments, and fakes stand in here.
 */
const path = require('path');
const assert = require('assert');

const { createAttention, DEFAULT_TEXT } = require(path.join(__dirname, '..', 'src', 'main', 'ai', 'attention'));

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

/** The app around the module: windows, settings and the OS's notifications, all fake. */
function harness({ focused = null, supported = true, hasWindow = true, settings = {} } = {}) {
    const shown = [];
    class FakeNotification {
        constructor(options) {
            this.options = options;
            this.handlers = {};
            this.closed = false;
            shown.push(this);
        }

        static isSupported() {
            return supported;
        }

        on(name, fn) {
            (this.handlers[name] = this.handlers[name] || []).push(fn);
        }

        emit(name) {
            for (const fn of this.handlers[name] || []) fn();
        }

        show() {
            this.emit('show');
        }

        close() {
            this.closed = true;
        }
    }

    const state = { focused, settings: { notify: true, notifySound: true, ...settings }, chimes: 0 };
    const opened = [];
    const attention = createAttention({
        Notification: FakeNotification,
        focusedId: () => state.focused,
        hasWindow: () => hasWindow,
        settings: () => state.settings,
        open: (conversationId) => opened.push(conversationId),
        chime: () => { state.chimes += 1; },
    });
    return { attention, shown, opened, state };
}

const conversation = (id = 'conv-1', extra = {}) => ({ id, title: 'Restart nginx on web-01', secrets: new Set(), ...extra });

/** A window as main sees it: an id, and a way to hear that it went. */
const window = (id) => ({ id, gone: null, once(event, fn) { if (event === 'destroyed') this.gone = fn; } });

/** One whole turn, from the message to its result. */
function turn(attention, chat, reply = 'Done: nginx restarted and answering on :80.') {
    attention.observe(chat, { type: 'user-message', text: 'restart nginx' });
    attention.observe(chat, { type: 'assistant-text', text: reply });
    attention.observe(chat, { type: 'result', subtype: 'success' });
}

console.log('\nwhen a notification goes up');

check('a turn that ends with no window focused raises one, titled and with the reply', () => {
    const { attention, shown } = harness({ focused: null });
    turn(attention, conversation());
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].options.title, 'Restart nginx on web-01 is done');
    assert.strictEqual(shown[0].options.body, 'Done: nginx restarted and answering on :80.');
    assert.strictEqual(shown[0].options.silent, true, 'the chime stands in for the system sound');
});

check('nothing for the chat in front in the focused window', () => {
    const { attention, shown } = harness({ focused: 1 });
    attention.setInView(window(1), ['conv-1']);
    turn(attention, conversation());
    assert.strictEqual(shown.length, 0);
});

check('the same chat on screen in a window without the focus still raises one', () => {
    const { attention, shown, state } = harness({ focused: 1 });
    attention.setInView(window(1), ['conv-1']);
    state.focused = null;
    turn(attention, conversation());
    assert.strictEqual(shown.length, 1);
});

check('a chat behind another tab, in the focused window, raises one', () => {
    const { attention, shown } = harness({ focused: 1 });
    attention.setInView(window(1), ['conv-2']);
    turn(attention, conversation('conv-1'));
    assert.strictEqual(shown.length, 1);
});

check('a chat in front in another window, while this one has the focus, raises one', () => {
    const { attention, shown } = harness({ focused: 2 });
    attention.setInView(window(1), ['conv-1']);
    attention.setInView(window(2), []);
    turn(attention, conversation('conv-1'));
    assert.strictEqual(shown.length, 1);
});

check('a shut panel reports nothing in front, so its chats are not being looked at', () => {
    const { attention, shown } = harness({ focused: 1 });
    const main = window(1);
    attention.setInView(main, ['conv-1']);
    attention.setInView(main, []);
    turn(attention, conversation('conv-1'));
    assert.strictEqual(shown.length, 1);
});

check('a question raises one with the question as its body', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), { type: 'user-message', text: 'clean up' });
    attention.observe(conversation(), {
        type: 'approval-request',
        requestId: 'ask-1',
        name: 'ask_user',
        question: true,
        input: { questions: [{ question: 'Delete the old  logs\ntoo?', options: [] }] },
    });
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].options.title, 'Restart nginx on web-01 has a question');
    assert.strictEqual(shown[0].options.body, 'Delete the old logs too?');
});

check('an approval raises one naming the command', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), { type: 'user-message', text: 'restart' });
    attention.observe(conversation(), {
        type: 'approval-request',
        requestId: 'approve-1',
        name: 'run_command',
        input: { session: 's1', command: 'sudo systemctl restart nginx' },
    });
    assert.strictEqual(shown[0].options.title, 'Restart nginx on web-01 needs your approval');
    assert.strictEqual(shown[0].options.body, 'sudo systemctl restart nginx');
});

check('an approval for a call with no command names the call and its arguments', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), {
        type: 'approval-request',
        requestId: 'approve-2',
        name: 'write_file',
        input: { session: 's1', path: '/etc/motd' },
    });
    assert.strictEqual(shown[0].options.body, 'write_file: path: /etc/motd');
});

check('an error that ends a turn raises one; an error with no turn running does not', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), { type: 'error', message: 'No AI agent is switched on.' });
    assert.strictEqual(shown.length, 0);
    attention.observe(conversation(), { type: 'user-message', text: 'go' });
    attention.observe(conversation(), { type: 'error', message: 'The runtime exited.' });
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].options.title, 'Restart nginx on web-01 stopped with a problem');
    assert.strictEqual(shown[0].options.body, 'The runtime exited.');
});

check('a turn that ran out of steps says it stopped rather than that it is done', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), { type: 'user-message', text: 'go' });
    attention.observe(conversation(), { type: 'result', subtype: 'error_max_turns', isError: true });
    assert.strictEqual(shown[0].options.title, 'Restart nginx on web-01 stopped with a problem');
});

console.log('\nwhen it keeps quiet');

check('a turn the person stopped raises nothing', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), { type: 'user-message', text: 'go' });
    attention.observe(conversation(), { type: 'interrupted' });
    attention.observe(conversation(), { type: 'result', subtype: 'success' });
    assert.strictEqual(shown.length, 0);
});

check('switched off in Settings, nothing goes up', () => {
    const { attention, shown } = harness({ settings: { notify: false } });
    turn(attention, conversation());
    attention.observe(conversation(), { type: 'approval-request', requestId: 'a', name: 'run_command', input: { command: 'ls' } });
    assert.strictEqual(shown.length, 0);
});

check('no notifications on this system, or no window left: nothing, and nothing thrown', () => {
    const unsupported = harness({ supported: false });
    turn(unsupported.attention, conversation());
    assert.strictEqual(unsupported.shown.length, 0);
    const closing = harness({ hasWindow: false });
    turn(closing.attention, conversation());
    assert.strictEqual(closing.shown.length, 0);
});

check('a turn ending on a question still standing leaves the question up', () => {
    const { attention, shown } = harness();
    const chat = conversation();
    attention.observe(chat, { type: 'user-message', text: 'go' });
    attention.observe(chat, { type: 'approval-request', requestId: 'ask-1', question: true, name: 'ask_user', input: { questions: [{ question: 'Which one?' }] } });
    attention.observe(chat, { type: 'assistant-text', text: 'I asked which one.' });
    attention.observe(chat, { type: 'result', subtype: 'success' });
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].closed, false);
});

console.log('\nnot spam');

check('one per event: a turn ends once, a question is asked once', () => {
    const { attention, shown } = harness();
    const chat = conversation();
    turn(attention, chat);
    attention.observe(chat, { type: 'result', subtype: 'success' });
    attention.observe(chat, { type: 'error', message: 'late' });
    assert.strictEqual(shown.length, 1);
    attention.observe(chat, { type: 'user-message', text: 'again' });
    const ask = { type: 'approval-request', requestId: 'ask-9', question: true, name: 'ask_user', input: { questions: [{ question: 'Sure?' }] } };
    attention.observe(chat, ask);
    attention.observe(chat, ask);
    assert.strictEqual(shown.length, 2);
});

check('an event seen as it happened is not announced later, once looked away from', () => {
    const { attention, shown, state } = harness({ focused: 1 });
    attention.setInView(window(1), ['conv-1']);
    const chat = conversation();
    turn(attention, chat);
    state.focused = null;
    attention.observe(chat, { type: 'result', subtype: 'success' });
    assert.strictEqual(shown.length, 0);
});

check('a new one for a conversation replaces the one it had up', () => {
    const { attention, shown } = harness();
    const chat = conversation();
    attention.observe(chat, { type: 'user-message', text: 'go' });
    attention.observe(chat, { type: 'approval-request', requestId: 'a1', name: 'run_command', input: { command: 'ls' } });
    attention.observe(chat, { type: 'approval-request', requestId: 'a2', name: 'run_command', input: { command: 'df -h' } });
    assert.strictEqual(shown.length, 2);
    assert.strictEqual(shown[0].closed, true);
    assert.strictEqual(shown[1].closed, false);
});

check('each conversation keeps its own: one chat does not take down another\'s', () => {
    const { attention, shown } = harness();
    turn(attention, conversation('conv-1'));
    turn(attention, conversation('conv-2'));
    assert.strictEqual(shown.length, 2);
    assert.ok(shown.every(entry => !entry.closed));
});

check('answering the question takes its notification down; settling another does not', () => {
    const { attention, shown } = harness();
    const chat = conversation();
    attention.observe(chat, { type: 'approval-request', requestId: 'ask-1', question: true, name: 'ask_user', input: { questions: [{ question: 'Which?' }] } });
    attention.observe(chat, { type: 'approval-settled', requestId: 'other', status: 'approved' });
    assert.strictEqual(shown[0].closed, false);
    attention.observe(chat, { type: 'approval-settled', requestId: 'ask-1', status: 'approved' });
    assert.strictEqual(shown[0].closed, true);
});

check('looking at the conversation takes its notification down', () => {
    const { attention, shown, state } = harness({ focused: null });
    const main = window(1);
    turn(attention, conversation());
    attention.setInView(main, ['conv-1']);
    assert.strictEqual(shown[0].closed, false, 'on screen, but the window has no focus yet');
    state.focused = 1;
    attention.focused(1);
    assert.strictEqual(shown[0].closed, true);
});

check('switching to it in the focused window takes it down too', () => {
    const { attention, shown } = harness({ focused: 1 });
    const main = window(1);
    attention.setInView(main, ['conv-2']);
    turn(attention, conversation('conv-1'));
    attention.setInView(main, ['conv-1']);
    assert.strictEqual(shown[0].closed, true);
});

check('writing to it again takes it down', () => {
    const { attention, shown } = harness();
    const chat = conversation();
    turn(attention, chat);
    attention.observe(chat, { type: 'user-message', text: 'and the other one' });
    assert.strictEqual(shown[0].closed, true);
});

check('a window that closes is forgotten', () => {
    const { attention, shown } = harness({ focused: 1 });
    const main = window(1);
    attention.setInView(main, ['conv-1']);
    main.gone();
    turn(attention, conversation('conv-1'));
    assert.strictEqual(shown.length, 1);
});

console.log('\nclick and sound');

check('clicking it opens the conversation it is about', () => {
    const { attention, shown, opened } = harness();
    turn(attention, conversation('conv-7'));
    shown[0].emit('click');
    assert.deepStrictEqual(opened, ['conv-7']);
});

check('the chime plays once the system has shown it, and not with the sound off', () => {
    const on = harness();
    turn(on.attention, conversation());
    assert.strictEqual(on.state.chimes, 1);
    const off = harness({ settings: { notifySound: false } });
    turn(off.attention, conversation());
    assert.strictEqual(off.shown.length, 1);
    assert.strictEqual(off.state.chimes, 0);
});

console.log('\nwords and secrets');

check('the words follow the language the renderer sends; anything missing stays English', () => {
    const { attention, shown } = harness();
    attention.setText({ done: '{title} 已完成', question: 42 });
    turn(attention, conversation());
    assert.strictEqual(shown[0].options.title, 'Restart nginx on web-01 已完成');
    attention.observe(conversation(), { type: 'approval-request', requestId: 'q', question: true, name: 'ask_user', input: { questions: [{ question: 'Which?' }] } });
    assert.strictEqual(shown[1].options.title, DEFAULT_TEXT.question.replace('{title}', 'Restart nginx on web-01'));
});

check('a chat with no title yet is named as the agent', () => {
    const { attention, shown } = harness();
    turn(attention, conversation('conv-1', { title: '' }));
    assert.strictEqual(shown[0].options.title, 'The AI agent is done');
});

check('a key the user pasted stays masked in the title and the body', () => {
    const { attention, shown } = harness();
    const key = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx';
    const chat = conversation('conv-1', { title: `use ${key} for deploys`, secrets: new Set([key]) });
    turn(attention, chat, `Saved ${key} to the env file.`);
    assert.ok(!shown[0].options.title.includes(key), shown[0].options.title);
    assert.ok(!shown[0].options.body.includes(key), shown[0].options.body);
    assert.ok(shown[0].options.body.includes('••••'));
});

check('a password the agent put in a command is masked in the approval', () => {
    const { attention, shown } = harness();
    attention.observe(conversation(), {
        type: 'approval-request',
        requestId: 'a',
        name: 'run_command',
        input: { command: 'mysql -u root --password=Tr0ub4dor&3xyz -e "show databases"' },
    });
    assert.ok(!shown[0].options.body.includes('Tr0ub4dor&3xyz'), shown[0].options.body);
});

check('a long reply is cut to a line the notification can show', () => {
    const { attention, shown } = harness();
    turn(attention, conversation(), `${'word '.repeat(200)}end`);
    assert.ok(shown[0].options.body.length <= 200);
    assert.ok(shown[0].options.body.endsWith('…'));
    assert.ok(!/\s{2}/.test(shown[0].options.body));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
