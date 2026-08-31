/**
 * Images attached to a message, checked before anything is done with them.
 *
 * The renderer reads the file, scales it down if it has to, and sends base64
 * across the bridge. This is the other side of that: nothing here trusts the
 * shape it was handed, because the bytes go straight into a model request and
 * a malformed block fails the whole turn with an error the user cannot read.
 *
 * The limits are the API's own. Five megabytes is the ceiling per image and
 * these four are the types it decodes; the count is a sanity cap rather than a
 * limit anyone should meet.
 */

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** How many bytes a base64 string decodes to, without decoding it. */
function decodedLength(data) {
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * The attachments as `{ name, mediaType, data }`, or the reason one of them
 * cannot be sent.
 *
 * All or nothing: a message with one image the model cannot read is not sent
 * with the other three, because the text was written about all four.
 */
function readImages(raw) {
    if (raw === undefined || raw === null) return { images: [], error: '' };
    if (!Array.isArray(raw)) return { images: [], error: 'The attachments were not a list' };
    if (raw.length > MAX_IMAGES) {
        return { images: [], error: `A message can carry at most ${MAX_IMAGES} images` };
    }

    const images = [];
    for (const entry of raw) {
        const name = String(entry?.name || 'image').replace(/\s+/g, ' ').trim().slice(0, 120) || 'image';
        const mediaType = String(entry?.mediaType || '').toLowerCase();
        const data = typeof entry?.data === 'string' ? entry.data : '';

        if (!IMAGE_TYPES.has(mediaType)) {
            return { images: [], error: `${name} is not a PNG, JPEG, GIF or WebP image` };
        }
        if (!data || data.length % 4 !== 0 || !BASE64.test(data)) {
            return { images: [], error: `${name} could not be read` };
        }
        if (decodedLength(data) > MAX_IMAGE_BYTES) {
            return { images: [], error: `${name} is larger than the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB an image may be` };
        }
        images.push({ name, mediaType, data });
    }
    return { images, error: '' };
}

/**
 * The same images without their bytes, for the transcript on disk.
 *
 * A screenshot is a megabyte of base64 and the archive's whole budget is a
 * quarter of that, so keeping the pixels would cost the conversation they were
 * sent in. What survives is enough to draw a chip where the picture was.
 */
function stripImages(images) {
    return images.map(({ name, mediaType }) => ({ name, mediaType }));
}

module.exports = { readImages, stripImages, IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES };
