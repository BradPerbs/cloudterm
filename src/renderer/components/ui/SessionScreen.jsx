import { useEffect, useRef, useState } from 'react';
import { Copy01Icon, Refresh01Icon, Tick01Icon } from 'hugeicons-react';
import { OsIcon } from '../../lib/os-icons';
import ConnectingSplash from './ConnectingSplash';

/**
 * Everything a pane has to say while it has no session, on one screen.
 *
 * A connection asks up to three questions before it is a shell: do you trust
 * this server's key, what is your one-time code, and (when it did not work)
 * what now. Each of those used to be a different piece of furniture: two modals
 * over the whole window and a red line printed into an otherwise empty
 * terminal, with the button that answered the third one in the pane header.
 *
 * They are one screen here, because they are one moment. The pane keeps the
 * host badge it was already showing, the wording under it changes, and the
 * answer is given in the same place every time. A modal is for interrupting
 * what you were doing; none of this interrupts anything, since the pane it
 * belongs to has nothing else in it yet.
 *
 * The screen draws itself out of `currentColor` and the pane's own background,
 * so it takes the terminal's theme the way the connecting splash does. `accent`
 * is the one exception: a key that changed and a dial that failed are told in
 * the theme's own red, which is the colour the terminal would have used to say
 * the same thing.
 */

const COPY_CONFIRM_MS = 1400;

/** An address is set as one wherever it stands in for the supporting line. */
const Address = ({ value }) => <span className="font-mono text-[12px]">{value}</span>;

/** The still version of the connecting badge, once there is nothing in flight. */
function Mark({ os, distro }) {
    return (
        <span className="connect-badge flex h-14 w-14 items-center justify-center rounded-full">
            <OsIcon os={os} distro={distro} className="w-7 h-7" />
        </span>
    );
}

function ScreenButton({ variant = 'ghost', background, accent, children, ...props }) {
    const shape = 'h-9 px-4 inline-flex items-center justify-center gap-1.5 rounded-xl '
        + 'text-[13px] font-semibold transition-all active:scale-95';

    if (variant === 'ghost') {
        return (
            <button type="button" className={`${shape} border session-ghost`} {...props}>
                {children}
            </button>
        );
    }

    // Filled from the foreground itself, with the pane's background as the
    // label. One rule, and it lands right on every theme: whatever the terminal
    // writes its text in is legible against whatever it writes it on.
    //
    // The classes on the label are the floor, for a caller that gave no
    // background: a fill made of the foreground is dark on a light app and
    // light on a dark one, so those are the two colours that read on it. Losing
    // them once made a white button with a white word on it.
    return (
        <button
            type="button"
            className={`${shape} hover:opacity-90`}
            style={{ backgroundColor: variant === 'danger' ? accent : 'currentColor' }}
            {...props}
        >
            <span
                className="inline-flex items-center gap-1.5 text-white dark:text-black"
                style={background ? { color: background } : undefined}
            >
                {children}
            </span>
        </button>
    );
}

function CopyFingerprint({ text }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef(0);

    useEffect(() => () => clearTimeout(timer.current), []);

    const copy = async () => {
        const body = String(text || '');
        if (!body) return;

        try {
            await navigator.clipboard.writeText(body);
        } catch {
            try {
                await window.api?.clipboard?.writeText?.(body);
            } catch {
                // Nothing to say that the tick not appearing does not say.
                return;
            }
        }

        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
    };

    return (
        <button
            type="button"
            onClick={copy}
            data-copied={copied}
            title={copied ? 'Copied' : 'Copy fingerprint'}
            aria-label={copied ? 'Copied' : 'Copy fingerprint'}
            className="session-copy shrink-0 w-6 h-6 flex items-center justify-center rounded-md outline-none"
        >
            {copied
                ? <Tick01Icon size={12} strokeWidth={2.5} />
                : <Copy01Icon size={12} strokeWidth={2} />}
        </button>
    );
}

/**
 * The identity the server is asking to be trusted as: where it answered, what
 * algorithm it answered with, and the fingerprint that is the actual question.
 *
 * The fingerprint is the largest thing on the screen because it is the only
 * part anyone has to read character by character. Its `SHA256:` prefix is the
 * same on every key, so it sits back a step and leaves the contrast to the
 * digest.
 */
