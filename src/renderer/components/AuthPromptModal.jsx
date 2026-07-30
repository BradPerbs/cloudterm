import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LockPasswordIcon } from 'hugeicons-react';

/**
 * A keyboard-interactive round the app could not answer on its own: a one-time
 * code, a push-approval choice, an expired password that has to be changed.
 *
 * The server's own wording is shown verbatim rather than being restated, since
 * only it knows whether it wants a TOTP code, a YubiKey touch or option 1-3,
 * and paraphrasing that has a habit of being wrong. `echo` decides whether an
 * answer is masked, which is the server telling us whether it is a secret.
 */
function AuthPromptModal({ prompt, onRespond }) {
    const [answers, setAnswers] = useState([]);
    const firstFieldRef = useRef(null);

    // A fresh round starts from blank fields, never from the previous one's,
    // which would put a spent code in front of the user as if it were valid.
    useEffect(() => {
        setAnswers(new Array(prompt?.prompts?.length || 0).fill(''));
    }, [prompt?.requestId]);

    useEffect(() => {
        if (prompt) firstFieldRef.current?.focus();
    }, [prompt?.requestId]);

    if (!prompt) return null;

    const fields = prompt.prompts || [];
    const target = [prompt.username, prompt.host].filter(Boolean).join('@');

    const submit = (event) => {
        event.preventDefault();
        onRespond(prompt.requestId, answers);
    };

    const cancel = () => onRespond(prompt.requestId, null);

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

            <form
                onSubmit={submit}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        cancel();
                    }
                }}
                className="absolute left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-2xl border border-gray-200 dark:border-surface-control bg-white dark:bg-surface-raised"
            >
                <div className="p-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                            <LockPasswordIcon size={20} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                                {prompt.name?.trim() || 'Additional authentication'}
                            </h2>
                            {target && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                    {target}
                                    {prompt.port && prompt.port !== 22 ? `:${prompt.port}` : ''}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Servers put the useful part here: "approve the push on
                        your phone", "your password has expired". Newlines are
                        significant, so they are preserved. */}
                    {prompt.instructions?.trim() && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
                            {prompt.instructions.trim()}
                        </p>
                    )}

                    <div className="flex flex-col gap-3">
                        {fields.map((field, index) => (
                            <div key={index} className="flex flex-col gap-1.5">
                                <label
                                    htmlFor={`auth-prompt-${index}`}
                                    className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words"
                                >
                                    {field.text?.trim() || 'Response'}
                                </label>
                                <input
                                    id={`auth-prompt-${index}`}
                                    ref={index === 0 ? firstFieldRef : undefined}
                                    type={field.echo ? 'text' : 'password'}
                                    value={answers[index] || ''}
                                    onChange={(event) => setAnswers((current) => {
                                        const next = [...current];
                                        next[index] = event.target.value;
                                        return next;
                                    })}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none transition-all font-mono text-sm"
                                />
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-neutral-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
                            onClick={cancel}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-2.5 rounded-xl font-semibold bg-gray-900 dark:bg-white text-white dark:text-black transition-opacity hover:opacity-90 shadow-lg"
                        >
                            Continue
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );

    return createPortal(content, document.body);
}

export default memo(AuthPromptModal);
