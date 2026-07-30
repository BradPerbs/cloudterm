import { memo } from 'react';
import {
    Download01Icon,
    Upload01Icon,
    Cancel01Icon,
    Refresh01Icon,
    Tick02Icon,
    Alert02Icon,
    ArrowDown01Icon,
    Delete02Icon,
} from 'hugeicons-react';
import { formatSize, formatSpeed, formatEta } from '../../lib/format';

const STATE_LABELS = {
    queued: 'Queued',
    scanning: 'Scanning…',
    running: '',
    done: 'Completed',
    error: 'Failed',
    canceled: 'Canceled',
};

const isActive = (state) => state === 'queued' || state === 'scanning' || state === 'running';

function StateIcon({ transfer }) {
    if (transfer.state === 'done') {
        return <Tick02Icon size={16} strokeWidth={2.5} className="text-green-500" />;
    }
    if (transfer.state === 'error') {
        return <Alert02Icon size={16} strokeWidth={2} className="text-red-500" />;
    }
    if (transfer.state === 'canceled') {
        return <Cancel01Icon size={16} strokeWidth={2} className="text-gray-400" />;
    }
    return transfer.direction === 'upload'
        ? <Upload01Icon size={16} strokeWidth={2} className="text-blue-500" />
        : <Download01Icon size={16} strokeWidth={2} className="text-blue-500" />;
}

function TransferRow({ transfer, onCancel, onRetry }) {
    const percent = transfer.totalBytes
        ? Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100))
        : transfer.state === 'done' ? 100 : 0;

    const eta = transfer.speed > 0 && transfer.totalBytes > transfer.transferredBytes
        ? (transfer.totalBytes - transfer.transferredBytes) / transfer.speed
        : 0;

    const detail = transfer.state === 'error'
        ? transfer.error
        : transfer.state === 'running'
            ? [
                `${formatSize(transfer.transferredBytes)} / ${formatSize(transfer.totalBytes)}`,
                formatSpeed(transfer.speed),
                eta ? `${formatEta(eta)} left` : '',
                transfer.totalFiles > 1 ? `${transfer.completedFiles}/${transfer.totalFiles} files` : '',
            ].filter(Boolean).join(' · ')
            : [
                STATE_LABELS[transfer.state],
                transfer.state === 'done' ? formatSize(transfer.totalBytes) : '',
                transfer.skippedFiles ? `${transfer.skippedFiles} skipped` : '',
            ].filter(Boolean).join(' · ');

    return (
        <div className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-surface-control/50 transition-colors">
            <span className="shrink-0"><StateIcon transfer={transfer} /></span>

            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                        {transfer.name}
                    </span>
                    {transfer.state === 'running' && transfer.currentFile && transfer.totalFiles > 1 && (
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500 truncate">
                            {transfer.currentFile}
                        </span>
                    )}
                </div>

                {isActive(transfer.state) && (
                    <div className="mt-1 h-1 bg-gray-200 dark:bg-surface-control rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-[width] duration-200 ${
                                transfer.state === 'running' ? 'bg-blue-500' : 'bg-blue-500/40 sftp-indeterminate'
                            }`}
                            style={{ width: transfer.state === 'running' ? `${percent}%` : '100%' }}
                        />
                    </div>
                )}

                <p className={`text-[11px] mt-0.5 truncate ${
                    transfer.state === 'error'
                        ? 'text-red-500'
                        : 'text-gray-500 dark:text-gray-400'
                }`}>
                    {detail}
                </p>
            </div>

            {transfer.state === 'running' && (
                <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400 w-9 text-right">
                    {percent}%
                </span>
            )}

            {isActive(transfer.state) ? (
                <button
                    onClick={() => onCancel(transfer.id)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Cancel"
                >
                    <Cancel01Icon size={14} strokeWidth={2} />
                </button>
            ) : (transfer.state === 'error' || transfer.state === 'canceled') && (
                <button
                    onClick={() => onRetry(transfer.id)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    title="Retry"
                >
                    <Refresh01Icon size={14} strokeWidth={2} />
                </button>
            )}
        </div>
    );
}

/** Collapsible queue drawer; the header doubles as the summary when collapsed. */
function TransferPanel({ transfers, summary, expanded, onToggle, onCancel, onRetry, onCancelAll, onClear }) {
    if (transfers.length === 0) return null;

    const headline = summary.active
        ? `${summary.active} transfer${summary.active > 1 ? 's' : ''} · ${summary.percent}%${
            summary.speed ? ` · ${formatSpeed(summary.speed)}` : ''
        }${summary.eta ? ` · ${formatEta(summary.eta)} left` : ''}`
        : summary.failed
            ? `${summary.failed} failed`
            : `${transfers.length} transfer${transfers.length > 1 ? 's' : ''} finished`;

    return (
        <div className="shrink-0 border-t border-gray-200 dark:border-surface-control bg-white dark:bg-surface-raised">
            <div className="h-9 flex items-center gap-2 px-3">
                <button
                    onClick={onToggle}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left group"
                    title={expanded ? 'Collapse' : 'Expand'}
                >
                    <ArrowDown01Icon
                        size={14}
                        strokeWidth={2.5}
                        className={`shrink-0 text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`}
                    />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Transfers</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{headline}</span>
                </button>

                {summary.active > 0 && (
                    <button
                        onClick={onCancelAll}
                        className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        Cancel all
                    </button>
                )}
                {summary.finished > 0 && (
                    <button
                        onClick={onClear}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                        title="Clear finished"
                    >
                        <Delete02Icon size={14} strokeWidth={2} />
                    </button>
                )}
            </div>

            {expanded && (
                <div className="max-h-52 overflow-y-auto border-t border-gray-100 dark:border-surface-control/70">
                    {transfers.map(transfer => (
                        <TransferRow
                            key={transfer.id}
                            transfer={transfer}
                            onCancel={onCancel}
                            onRetry={onRetry}
                        />
                    ))}
                </div>
            )}

            {/* Collapsed: one bar standing in for the whole queue. */}
            {!expanded && summary.active > 0 && (
                <div className="h-0.5 bg-gray-200 dark:bg-surface-control">
                    <div
                        className="h-full bg-blue-500 transition-[width] duration-200"
                        style={{ width: `${summary.percent}%` }}
                    />
                </div>
            )}
        </div>
    );
}

export default memo(TransferPanel);
