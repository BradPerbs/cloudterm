/**
 * Whether the composer offers pictures: the button, paste and drop.
 *
 * The same three questions main asks before it takes one (see
 * `src/main/ai/image-gate.js`), so the button is there exactly when a
 * picture would go through. The runtime has to carry pictures, the model it
 * is set to has to read them (a row in its list can say `images: false`),
 * and a runtime that opens pictures as files with its own tools needs the
 * local tools on. A model the list does not name is given the runtime's
 * answer, since the list may not have been read yet.
 *
 * `answering` is `{ provider, model, allowLocalTools }`: the settings, or a
 * tab's own pick once a tab can have one.
 */

/** The row the model names, or with nothing pinned the runtime's default. */
function modelRow(catalog, model) {
    const rows = Array.isArray(catalog) ? catalog : [];
    if (!model) return rows.find(row => row.preferred);
    return rows.find(row => row.value === model) || rows.find(row => row.resolved === model);
}

export function canReadImages(answering, { imageProviders = [], localImageProviders = [], catalogs = {} } = {}) {
    const provider = answering?.provider;
    if (!provider || !imageProviders.includes(provider)) return false;
    if (localImageProviders.includes(provider) && answering.allowLocalTools === false) return false;
    const row = modelRow(catalogs?.[provider], answering.model);
    return !(row && row.images === false);
}

export default canReadImages;
