/**
 * The RDCleanPath PDU, encoded and decoded.
 *
 * RDCleanPath is the short preamble IronRDP's WASM client speaks to whatever is
 * proxying it, before the RDP session proper begins. It exists because the
 * client cannot do the first two steps itself: a browser has no TCP socket to
 * send an X.224 Connection Request on, and no way to see the server's TLS
 * certificate once one is established.
 *
 * So the client hands over its X.224 Connection Request and a destination, and
 * expects back the server's Connection Confirm and its certificate chain. From
 * that point the proxy is a pipe and the client drives the rest, including
 * CredSSP, which is why no password is needed on this side.
 *
 * One request, one response, and then it is over for the life of the session.
 *
 * The grammar, as IronRDP defines it:
 *
 *   RDCleanPathPdu ::= SEQUENCE {
 *       version           [0] INTEGER,
 *       error             [1] RDCleanPathErr OPTIONAL,
 *       destination       [2] UTF8String OPTIONAL,
 *       proxyAuth         [3] UTF8String OPTIONAL,
 *       serverAuth        [4] UTF8String OPTIONAL,
 *       preconnectionBlob [5] UTF8String OPTIONAL,
 *       x224ConnectionPdu [6] OCTET STRING OPTIONAL,
 *       serverCertChain   [7] SEQUENCE OF OCTET STRING OPTIONAL,
 *       serverAddr        [9] UTF8String OPTIONAL
 *   }
 *
 * Kept free of sockets so it can be exercised directly: a DER bug and a network
 * bug look identical from the outside, and only one of them is cheap to find.
 */

/** IronRDP's version constant. Not a port number, despite looking like one. */
const VERSION = 3390;

const TAG_SEQUENCE = 0x30;
const TAG_INTEGER = 0x02;
const TAG_OCTET_STRING = 0x04;
const TAG_UTF8STRING = 0x0c;

/** Context-specific constructed tag [n]. */
const contextTag = (n) => 0xa0 + n;

/** Error codes the client understands. */
const ERROR_GENERAL = 1;
const ERROR_NEGOTIATION = 2;

/**
 * A DER PDU longer than this is not something we produced or asked for. The
 * bound matters because the length header is attacker-supplied and is used to
 * size reads.
 */
const MAX_PDU = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * DER primitives
 * ------------------------------------------------------------------ */

