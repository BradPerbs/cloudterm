import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
    Download01Icon,
    ServerStack01Icon,
    Alert02Icon,
    CheckmarkCircle02Icon,
    FileImportIcon,
    Loading03Icon,
    SearchRemoveIcon,
} from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import SettingCard from './ui/SettingCard';
import { StatusBadge, GroupHeader } from './ImportSection';
import { IS_WINDOWS } from '../../lib/platform';
import { describeTunnel } from '../../lib/tunnels';
import { toastOptions } from '../../lib/toast';
import logoPutty from '../../assets/icons/128_putty.png';
import logoKitty from '../../assets/icons/48_kitty.png';
import logoMobaxterm from '../../assets/icons/48_mobaxterm.png';

/**
 * Bring saved sessions in from the other terminals people migrate from:
 * PuTTY and KiTTY and MobaXterm (its ini, or a .mxtsessions export).
 *
 * PuTTY reads from the registry on Windows and from `~/.putty/sessions` on
 * everything else. KiTTY and MobaXterm are Windows programs, so away from it
 * they show as not found, and MobaXterm's file picker below is the way in.
 *
 * Same shape as the OpenSSH section above it: scan, tick what to take,
 * import. Everything already saved shows as "already added" and starts
 * unticked, so running it twice is safe.
 */

const SOURCES = [
    { id: 'putty', label: 'PuTTY', logo: logoPutty },
    { id: 'kitty', label: 'KiTTY', logo: logoKitty },
    { id: 'mobaxterm', label: 'MobaXterm', logo: logoMobaxterm },
];

const PROTOCOL_LABELS = { ssh: 'SSH', telnet: 'telnet', serial: 'serial', rdp: 'RDP', vnc: 'VNC' };

const KEY_STATES = {
    encrypted: 'passphrase-protected',
    ppk: 'needs conversion',
    unreadable: 'unreadable',
};

function sourceSubtitle(id, info) {
    if (info === undefined) return 'Checking…';
    if (!info?.found) return 'Not found';
    if (id === 'mobaxterm') return info.path.split(/[\\/]/).pop();
    const count = info.sessions || 0;
    return `${count} saved session${count === 1 ? '' : 's'}`;
}

/**
 * One importable app: its real logo, whether it was found, and an Import
 * button. The button is the click target, deliberately: a plain card reads
 * as information, a button reads as something to press.
 */
