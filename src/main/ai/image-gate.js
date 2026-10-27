/**
 * Whether a picture can go to the agent answering, on the model it is set to.
 *
 * Three things have to hold, and the composer asks the same three before it
 * offers the picture button (see `lib/image-gate` there). The runtime has to
 * carry pictures at all (`supportsImages` on the provider). The model has to
 * read them: a model list can mark a row `images: false`, which is how Grok
 * Build's coding models and its text-only API path say they cannot. And a
 * runtime that opens pictures as files with its own Read tool
 * (`imagesNeedLocalTools`) needs the local tools switched on, since without
 * them the file is there and nothing can open it.
 *
 * A model the list does not name is given the runtime's answer. The list is
 * read when the menu first opens, and a message sent before that should not
 * be refused on a guess.
 *
 * Kept free of Electron so it can be tested on its own.
 */

/**
 * The row of `catalog` the settings point at: the model by its id or the wire
 * id it stands for, and with nothing pinned the one the runtime marks as its
 * default. Undefined when the list says nothing about it.
 */
function modelRow(catalog, model) {
    const rows = Array.isArray(catalog) ? catalog : [];
    if (!model) return rows.find(row => row.preferred);
    return rows.find(row => row.value === model) || rows.find(row => row.resolved === model);
}

/**
 * Why a picture cannot go, or '' when it can. Said in a sentence a person can
 * act on, since it is shown to them as the reason their message was refused.
 */
function imageRefusal({ provider, settings = {}, catalog = null } = {}) {
    if (provider?.supportsImages !== true) {
        return 'This agent cannot read images. Claude Code, Codex and Grok Build can.';
    }
    const row = modelRow(catalog, settings.model);
    if (row && row.images === false) {
        return `${row.label || row.value || 'This model'} cannot read images. Pick a model that can, or send the words alone.`;
    }
    if (provider.imagesNeedLocalTools === true && settings.allowLocalTools === false) {
        return 'This agent opens images as files on this computer, and local tools are switched off in '
            + 'Settings, so it cannot read them.';
    }
    return '';
}

module.exports = { imageRefusal, modelRow };
