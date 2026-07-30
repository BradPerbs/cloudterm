import { memo, useEffect, useRef, useState } from 'react';
import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    ArrowUp01Icon,
    Home01Icon,
    Refresh01Icon,
    FolderAddIcon,
    FolderUploadIcon,
    FileAddIcon,
    Upload01Icon,
    Download01Icon,
    Delete02Icon,
    Search01Icon,
    ViewIcon,
    ViewOffSlashIcon,
    Cancel01Icon,
} from 'hugeicons-react';
import { breadcrumbFor } from '../../lib/remote-path';

function IconButton({ icon, title, onClick, disabled, active, danger }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                active
                    ? 'bg-gray-900/[0.08] dark:bg-surface-control text-gray-900 dark:text-white'
                    : danger
                        ? 'text-gray-500 dark:text-gray-400 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-900/20 enabled:hover:text-red-600 dark:enabled:hover:text-red-400'
                        : 'text-gray-500 dark:text-gray-400 enabled:hover:bg-gray-100 dark:enabled:hover:bg-surface-control enabled:hover:text-gray-900 dark:enabled:hover:text-white'
            }`}
        >
            {icon}
        </button>
    );
}

const Divider = () => <div className="w-px h-5 shrink-0 bg-gray-200 dark:bg-surface-control mx-0.5" />;

/**
 * Breadcrumbs that turn into a text field on click, so a path can be typed or
 * pasted without leaving the pane.
 */
function PathBar({ path, onNavigate, onSubmitPath }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(path);
    const inputRef = useRef(null);
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!editing) setValue(path);
    }, [path, editing]);

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);

    // Deep paths should show their tail, which is the part that identifies them.
    useEffect(() => {
        if (!editing && scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [path, editing]);

    if (editing) {
        return (
            <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                        setEditing(false);
                        onSubmitPath(value);
                    }
                    if (event.key === 'Escape') {
                        setEditing(false);
                        setValue(path);
                    }
                }}
                onBlur={() => { setEditing(false); setValue(path); }}
                spellCheck={false}
                className="flex-1 min-w-0 h-8 px-3 rounded-lg border border-blue-500 bg-white dark:bg-surface-base text-gray-900 dark:text-white font-mono text-xs outline-none"
            />
        );
    }

    const segments = breadcrumbFor(path);

    return (
        <div
            ref={scrollRef}
            onClick={(event) => { if (event.target === event.currentTarget) setEditing(true); }}
            onDoubleClick={() => setEditing(true)}
            title="Click to type a path"
            className="flex-1 min-w-0 h-8 flex items-center gap-0.5 px-2 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-surface-control overflow-x-auto sftp-pathbar cursor-text"
        >
            <button
                onClick={() => onNavigate('/')}
                className="shrink-0 px-1.5 py-0.5 rounded text-xs font-mono text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-control hover:text-gray-900 dark:hover:text-white transition-colors"
            >
                /
            </button>
            {segments.map((segment, index) => (
                <span key={segment.path} className="flex items-center shrink-0">
                    {index > 0 && <span className="text-gray-300 dark:text-neutral-600 text-xs">/</span>}
                    <button
                        onClick={() => onNavigate(segment.path)}
                        className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors hover:bg-gray-100 dark:hover:bg-surface-control ${
                            index === segments.length - 1
                                ? 'text-gray-900 dark:text-white font-medium'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                    >
                        {segment.name}
                    </button>
                </span>
            ))}
        </div>
    );
}

function SftpToolbar({
    path,
    loading,
    canGoBack,
    canGoForward,
    selectionCount,
    showHidden,
    filter,
    filterRef,
    onBack,
    onForward,
    onUp,
    onHome,
    onRefresh,
    onNavigate,
    onSubmitPath,
    onNewFolder,
    onNewFile,
    onUploadFiles,
    onUploadFolder,
    onDownload,
    onDelete,
    onToggleHidden,
    onFilterChange,
}) {
    return (
        <div className="shrink-0 h-12 flex items-center gap-1 px-2 border-b border-gray-200 dark:border-surface-control bg-white dark:bg-surface-raised">
            <IconButton
                icon={<ArrowLeft01Icon size={17} strokeWidth={2} />}
                title="Back"
                onClick={onBack}
                disabled={!canGoBack}
            />
            <IconButton
                icon={<ArrowRight01Icon size={17} strokeWidth={2} />}
                title="Forward"
                onClick={onForward}
                disabled={!canGoForward}
            />
            <IconButton
                icon={<ArrowUp01Icon size={17} strokeWidth={2} />}
                title="Up one level"
                onClick={onUp}
                disabled={path === '/'}
            />
            <IconButton
                icon={<Home01Icon size={17} strokeWidth={2} />}
                title="Home directory"
                onClick={onHome}
            />
            <IconButton
                icon={<Refresh01Icon size={17} strokeWidth={2} className={loading ? 'animate-spin' : ''} />}
                title="Refresh"
                onClick={onRefresh}
            />

            <Divider />

            <PathBar path={path} onNavigate={onNavigate} onSubmitPath={onSubmitPath} />

            <Divider />

            <div className="relative shrink-0">
                <Search01Icon
                    size={14}
                    strokeWidth={2}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                    ref={filterRef}
                    value={filter}
                    onChange={(event) => onFilterChange(event.target.value)}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                            onFilterChange('');
                            event.currentTarget.blur();
                        }
                    }}
                    placeholder="Filter"
                    spellCheck={false}
                    className="w-36 h-8 pl-8 pr-7 rounded-lg border border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base text-gray-900 dark:text-white text-xs outline-none focus:border-gray-300 dark:focus:border-neutral-700 placeholder:text-gray-400"
                />
                {filter && (
                    <button
                        onClick={() => onFilterChange('')}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        title="Clear filter"
                    >
                        <Cancel01Icon size={11} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            <IconButton
                icon={showHidden
                    ? <ViewIcon size={16} strokeWidth={2} />
                    : <ViewOffSlashIcon size={16} strokeWidth={2} />}
                title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
                onClick={onToggleHidden}
                active={showHidden}
            />

            <Divider />

            <IconButton
                icon={<FolderAddIcon size={17} strokeWidth={2} />}
                title="New folder"
                onClick={onNewFolder}
            />
            <IconButton
                icon={<FileAddIcon size={17} strokeWidth={2} />}
                title="New file"
                onClick={onNewFile}
            />
            <IconButton
                icon={<Upload01Icon size={17} strokeWidth={2} />}
                title="Upload files"
                onClick={onUploadFiles}
            />
            <IconButton
                icon={<FolderUploadIcon size={17} strokeWidth={2} />}
                title="Upload folder"
                onClick={onUploadFolder}
            />
            <IconButton
                icon={<Download01Icon size={17} strokeWidth={2} />}
                title="Download selected"
                onClick={onDownload}
                disabled={selectionCount === 0}
            />
            <IconButton
                icon={<Delete02Icon size={17} strokeWidth={2} />}
                title="Delete selected"
                onClick={onDelete}
                disabled={selectionCount === 0}
                danger
            />
        </div>
    );
}

export default memo(SftpToolbar);
