const path = require('path');

/**
 * Turning a name the *server* chose into a path on this machine.
 *
 * A remote filename is only constrained by POSIX: every byte except `/` and
 * NUL is legal, which leaves `\`, `..`, `C:` and `NUL` all perfectly valid
 * names for a file sitting on a Linux box. On Windows all four are path
 * syntax, so joining one straight onto a download directory lets the server
 * decide where the bytes land. `..\..\evil.exe` resolves clean out of the
 * folder the user picked, and the Startup folder is a short walk from there.
 *
 * So nothing from a listing is ever joined directly. Each name is first
 * reduced to a single inert segment, and the assembled path is then checked
 * against the root it was supposed to stay under. The second half catches
 * anything the first half missed, including whatever `path.join` decides a
 * future Node version should normalise.
 */

const WINDOWS = process.platform === 'win32';

/**
 * Characters Windows reads as path syntax or refuses outright. `\` is a
 * separator, `:` opens a drive or an alternate data stream, and the rest are
 * rejected by the filesystem. Only applied on Windows: `a\b` and `a:b` are
 * ordinary filenames on Linux and macOS, and mangling them there would
 * corrupt legitimate downloads for no benefit.
 */
const WINDOWS_ILLEGAL = /[\\:*?"<>|]/g;

/** Control characters are invalid in a filename on every platform we target. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Reserved DOS device names. Opening one writes to the device rather than to
 * a file, so a listing containing `nul` must not become a local `nul`.
 * The rule applies to the stem, so `nul.txt` is reserved too.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** A name that is only dots addresses a directory rather than naming a file. */
const DOTS_ONLY = /^\.+$/;

/**
 * Reduce a server-supplied name to one path segment that cannot traverse,
 * name a device, or fail to open. Returns `fallback` when nothing usable is
 * left, so a caller always gets a writable name back.
 */
function safeLocalSegment(name, fallback = 'download') {
    let segment = String(name ?? '');

    // `/` first: it is the one separator a remote name is guaranteed not to
    // contain, but the guarantee belongs to the server, not to us.
    segment = segment.replace(/\//g, '_').replace(CONTROL, '_');

    if (WINDOWS) segment = segment.replace(WINDOWS_ILLEGAL, '_');

    // `..` and `.` are traversal, never filenames.
    if (DOTS_ONLY.test(segment)) segment = '_'.repeat(segment.length);

    if (WINDOWS) {
        if (WINDOWS_RESERVED.test(segment)) segment = `_${segment}`;
        // Windows silently drops trailing dots and spaces, so `evil.exe . `
        // and `evil.exe` are the same file, which turns a distinct-looking
        // name into an overwrite of one that is already there.
        segment = segment.replace(/[. ]+$/, '');
    }

    return segment || fallback;
}

/**
 * Join server-supplied segments onto a trusted local root, refusing anything
 * that still escapes it. `root` is the directory the user chose; `segments`
 * are names straight out of a remote listing.
 */
function joinLocalSafe(root, ...segments) {
    const base = path.resolve(root);
    const target = path.resolve(base, ...segments.map(segment => safeLocalSegment(segment)));

    if (!isInsideLocal(base, target)) {
        // Unreachable via safeLocalSegment; a hard failure beats writing to a
        // path we cannot account for.
        throw new Error(`Refusing to write outside ${base}`);
    }

    return target;
}

/** True when `target` is `base` itself or sits underneath it. */
function isInsideLocal(base, target) {
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(target);

    if (resolvedTarget === resolvedBase) return true;

    // A string compare needs the separator, or `C:\dl` would appear to contain
    // `C:\dl-evil`. Case-insensitive on Windows, where paths are.
    const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;

    return WINDOWS
        ? resolvedTarget.toLowerCase().startsWith(prefix.toLowerCase())
        : resolvedTarget.startsWith(prefix);
}

module.exports = { safeLocalSegment, joinLocalSafe, isInsideLocal };
