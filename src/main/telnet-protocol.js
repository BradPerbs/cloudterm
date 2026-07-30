/**
 * The Telnet protocol itself: RFC 854 option negotiation, and the escaping the
 * data stream needs on the way in and out.
 *
 * Split from telnet.js the way vnc-auth.js is split from vnc.js, and for the
 * same reason: this is the part that has to be exactly right and the part that
 * can be exercised without a server. It touches no sockets and requires
 * nothing, so a test drives it with byte arrays.
 *
 * Two jobs, and they are easy to conflate:
 *
 *   1. Commands have to come *out* of the stream. A telnet server interleaves
 *      IAC sequences with the bytes the shell printed, and one that reaches the
 *      terminal draws as garbage in the middle of a line.
 *
 *   2. Options have to be answered. A server that offers to echo and is never
 *      told either way will wait, and the session hangs before the first
 *      prompt with nothing on screen to explain it.
 *
 * The parser is resumable. A sequence split across two reads from the socket is
 * the normal case, not an edge one, so state lives on the instance rather than
 * being rebuilt per chunk.
 */

/* ------------------------------------------------------------------ *
 * The vocabulary (RFC 854 §"Command structure")
 * ------------------------------------------------------------------ */

const IAC = 255;   // "interpret as command", the escape that starts everything
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;    // begin subnegotiation
const SE = 240;    // end subnegotiation

const OPTIONS = {
    BINARY: 0,
    ECHO: 1,
    SUPPRESS_GO_AHEAD: 3,
    STATUS: 5,
    TERMINAL_TYPE: 24,
    END_OF_RECORD: 25,
    NAWS: 31,           // negotiate about window size, RFC 1073
    TERMINAL_SPEED: 32,
    REMOTE_FLOW_CONTROL: 33,
    LINEMODE: 34,
    NEW_ENVIRON: 39,
};

/** Subnegotiation verbs for TERMINAL-TYPE, RFC 1091. */
const TERMINAL_TYPE_IS = 0;
const TERMINAL_TYPE_SEND = 1;

/**
 * What we ask the *server* to do.
 *
 * ECHO and SUPPRESS-GO-AHEAD together are what turns a telnet session from the
 * half-duplex line-at-a-time thing the RFC describes into the character-at-a-
 * time stream a terminal emulator expects. Without them the server waits for a
 * whole line before it says anything and nothing appears as you type.
 */
const WANT_FROM_SERVER = new Set([
    OPTIONS.ECHO,
    OPTIONS.SUPPRESS_GO_AHEAD,
    OPTIONS.BINARY,
]);

/**
 * What we are willing to do ourselves.
 *
 * Deliberately short. Every option here is one this file actually implements;
 * agreeing to something and then not doing it is worse than refusing, because
 * the server then waits for a subnegotiation that never comes.
 */
const WANT_FROM_US = new Set([
    OPTIONS.TERMINAL_TYPE,
    OPTIONS.NAWS,
    OPTIONS.SUPPRESS_GO_AHEAD,
]);

/* Parser states. */
const DATA = 0;
const SEEN_IAC = 1;
const SEEN_VERB = 2;
const SUBNEG = 3;
const SUBNEG_IAC = 4;

/** A byte of 255 inside a value has to be doubled, or it reads as an IAC. */
function escapeIac(bytes) {
    const out = [];
    for (const byte of bytes) {
        out.push(byte);
        if (byte === IAC) out.push(IAC);
    }
    return out;
}

/**
 * One connection's negotiation state.
 *
 *   terminalType  what to answer a TERMINAL-TYPE request with
 *   send          hands a Buffer of protocol bytes straight to the socket;
 *                 never application data, so it bypasses `encode` entirely
 */