function encodeLength(length) {
    if (length < 0x80) return Buffer.from([length]);

    const bytes = [];
    let rest = length;
    while (rest > 0) {
        bytes.unshift(rest & 0xff);
        rest = Math.floor(rest / 256);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function wrap(tag, content) {
    return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function encodeInteger(value) {
    if (value === 0) return wrap(TAG_INTEGER, Buffer.from([0]));

    const bytes = [];
    let rest = value;
    while (rest > 0) {
        bytes.unshift(rest & 0xff);
        rest = Math.floor(rest / 256);
    }
    // A leading zero keeps it unsigned when the high bit would otherwise say
    // negative.
    if (bytes[0] & 0x80) bytes.unshift(0);
    return wrap(TAG_INTEGER, Buffer.from(bytes));
}

const encodeUtf8String = (text) => wrap(TAG_UTF8STRING, Buffer.from(text, 'utf8'));
const encodeOctetString = (bytes) => wrap(TAG_OCTET_STRING, bytes);

/**
 * Read a DER length at `offset`.
 *
 * Multiplication rather than `<<`: a four-byte length shifted left overflows
 * into a negative number in JS, and a negative length would then be handed
 * straight to `subarray`.
 */
function decodeLength(buffer, offset) {
    if (offset >= buffer.length) throw new Error('Truncated DER length');

    const first = buffer[offset];
    if (first < 0x80) return { length: first, bytesRead: 1 };

    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new Error('Unsupported DER length form');
    if (offset + count >= buffer.length) throw new Error('Truncated DER length');

    let length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buffer[offset + 1 + i];
    if (length > MAX_PDU) throw new Error('DER length out of range');

    return { length, bytesRead: 1 + count };
}

/** Read one tag-length-value at `offset`. */
function decodeTlv(buffer, offset) {
    if (offset >= buffer.length) throw new Error('Truncated DER element');

    const tag = buffer[offset];
    const { length, bytesRead } = decodeLength(buffer, offset + 1);
    const start = offset + 1 + bytesRead;
    const end = start + length;
    if (end > buffer.length) throw new Error('DER element runs past the buffer');

    return { tag, value: buffer.subarray(start, end), totalLength: 1 + bytesRead + length };
}

/** Every element inside a constructed value. */
function decodeChildren(buffer) {
    const children = [];
    let offset = 0;
    while (offset < buffer.length) {
        const tlv = decodeTlv(buffer, offset);
        children.push(tlv);
        offset += tlv.totalLength;
    }
    return children;
}

function decodeInteger(buffer) {
    let value = 0;
    for (const byte of buffer) value = value * 256 + byte;
    return value;
}

/* ------------------------------------------------------------------ *
 * The PDU
 * ------------------------------------------------------------------ */

/**
 * Parse the client's request.
 *
 * Throws on anything malformed rather than returning a partial record: this is
 * the first thing read off a socket, and a half-understood PDU is worth less
 * than a clear failure.
 */
function parseRequest(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    const outer = decodeTlv(buffer, 0);
    if (outer.tag !== TAG_SEQUENCE) {
        throw new Error(`Expected a DER SEQUENCE, got 0x${outer.tag.toString(16)}`);
    }

    const request = {
        version: null,
        destination: '',
        proxyAuth: '',
        preconnectionBlob: '',
        x224ConnectionRequest: null,
    };

    for (const child of decodeChildren(outer.value)) {
        // Strip the class and constructed bits to get the tag number.
        switch (child.tag & 0x1f) {
            case 0:
                request.version = decodeInteger(decodeTlv(child.value, 0).value);
                break;
            case 2:
                request.destination = decodeTlv(child.value, 0).value.toString('utf8');
                break;
            case 3:
                request.proxyAuth = decodeTlv(child.value, 0).value.toString('utf8');
                break;
            case 5:
                request.preconnectionBlob = decodeTlv(child.value, 0).value.toString('utf8');
                break;
            case 6:
                request.x224ConnectionRequest = decodeTlv(child.value, 0).value;
                break;
            default:
                // Forwards compatibility: an unknown optional field is not an
                // error, it is a newer client.
                break;
        }
    }

    if (request.version !== VERSION) {
        throw new Error(`Unsupported RDCleanPath version ${request.version}`);
    }
    if (!request.destination) throw new Error('The request named no destination');
    if (!request.x224ConnectionRequest?.length) {
        throw new Error('The request carried no X.224 connection PDU');
    }

    return request;
}

/**
 * Build the success response: the server's Connection Confirm, and the
 * certificate chain the client needs to bind CredSSP to this TLS session.
 */
function buildResponse(serverAddr, x224Response, certChain) {
    const certificates = wrap(
        TAG_SEQUENCE,
        Buffer.concat(certChain.map(encodeOctetString))
    );

    return wrap(TAG_SEQUENCE, Buffer.concat([
        wrap(contextTag(0), encodeInteger(VERSION)),
        wrap(contextTag(6), encodeOctetString(x224Response)),
        wrap(contextTag(7), certificates),
        wrap(contextTag(9), encodeUtf8String(serverAddr)),
    ]));
}

/**
 * Build an error response.
 *
 * Worth sending rather than just closing the socket: the client surfaces the
 * code, so the difference between "nothing is listening" and "the handshake was
 * refused" survives as far as the pane.
 */
function buildError(errorCode = ERROR_GENERAL, httpStatusCode = null) {
    const parts = [wrap(contextTag(0), encodeInteger(errorCode))];
    if (httpStatusCode != null) {
        parts.push(wrap(contextTag(1), encodeInteger(httpStatusCode)));
    }

    return wrap(TAG_SEQUENCE, Buffer.concat([
        wrap(contextTag(0), encodeInteger(VERSION)),
        wrap(contextTag(1), wrap(TAG_SEQUENCE, Buffer.concat(parts))),
    ]));
}

/**
 * Split a destination into host and port.
 *
 * Written to accept what the client sends back, which is the address we gave
 * it, but IPv6 in brackets is handled because a literal address is exactly the
 * case where someone would use one.
 */
function parseDestination(destination, fallbackPort = 3389) {
    if (destination.startsWith('[')) {
        const end = destination.indexOf(']');
        if (end === -1) throw new Error(`Malformed IPv6 destination: ${destination}`);

        const host = destination.slice(1, end);
        const rest = destination.slice(end + 1);
        const port = rest.startsWith(':') ? Number(rest.slice(1)) : fallbackPort;
        return { host, port: Number.isInteger(port) ? port : fallbackPort };
    }

    const colon = destination.lastIndexOf(':');
    if (colon === -1) return { host: destination, port: fallbackPort };

    const port = Number(destination.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { host: destination, port: fallbackPort };
    }
    return { host: destination.slice(0, colon), port };
}

module.exports = {
    VERSION,
    ERROR_GENERAL,
    ERROR_NEGOTIATION,
    MAX_PDU,
    parseRequest,
    buildResponse,
    buildError,
    parseDestination,
};
