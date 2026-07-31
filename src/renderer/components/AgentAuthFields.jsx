import { memo, useCallback, useEffect, useState } from 'react';
import { Key01Icon, Alert02Icon, Tick02Icon, Loading03Icon, Refresh01Icon } from 'hugeicons-react';
import Checkbox from './ui/Checkbox';
import { IS_WINDOWS } from '../lib/platform';

/** Fingerprints are long; the tail is the part people actually compare. */
const shortFingerprint = (value) => (value?.length > 26 ? `${value.slice(0, 24)}…` : value || '');

function StatusLine({ status }) {
    if (!status) {
        return (
            <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loading03Icon size={14} className="animate-spin" />
                Looking for an agent…
            </span>
        );
    }

    if (!status.available) {
        return (
            <span className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
                <Alert02Icon size={15} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span className="min-w-0">
                    No agent available
                    {status.message ? `: ${status.message}` : ''}
                </span>
            </span>
        );
    }

    const count = status.identities?.length || 0;

    return (
        <span className="flex items-start gap-2 text-sm text-green-600 dark:text-green-500">
            <Tick02Icon size={15} strokeWidth={2.5} className="shrink-0 mt-0.5" />
            <span className="min-w-0">
                {count === 0
                    ? 'Agent is running, but holds no keys'
                    : `${count} key${count === 1 ? '' : 's'} available`}
                <span className="text-gray-500 dark:text-gray-400"> via {status.location}</span>
            </span>
        </span>
    );
}

/**
 * Keys the agent is holding that this app cannot use.
 *
 * Said out loud because the alternative is what happened before: they were
 * dropped on the way in and the list simply came up short. Someone whose agent
 * holds a security key would compare this against `ssh-add -l`, find a key
 * missing, and have nothing to go on.
 */
function UnusableKeys({ identities }) {
    if (!identities?.length) return null;

    const securityKeys = identities.filter(identity => identity.type?.startsWith('sk-')).length;

    return (
        <div className="pt-1 border-t border-gray-100 dark:border-neutral-800 flex flex-col gap-1">
            <span className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                <Alert02Icon size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span className="min-w-0">
                    {identities.length} more key{identities.length === 1 ? '' : 's'} in the agent
                    {securityKeys > 0
                        ? `, ${securityKeys === identities.length ? 'held on a security key' : 'some held on a security key'}`
                        : ''}
                    {' '}(not supported yet, and will not be offered).
                </span>
            </span>
            <ul className="flex flex-col gap-1">
                {identities.map((identity, index) => (
                    <li key={identity.fingerprint || index} className="flex items-center gap-2 text-xs min-w-0 opacity-60">
                        <Key01Icon size={12} strokeWidth={2} className="shrink-0 text-gray-400" />
                        <span className="font-mono text-gray-600 dark:text-gray-400 truncate">
                            {identity.type || 'unknown'}
                        </span>
                        {identity.comment && (
                            <span className="text-gray-500 dark:text-gray-400 truncate">
                                {identity.comment}
                            </span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-gray-400 dark:text-neutral-500 shrink-0">
                            {shortFingerprint(identity.fingerprint)}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Agent authentication settings. The agent is probed live so a missing or empty
 * agent is visible here rather than surfacing later as an opaque
 * "All configured authentication methods failed".
 */
function AgentAuthFields({ agentPath, agentForward, onChange }) {
    const [status, setStatus] = useState(null);
    const [showPath, setShowPath] = useState(Boolean(agentPath));

    const refresh = useCallback(async (path) => {
        setStatus(null);
        try {
            setStatus(await window.api.agent.status(path));
        } catch (error) {
            setStatus({ available: false, message: error.message });
        }
    }, []);

    // Typing a custom path shouldn't probe on every keystroke.
    useEffect(() => {
        const timer = setTimeout(() => refresh(agentPath), agentPath ? 500 : 0);
        return () => clearTimeout(timer);
    }, [agentPath, refresh]);

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-neutral-800 p-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                    <StatusLine status={status} />
                    <button
                        type="button"
                        onClick={() => refresh(agentPath)}
                        title="Check again"
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                        <Refresh01Icon size={13} strokeWidth={2} />
                    </button>
                </div>

                {status?.available && status.identities?.length > 0 && (
                    <ul className="flex flex-col gap-1 pt-1 border-t border-gray-100 dark:border-neutral-800">
                        {status.identities.map((identity, index) => (
                            <li
                                key={identity.fingerprint || index}
                                className="flex items-center gap-2 text-xs min-w-0"
                            >
                                <Key01Icon size={12} strokeWidth={2} className="shrink-0 text-gray-400" />
                                <span className="font-mono text-gray-600 dark:text-gray-400 shrink-0">
                                    {identity.type}
                                </span>
                                {identity.comment && (
                                    <span className="text-gray-500 dark:text-gray-400 truncate">
                                        {identity.comment}
                                    </span>
                                )}
                                <span className="ml-auto font-mono text-[10px] text-gray-400 dark:text-neutral-500 shrink-0">
                                    {shortFingerprint(identity.fingerprint)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}

                {status?.available && <UnusableKeys identities={status.unusable} />}

                {status && !status.available && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {IS_WINDOWS
                            ? 'Start the OpenSSH Authentication Agent service, or run Pageant, then check again.'
                            : 'Start ssh-agent and add a key with ssh-add, then check again.'}
                    </p>
                )}
            </div>

            <Checkbox
                variant="card"
                checked={agentForward}
                onChange={(event) => onChange('agentForward', event.target.checked)}
                label="Forward the agent to this host"
                description="Lets you hop from this server to others using the same keys. Anyone with root on this host can use your keys while you are connected, so leave it off for machines you do not control."
            />

            {showPath ? (
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {IS_WINDOWS ? 'Agent socket or pipe' : 'Agent socket'}
                    </label>
                    <input
                        type="text"
                        value={agentPath}
                        onChange={(event) => onChange('agentPath', event.target.value)}
                        placeholder={status?.path || 'Leave blank to detect automatically'}
                        spellCheck={false}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none transition-all placeholder:text-gray-400 font-mono text-xs"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {IS_WINDOWS ? (
                            <>
                                Blank tries <span className="font-mono">SSH_AUTH_SOCK</span>, the
                                Windows OpenSSH agent and Pageant, and takes the first that answers.
                                Use <span className="font-mono">pageant</span> to target Pageant
                                explicitly.
                            </>
                        ) : (
                            <>
                                Blank uses <span className="font-mono">SSH_AUTH_SOCK</span>, which is
                                where <span className="font-mono">ssh-agent</span> leaves its socket.
                            </>
                        )}
                    </p>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setShowPath(true)}
                    className="self-start text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                    Use a different agent…
                </button>
            )}
        </div>
    );
}

export default memo(AgentAuthFields);