function createNegotiator({ terminalType = 'xterm-256color', send } = {}) {
    const emit = typeof send === 'function' ? send : () => {};

    let state = DATA;
    let verb = 0;
    let subnegotiation = [];

    /**
     * The last thing we told the far end about each option, one map per
     * direction.
     *
     * This is what stops a negotiation loop. RFC 854 §"option negotiation" is
     * explicit that a party must not acknowledge a request that changes
     * nothing: two implementations that answer every WILL with a DO spend the
     * session bouncing the same two bytes off each other, and the terminal
     * never sees a byte of output. So a reply goes out only when it differs
     * from the last one sent for that option.
     */
    const toldServer = new Map();   // option -> DO | DONT
    const toldOurself = new Map();  // option -> WILL | WONT

    /** What we have asked the server for, and what we have offered to do. */
    const serverDoing = new Set();
    const weOffered = new Set();

    /**
     * Options the server has actually told us to do.
     *
     * Distinct from `weOffered` on purpose. Offering WILL NAWS and being told
     * DO NAWS are two different moments, and a subnegotiation sent between them
     * is one for an option that has not been agreed — a protocol error some
     * servers drop the connection over. A pane resized in that window would do
     * exactly that.
     */
    const agreedByServer = new Set();

    let size = { cols: 80, rows: 24 };

    const command = (...bytes) => emit(Buffer.from(bytes));

    /** Only speaks when the answer changes. See `toldServer` above. */
    function replyToServerOffer(option, accept) {
        const reply = accept ? DO : DONT;
        if (toldServer.get(option) === reply) return;
        toldServer.set(option, reply);
        if (accept) serverDoing.add(option);
        else serverDoing.delete(option);
        command(IAC, reply, option);
    }

    function replyAboutUs(option, accept) {
        const reply = accept ? WILL : WONT;
        if (toldOurself.get(option) === reply) return;
        toldOurself.set(option, reply);
        if (accept) weOffered.add(option);
        else {
            weOffered.delete(option);
            agreedByServer.delete(option);
        }
        command(IAC, reply, option);
    }

    /**
     * Tell the server the window size, RFC 1073.
     *
     * Sent whenever the pane is resized, but only once the server has actually
     * asked us to do NAWS: an unsolicited subnegotiation for an option that was
     * never agreed is a protocol error, and some servers drop the connection
     * over it.
     */
    function sendWindowSize() {
        if (!agreedByServer.has(OPTIONS.NAWS)) return;
        const { cols, rows } = size;
        const payload = escapeIac([
            (cols >> 8) & 0xff, cols & 0xff,
            (rows >> 8) & 0xff, rows & 0xff,
        ]);
        emit(Buffer.from([IAC, SB, OPTIONS.NAWS, ...payload, IAC, SE]));
    }

    function sendTerminalType() {
        const name = Buffer.from(terminalType.toUpperCase(), 'ascii');
        emit(Buffer.from([
            IAC, SB, OPTIONS.TERMINAL_TYPE, TERMINAL_TYPE_IS,
            ...escapeIac(name),
            IAC, SE,
        ]));
    }

    function handleSubnegotiation(bytes) {
        if (bytes.length === 0) return;
        const option = bytes[0];

        // The only subnegotiation we answer. Everything else is for an option
        // we refused, so there is nothing sensible to say about it.
        if (option === OPTIONS.TERMINAL_TYPE && bytes[1] === TERMINAL_TYPE_SEND) {
            sendTerminalType();
        }
    }

    function handleVerb(code, option) {
        switch (code) {
            case WILL:
                replyToServerOffer(option, WANT_FROM_SERVER.has(option));
                break;

            case WONT:
                // Always DONT, never silence: the server is withdrawing, and
                // leaving it unanswered leaves the option in a half-agreed
                // state that neither side can resolve.
                replyToServerOffer(option, false);
                break;

            case DO: {
                const accept = WANT_FROM_US.has(option);
                replyAboutUs(option, accept);
                if (accept) {
                    // The moment the option is actually in force. Anything sent
                    // before this — a resize while the offer was still in
                    // flight — is a subnegotiation for an unagreed option.
                    agreedByServer.add(option);
                    // The size follows the WILL rather than preceding it, which
                    // is why this is here and not in `replyAboutUs`.
                    if (option === OPTIONS.NAWS) sendWindowSize();
                }
                break;
            }

            case DONT:
                replyAboutUs(option, false);
                break;

            default:
                break;
        }
    }

    /**
     * Feed bytes off the socket; get back the ones the terminal should draw.
     *
     * Everything protocol-shaped is consumed here, and any reply it calls for
     * has already gone out through `send` by the time this returns.
     */
    function receive(chunk) {
        const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const output = [];

        for (const byte of input) {
            switch (state) {
                case DATA:
                    if (byte === IAC) state = SEEN_IAC;
                    else output.push(byte);
                    break;

                case SEEN_IAC:
                    if (byte === IAC) {
                        // A doubled IAC is one literal 0xFF of data.
                        output.push(IAC);
                        state = DATA;
                    } else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
                        verb = byte;
                        state = SEEN_VERB;
                    } else if (byte === SB) {
                        subnegotiation = [];
                        state = SUBNEG;
                    } else {
                        // A two-byte command with no option: GA, NOP, AYT and
                        // the rest. None needs an answer, and consuming it is
                        // the whole point.
                        state = DATA;
                    }
                    break;

                case SEEN_VERB:
                    handleVerb(verb, byte);
                    state = DATA;
                    break;

                case SUBNEG:
                    if (byte === IAC) state = SUBNEG_IAC;
                    else subnegotiation.push(byte);
                    break;

                case SUBNEG_IAC:
                    if (byte === SE) {
                        handleSubnegotiation(subnegotiation);
                        subnegotiation = [];
                        state = DATA;
                    } else if (byte === IAC) {
                        // Escaped 0xFF inside the payload.
                        subnegotiation.push(IAC);
                        state = SUBNEG;
                    } else {
                        // Malformed: an IAC inside a subnegotiation that is not
                        // SE and not another IAC. Treat it as the end rather
                        // than swallowing the rest of the session looking for
                        // one that never comes.
                        handleSubnegotiation(subnegotiation);
                        subnegotiation = [];
                        state = DATA;
                    }
                    break;

                default:
                    state = DATA;
                    break;
            }
        }

        return stripCarriageReturnNul(Buffer.from(output));
    }

    /**
     * Turn what was typed into what goes on the wire.
     *
     *   0xFF has to be doubled or the server reads it as a command.
     *
     *   A bare CR has to become CR LF. RFC 854 is explicit that CR must be
     *   followed by LF or NUL in the data stream, and xterm sends a bare CR for
     *   Enter. A server given the bare one sees no line ending at all, so
     *   nothing you type ever runs. A CR that already has its LF is left alone,
     *   which is what keeps a pasted block from arriving double-spaced.
     */
    function encode(data) {
        const text = typeof data === 'string' ? data : data.toString('binary');
        // Unconditional, because outbound BINARY is never negotiated: it is not
        // in WANT_FROM_US, so a server asking for it is refused and this side
        // of the connection is always in NVT mode.
        const withLineEndings = text.replace(/\r(?!\n)/g, '\r\n');

        const bytes = Buffer.from(withLineEndings, 'binary');
        if (!bytes.includes(IAC)) return bytes;
        return Buffer.from(escapeIac(bytes));
    }

    /** The pane was resized. Tells the server if it asked to be told. */
    function resize(cols, rows) {
        const width = Number(cols) > 0 ? Math.min(Math.round(cols), 65535) : 80;
        const height = Number(rows) > 0 ? Math.min(Math.round(rows), 65535) : 24;
        if (width === size.cols && height === size.rows) return;
        size = { cols: width, rows: height };
        sendWindowSize();
    }

    /**
     * Open the conversation rather than waiting to be asked.
     *
     * A server that is waiting for the client to speak first and a client doing
     * the same is a session that shows nothing until a key is pressed. Offering
     * what we can do costs three bytes each and settles it immediately.
     */
    function start() {
        replyAboutUs(OPTIONS.TERMINAL_TYPE, true);
        replyAboutUs(OPTIONS.NAWS, true);
        replyToServerOffer(OPTIONS.SUPPRESS_GO_AHEAD, true);
        replyToServerOffer(OPTIONS.ECHO, true);
    }

    return {
        start,
        receive,
        encode,
        resize,
        // Read by the tests, and by nothing else.
        isServerDoing: (option) => serverDoing.has(option),
        isOffered: (option) => weOffered.has(option),
        isAgreed: (option) => agreedByServer.has(option),
    };
}

/**
 * CR NUL means "a carriage return, and nothing else" (RFC 854). The NUL is
 * padding, not data, and xterm draws it as a cell rather than ignoring it, so a
 * server using the strict form ends every line with a stray character.
 */
function stripCarriageReturnNul(buffer) {
    if (!buffer.includes(0)) return buffer;

    const out = [];
    for (let index = 0; index < buffer.length; index += 1) {
        const byte = buffer[index];
        if (byte === 0 && index > 0 && buffer[index - 1] === 13) continue;
        out.push(byte);
    }
    return Buffer.from(out);
}

module.exports = {
    createNegotiator,
    // Exported so tests can build byte sequences in the protocol's own terms
    // rather than in magic numbers.
    IAC,
    DO,
    DONT,
    WILL,
    WONT,
    SB,
    SE,
    OPTIONS,
    TERMINAL_TYPE_IS,
    TERMINAL_TYPE_SEND,
};