function SourceCard({ source, info, active, scanning, onScan }) {
    const found = Boolean(info?.found);
    const busy = active && scanning;

    return (
        <div
            className={`flex flex-col gap-3 p-3 rounded-xl border min-w-0 transition-colors ${
                active
                    ? 'border-gray-400 dark:border-neutral-600 bg-gray-50 dark:bg-surface-control/40'
                    : 'border-gray-200 dark:border-surface-control'
            }`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <img
                    src={source.logo}
                    alt=""
                    className={`w-9 h-9 shrink-0 object-contain ${found ? '' : 'grayscale opacity-40'}`}
                />
                <div className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                        {source.label}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-neutral-500 leading-tight min-w-0">
                        <span
                            aria-hidden="true"
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                found ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-neutral-700'
                            }`}
                        />
                        <span className="truncate">{sourceSubtitle(source.id, info)}</span>
                    </span>
                </div>
            </div>

            <button
                onClick={() => onScan(source.id)}
                disabled={!found || scanning}
                className="h-8 rounded-lg border border-gray-300 dark:border-surface-control text-xs
                    font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100
                    dark:hover:bg-surface-control transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed
                    flex items-center justify-center gap-1.5"
            >
                {busy && <Loading03Icon size={12} strokeWidth={2.5} className="animate-spin" />}
                {busy ? 'Scanning…' : 'Import'}
            </button>
        </div>
    );
}

/** A line of small facts under a row: folder, forwards, key state, warnings. */
function CandidateNotes({ host }) {
    const notes = [];

    if (host.folder) notes.push(`in ${host.folder}`);
    if (host.tunnels?.length) notes.push(host.tunnels.map(describeTunnel).join(' · '));
    if (host.identityName) {
        const state = KEY_STATES[host.identityState];
        notes.push(state ? `key ${host.identityName} (${state})` : `key ${host.identityName}`);
    }
    notes.push(...(host.notes || []));

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

export default function AppImportSection({ onImported }) {
    const [sources, setSources] = useState(null);
    const [active, setActive] = useState('');
    const [scan, setScan] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [importing, setImporting] = useState(false);
    const [report, setReport] = useState(null);

    const [selected, setSelected] = useState(() => new Set());
    const [withIdentityFiles, setWithIdentityFiles] = useState(true);

    useEffect(() => {
        // `{}` on failure so every card resolves to "Not found" rather than
        // sitting on "Checking…" forever; the file picker still works.
        window.api.importer.detect().then(setSources).catch(() => setSources({}));
    }, []);

    const runScan = useCallback(async (source, options = {}) => {
        setScanning(true);
        setReport(null);
        setActive(source);
        try {
            const result = await window.api.importer.scan({ source, ...options });
            setScan(result);
            setSelected(new Set(result.hosts.filter(h => h.status === 'new').map(h => h.key)));
        } catch (error) {
            toast.error(`Could not read the ${source} sessions: ${error.message}`, toastOptions());
        } finally {
            setScanning(false);
        }
    }, []);

    const chooseFile = useCallback(async () => {
        const result = await window.api.dialog.open({
            title: 'Choose a MobaXterm.ini or .mxtsessions file',
            properties: ['openFile'],
            filters: [
                { name: 'MobaXterm sessions', extensions: ['ini', 'mxtsessions'] },
                { name: 'All files', extensions: ['*'] },
            ],
        });
        if (result.canceled || !result.filePaths?.[0]) return;
        runScan('mobaxterm', { path: result.filePaths[0] });
    }, [runScan]);

    const toggle = useCallback((key) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const hosts = scan?.hosts || [];

    const toggleAll = useCallback(() => {
        setSelected(current => (current.size === hosts.length ? new Set() : new Set(hosts.map(h => h.key))));
    }, [hosts]);

    const runImport = useCallback(async () => {
        setImporting(true);
        try {
            const result = await window.api.importer.apply({
                source: active,
                path: scan.path,
                keys: [...selected],
                importIdentityFiles: withIdentityFiles,
            });

            onImported?.();
            // Re-scan so everything just taken now reads as "already added",
            // then show the report, in that order: the re-scan clears it.
            await runScan(active, active === 'mobaxterm' ? { path: scan.path } : {});
            setReport(result);

            const parts = [];
            if (result.hosts.imported) parts.push(`${result.hosts.imported} host${result.hosts.imported > 1 ? 's' : ''}`);
            if (result.keys.imported) parts.push(`${result.keys.imported} key${result.keys.imported > 1 ? 's' : ''}`);
            if (result.folders?.created) parts.push(`${result.folders.created} folder${result.folders.created > 1 ? 's' : ''}`);

            toast.success(parts.length ? `Imported ${parts.join(', ')}` : 'Nothing new to import', toastOptions());
        } catch (error) {
            toast.error(`Import failed: ${error.message}`, toastOptions());
        } finally {
            setImporting(false);
        }
    }, [scan, active, selected, withIdentityFiles, onImported, runScan]);

    return (
        <SettingCard className="flex flex-col gap-5">
            <div className="min-w-0">
                <h4 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Download01Icon size={18} strokeWidth={2} className="text-gray-400" />
                    From other apps
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Hosts, port forwards, folders and serial or desktop settings come
                    across. Passwords stay behind; each app keeps those encrypted with
                    its own scheme.
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <div className="grid grid-cols-3 gap-2">
                    {SOURCES.map(source => (
                        <SourceCard
                            key={source.id}
                            source={source}
                            // Undefined only while detection is still running.
                            info={sources ? (sources[source.id] || { found: false }) : undefined}
                            active={active === source.id}
                            scanning={scanning}
                            onScan={runScan}
                        />
                    ))}
                </div>

                <button
                    onClick={chooseFile}
                    className="self-end flex items-center gap-1.5 text-[11px] font-medium text-gray-400
                        dark:text-neutral-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    title="A portable MobaXterm.ini, or a .mxtsessions export"
                >
                    <FileImportIcon size={12} strokeWidth={2} />
                    {IS_WINDOWS
                        ? 'Portable install? Choose a MobaXterm file…'
                        : 'Choose a MobaXterm file…'}
                </button>
            </div>

            {scan && (
                <>
                    {scan.error ? (
                        <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                            <Alert02Icon size={13} strokeWidth={2} className="shrink-0 mt-px" />
                            {scan.error}
                        </p>
                    ) : (
                        /* Where the results came from, and what could not be read. */
                        <span className="text-[11px] font-mono text-gray-500 dark:text-neutral-500 truncate">
                            {scan.path}
                            {scan.stats?.skippedNote && ` (${scan.stats.skippedNote})`}
                        </span>
                    )}

                    {scan.warnings?.map(warning => (
                        <p key={warning} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                            <Alert02Icon size={13} strokeWidth={2} className="shrink-0 mt-px" />
                            {warning}
                        </p>
                    ))}

                    {hosts.length > 0 && (
                        <div className="border border-gray-200 dark:border-surface-control rounded-xl overflow-hidden">
                            <GroupHeader
                                icon={<ServerStack01Icon size={15} strokeWidth={2} />}
                                title={`${scan.label} sessions`}
                                count={hosts.length}
                                selected={selected.size}
                                onToggleAll={toggleAll}
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
                                                checked={selected.has(host.key)}
                                                onChange={() => toggle(host.key)}
                                            />
                                            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[10rem]">
                                                {host.name}
                                            </span>
                                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-surface-control text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                                {PROTOCOL_LABELS[host.protocol] || host.protocol}
                                            </span>
                                            <span className="flex-1 min-w-0 text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                                                {host.address}
                                            </span>
                                            <StatusBadge status={host.status} />
                                        </label>
                                        <CandidateNotes host={host} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!scan.error && hosts.length === 0 && (
                        <div className="flex flex-col items-center gap-1.5 py-8 text-gray-400 dark:text-neutral-500">
                            <SearchRemoveIcon size={20} strokeWidth={1.5} />
                            <p className="text-sm">Nothing importable in {scan.label}.</p>
                        </div>
                    )}

                    {/* Copying private keys is a real decision, so it is a
                        visible one rather than something done quietly. */}
                    {hosts.some(host => host.identityState === 'ready') && (
                        <Checkbox
                            variant="card"
                            checked={withIdentityFiles}
                            onChange={(event) => setWithIdentityFiles(event.target.checked)}
                            label="Copy the private keys these hosts reference"
                            description="Each key file is read into the keychain and encrypted with the OS keystore. Without this, imported hosts are set to use your SSH agent instead."
                        />
                    )}

                    <div className="flex items-center justify-between gap-4 pt-1">
                        <div className="min-w-0">
                            {report && (
                                <p className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                                    <CheckmarkCircle02Icon size={14} strokeWidth={2} className="shrink-0" />
                                    Imported {report.hosts.imported} host(s)
                                    {report.keys.imported > 0 && `, ${report.keys.imported} key(s)`}
                                    {report.folders?.created > 0 && `, ${report.folders.created} folder(s)`}.
                                    {report.hosts.skipped > 0 && ` ${report.hosts.skipped} already present.`}
                                    {report.hosts.relayed > 0
                                        && ` ${report.hosts.relayed} set to connect through a jump host.`}
                                </p>
                            )}
                        </div>
                        <button
                            onClick={runImport}
                            disabled={selected.size === 0 || importing || Boolean(scan.error)}
                            className="shrink-0 px-4 h-9 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {importing
                                ? 'Importing…'
                                : selected.size > 0 ? `Import ${selected.size} selected` : 'Nothing selected'}
                        </button>
                    </div>
                </>
            )}
        </SettingCard>
    );
}
