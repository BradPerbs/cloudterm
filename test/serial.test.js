/**
 * The serial record: what a saved host means when it says 115200 8N1.
 *
 * Opening a real port needs a real cable, so what is tested here is the
 * vocabulary around it — and that is the part that matters, because a serial
 * port fails silently. A wrong baud rate does not report an error, it prints
 * plausible-looking garbage, so a normaliser that quietly rewrote a setting
 * would look exactly like a device with the wrong cable.
 */
const path = require('path');
const assert = require('assert');

const {
    normalizeProtocol,
    defaultPort,
    normalizeSerial,
    validateSerial,
    describeSerial,
    newlineFor,
    DEFAULT_SERIAL,
} = require(path.join(__dirname, '..', 'src', 'main', 'protocol-config.js'));

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

console.log('\nprotocol: which transport');

check('a record written before protocols existed is SSH', () => {
    // Every host saved by an earlier version has no `protocol` at all, and was
    // SSH. Anything else here would change what those records mean.
    assert.strictEqual(normalizeProtocol(undefined), 'ssh');
    assert.strictEqual(normalizeProtocol(''), 'ssh');
});

check('refuses a protocol it does not implement', () => {
    assert.strictEqual(normalizeProtocol('rlogin'), 'ssh');
    assert.strictEqual(normalizeProtocol('../../etc/passwd'), 'ssh');
});

check('keeps the three it does', () => {
    assert.strictEqual(normalizeProtocol('ssh'), 'ssh');
    assert.strictEqual(normalizeProtocol('telnet'), 'telnet');
    assert.strictEqual(normalizeProtocol('serial'), 'serial');
});

check('knows each protocol\'s own port', () => {
    assert.strictEqual(defaultPort('ssh'), 22);
    assert.strictEqual(defaultPort('telnet'), 23);
    // A serial line has no port number of any kind.
    assert.strictEqual(defaultPort('serial'), 0);
});

console.log('\nserial: normalising a record');

check('fills in a blank record with the usual console settings', () => {
    assert.deepStrictEqual(normalizeSerial({}), DEFAULT_SERIAL);
    assert.deepStrictEqual(normalizeSerial(undefined), DEFAULT_SERIAL);
    assert.deepStrictEqual(normalizeSerial(null), DEFAULT_SERIAL);
});

check('keeps a rate the list does not offer', () => {
    // An adapter will run at 31250 for MIDI or 250000 for DMX. Clamping to a
    // list would be inventing a limit the hardware does not have.
    assert.strictEqual(normalizeSerial({ baudRate: 31250 }).baudRate, 31250);
    assert.strictEqual(normalizeSerial({ baudRate: '250000' }).baudRate, 250000);
});

check('rejects a rate that is not a rate', () => {
    assert.strictEqual(normalizeSerial({ baudRate: 0 }).baudRate, 115200);
    assert.strictEqual(normalizeSerial({ baudRate: -9600 }).baudRate, 115200);
    assert.strictEqual(normalizeSerial({ baudRate: 'fast' }).baudRate, 115200);
});

check('falls back rather than passing a bad frame to the driver', () => {
    assert.strictEqual(normalizeSerial({ dataBits: 9 }).dataBits, 8);
    assert.strictEqual(normalizeSerial({ stopBits: 3 }).stopBits, 1);
    assert.strictEqual(normalizeSerial({ parity: 'sometimes' }).parity, 'none');
    assert.strictEqual(normalizeSerial({ flowControl: 'magic' }).flowControl, 'none');
});

check('keeps the unusual frames that are real', () => {
    assert.strictEqual(normalizeSerial({ dataBits: 7 }).dataBits, 7);
    assert.strictEqual(normalizeSerial({ stopBits: 1.5 }).stopBits, 1.5);
    assert.strictEqual(normalizeSerial({ parity: 'even' }).parity, 'even');
    assert.strictEqual(normalizeSerial({ flowControl: 'rtscts' }).flowControl, 'rtscts');
});

check('DTR and RTS are asserted unless a record says otherwise', () => {
    // Absent means on, which is what a terminal program does. Explicitly false
    // has to survive, or a board wired to reset on DTR reboots on every open.
    assert.strictEqual(normalizeSerial({}).dtr, true);
    assert.strictEqual(normalizeSerial({ dtr: false }).dtr, false);
    assert.strictEqual(normalizeSerial({ rts: false }).rts, false);
});

check('trims a port path', () => {
    assert.strictEqual(normalizeSerial({ path: '  COM3 ' }).path, 'COM3');
});

console.log('\nserial: naming and validating');

check('a port with no path cannot be opened', () => {
    assert.strictEqual(validateSerial({}).ok, false);
    assert.strictEqual(validateSerial({ path: 'COM3' }).ok, true);
});

check('names a line the way the documentation does', () => {
    // 115200 8N1 is the form every console manual is written in, which is what
    // makes a setting checkable against the label on the device.
    assert.strictEqual(
        describeSerial({ path: 'COM3', baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1 }),
        'COM3 · 115200 8N1'
    );
    assert.strictEqual(
        describeSerial({ path: '/dev/tty.usbserial-1420', baudRate: 9600, dataBits: 7, parity: 'even', stopBits: 2 }),
        '/dev/tty.usbserial-1420 · 9600 7E2'
    );
});

check('a half stop bit is not rounded away', () => {
    assert.strictEqual(
        describeSerial({ path: 'COM1', baudRate: 1200, dataBits: 8, parity: 'odd', stopBits: 1.5 }),
        'COM1 · 1200 8O1.5'
    );
});

check('names a port that has not been chosen yet', () => {
    assert.strictEqual(describeSerial({}), 'serial');
});

console.log('\nserial: what Enter sends');

check('defaults to CR, which is what network gear expects', () => {
    assert.strictEqual(newlineFor({}), '\r');
});

check('honours the other two', () => {
    assert.strictEqual(newlineFor({ newline: 'lf' }), '\n');
    assert.strictEqual(newlineFor({ newline: 'crlf' }), '\r\n');
});

check('an unknown setting is CR rather than nothing', () => {
    // Sending nothing at all would be a keyboard that does not work, which is
    // harder to diagnose than a device that answers the wrong line ending.
    assert.strictEqual(newlineFor({ newline: 'nel' }), '\r');
});

console.log(`\n${passed} checks passed\n`);