function Identity({ prompt }) {
    const value = String(prompt.fingerprint || '');
    const cut = value.indexOf(':');
    const prefix = cut === -1 ? '' : value.slice(0, cut + 1);
    const digest = cut === -1 ? value : value.slice(cut + 1);

    return (
        <div className="w-full rounded-xl border session-well overflow-hidden text-left">
            <div className="flex items-center gap-3 h-10 px-3.5 border-b session-rule">
                <span className="min-w-0 flex-1 font-mono text-[13px] truncate selectable">
                    {prompt.host}:{prompt.port}
                </span>
                <span className="shrink-0 font-mono text-[11px]" style={{ opacity: 0.5 }}>
                    {prompt.keyType || 'unknown'}
                </span>
            </div>

            <div className="flex items-start gap-2 px-3.5 py-3">
                <p className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all selectable">
                    <span style={{ opacity: 0.45 }}>{prefix}</span>
                    {digest}
                </p>
                <CopyFingerprint text={prompt.fingerprint} />
            </div>
        </div>
    );
}

/*
 * Each face below returns what the frame needs to draw it, rather than a
 * component: a heading, the line under it, whatever goes in the middle, the
 * buttons, and what Escape means. The frame is then one piece of layout that
 * every state shares, which is the whole point of putting them on one screen.
 */

