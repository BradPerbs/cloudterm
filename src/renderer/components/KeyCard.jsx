import { memo, useCallback } from 'react';
import {
    Copy01Icon,
    Delete02Icon,
    Edit02Icon,
    FingerPrintIcon,
    Key01Icon,
    LockPasswordIcon,
    MoreVerticalIcon,
} from 'hugeicons-react';
import IconTile from './hosts/IconTile';
import MenuButton from './ui/MenuButton';

/**
 * One key in the keychain, as a tile in the grid.
 *
 * Built to the same two lines as a host card, because it is the same kind of
 * object in the same kind of collection: what it is called, and the one string
 * that identifies it. For a host that is `user@host`; for a key it is the
 * fingerprint, which is the only thing that tells two ED25519 keys apart — the
 * name is whatever someone typed, and the algorithm is shared by half the list.
 *
 * The marks on the right are the three facts that change what the key can do,
 * and they are the flags the bridge was already sending and nothing was
 * reading: whether the private half is here at all, whether it is locked behind
 * a passphrase, and how many hosts would stop dialling if it went.
 */

/** The card is the edit button, so the menu on it opts out of that click. */
const stop = (event) => event.stopPropagation();

/** The certificate chip: whether to draw one, and what it says on hover. */
function describeCertificate(info) {
    if (!info) return null;

    const expired = info.validBefore !== null && Date.now() > info.validBefore;
    const when = info.validBefore === null
        ? 'never expires'
        : `${expired ? 'expired' : 'valid until'} ${new Date(info.validBefore).toLocaleDateString()}`;
    const who = info.principals?.length ? info.principals.join(', ') : 'any username';

    return { expired, title: `Certificate “${info.keyId}” · ${who} · ${when}` };
}

function KeyCard({ entry, onEdit, onCopyPublicKey, onCopyFingerprint, onDelete }) {
    const { key, usedBy } = entry;

    const handleClick = useCallback((event) => {
        if (event.target.closest('[data-action]')) return;
        onEdit();
    }, [onEdit]);

    // Enter and Space reach the card through the keyboard; without them a key
    // could be tabbed to and not opened.
    const handleKeyDown = useCallback((event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onEdit();
    }, [onEdit]);

    /**
     * The identifying line.
     *
     * The `SHA256:` prefix is on every fingerprint in the list, so it is the one
     * part that distinguishes nothing; dropped here to spend the width on the
     * digest instead. A key imported without its public half has no fingerprint
     * to show and falls back to its comment, which is at least something the
     * person who saved it wrote down.
     */
    const digest = (key.fingerprint || '').replace(/^SHA256:/, '');
    const identity = digest || key.comment || '';

    const certificate = describeCertificate(key.certificateInfo);

    const menuItems = [
        { label: 'Edit key', icon: <Edit02Icon size={14} strokeWidth={2} />, onSelect: onEdit },
        {
            label: 'Copy public key',
            icon: <Copy01Icon size={14} strokeWidth={2} />,
            disabled: !key.publicKey,
            onSelect: onCopyPublicKey,
        },
        {
            label: 'Copy fingerprint',
            icon: <FingerPrintIcon size={14} strokeWidth={2} />,
            disabled: !key.fingerprint,
            onSelect: onCopyFingerprint,
        },
        { separator: true },
        { label: 'Delete', icon: <Delete02Icon size={14} strokeWidth={2} />, danger: true, onSelect: onDelete },
    ];

    return (
        <div
            // What useFlipOrder follows a card by when the grid rewraps.
            data-card-id={key.id}
            className="org-card group relative cursor-pointer rounded-2xl p-2.5"
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
        >
            <div className="flex items-center gap-2.5">
                <IconTile size="md">
                    {/* A Hello key is a different kind of thing, not a variant
                        of the same one, so it is told apart at a glance rather
                        than by reading the marks. */}
                    {key.hello
                        ? <FingerPrintIcon size={20} strokeWidth={1.5} className="text-blue-500 dark:text-blue-400" />
                        : <Key01Icon size={20} strokeWidth={1.5} className="text-gray-500 dark:text-gray-300" />}
                </IconTile>

                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate leading-tight">
                        {key.name}
                    </h3>

                    {/* The marks keep their width and the fingerprint gives way:
                        a truncated digest still says which key this is (the name
                        above it already did), while half a warning says nothing. */}
                    <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                        <p className="flex-1 min-w-0 text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight">
                            {key.type || 'SSH'}
                            {identity && (
                                <>
                                    <span className="mx-1 opacity-50">·</span>
                                    <span className={digest ? 'font-mono' : ''} title={key.fingerprint || undefined}>
                                        {identity}
                                    </span>
                                </>
                            )}
                        </p>

                        {/* Read-only, so they stay part of the card's own click
                            target rather than opting out of it the way the menu
                            does: a badge that swallows the click is a dead spot
                            in the middle of a card that opens. */}
                        <span className="shrink-0 flex items-center gap-1.5">
                            {/* A key with no private half cannot authenticate
                                anything. It is a real record with a real name,
                                so nothing else on the card would say so. */}
                            {/* A Hello key has no stored private half either,
                                but for the opposite reason: it is in the TPM
                                and cannot be taken out. Saying "public only"
                                about the strongest key in the list would be
                                exactly backwards. */}
                            {key.hello ? (
                                <span
                                    title="Held in this PC’s TPM. Signing asks for Windows Hello"
                                    className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md
                                        bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                >
                                    <FingerPrintIcon size={11} strokeWidth={2.5} />
                                    Hello
                                </span>
                            ) : !key.hasPrivateKey && (
                                <span
                                    title="No private key stored, so this key cannot authenticate"
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md
                                        bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                                >
                                    Public only
                                </span>
                            )}

                            {/* A certificate changes what the key is: it logs
                                in wherever the CA is trusted, and it stops
                                working on a date. Expiry is the one that has to
                                be visible without opening anything, because
                                nothing else about the key will have changed. */}
                            {certificate && (
                                <span
                                    title={certificate.title}
                                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${certificate.expired
                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                                        : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'}`}
                                >
                                    {certificate.expired ? 'Cert expired' : 'Cert'}
                                </span>
                            )}

                            {/* The mark is on a wrapper rather than the glyph:
                                an SVG ignores a `title` attribute, it wants a
                                `<title>` child, so the icon alone would be a
                                silent one. */}
                            {key.hasPassphrase && (
                                <span title="Protected by a passphrase" className="flex items-center text-gray-400 dark:text-neutral-500">
                                    <LockPasswordIcon size={12} strokeWidth={2} />
                                </span>
                            )}

                            {usedBy > 0 && (
                                <span
                                    title={`Used by ${usedBy} host${usedBy === 1 ? '' : 's'}`}
                                    className="text-[10px] font-medium tabular-nums text-gray-400 dark:text-neutral-500"
                                >
                                    {usedBy} host{usedBy === 1 ? '' : 's'}
                                </span>
                            )}
                        </span>
                    </div>
                </div>

                {/* Idle cards stay quiet; the controls come up on hover, and on
                    keyboard focus so they are still reachable without a mouse. */}
                <div
                    data-action="menu"
                    onClick={stop}
                    className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                >
                    <MenuButton
                        icon={<MoreVerticalIcon size={16} strokeWidth={2} />}
                        title="Key actions"
                        items={menuItems}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(KeyCard);
