const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';

    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), SIZE_UNITS.length - 1);
    const scaled = value / 1024 ** exponent;
    // Bytes are always whole; larger units read better with one decimal.
    const decimals = exponent === 0 ? 0 : scaled < 10 ? 1 : scaled < 100 ? 1 : 0;

    return `${scaled.toFixed(decimals)} ${SIZE_UNITS[exponent]}`;
}

export function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond < 1) return '';
    return `${formatSize(bytesPerSecond)}/s`;
}

export function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds < 1) return 'a moment';
    if (seconds < 60) return `${Math.round(seconds)}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

const DAY = 24 * 60 * 60 * 1000;

/** Recent files show a time; older ones a date, the same trick `ls -l` uses. */
export function formatDate(timestamp) {
    if (!timestamp) return '-';

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '-';

    const age = Date.now() - timestamp;
    if (age >= 0 && age < 180 * DAY) {
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function formatDateTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
}

const RWX = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];

/** Render the permission bits the way `ls -l` does, setuid/sticky included. */
export function formatMode(mode, { isDirectory = false, isSymlink = false } = {}) {
    const bits = (mode || 0) & 0o7777;
    const owner = RWX[(bits >> 6) & 7].split('');
    const group = RWX[(bits >> 3) & 7].split('');
    const other = RWX[bits & 7].split('');

    if (bits & 0o4000) owner[2] = owner[2] === 'x' ? 's' : 'S';
    if (bits & 0o2000) group[2] = group[2] === 'x' ? 's' : 'S';
    if (bits & 0o1000) other[2] = other[2] === 'x' ? 't' : 'T';

    const type = isSymlink ? 'l' : isDirectory ? 'd' : '-';
    return type + owner.join('') + group.join('') + other.join('');
}

export const formatOctal = (mode) => ((mode || 0) & 0o7777).toString(8).padStart(4, '0');
