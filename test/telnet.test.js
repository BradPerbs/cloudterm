/**
 * Telnet option negotiation and stream escaping.
 *
 * This is the part of telnet worth testing, for the same reason the ANSI
 * stripper in session-log.js is: it runs on every byte a server sends and it
 * fails quietly. A command left in the stream draws as garbage in the middle of
 * a line, and a negotiation loop shows up as a session that connects and then
 * prints nothing at all — neither says which of the two it was.
 *
 * The state machine takes no sockets, so everything here is byte arrays in and
 * byte arrays out.
 */
const path = require('path');
const assert = require('assert');

const {
    createNegotiator,
    IAC, DO, DONT, WILL, WONT, SB, SE,
    OPTIONS,
    TERMINAL_TYPE_IS,
    TERMINAL_TYPE_SEND,
} = require(path.join(__dirname, '..', 'src', 'main', 'telnet-protocol.js'));

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

/** A negotiator plus everything it has tried to send, flattened. */
function harness(options = {}) {
    const sent = [];
    const negotiator = createNegotiator({
        ...options,
        send: (bytes) => sent.push(...bytes),
    });
    return {
        negotiator,
        sent,
        /** Everything sent since the last call, so each step reads on its own. */
        drain() {
            return sent.splice(0, sent.length);
        },
    };
}

const bytes = (buffer) => Array.from(buffer);

console.log('\ntelnet: the data stream');

check('passes ordinary output through untouched', () => {
    const { negotiator } = harness();
    const out = negotiator.receive(Buffer.from('login: '));
    assert.strictEqual(out.toString(), 'login: ');
});

check('takes commands out of the data', () => {
    const { negotiator } = harness();
    const out = negotiator.receive(Buffer.from([
        ...Buffer.from('a'),
        IAC, WILL, OPTIONS.ECHO,
        ...Buffer.from('b'),
    ]));
    assert.strictEqual(out.toString(), 'ab');
});

check('a doubled IAC is one literal 0xFF of data', () => {
    const { negotiator } = harness();
    const out = negotiator.receive(Buffer.from([0x41, IAC, IAC, 0x42]));
    assert.deepStrictEqual(bytes(out), [0x41, 0xff, 0x42]);
});

check('a command split across two reads is still consumed', () => {
    // The normal case rather than an edge one: a socket splits wherever it
    // likes. A parser rebuilt per chunk would emit 0xFF 0xFB as text here.
    const { negotiator, drain } = harness();

    const first = negotiator.receive(Buffer.from([0x41, IAC, WILL]));
    assert.strictEqual(first.toString(), 'A', 'the half-command must not reach the terminal');

    const second = negotiator.receive(Buffer.from([OPTIONS.ECHO, 0x42]));
    assert.strictEqual(second.toString(), 'B');
    assert.deepStrictEqual(drain(), [IAC, DO, OPTIONS.ECHO], 'and it is still answered');
});

check('a subnegotiation split across three reads is reassembled', () => {
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.TERMINAL_TYPE]));
    drain();

    negotiator.receive(Buffer.from([IAC, SB]));
    negotiator.receive(Buffer.from([OPTIONS.TERMINAL_TYPE, TERMINAL_TYPE_SEND]));
    const out = negotiator.receive(Buffer.from([IAC, SE]));

    assert.strictEqual(out.length, 0, 'a subnegotiation is not data');
    assert.deepStrictEqual(drain(), [
        IAC, SB, OPTIONS.TERMINAL_TYPE, TERMINAL_TYPE_IS,
        ...Buffer.from('XTERM-256COLOR'),
        IAC, SE,
    ]);
});

check('drops the NUL padding after a CR', () => {
    // RFC 854's strict form for a bare carriage return. xterm draws the NUL as
    // a cell, so left alone it puts a stray character at the end of every line.
    const { negotiator } = harness();
    const out = negotiator.receive(Buffer.from([0x41, 0x0d, 0x00, 0x42]));
    assert.deepStrictEqual(bytes(out), [0x41, 0x0d, 0x42]);
});

check('leaves a real CR LF alone', () => {
    const { negotiator } = harness();
    const out = negotiator.receive(Buffer.from('one\r\ntwo'));
    assert.strictEqual(out.toString(), 'one\r\ntwo');
});

console.log('\ntelnet: answering the server');

check('accepts the options that make it character-at-a-time', () => {
    // Without ECHO and SUPPRESS-GO-AHEAD the server waits for a whole line
    // before it says anything, and nothing appears as you type.
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.ECHO]));
    assert.deepStrictEqual(drain(), [IAC, DO, OPTIONS.ECHO]);

    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.SUPPRESS_GO_AHEAD]));
    assert.deepStrictEqual(drain(), [IAC, DO, OPTIONS.SUPPRESS_GO_AHEAD]);
});

check('refuses an option it does not implement', () => {
    // Agreeing and then not doing it is worse than refusing: the server waits
    // for a subnegotiation that never comes.
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NEW_ENVIRON]));
    assert.deepStrictEqual(drain(), [IAC, WONT, OPTIONS.NEW_ENVIRON]);

    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.STATUS]));
    assert.deepStrictEqual(drain(), [IAC, DONT, OPTIONS.STATUS]);
});

check('agrees to say what terminal it is', () => {
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.TERMINAL_TYPE]));
    assert.deepStrictEqual(drain(), [IAC, WILL, OPTIONS.TERMINAL_TYPE]);
});

