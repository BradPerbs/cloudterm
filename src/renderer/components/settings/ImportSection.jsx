import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    Download01Icon,
    ServerStack01Icon,
    ShieldKeyIcon,
    Alert02Icon,
    CheckmarkCircle02Icon,
} from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import SettingCard from './ui/SettingCard';
import { describeTunnel } from '../../lib/tunnels';
import { toastOptions } from '../../lib/toast';

const STATUS_BADGES = {
    new: null,
    present: { label: 'already added', tone: 'text-gray-400 dark:text-neutral-500' },
    conflict: { label: 'differs from stored key', tone: 'text-amber-600 dark:text-amber-500' },
};

export function StatusBadge({ status }) {
    const badge = STATUS_BADGES[status];
    if (!badge) return null;
    return <span className={`shrink-0 text-[11px] ${badge.tone}`}>{badge.label}</span>;
}

export function GroupHeader({ icon, title, count, selected, onToggleAll, children }) {
    return (
        <div className="flex items-center gap-3 px-3 h-10 border-b border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base/60">
            <Checkbox
                size="sm"
                checked={count > 0 && selected === count}
                indeterminate={selected > 0 && selected < count}
                disabled={count === 0}
                onChange={onToggleAll}
            />
            <span className="text-gray-400">{icon}</span>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
            <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                {selected} of {count} selected
            </span>
            <div className="flex-1" />
            {children}
        </div>
    );
}

/** A line of small facts under a row: tunnels, key state, parse warnings. */
function RowNotes({ host }) {
    const notes = [];

    if (host.tunnels?.length) {
        notes.push(host.tunnels.map(describeTunnel).join(' · '));
    }
    if (host.identityName) {
        notes.push(
            host.identityState === 'ready'
                ? `key ${host.identityName}`
                : `key ${host.identityName} (${host.identityState})`
        );
    }

    if (notes.length === 0 && host.warnings.length === 0) return null;

    return (
        <div className="pl-8 pr-3 pb-2 flex flex-col gap-0.5">
            {notes.length > 0 && (
                <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                    {notes.join('  |  ')}
                </span>
            )}
            {host.warnings.map(warning => (
                <span key={warning} className="text-[11px] text-amber-600 dark:text-amber-500">
                    {warning}
                </span>
            ))}
        </div>
    );
}

/**
 * Bring an existing OpenSSH setup in: `~/.ssh/config` becomes hosts (with the
 * port forwards it declares), `~/.ssh/known_hosts` becomes trusted keys.
 *
 * Everything already known is shown but left unchecked, so running this twice
 * is safe and re-scanning after an import shows exactly what it did.
 */
