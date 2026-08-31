/**
 * Pictures on their way into the composer.
 *
 * Whatever arrives, pasted, dropped or picked, is turned into the one shape
 * the bridge takes: a name, a media type and the bytes as base64. Anything
 * larger than the model accepts is scaled down here rather than refused, since
 * a full-resolution screenshot of a 4K display is the common case and nobody
 * wants to open an editor to ask about it.
 */

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** The API's ceiling per image. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The longest side a sent image keeps. The model downsamples anything past
 * about 1600 pixels anyway, so beyond this only the upload gets slower.
 */
const MAX_SIDE = 2000;

export const isImageFile = (file) => Boolean(file) && IMAGE_TYPES.includes(file.type);

/** How many bytes a base64 string decodes to. */
function decodedLength(data) {
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return Math.floor((data.length * 3) / 4) - padding;
}

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('The file could not be read'));
        reader.readAsDataURL(file);
    });
}

/** `{ mediaType, data }` from a data URL. */
function splitDataUrl(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(5, comma);
    return { mediaType: header.split(';')[0], data: dataUrl.slice(comma + 1) };
}

/**
 * Re-encode the picture at `scale`, as PNG when it came in as PNG and JPEG
 * otherwise. A PNG is kept as PNG so a screenshot's text stays crisp; JPEG for
 * the rest is what makes a photograph fit.
 */
function reencode(bitmap, scale, mediaType) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return mediaType === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * One file, ready to send: `{ name, mediaType, data, dataUrl }`. `dataUrl` is
 * for the thumbnail; the other three are what cross the bridge.
 *
 * Rejects with a message when the file is not an image, or cannot be brought
 * under the limit.
 */
export async function readImage(file) {
    if (!isImageFile(file)) throw new Error('not an image');

    const name = file.name || 'image';
    let dataUrl = await readAsDataUrl(file);
    let { mediaType, data } = splitDataUrl(dataUrl);

    // An animated GIF cannot be redrawn without losing the animation, so it is
    // sent as it is or not at all. Everything else can be scaled.
    if (mediaType === 'image/gif') {
        if (decodedLength(data) > MAX_IMAGE_BYTES) throw new Error('too large');
        return { name, mediaType, data, dataUrl };
    }

    const bitmap = await createImageBitmap(file);
    try {
        const longest = Math.max(bitmap.width, bitmap.height);
        let scale = Math.min(1, MAX_SIDE / longest);
        // The first pass brings the size down; the later ones only happen for
        // a picture that is still too heavy at that size, and each takes a
        // further third off.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            if (scale === 1 && decodedLength(data) <= MAX_IMAGE_BYTES) break;
            dataUrl = reencode(bitmap, scale, mediaType);
            ({ mediaType, data } = splitDataUrl(dataUrl));
            if (decodedLength(data) <= MAX_IMAGE_BYTES) break;
            scale *= 0.66;
        }
    } finally {
        bitmap.close?.();
    }

    if (decodedLength(data) > MAX_IMAGE_BYTES) throw new Error('too large');
    return { name, mediaType, data, dataUrl };
}

/** The image files among what was pasted or dropped, in order. */
export function imageFiles(transfer) {
    if (!transfer) return [];
    return Array.from(transfer.files || []).filter(isImageFile);
}
