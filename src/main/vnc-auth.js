/**
 * The DES used by RFB "VNC Authentication" (security type 2).
 *
 * Node cannot help here: `des-ecb` moved to OpenSSL 3's legacy provider, which
 * Electron does not enable, so `createCipheriv('des-ecb', …)` throws
 * `digital envelope routines::unsupported`. The cipher is needed regardless,
 * because the challenge-response in RFB §7.2.2 is defined in terms of it.
 *
 * Two things about this DES are specific to VNC and are the usual reason an
 * implementation "works" against nothing:
 *
 *   - the key is the password, truncated or zero-padded to exactly 8 bytes;
 *   - every key byte has its bits reversed, because the original AT&T code
 *     read the key least-significant-bit first and every server since has
 *     copied it.
 *
 * Encrypt-only, and never used for anything but this handshake. It is a 1998
 * cipher with a 56-bit key and an 8-byte password ceiling; that is a statement
 * about RFB, not a choice made here.
 */

/* Tables are the FIPS 46-3 ones, 1-indexed as they are published so they can be
 * checked against the spec by eye. */

const PC1 = [
    57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
    10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
    63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
    14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const PC2 = [
    14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
    23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
    41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
    44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const IP = [
    58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
    62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
    57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
    61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const FP = [
    40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
    38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
    36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
    34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const E = [
    32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
    8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
    16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
    24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const P = [
    16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
    2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const S = [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
        0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
        4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
        15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
        3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
        0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
        13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
        13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
        13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
        1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
        13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
        10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
        3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
        14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
        4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
        11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
        10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
        9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
        4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
        13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
        1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
        6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
        1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
        7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
        2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

/** Bytes to one bit per element, most significant bit first. */
function toBits(buffer) {
    const bits = new Uint8Array(buffer.length * 8);
    for (let i = 0; i < buffer.length; i++) {
        for (let bit = 0; bit < 8; bit++) {
            bits[i * 8 + bit] = (buffer[i] >> (7 - bit)) & 1;
        }
    }
    return bits;
}

function fromBits(bits) {
    const buffer = Buffer.alloc(bits.length / 8);
    for (let i = 0; i < buffer.length; i++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | bits[i * 8 + bit];
        buffer[i] = byte;
    }
    return buffer;
}

/** Apply a 1-indexed permutation table. */
function permute(bits, table) {
    const out = new Uint8Array(table.length);
    for (let i = 0; i < table.length; i++) out[i] = bits[table[i] - 1];
    return out;
}

function rotateLeft(bits, count) {
    const out = new Uint8Array(bits.length);
    for (let i = 0; i < bits.length; i++) out[i] = bits[(i + count) % bits.length];
    return out;
}

/** The 16 round subkeys, 48 bits each. */
function scheduleKey(key) {
    const permuted = permute(toBits(key), PC1);
    let left = permuted.slice(0, 28);
    let right = permuted.slice(28, 56);

    const subkeys = [];
    for (let round = 0; round < 16; round++) {
        left = rotateLeft(left, SHIFTS[round]);
        right = rotateLeft(right, SHIFTS[round]);

        const combined = new Uint8Array(56);
        combined.set(left, 0);
        combined.set(right, 28);
        subkeys.push(permute(combined, PC2));
    }
    return subkeys;
}

/** The Feistel function: expand, mix in the subkey, substitute, permute. */
function feistel(right, subkey) {
    const expanded = permute(right, E);
    for (let i = 0; i < 48; i++) expanded[i] ^= subkey[i];

    const substituted = new Uint8Array(32);
    for (let box = 0; box < 8; box++) {
        const offset = box * 6;
        // Row from the outer two bits, column from the inner four.
        const row = (expanded[offset] << 1) | expanded[offset + 5];
        const column = (expanded[offset + 1] << 3)
            | (expanded[offset + 2] << 2)
            | (expanded[offset + 3] << 1)
            | expanded[offset + 4];

        const value = S[box][row * 16 + column];
        for (let bit = 0; bit < 4; bit++) {
            substituted[box * 4 + bit] = (value >> (3 - bit)) & 1;
        }
    }

    return permute(substituted, P);
}

/** One 8-byte block. Exported for the test vector; callers want `encrypt`. */
function encryptBlock(block, subkeys) {
    const permuted = permute(toBits(block), IP);
    let left = permuted.slice(0, 32);
    let right = permuted.slice(32, 64);

    for (let round = 0; round < 16; round++) {
        const mixed = feistel(right, subkeys[round]);
        for (let i = 0; i < 32; i++) mixed[i] ^= left[i];
        left = right;
        right = mixed;
    }

    // The halves are swapped once more before the final permutation.
    const preOutput = new Uint8Array(64);
    preOutput.set(right, 0);
    preOutput.set(left, 32);
    return fromBits(permute(preOutput, FP));
}

/** DES-ECB over a buffer that is a whole number of blocks. */
function encrypt(key, data) {
    if (key.length !== 8) throw new Error('DES key must be 8 bytes');
    if (data.length % 8 !== 0) throw new Error('DES input must be a multiple of 8 bytes');

    const subkeys = scheduleKey(key);
    const out = Buffer.alloc(data.length);
    for (let offset = 0; offset < data.length; offset += 8) {
        encryptBlock(data.subarray(offset, offset + 8), subkeys).copy(out, offset);
    }
    return out;
}

/** Reverse the bits of a byte: 0b1000_0000 -> 0b0000_0001. */
function reverseBits(byte) {
    let out = 0;
    for (let bit = 0; bit < 8; bit++) out |= ((byte >> bit) & 1) << (7 - bit);
    return out;
}

/**
 * The DES key RFB makes from a password: 8 bytes, zero-padded, bit-reversed.
 *
 * Latin-1 rather than UTF-8, because the byte the server hashed is the byte the
 * password was typed as on a 1990s terminal. A password with an accent in it
 * would otherwise agree with no server at all.
 */
function keyFromPassword(password) {
    const key = Buffer.alloc(8);
    Buffer.from(String(password ?? ''), 'latin1').copy(key, 0, 0, 8);
    for (let i = 0; i < 8; i++) key[i] = reverseBits(key[i]);
    return key;
}

/**
 * Answer a VNC Authentication challenge: the server's 16 random bytes,
 * DES-ECB encrypted under the password.
 */
function respond(password, challenge) {
    if (challenge.length !== 16) throw new Error('VNC challenge must be 16 bytes');
    return encrypt(keyFromPassword(password), challenge);
}

module.exports = {
    encrypt,
    keyFromPassword,
    respond,
    // Exported for the tests, which check this against the published FIPS vector
    // rather than against another implementation of the same guesswork.
    encryptBlock,
    scheduleKey,
};