export default function ImportSection({ onImported }) {
    const [paths, setPaths] = useState(null);
    const [scan, setScan] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [importing, setImporting] = useState(false);
    const [report, setReport] = useState(null);

    const [selectedHosts, setSelectedHosts] = useState(() => new Set());
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    const [withIdentityFiles, setWithIdentityFiles] = useState(true);

    useEffect(() => {
        window.api.importer.paths().then(setPaths).catch(() => setPaths(null));
    }, []);

    const runScan = useCallback(async (options = {}) => {
        setScanning(true);
        setReport(null);
        try {
            const result = await window.api.importer.scan(options);
            setScan(result);
            // Pre-select only what would actually change something.
            setSelectedHosts(new Set(result.config.hosts.filter(h => h.status === 'new').map(h => h.key)));
            setSelectedKeys(new Set(result.knownHosts.entries.filter(e => e.status === 'new').map(e => e.key)));
        } catch (error) {
            toast.error(`Could not read the SSH config: ${error.message}`, toastOptions());
        } finally {
            setScanning(false);
        }
    }, []);

    const chooseFile = useCallback(async () => {
        const result = await window.api.dialog.open({
            title: 'Choose an SSH config file',
            properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths?.[0]) return;
        runScan({ configPath: result.filePaths[0] });
    }, [runScan]);

    const toggle = useCallback((setter, key) => {
        setter((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const hosts = scan?.config?.hosts || [];
    const entries = scan?.knownHosts?.entries || [];

    const toggleAllHosts = useCallback(() => {
        setSelectedHosts(current => (current.size === hosts.length ? new Set() : new Set(hosts.map(h => h.key))));
    }, [hosts]);

    const toggleAllKeys = useCallback(() => {
        setSelectedKeys(current => (current.size === entries.length ? new Set() : new Set(entries.map(e => e.key))));
    }, [entries]);

    const total = selectedHosts.size + selectedKeys.size;

    const runImport = useCallback(async () => {
        setImporting(true);
        try {
            const result = await window.api.importer.apply({
                configPath: scan.config.path,
                knownHostsPath: scan.knownHosts.path,
                aliases: [...selectedHosts],
                fingerprints: [...selectedKeys],
                importIdentityFiles: withIdentityFiles,
            });

            setReport(result);
            onImported?.();
            // Re-scan so everything just taken now reads as "already added".
            await runScan({ configPath: scan.config.path, knownHostsPath: scan.knownHosts.path });

            const parts = [];
            if (result.hosts.imported) parts.push(`${result.hosts.imported} host${result.hosts.imported > 1 ? 's' : ''}`);
            if (result.keys.imported) parts.push(`${result.keys.imported} key${result.keys.imported > 1 ? 's' : ''}`);
            if (result.knownHosts.imported) parts.push(`${result.knownHosts.imported} host key${result.knownHosts.imported > 1 ? 's' : ''}`);

            toast.success(parts.length ? `Imported ${parts.join(', ')}` : 'Nothing new to import', toastOptions());
        } catch (error) {
            toast.error(`Import failed: ${error.message}`, toastOptions());
        } finally {
            setImporting(false);
        }
    }, [scan, selectedHosts, selectedKeys, withIdentityFiles, onImported, runScan]);

    const skipNote = useMemo(() => {
        const stats = scan?.knownHosts?.stats;
        if (!stats) return '';

        const bits = [];
        if (stats.hashed) bits.push(`${stats.hashed} hashed`);
        if (stats.patterns) bits.push(`${stats.patterns} wildcard`);
        if (stats.markers) bits.push(`${stats.markers} certificate/revoked`);
        if (stats.malformed) bits.push(`${stats.malformed} unreadable`);

        return bits.length ? `${bits.join(', ')} skipped` : '';
    }, [scan]);

    return (
        <SettingCard className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Download01Icon size={18} strokeWidth={2} className="text-gray-400" />
                        From OpenSSH
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Read <code className="font-mono text-xs">~/.ssh/config</code> and{' '}
                        <code className="font-mono text-xs">~/.ssh/known_hosts</code> and bring
                        the hosts, their port forwards and their trusted keys in here.
                    </p>
                    {paths && !paths.hasConfig && !paths.hasKnownHosts && (
                        <p className="text-xs text-gray-400 dark:text-neutral-500 mt-2">
                            Nothing found in {paths.sshDir}. You can still pick a file.
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={chooseFile}
                        className="px-3 h-9 rounded-xl border border-gray-300 dark:border-surface-control text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                    >
                        Choose file…
                    </button>
                    <button
                        onClick={() => runScan()}
                        disabled={scanning}
                        className="px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-50"
                    >
                        {scanning ? 'Scanning…' : 'Scan ~/.ssh'}
                    </button>
                </div>
            </div>

            {scan && (
                <>
                    {/* Where the results came from, and what could not be read. */}
                    <div className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-neutral-500 font-mono">
                        <span className="truncate">
                            {scan.config.error ? `config: ${scan.config.error}` : scan.config.path}
                            {scan.config.stats?.files > 1 && ` (+${scan.config.stats.files - 1} included)`}
                        </span>
                        <span className="truncate">
                            {scan.knownHosts.error
                                ? `known_hosts: ${scan.knownHosts.error}`
                                : `${scan.knownHosts.path}${skipNote ? ` (${skipNote})` : ''}`}
                        </span>
                    </div>

                    {scan.config.warnings?.map(warning => (
                        <p key={warning} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                            <Alert02Icon size={13} strokeWidth={2} className="shrink-0 mt-px" />
                            {warning}
                        </p>
                    ))}

                    {/* Hosts */}
                    {hosts.length > 0 && (
                        <div className="border border-gray-200 dark:border-surface-control rounded-xl overflow-hidden">
                            <GroupHeader
                                icon={<ServerStack01Icon size={15} strokeWidth={2} />}
                                title="Hosts"
                                count={hosts.length}
                                selected={selectedHosts.size}
                                onToggleAll={toggleAllHosts}
                            />
                            <div className="max-h-72 overflow-y-auto">
                                {hosts.map(host => (
                                    <div
                                        key={host.key}
                                        className="border-b border-gray-100 dark:border-surface-control/60 last:border-b-0"
                                    >
                                        <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-surface-control/30">
                                            <Checkbox
                                                size="sm"
                                                checked={selectedHosts.has(host.key)}
                                                onChange={() => toggle(setSelectedHosts, host.key)}
                                            />
                                            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[10rem]">
                                                {host.name}
                                            </span>
                                            <span className="flex-1 min-w-0 text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                                                {host.username ? `${host.username}@` : ''}{host.host}
                                                {host.port !== 22 ? `:${host.port}` : ''}
                                            </span>
                                            <StatusBadge status={host.status} />
                                        </label>
                                        <RowNotes host={host} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Known hosts */}
                    {entries.length > 0 && (
                        <div className="border border-gray-200 dark:border-surface-control rounded-xl overflow-hidden">
                            <GroupHeader
                                icon={<ShieldKeyIcon size={15} strokeWidth={2} />}
                                title="Trusted host keys"
                                count={entries.length}
                                selected={selectedKeys.size}
                                onToggleAll={toggleAllKeys}
                            />
                            <div className="max-h-64 overflow-y-auto">
                                {entries.map(entry => (
                                    <label
                                        key={entry.key}
                                        className="flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-gray-100 dark:border-surface-control/60 last:border-b-0 hover:bg-gray-50 dark:hover:bg-surface-control/30"
                                    >
                                        <Checkbox
                                            size="sm"
                                            checked={selectedKeys.has(entry.key)}
                                            onChange={() => toggle(setSelectedKeys, entry.key)}
                                        />
                                        <span className="text-sm font-mono text-gray-900 dark:text-white truncate max-w-[12rem]">
                                            {entry.host}{entry.port !== 22 ? `:${entry.port}` : ''}
                                        </span>
                                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-surface-control text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                            {entry.keyType}
                                        </span>
                                        <span className="flex-1 min-w-0 text-[11px] font-mono text-gray-400 dark:text-neutral-500 truncate">
                                            {entry.fingerprint}
                                        </span>
                                        <StatusBadge status={entry.status} />
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {hosts.length === 0 && entries.length === 0 && (
                        <p className="text-sm text-gray-400 dark:text-neutral-500 py-6 text-center">
                            Nothing to import from these files.
                        </p>
                    )}

                    {/* Copying private keys is a real decision, so it is a
                        visible one rather than something done quietly. */}
                    {hosts.some(host => host.identityState === 'ready') && (
                        <Checkbox
                            variant="card"
                            checked={withIdentityFiles}
                            onChange={(event) => setWithIdentityFiles(event.target.checked)}
                            label="Copy the private keys these hosts reference"
                            description="Each IdentityFile is read into the keychain and encrypted with the OS keystore. Without this, imported hosts are set to use your SSH agent instead."
                        />
                    )}

                    <div className="flex items-center justify-between gap-4 pt-1">
                        <div className="min-w-0">
                            {report && (
                                <p className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                                    <CheckmarkCircle02Icon size={14} strokeWidth={2} className="shrink-0" />
                                    Imported {report.hosts.imported} host(s), {report.keys.imported} key(s),{' '}
                                    {report.knownHosts.imported} host key(s).
                                    {report.hosts.skipped + report.knownHosts.skipped > 0
                                        && ` ${report.hosts.skipped + report.knownHosts.skipped} already present.`}
                                    {report.hosts.relayed > 0
                                        && ` ${report.hosts.relayed} set to connect through a jump host.`}
                                </p>
                            )}
                        </div>
                        <button
                            onClick={runImport}
                            disabled={total === 0 || importing}
                            className="shrink-0 px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {importing ? 'Importing…' : total > 0 ? `Import ${total} selected` : 'Nothing selected'}
                        </button>
                    </div>
                </>
            )}
        </SettingCard>
    );
}
