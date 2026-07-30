import { memo } from 'react';
import { createPortal } from 'react-dom';
import { AlertSquareIcon, ShieldKeyIcon } from 'hugeicons-react';

/**
 * Shown when a server presents a host key we have not already trusted.
 * Nothing is sent to the server until the user answers.
 */
function HostKeyModal({ prompt, onRespond }) {
    if (!prompt) return null;

    const isChanged = prompt.status === 'changed';

    const content = (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.55)',
                    backdropFilter: 'blur(4px)',
                }}
            />

            <div
                className={`absolute left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-2xl border bg-white dark:bg-surface-raised ${
                    isChanged ? 'border-red-500' : 'border-gray-200 dark:border-surface-control'
                }`}
            >
                <div className="p-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                isChanged
                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                            }`}
                        >
                            {isChanged ? <AlertSquareIcon size={20} /> : <ShieldKeyIcon size={20} />}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                                {isChanged ? 'Host key has changed' : 'Unknown host key'}
                            </h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                {prompt.host}:{prompt.port}
                            </p>
                        </div>
                    </div>

                    {isChanged ? (
                        <p className="text-sm text-red-600 dark:text-red-400">
                            The key this server presented does not match the one previously
                            trusted. This can mean the server was rebuilt, or that the
                            connection is being intercepted. Do not continue unless you know
                            why the key changed.
                        </p>
                    ) : (
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            This server has not been seen before. Verify the fingerprint out of
                            band before trusting it.
                        </p>
                    )}

                    <div className="rounded-xl bg-gray-50 dark:bg-neutral-800 p-4 flex flex-col gap-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500 dark:text-gray-400">Key type</span>
                            <span className="font-mono text-gray-900 dark:text-white">{prompt.keyType}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-gray-500 dark:text-gray-400">Fingerprint</span>
                            <span className="font-mono text-xs break-all text-gray-900 dark:text-white">
                                {prompt.fingerprint}
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-neutral-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
                            onClick={() => onRespond(prompt.requestId, false)}
                            autoFocus
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className={`flex-1 px-4 py-2.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 shadow-lg ${
                                isChanged ? 'bg-red-600' : 'bg-gray-900 dark:bg-white dark:text-black'
                            }`}
                            onClick={() => onRespond(prompt.requestId, true)}
                        >
                            {isChanged ? 'Accept new key' : 'Trust and connect'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(content, document.body);
}

export default memo(HostKeyModal);