function hostKeyFace({ prompt, onRespond, background, accent }) {
    const changed = prompt.status === 'changed';
    const decline = () => onRespond(prompt.requestId, false);

    return {
        heading: changed ? 'Host key has changed' : 'Unknown host key',
        supporting: changed
            ? 'The key this server presented is not the one you trusted for this address.'
            : 'This server has not been seen before. Check its fingerprint against one you '
              + 'got from the server itself, not over this connection.',
        onEscape: decline,
        content: (
            <>
                <Identity prompt={prompt} />

                {changed && (
                    <p
                        className="w-full rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed text-left"
                        style={{
                            color: accent,
                            borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
                            backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)`,
                        }}
                    >
                        A server that was rebuilt or rekeyed looks exactly like this. So does a
                        connection someone else is sitting in the middle of. Do not continue
                        unless you know which one it is.
                    </p>
                )}
            </>
        ),
        actions: (
            <>
                {/* Focus starts on the refusal, and Escape is the same answer.
                    Declining costs a reconnect; trusting the wrong key costs
                    the session. */}
                <ScreenButton onClick={decline} autoFocus>Cancel</ScreenButton>
                <ScreenButton
                    variant={changed ? 'danger' : 'primary'}
                    background={background}
                    accent={accent}
                    onClick={() => onRespond(prompt.requestId, true)}
                >
                    {changed ? 'Replace stored key' : 'Trust and connect'}
                </ScreenButton>
            </>
        ),
    };
}

/**
 * A keyboard-interactive round: a one-time code, a push approval, a password
 * the server says has expired.
 *
 * The server's own wording is shown verbatim rather than restated, since only
 * it knows whether it wants a TOTP code, a YubiKey touch or option 1-3, and
 * paraphrasing that has a habit of being wrong. `echo` decides whether an
 * answer is masked, which is the server telling us whether it is a secret.
 *
 * Mounted under the round's own request id, so a second round starts from
 * blank fields rather than from the last one's: a spent code sitting in the
 * box, presented as if it were still good, is worse than an empty one.
 */
function AuthFields({ prompt, onRespond, background }) {
    const fields = prompt.prompts || [];
    const [answers, setAnswers] = useState(() => new Array(fields.length).fill(''));
    const firstField = useRef(null);

    useEffect(() => {
        firstField.current?.focus();
    }, []);

    return (
        <form
            className="w-full flex flex-col gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                onRespond(prompt.requestId, answers);
            }}
        >
            {fields.map((field, index) => (
                <label key={index} className="flex flex-col gap-1.5 text-left">
                    <span className="text-[13px] font-medium whitespace-pre-wrap break-words" style={{ opacity: 0.75 }}>
                        {field.text?.trim() || 'Response'}
                    </span>
                    <input
                        ref={index === 0 ? firstField : undefined}
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
                        className="w-full h-10 px-3 rounded-xl border session-field font-mono text-[13px] outline-none transition-colors"
                    />
                </label>
            ))}

            <div className="flex items-center justify-center gap-2 pt-1">
                <ScreenButton onClick={() => onRespond(prompt.requestId, null)}>
                    Cancel
                </ScreenButton>
                <ScreenButton type="submit" variant="primary" background={background}>
                    Continue
                </ScreenButton>
            </div>
        </form>
    );
}

function authFace({ prompt, onRespond, background, address }) {
    return {
        heading: prompt.name?.trim() || 'Additional authentication',
        // The server's instructions where it gave any, and otherwise the
        // account being authenticated, which is the next most useful thing to
        // know about a box asking for a code.
        supporting: prompt.instructions?.trim() || <Address value={address} />,
        onEscape: () => onRespond(prompt.requestId, null),
        content: (
            <AuthFields
                key={prompt.requestId}
                prompt={prompt}
                onRespond={onRespond}
                background={background}
            />
        ),
        // The form carries its own, so Enter submits from a field.
        actions: null,
    };
}

/**
 * A dial that did not land, and the clock if one is running.
 *
 * The countdown is the same state as the failure, not a separate screen: the
 * reason it failed is still the most useful thing on it, and what has changed
 * is only that something is about to happen on its own. So the reason stays put
 * and the button becomes the way to skip the wait.
 */
function failedFace({ message, address, retryIn, attempt, maxAttempts, onReconnect, background }) {
    const counting = retryIn > 0;

    return {
        heading: 'Could not connect',
        supporting: <Address value={address} />,
        content: (
            <>
                {message && (
                    <p className="w-full rounded-xl border session-well px-3.5 py-3 text-[13px] leading-relaxed text-left break-words selectable">
                        {message}
                    </p>
                )}

                {/* Full contrast, and the only line on the screen that has it
                    besides the heading. It is the one thing here that is still
                    changing, and it is what the header no longer says. */}
                {counting && (
                    <p className="text-[13px] font-medium">
                        Trying again in {retryIn}s
                        {attempt ? (
                            <span className="font-normal" style={{ opacity: 0.55 }}>
                                {` (attempt ${attempt} of ${maxAttempts})`}
                            </span>
                        ) : ''}
                    </p>
                )}
            </>
        ),
        actions: (
            <ScreenButton variant="primary" background={background} onClick={onReconnect} autoFocus>
                <Refresh01Icon size={13} strokeWidth={2.5} />
                {counting ? 'Retry now' : 'Try again'}
            </ScreenButton>
        ),
    };
}

export default function SessionScreen({
    state,
    title,
    address,
    os,
    distro,
    background,
    accent = '#f7768e',
    hostKeyPrompt,
    onHostKeyRespond,
    authPrompt,
    onAuthRespond,
    message,
    retryIn = 0,
    attempt = 0,
    maxAttempts = 0,
    onReconnect,
    className = '',
    style,
}) {
    // Still dialling: the screen it has always been, halos and all.
    if (state === 'connecting') {
        return (
            <ConnectingSplash
                title={title}
                subtitle={address}
                os={os}
                distro={distro}
                className={className}
                style={style}
            />
        );
    }

    const body =
        state === 'hostkey' && hostKeyPrompt
            ? hostKeyFace({ prompt: hostKeyPrompt, onRespond: onHostKeyRespond, background, accent })
            : state === 'auth' && authPrompt
                ? authFace({ prompt: authPrompt, onRespond: onAuthRespond, background, address })
                : state === 'failed'
                    ? failedFace({
                        message,
                        address,
                        retryIn,
                        attempt,
                        maxAttempts,
                        onReconnect,
                        background,
                    })
                    : null;

    if (!body) return null;

    return (
        <div
            className={`absolute inset-0 flex items-start justify-center overflow-y-auto px-6 py-10 ${className}`}
            style={style}
            onKeyDown={(event) => {
                if (event.key !== 'Escape' || !body.onEscape) return;
                event.stopPropagation();
                body.onEscape();
            }}
        >
            <div className="connect-fade-in m-auto w-full max-w-[26rem] flex flex-col items-center text-center">
                <Mark os={os} distro={distro} />

                <h2 className="mt-5 text-[15px] font-semibold">{body.heading}</h2>

                {body.supporting && (
                    <p
                        className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                        style={{ opacity: 0.6 }}
                    >
                        {body.supporting}
                    </p>
                )}

                {body.content && <div className="mt-5 w-full flex flex-col gap-3">{body.content}</div>}

                {body.actions && (
                    <div className="mt-5 flex items-center justify-center gap-2">{body.actions}</div>
                )}
            </div>
        </div>
    );
}
