import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { FileImportIcon, FingerPrintIcon, ViewIcon, ViewOffIcon } from 'hugeicons-react';
import toast from 'react-hot-toast';
import { toastOptions } from '../lib/toast';
import Sheet from './ui/Sheet';
import Button, { IconButton } from './ui/Button';
import Field, { FIELD_CLASS, MONO_FIELD_CLASS } from './ui/Field';

// Animated collapse component for smooth reveal/hide
function AnimatedCollapse({ isOpen, children }) {
    const contentRef = useRef(null);
    const [height, setHeight] = useState(0);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
            // Wait for content to render, then measure and animate
            requestAnimationFrame(() => {
                if (contentRef.current) {
                    setHeight(contentRef.current.scrollHeight);
                }
            });
        } else {
            setHeight(0);
            // Delay hiding until animation completes
            const timer = setTimeout(() => setIsVisible(false), 250);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!isVisible && !isOpen) return null;

    return (
        <div
            style={{
                height: height,
                opacity: isOpen ? 1 : 0,
                overflow: 'hidden',
                transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
            }}
        >
            <div ref={contentRef}>
                {children}
            </div>
        </div>
    );
}

const KEY_TYPES = [
    { id: 'ED25519', label: 'ED25519', description: 'Modern, fast, secure (recommended)' },
    { id: 'ECDSA', label: 'ECDSA', description: 'Elliptic Curve DSA' },
    { id: 'RSA', label: 'RSA', description: 'Traditional RSA key' },
];

/**
 * A pick-one card, in the chrome the app's other option cards use.
 *
 * Same radius, border and hover as `Checkbox variant="card"`, because they are
 * the same object: a bordered panel you click to choose something, with a label
 * and a line under it. The picked state is stronger than the checkbox's, since
 * these carry no tick — the outline is the only thing saying which one is on.
 */
const OPTION_CARD = 'p-3 rounded-xl border text-left transition-colors outline-none '
    + 'focus-visible:ring-2 focus-visible:ring-gray-900/25 dark:focus-visible:ring-white/30';

const OPTION_CARD_PICKED = 'border-gray-900 dark:border-white bg-gray-50 dark:bg-surface-control/40';

const OPTION_CARD_RESTING = 'border-gray-200 dark:border-surface-control '
    + 'hover:border-gray-300 dark:hover:border-neutral-600';

const shortDate = (value) => new Date(value).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
});

/**
 * What the stored certificate turned out to say.
 *
 * Read by the main process on save, because the renderer cannot parse SSH wire
 * format — and worth showing, since the two things that make a certificate stop
 * working are invisible in the blob itself: it expires, and it only covers the
 * principals it names.
 */
function certificateNote(info) {
    if (!info) return 'Signed by a CA and presented instead of the bare key. Paste a *-cert.pub.';

    const expiry = info.validBefore === null
        ? 'never expires'
        : Date.now() > info.validBefore
            ? `EXPIRED ${shortDate(info.validBefore)}`
            : `valid until ${shortDate(info.validBefore)}`;

    const who = info.principals?.length
        ? `logs in as ${info.principals.join(', ')}`
        // No principals at all means every username, which is worth naming
        // rather than showing as an empty list.
        : 'valid for any username';

    return `${who} · ${expiry} · CA ${info.caFingerprint}`;
}

/**
 * `Field`'s chrome without its `<label>`, for a group of buttons.
 *
 * Same type, same spacing, same hint — but a caption rather than a label,
 * because a label has to point at one control and a row of three choices has
 * no single one to point at.
 */
function FieldGroup({ label, hint, className = '', children }) {
    return (
        <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</span>
            {children}
            {hint && <span className="text-[11px] text-gray-500 dark:text-neutral-500">{hint}</span>}
        </div>
    );
}

