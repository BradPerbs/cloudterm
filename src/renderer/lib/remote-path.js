// Remote paths are always POSIX, regardless of the local platform. The
// renderer has no Node access, so these replace `path.posix`.

export function joinRemote(base, name) {
    if (!name) return base || '/';
    const prefix = base === '/' ? '' : (base || '').replace(/\/+$/, '');
    return `${prefix}/${name.replace(/^\/+/, '')}`;
}

export function dirnameRemote(remotePath) {
    if (!remotePath || remotePath === '/') return '/';
    const trimmed = remotePath.replace(/\/+$/, '');
    const index = trimmed.lastIndexOf('/');
    if (index <= 0) return '/';
    return trimmed.slice(0, index);
}

export function basenameRemote(remotePath) {
    if (!remotePath || remotePath === '/') return '/';
    return remotePath.replace(/\/+$/, '').split('/').pop() || '/';
}

/** Local paths may be Windows-style, so split on both separators. */
export function basenameLocal(localPath) {
    return (localPath || '').split(/[\\/]/).pop();
}

/** Collapse `//`, `.` and `..` so the path bar accepts what a shell would. */
export function normalizeRemote(remotePath) {
    if (!remotePath) return '/';

    const absolute = remotePath.startsWith('/');
    const resolved = [];

    for (const segment of remotePath.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            resolved.pop();
            continue;
        }
        resolved.push(segment);
    }

    const joined = resolved.join('/');
    if (absolute) return `/${joined}`;
    return joined || '.';
}

/** Breadcrumb segments, each carrying the absolute path it navigates to. */
export function breadcrumbFor(remotePath) {
    const segments = (remotePath || '/').split('/').filter(Boolean);
    let current = '';
    return segments.map((name) => {
        current += `/${name}`;
        return { name, path: current };
    });
}

/** True when `child` sits inside `parent`. Blocks moving a directory into itself. */
export function isInside(parent, child) {
    if (parent === child) return true;
    const base = parent === '/' ? '/' : `${parent.replace(/\/+$/, '')}/`;
    return child.startsWith(base);
}
