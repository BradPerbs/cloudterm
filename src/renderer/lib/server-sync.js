/**
 * Which folders on the Hosts page belong to the account sync.
 *
 * The ids are minted in `src/main/server-sync.js` and are that module's own
 * namespace: one folder for the account, and one inside it per project. A
 * folder the user makes is `folder-<timestamp>`, so it can never collide, and
 * the id survives a rename or a drag in a way the name does not.
 *
 * The page cares because those folders are not really the user's to arrange.
 * The sync writes a project's name and its place on every run, so a rename here
 * lasts until the next one; better to say where the folder came from than to
 * let somebody discover that by watching their edit undo itself.
 */

/** The folder the sync files every server under. */
export const SYNC_FOLDER_ID = 'cloudblast';

const PROJECT_PREFIX = 'cloudblast-folder-';

/**
 * What a folder is to the sync: 'account' for the CloudBlast folder itself,
 * 'project' for one of the projects mirrored inside it, and null for a folder
 * somebody made by hand.
 */
export function syncedFolder(folderId) {
    if (!folderId) return null;
    if (folderId === SYNC_FOLDER_ID) return 'account';
    return String(folderId).startsWith(PROJECT_PREFIX) ? 'project' : null;
}