check('does not answer an offer it has already answered', () => {
    // The property that stops a negotiation loop. Two implementations that
    // acknowledge every acknowledgement spend the session bouncing the same
    // three bytes off each other and the terminal never draws anything.
    const { negotiator, drain } = harness();

    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.ECHO]));
    assert.deepStrictEqual(drain(), [IAC, DO, OPTIONS.ECHO]);

    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.ECHO]));
    assert.deepStrictEqual(drain(), [], 'the repeat is silence, not a second DO');

    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NEW_ENVIRON]));
    drain();
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NEW_ENVIRON]));
    assert.deepStrictEqual(drain(), [], 'a repeated refusal is silent too');
});

check('answers again once the state has actually changed', () => {
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.ECHO]));
    drain();

    negotiator.receive(Buffer.from([IAC, WONT, OPTIONS.ECHO]));
    assert.deepStrictEqual(drain(), [IAC, DONT, OPTIONS.ECHO], 'a withdrawal is acknowledged');

    negotiator.receive(Buffer.from([IAC, WILL, OPTIONS.ECHO]));
    assert.deepStrictEqual(drain(), [IAC, DO, OPTIONS.ECHO], 'and so is offering it again');
});

check('ignores a two-byte command that needs no answer', () => {
    const { negotiator, drain } = harness();
    // IAC GA, which a server sends constantly before SGA is agreed.
    const out = negotiator.receive(Buffer.from([0x41, IAC, 249, 0x42]));
    assert.strictEqual(out.toString(), 'AB');
    assert.deepStrictEqual(drain(), []);
});

console.log('\ntelnet: window size');

check('sends the size only once NAWS is agreed', () => {
    const { negotiator, drain } = harness();

    negotiator.resize(120, 40);
    assert.deepStrictEqual(drain(), [], 'nothing before the server has asked');

    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NAWS]));
    assert.deepStrictEqual(drain(), [
        IAC, WILL, OPTIONS.NAWS,
        IAC, SB, OPTIONS.NAWS, 0, 120, 0, 40, IAC, SE,
    ], 'the WILL comes first, then the size it agreed to send');
});

check('a later resize is sent on its own', () => {
    // Dragging the pane divider, once NAWS is already agreed: the size goes out
    // by itself, with no second WILL in front of it. Deliberately not 80x24,
    // which is the size the negotiator starts at and so would be suppressed as
    // a no-op — see the next check.
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NAWS]));
    drain();

    negotiator.resize(132, 43);
    assert.deepStrictEqual(drain(), [IAC, SB, OPTIONS.NAWS, 0, 132, 0, 43, IAC, SE]);
});

check('a resize to the same size says nothing', () => {
    const { negotiator, drain } = harness();
    negotiator.resize(80, 24);
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NAWS]));
    drain();

    negotiator.resize(80, 24);
    assert.deepStrictEqual(drain(), []);
});

check('escapes a 255 inside the size', () => {
    // A 255-column pane would otherwise put an IAC in the middle of a
    // subnegotiation and end it early.
    const { negotiator, drain } = harness();
    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NAWS]));
    drain();

    negotiator.resize(255, 24);
    assert.deepStrictEqual(drain(), [
        IAC, SB, OPTIONS.NAWS, 0, 255, 255, 0, 24, IAC, SE,
    ]);
});

console.log('\ntelnet: what goes out');

check('turns a bare CR into CR LF', () => {
    // xterm sends a bare CR for Enter. A server given that sees no line ending
    // at all, so nothing typed ever runs.
    const { negotiator } = harness();
    assert.deepStrictEqual(bytes(negotiator.encode('show version\r')),
        [...Buffer.from('show version'), 0x0d, 0x0a]);
});

check('leaves a CR that already has its LF', () => {
    // Or a pasted block arrives double-spaced.
    const { negotiator } = harness();
    assert.strictEqual(negotiator.encode('one\r\ntwo\r\n').toString(), 'one\r\ntwo\r\n');
});

check('doubles a 0xFF that was typed', () => {
    const { negotiator } = harness();
    assert.deepStrictEqual(bytes(negotiator.encode(Buffer.from([0x41, 0xff, 0x42]))),
        [0x41, 0xff, 0xff, 0x42]);
});

check('leaves ordinary input alone', () => {
    const { negotiator } = harness();
    assert.strictEqual(negotiator.encode('ls -la').toString(), 'ls -la');
});

console.log('\ntelnet: opening the conversation');

check('offers what it can do rather than waiting to be asked', () => {
    // A server waiting for the client and a client waiting for the server is a
    // session that shows nothing until a key is pressed.
    const { negotiator, drain } = harness();
    negotiator.start();
    assert.deepStrictEqual(drain(), [
        IAC, WILL, OPTIONS.TERMINAL_TYPE,
        IAC, WILL, OPTIONS.NAWS,
        IAC, DO, OPTIONS.SUPPRESS_GO_AHEAD,
        IAC, DO, OPTIONS.ECHO,
    ]);
});

check('does not send the size on the strength of its own offer', () => {
    // WILL NAWS is an offer; DO NAWS is the agreement. A subnegotiation sent
    // between the two is one for an option that has not been agreed, which
    // some servers drop the connection over.
    const { negotiator, drain } = harness();
    negotiator.start();
    drain();

    negotiator.resize(200, 60);
    assert.deepStrictEqual(drain(), []);

    negotiator.receive(Buffer.from([IAC, DO, OPTIONS.NAWS]));
    assert.deepStrictEqual(drain(), [IAC, SB, OPTIONS.NAWS, 0, 200, 0, 60, IAC, SE],
        'no second WILL, since that was already offered — just the size');
});

console.log(`\n${passed} checks passed\n`);
