// Which OS the app is running on, as the main process sees it.
//
// Fixed for the life of the window, so it is read once here rather than
// threaded through props. Only a few things in the interface need it: macOS
// draws its own window controls, and Pageant and the registry importers exist
// nowhere but Windows.
//
// A blank fallback is deliberate. If the bridge is somehow missing, every flag
// below reads false, which shows the neutral form of each of those things
// rather than the wrong platform's.
const platform = window.api?.platform || '';

export const IS_MAC = platform === 'darwin';
export const IS_WINDOWS = platform === 'win32';
export const IS_LINUX = platform === 'linux';

/**
 * What the "hold this and click" key is called here.
 *
 * Written once so a setting label, its description and any hint about it all
 * name the same key, and so a Mac is never told to hold Ctrl for a chord it
 * answers to Cmd for.
 */
export const MODIFIER_KEY = IS_MAC ? 'Cmd' : 'Ctrl';

export default platform;