/** A password box with the app's reveal control, which three fields here want. */
function SecretField({ label, hint, value, placeholder, onChange, autoComplete = 'new-password' }) {
    const [shown, setShown] = useState(false);

    return (
        <Field label={label} hint={hint}>
            <div className="relative">
                <input
                    type={shown ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className={`${FIELD_CLASS} pr-10`}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                />
                <IconButton
                    size="sm"
                    variant="ghost"
                    onClick={() => setShown(!shown)}
                    title={shown ? 'Hide passphrase' : 'Show passphrase'}
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    icon={shown
                        ? <ViewOffIcon size={15} strokeWidth={2} />
                        : <ViewIcon size={15} strokeWidth={2} />}
                />
            </div>
        </Field>
    );
}

/**
 * Mounted only while open: the sheet owns the enter and exit animations and
 * calls `onClose` once it has finished leaving, so the form is seeded from
 * props at mount rather than reset by an effect on every open.
 *
 * Nothing here asks what algorithm an imported key is, because the key says so
 * itself and the main process reads it on save. A picker would only be a field
 * to answer wrongly, and a key mislabelled ED25519 because that is the default
 * is worse than one that arrived unlabelled.
 */
function KeyModal({ keyData, initialMode = 'generate', dismiss, onClose, onSave, onGenerate, onRequestDelete }) {
    // Editing an existing key is always the import shape: it already has its
    // material, so there is nothing to generate.
    const [mode] = useState(keyData ? 'import' : initialMode);
    const [isGenerating, setIsGenerating] = useState(false);

    const [formData, setFormData] = useState(() => ({
        name: keyData?.name || '',
        type: keyData?.type || 'ED25519',
        keySize: '',
        comment: keyData?.comment || '',
        // The private key and passphrase stay in the main process; blank here
        // means "keep what is stored".
        passphrase: '',
        privateKey: '',
        publicKey: keyData?.publicKey || '',
        pendingKeyId: '',
        fingerprint: keyData?.fingerprint || '',
        // Public, so unlike the key material this one round-trips: it is shown
        // as it is stored and saved back as it is edited.
        certificate: keyData?.certificate || '',
    }));

    const [showPrivate, setShowPrivate] = useState(false);
    const [errors, setErrors] = useState({});
    const formRef = useRef(null);

    // The file a key was read from, once one has been picked. Kept beside the
    // form rather than in it, because none of it is part of the record: the
    // store is handed what the file contained, not where it was sitting.
    const [imported, setImported] = useState(null);
    const [choosingFile, setChoosingFile] = useState(false);

    const generating = mode === 'generate' && !keyData;
    // Once the pair exists the form is describing a key that is already made,
    // so the options that produced it stop being questions.
    const settingUp = generating && !formData.pendingKeyId;

    const handleChange = useCallback((field, value) => {
        setFormData(prev => {
            const updated = { ...prev, [field]: value };
            // Reset keySize when type changes
            if (field === 'type') {
                updated.keySize = '';
            }
            return updated;
        });
        setErrors(prev => ({ ...prev, [field]: '' }));
    }, []);

    const validateForm = useCallback(() => {
        const newErrors = {};

        if (!formData.name.trim()) {
            newErrors.name = 'Name is required';
        }

        // An existing key already has its material stored, so a blank field is
        // valid when editing. So is a blank one after a file was picked: that
        // key is in the main process waiting to be claimed by id.
        if (mode === 'import' && !keyData?.hasPrivateKey
            && !formData.privateKey.trim() && !formData.pendingKeyId) {
            newErrors.privateKey = 'Private key is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }, [formData, mode, keyData]);

    const handleGenerate = useCallback(async () => {
        if (!validateForm()) return;

        setIsGenerating(true);
        try {
            const result = await onGenerate({
                type: formData.type,
                keySize: formData.keySize ? parseInt(formData.keySize) : undefined,
                comment: formData.comment || `cloudblast-${formData.name}`,
                passphrase: formData.passphrase,
            });

            // Only the public half comes back; the private key is held by the
            // main process and claimed by id on save.
            setFormData(prev => ({
                ...prev,
                pendingKeyId: result.pendingKeyId,
                fingerprint: result.fingerprint,
                publicKey: result.publicKey,
            }));

            toast.success('Key pair generated', toastOptions({ duration: 1800 }));
            setIsGenerating(false);
        } catch (error) {
            toast.error(`Failed to generate key: ${error.message}`, toastOptions());
            setIsGenerating(false);
        }
    }, [formData, onGenerate, validateForm]);

    /**
     * Take the key off disk instead of out of the clipboard.
     *
     * The file is read in the main process, so what comes back is everything
     * the form can show about the key and nothing it should be holding: an id
     * standing in for the private half, plus whatever the `.pub` and the
     * `-cert.pub` beside it turned out to say. The name is filled in from the
     * file only when the field is still empty, so picking a second file does
     * not rename a key that has already been named.
     */
    const handleChooseFile = useCallback(async () => {
        if (choosingFile) return;
        setChoosingFile(true);
        try {
            // The id of an earlier pick, so a change of mind does not leave the
            // first file's private key held in the main process.
            const result = await window.api.keys.importFile({ replaces: formData.pendingKeyId });
            if (result.canceled) return;

            if (!result.success) {
                toast.error(result.message || 'That file could not be read as a key',
                    toastOptions({ duration: 5000 }));
                return;
            }

            setFormData(prev => ({
                ...prev,
                name: prev.name.trim() || result.file,
                pendingKeyId: result.pendingKeyId,
                // Whatever was pasted before is not what is being saved now.
                privateKey: '',
                type: result.type || prev.type,
                fingerprint: result.fingerprint || prev.fingerprint,
                publicKey: result.publicKey || prev.publicKey,
                certificate: result.certificate || prev.certificate,
            }));
            setImported({ file: result.file, encrypted: result.encrypted });
            setErrors(prev => ({ ...prev, name: '', privateKey: '' }));
            toast.success(`Read ${result.file}`, toastOptions({ duration: 1800 }));
        } catch (error) {
            toast.error(`Could not read that file: ${error.message}`, toastOptions());
        } finally {
            setChoosingFile(false);
        }
    }, [choosingFile, formData.pendingKeyId]);

    /**
     * Back to the paste box.
     *
     * Only the private half goes: the public key, fingerprint and certificate
     * the file filled in stay in their boxes, where they can be read and edited
     * like anything else typed into this form.
     */
    const handleForgetFile = useCallback(() => {
        setFormData(prev => ({ ...prev, pendingKeyId: '' }));
        setImported(null);
    }, []);

    /**
     * `reportValidity` keeps the browser's own `required` handling now that the
     * action sits in the sheet footer, outside the form. The close is the
     * sheet's animated one, so saving leaves the same way cancelling does.
     */
    const submit = useCallback(async (close) => {
        if (!formRef.current?.reportValidity()) return;
        if (!validateForm()) return;

        try {
            await onSave({ ...formData, id: keyData?.id });
        } catch {
            // Already reported by the caller. Stay open so the entered key is
            // not thrown away along with the failure.
            return;
        }
        close();
    }, [formData, keyData, onSave, validateForm]);

    return (
        <Sheet
            title={keyData?.hello ? 'Windows Hello key'
                : keyData ? 'Edit SSH key'
                : mode === 'generate' ? 'Generate SSH key' : 'Import SSH key'}
            subtitle={keyData?.hello
                ? 'The private key is in this PC’s TPM. Nothing here can read it, including this app.'
                : 'Keys live in the app keychain and never leave the main process.'}
            dismiss={dismiss}
            onClose={onClose}
            footer={(close) => (
                <>
                    <Button onClick={close}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={() => submit(close)}
                        // Saving mid-generation would write a record with no
                        // private key in it: the pair does not exist yet, and
                        // the id that claims it is handed over at the end.
                        disabled={isGenerating || (generating && !formData.pendingKeyId)}
                    >
                        Save key
                    </Button>
                </>
            )}
        >
            {(close) => (
            <form
                ref={formRef}
                onSubmit={(event) => { event.preventDefault(); submit(close); }}
                className="flex flex-col gap-4"
            >
                <Field label="Key name" error={errors.name}>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        className={FIELD_CLASS}
                        placeholder="e.g. My GitHub Key"
                        required
                    />
                </Field>

                {/* A Windows Hello key has nothing to paste and nothing to
                    reveal: the private half is in the TPM and will not come
                    out. What it does need is the line to put on a server, which
                    is the only reason to open this at all. */}
                {keyData?.hello && (
                    <>
                        <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-900/10 p-3 flex gap-2.5">
                            <FingerPrintIcon
                                size={18}
                                strokeWidth={2}
                                className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400"
                            />
                            <div className="min-w-0 flex flex-col gap-1">
                                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                                    Held by Windows Hello
                                </span>
                                <span className="text-xs text-gray-600 dark:text-gray-400">
                                    The private key lives in this PC’s TPM and cannot be exported, copied
                                    or backed up, not by this app and not by you. Every connection asks
                                    for Windows Hello.
                                </span>
                                <span className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                                    It only works from this machine. Reinstalling elsewhere, or resetting
                                    Windows Hello, loses it for good. Keep another key on your servers so
                                    that does not lock you out.
                                </span>
                            </div>
                        </div>

                        <Field
                            label="Public key"
                            hint="Put this line in ~/.ssh/authorized_keys on the servers you want to reach."
                        >
                            <div className="relative">
                                <textarea
                                    value={formData.publicKey}
                                    readOnly
                                    rows={3}
                                    className={`${MONO_FIELD_CLASS} resize-none pr-16`}
                                />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="absolute right-1.5 top-1.5"
                                    onClick={() => {
                                        navigator.clipboard.writeText(formData.publicKey);
                                        toast.success('Public key copied', toastOptions({ duration: 1800 }));
                                    }}
                                >
                                    Copy
                                </Button>
                            </div>
                        </Field>

                        {formData.fingerprint && (
                            <Field label="Fingerprint">
                                <input
                                    value={formData.fingerprint}
                                    readOnly
                                    className={`${MONO_FIELD_CLASS} cursor-default`}
                                />
                            </Field>
                        )}
                    </>
                )}

                {settingUp && (
                    <>
                        {/* A group of buttons is not wrapped in a `Field`, the
                            same way the host form's auth picker is not: `Field`
                            is a `<label>`, and a label whose control is one of
                            three buttons is a label pointing at the wrong one. */}
                        <FieldGroup label="Key type">
                            <div className="grid grid-cols-3 gap-2">
                                {KEY_TYPES.map((keyType) => (
                                    <button
                                        key={keyType.id}
                                        type="button"
                                        aria-pressed={formData.type === keyType.id}
                                        className={`${OPTION_CARD} ${formData.type === keyType.id
                                            ? OPTION_CARD_PICKED : OPTION_CARD_RESTING}`}
                                        onClick={() => handleChange('type', keyType.id)}
                                    >
                                        <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                                            {keyType.label}
                                        </span>
                                        {/* `gray-400`, not `neutral-500`. The
                                            second is #565f89 in this palette,
                                            which over a picked card's #24283b
                                            is about 2:1, so the description was
                                            there and unreadable. This is the
                                            tone the app's other option cards
                                            use for the line under a label. */}
                                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            {keyType.description}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </FieldGroup>

                        <AnimatedCollapse isOpen={formData.type === 'ECDSA' || formData.type === 'RSA'}>
                            <FieldGroup
                                label={formData.type === 'ECDSA' ? 'Elliptic curve size (bits)' : 'Key size (bits)'}
                                // None of them starts picked, which used to read
                                // as three broken buttons. It is a real state:
                                // ssh-keygen has a default and this is how you
                                // ask for it.
                                hint="Optional. Left alone, ssh-keygen picks its own default."
                                className="pb-1"
                            >
                                <div className="grid grid-cols-3 gap-2">
                                    {(formData.type === 'ECDSA' ? ['521', '384', '256'] : ['4096', '2048', '1024']).map((size) => (
                                        <button
                                            key={size}
                                            type="button"
                                            aria-pressed={formData.keySize === size}
                                            className={`${OPTION_CARD} text-center ${formData.keySize === size
                                                ? OPTION_CARD_PICKED : OPTION_CARD_RESTING}`}
                                            onClick={() => handleChange('keySize', size)}
                                        >
                                            <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                                                {size}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </FieldGroup>
                        </AnimatedCollapse>

                        <Field label="Comment" hint="Optional. Written into the key itself.">
                            <input
                                type="text"
                                value={formData.comment}
                                onChange={(e) => handleChange('comment', e.target.value)}
                                className={FIELD_CLASS}
                                placeholder="e.g. user@example.com"
                            />
                        </Field>
                    </>
                )}

                {/* On the way out, the passphrase is what the new key gets
                    locked with, so it is asked for before the pair is made. */}
                {settingUp && (
                    <SecretField
                        label="Passphrase"
                        hint="Optional. The generated key is encrypted with this."
                        value={formData.passphrase}
                        placeholder="Leave empty for no passphrase"
                        onChange={(value) => handleChange('passphrase', value)}
                    />
                )}

                {settingUp && (
                    <Button
                        variant="primary"
                        fullWidth
                        size="lg"
                        onClick={handleGenerate}
                        disabled={isGenerating}
                    >
                        {isGenerating ? 'Generating…' : 'Generate key pair'}
                    </Button>
                )}

                {/* Keys Display - for import mode or after generation. Skipped
                    for a Hello key, which showed its own above and has no
                    private half or certificate to offer. */}
                {!keyData?.hello && (mode === 'import' || formData.pendingKeyId || keyData) && (
                    <>
                        {/* The other way in, and the one that does not involve
                            opening a private key in a text editor first. It sits
                            above the boxes it fills rather than beside the
                            private key field alone, because one pick answers all
                            four of them. */}
                        {mode === 'import' && !formData.pendingKeyId && (
                            <div className="rounded-xl border border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base/60 p-3 flex items-center gap-3">
                                <div className="min-w-0 flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Import from a file
                                    </span>
                                    <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                                        Pick a key such as <span className="font-mono">id_ed25519</span>.
                                        A <span className="font-mono">.pub</span> or
                                        {' '}<span className="font-mono">-cert.pub</span> sitting beside it
                                        comes too, and the key is read without passing through this window.
                                    </span>
                                </div>
                                <Button
                                    className="ml-auto shrink-0"
                                    onClick={handleChooseFile}
                                    disabled={choosingFile}
                                    icon={<FileImportIcon size={15} strokeWidth={2} />}
                                >
                                    {choosingFile ? 'Choosing…' : 'Choose file'}
                                </Button>
                            </div>
                        )}

                        <Field
                            label={mode === 'import' ? 'Public key (optional)' : 'Public key'}
                            hint={mode === 'import'
                                ? 'Paste it to record the fingerprint and the algorithm.'
                                : undefined}
                        >
                            <div className="relative">
                                <textarea
                                    value={formData.publicKey}
                                    onChange={(e) => handleChange('publicKey', e.target.value)}
                                    rows={3}
                                    className={`${MONO_FIELD_CLASS} resize-none ${formData.publicKey ? 'pr-16' : ''}`}
                                    placeholder="ssh-ed25519 AAAA..."
                                    readOnly={generating}
                                />
                                {formData.publicKey && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="absolute right-1.5 top-1.5"
                                        onClick={() => {
                                            navigator.clipboard.writeText(formData.publicKey);
                                            toast.success('Public key copied', toastOptions({ duration: 1800 }));
                                        }}
                                    >
                                        Copy
                                    </Button>
                                )}
                            </div>
                        </Field>

                        {/* Private Key: pasted on import; a generated one and
                            one read from a file both stay in the main process,
                            so there is nothing to show but what they are. */}
                        {formData.pendingKeyId ? (
                            <div className="rounded-lg border border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base/60 p-3 flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                    {imported ? `Private key read from ${imported.file}` : 'Private key generated'}
                                </span>
                                <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                                    It is held by the app and will be encrypted with the OS
                                    keystore when you save.
                                </span>
                                {formData.fingerprint && (
                                    <span className="text-[11px] font-mono break-all text-gray-600 dark:text-gray-300 mt-1">
                                        {formData.fingerprint}
                                    </span>
                                )}
                                {/* A wrong file is easy to pick out of a folder
                                    of `id_` names, so both ways back are here.
                                    A generated key has neither: there is no
                                    other file, and the pair only exists once. */}
                                {imported && (
                                    <div className="flex gap-1 mt-1.5 -ml-2">
                                        <Button size="sm" variant="ghost" onClick={handleChooseFile} disabled={choosingFile}>
                                            {choosingFile ? 'Choosing…' : 'Choose another file'}
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={handleForgetFile}>
                                            Paste instead
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Field label="Private key" error={errors.privateKey}>
                                <div className="relative">
                                    <textarea
                                        value={formData.privateKey}
                                        onChange={(e) => handleChange('privateKey', e.target.value)}
                                        rows={6}
                                        className={`${MONO_FIELD_CLASS} resize-none pr-10`}
                                        placeholder={keyData?.hasPrivateKey
                                            ? 'Stored, leave blank to keep the existing key'
                                            : '-----BEGIN OPENSSH PRIVATE KEY-----...'}
                                        required={mode === 'import' && !keyData?.hasPrivateKey}
                                        style={!showPrivate && formData.privateKey ? { WebkitTextSecurity: 'disc' } : {}}
                                    />
                                    <IconButton
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setShowPrivate(!showPrivate)}
                                        title={showPrivate ? 'Hide private key' : 'Show private key'}
                                        className="absolute right-1.5 top-1.5"
                                        icon={showPrivate
                                            ? <ViewOffIcon size={15} strokeWidth={2} />
                                            : <ViewIcon size={15} strokeWidth={2} />}
                                    />
                                </div>
                            </Field>
                        )}

                        {/* The certificate, if the key has one.
                            A CA-signed certificate replaces an `authorized_keys`
                            entry on every server that trusts the CA, which is
                            why it belongs to the key rather than to a host: it
                            is issued for this key and is presented wherever the
                            key is used, exactly as `ssh` picks up a
                            `<key>-cert.pub` sitting beside the key file. */}
                        <Field
                            label="Certificate (optional)"
                            hint={certificateNote(keyData?.certificateInfo)}
                        >
                            <textarea
                                value={formData.certificate}
                                onChange={(e) => handleChange('certificate', e.target.value)}
                                rows={3}
                                className={`${MONO_FIELD_CLASS} resize-none`}
                                placeholder="ssh-ed25519-cert-v01@openssh.com AAAA..."
                                spellCheck={false}
                            />
                        </Field>

                        {/* On the way in, the passphrase is what unlocks the key
                            that was just pasted, so it comes after it. This is
                            the whole reason the field is here at all in import
                            mode: an encrypted key stored without one is a key
                            that can never dial, and there was nowhere to type
                            it, nor anywhere to change it on an existing key. */}
                        {!generating && (
                            <SecretField
                                label="Passphrase"
                                // A file the app has already read can say whether
                                // it is encrypted, and it is worth saying here:
                                // stored without one, that key fails at the far
                                // end of a connection rather than on this form.
                                hint={imported?.encrypted
                                    ? `${imported.file} is encrypted. Without its passphrase the key cannot connect.`
                                    : keyData?.hasPassphrase
                                        ? 'A passphrase is stored for this key. Leave blank to keep it.'
                                        : 'Only if the private key above is encrypted.'}
                                value={formData.passphrase}
                                placeholder={keyData?.hasPassphrase
                                    ? 'Stored, leave blank to keep'
                                    : 'Leave empty if the key has none'}
                                onChange={(value) => handleChange('passphrase', value)}
                            />
                        )}
                    </>
                )}

                {/* Danger zone. Cancel and Save live in the sheet footer; this
                    stays in the body because it is not one of the two things
                    you came here to do. The page asks before it acts: the sheet
                    leaves, and the confirmation comes up over the list. */}
                {keyData && onRequestDelete && (
                    <div className="mt-2 p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10">
                        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">
                            Danger zone
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            Once you delete this key, there is no going back. Please be certain.
                        </p>
                        <Button
                            variant="dangerOutline"
                            fullWidth
                            onClick={() => {
                                onRequestDelete();
                                close();
                            }}
                        >
                            Delete this key
                        </Button>
                    </div>
                )}
            </form>
            )}
        </Sheet>
    );
}

export default memo(KeyModal);
