import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileImportIcon, FingerPrintIcon, Key01Icon, PlusSignIcon, SearchRemoveIcon } from 'hugeicons-react';
import toast from 'react-hot-toast';
import { toastOptions } from '../lib/toast';
import KeyModal from './KeyModal';
import KeyCard from './KeyCard';
import Button, { IconButton } from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import EmptyFrame from './ui/EmptyFrame';
import SearchField from './ui/SearchField';
import { CARD_GRID } from '../lib/layout';
import { useT } from '../i18n';
import { useFlipOrder } from '../hooks/useFlipOrder';

/**
 * The keychain.
 *
 * A sibling of Hosts and Snippets, laid out the way they are: a header led by
 * the search field with the actions at its right, then a list that scrolls on
 * its own. There is no page title for the same reason those two dropped theirs:
 * the sidebar item is already lit and the cards are plainly keys.
 *
 * The count of what is in use went with it. It was the one thing here the cards
 * could not say, but it was saying it in the widest part of the row while the
 * page had no way to find a key by name, which is the harder problem of the
 * two once a keychain is more than a screenful.
 *
 * Generating and importing are two buttons rather than one with a menu. They
 * are the same weight of action as "new folder" and "new host" on the Hosts
 * page and are spelled the same way here: the common one carries the label, the
 * other is a glyph beside it. A menu would have put a click in front of both.
 */

function KeychainPanel({
    isActive = true,
    reachedForPage = 0,
    keys,
    allHosts = [],
    onLoadKeys,
    onSaveKey,
    onDeleteKey,
    onGenerateKey,
}) {
    const t = useT();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingKey, setEditingKey] = useState(null);
    const [initialMode, setInitialMode] = useState('generate');
    const [confirming, setConfirming] = useState(null);
    const [query, setQuery] = useState('');
    // Null until asked, so the button does not flash in and out on a machine
    // that turns out not to have Hello set up.
    const [helloReady, setHelloReady] = useState(false);
    const [enrolling, setEnrolling] = useState(false);

    const searchRef = useRef(null);

    useEffect(() => {
        onLoadKeys();
    }, [onLoadKeys]);

    useEffect(() => {
        let cancelled = false;
        window.api.keys.helloSupported()
            .then((supported) => { if (!cancelled) setHelloReady(Boolean(supported)); })
            .catch(() => { /* not Windows, or no helper in this build */ });
        return () => { cancelled = true; };
    }, []);

    // The editor belongs to this page. Home stays mounted behind a terminal
    // tab, so without this the sheet would sit over the shell you switched to.
    useEffect(() => {
        if (isActive) return;
        setModalOpen(false);
        setEditingKey(null);
        setConfirming(null);
    }, [isActive]);

    // Reaching for this page while standing on it asks for the editor over it
    // to go. The sheet is handed the signal rather than unmounted, so it slides
    // out onto the page being asked for instead of blinking off it. The confirm
    // is a centred dialog with no exit to cut short, so it simply stops.
    useEffect(() => {
        setConfirming(null);
    }, [reachedForPage]);

    /* ------------------------------------------------------------------ *
     * What is on screen
     * ------------------------------------------------------------------ */

    /**
     * Which hosts each key is holding up.
     *
     * Worked out once per render rather than per card, and it is the answer to
     * two questions: the count a card shows, and who breaks if the key is
     * deleted. A host only counts when it is actually set to use the keychain:
     * a stale `keychainKeyId` left behind by a switch to password auth is not a
     * dependency, and counting it would overstate what a delete costs.
     */
    const entries = useMemo(() => {
        const dependants = new Map();
        for (const host of allHosts) {
            if (host.authMethod !== 'keychain' || !host.keychainKeyId) continue;
            if (!dependants.has(host.keychainKeyId)) dependants.set(host.keychainKeyId, []);
            dependants.get(host.keychainKeyId).push(host);
        }

        // Named order, because the store hands them back in the order they were
        // added and nothing on this page offers to sort them.
        return [...keys]
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map((key) => {
                const hosts = dependants.get(key.id) || [];
                return { key, hosts, usedBy: hosts.length };
            });
    }, [keys, allHosts]);

    const searching = query.trim().length > 0;

    /**
     * What a key can be found by.
     *
     * The name and the comment are what someone wrote down, the type is how
     * people talk about keys ("the ed25519 one"), and the fingerprint is there
     * because it is the string you have in your hand when a server log or an
     * `authorized_keys` line is what sent you looking. The names of the hosts
     * holding the key are in the haystack too: "which key does the bastion
     * use" is a question about a host, asked on this page.
     */
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return entries;

        return entries.filter(({ key, hosts }) => [
            key.name,
            key.comment,
            key.type,
            key.fingerprint,
            hosts.map(host => host.name).join(' '),
        ].filter(Boolean).join(' ').toLowerCase().includes(needle));
    }, [entries, query]);

    // Cards slide between positions when the list is reordered by a search, and
    // when the grid rewraps because the column it was using no longer fits.
    const gridRef = useRef(null);
    const orderKey = useMemo(() => visible.map(entry => entry.key.id).join(), [visible]);
    useFlipOrder(gridRef, orderKey);

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */

    const handleNewKey = useCallback((mode) => {
        setInitialMode(mode);
        setEditingKey(null);
        setModalOpen(true);
    }, []);

    const handleEditKey = useCallback((key) => {
        setEditingKey(key);
        setModalOpen(true);
    }, []);

    const handleSaveKey = useCallback(async (keyData) => {
        try {
            await onSaveKey(keyData);
            // Closing is the sheet's job: it animates out and then unmounts
            // itself through onClose. Clearing the flag here would cut that off.
            toast.success(keyData.id ? 'Key updated' : 'Key saved', toastOptions({ duration: 1800 }));
        } catch (error) {
            toast.error(`Failed to save key: ${error.message}`, toastOptions());
            // Rethrown so the sheet stays open on a failure rather than
            // animating away as though the key had been written.
            throw error;
        }
    }, [onSaveKey]);

    const handleGenerateKey = useCallback(async (options) => {
        return await onGenerateKey(options);
    }, [onGenerateKey]);

    /**
     * Enrol a Windows Hello key.
     *
     * There is no form in front of this: the only thing the app decides is a
     * name, and the interesting part happens in the Hello prompt. The editor
     * opens on the result because the key is useless until its public half has
     * been put on a server, and that is where the line to copy is.
     */
    const handleNewHelloKey = useCallback(async () => {
        if (enrolling) return;
        setEnrolling(true);
        try {
            const created = await window.api.keys.createHello({ name: 'Windows Hello' });
            await onLoadKeys();
            setEditingKey(created);
            setModalOpen(true);
            toast.success('Windows Hello key enrolled', toastOptions({ duration: 2200 }));
        } catch (error) {
            toast.error(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''),
                toastOptions({ duration: 4000 }));
        } finally {
            setEnrolling(false);
        }
    }, [enrolling, onLoadKeys]);

    /**
     * Ask before deleting, and say who is relying on it.
     *
     * A private key is the one record in the app that nothing can bring back,
     * not a re-import and not a sync, and a host set to keychain auth does not
     * fail here when its key goes. It fails the next time someone tries to
     * connect, with a message about a key that is no longer in the list.
     */
    const confirmDelete = useCallback((entry) => {
        const { key, hosts } = entry;

        setConfirming({
            title: 'Delete this key?',
            message: hosts.length > 0
                ? `“${key.name}” is the key ${hosts.length === 1 ? `“${hosts[0].name}” uses` : `${hosts.length} hosts use`} to connect. `
                    + `Deleting it will stop ${hosts.length === 1 ? 'that host' : 'them'} from dialling until another key is chosen. `
                    + 'The private key cannot be recovered.'
                : `“${key.name}” will be removed from the keychain. The private key cannot be recovered.`,
            confirmLabel: 'Delete key',
            // A Hello key's consequence reaches further than the app: the TPM
            // credential goes with the record, and every server still carrying
            // its line in `authorized_keys` is left with a key nothing holds.
            details: key.hello
                ? [`Removes the Windows Hello credential from this PC`,
                    `Remove ${key.fingerprint || 'its public key'} from authorized_keys on your servers`,
                    ...hosts.map(host => host.name)]
                : hosts.map(host => host.name),
            onConfirm: async () => {
                setConfirming(null);
                try {
                    await onDeleteKey(key.id);
                } catch (error) {
                    toast.error(`Failed to delete key: ${error.message}`, toastOptions());
                    return;
                }
                toast.success(`Deleted “${key.name}”`, toastOptions({ duration: 2200 }));
            },
        });
    }, [onDeleteKey]);

    const copy = useCallback(async (text, what) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(`${what} copied`, toastOptions({ duration: 1800 }));
        } catch (error) {
            toast.error(`Could not copy that: ${error.message}`, toastOptions());
        }
    }, []);

    /* ------------------------------------------------------------------ *
     * Keyboard
     * ------------------------------------------------------------------ */

    useEffect(() => {
        if (!isActive) return;

        const handler = (event) => {
            if (event.defaultPrevented) return;
            const typing = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');

            // The two ways every list in every app offers to start searching,
            // matching what Hosts and Snippets bind.
            if (((event.ctrlKey || event.metaKey) && event.key === 'f' && !event.altKey)
                || (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isActive]);

    const handleSearchKeyDown = useCallback((event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (query) setQuery('');
        else event.currentTarget.blur();
    }, [query]);

    /* ------------------------------------------------------------------ *
     * Render
     * ------------------------------------------------------------------ */

    return (
        <div className="flex flex-col gap-4 h-full min-h-0" id="keychain-panel">
            <div className="flex items-center gap-2 shrink-0">
                <SearchField
                    ref={searchRef}
                    value={query}
                    onChange={setQuery}
                    onKeyDown={handleSearchKeyDown}
                    ariaLabel={t('keychain.search')}
                />

                <div className="flex items-center gap-2 shrink-0">
                    <IconButton
                        onClick={() => handleNewKey('import')}
                        title={t('keychain.import')}
                        icon={<FileImportIcon size={18} strokeWidth={1.75} />}
                    />
                    {/* Only where there is a Hello to enrol into. Offering it on
                        a machine with no biometrics set up would be a button
                        whose only outcome is an error. */}
                    {helloReady && (
                        <IconButton
                            onClick={handleNewHelloKey}
                            disabled={enrolling}
                            title={enrolling
                                ? t('keychain.helloWaiting')
                                : t('keychain.helloAdd')}
                            icon={<FingerPrintIcon size={18} strokeWidth={1.75} />}
                        />
                    )}
                    <Button
                        variant="primary"
                        onClick={() => handleNewKey('generate')}
                        icon={<PlusSignIcon size={16} strokeWidth={2.5} />}
                    >
                        {t('keychain.newKey')}
                    </Button>
                </div>
            </div>

            {/* The panel scrolls its own list, so the actions stay put however
                many keys the collection grows to. */}
            <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2 pb-1">
                {visible.length === 0 ? (
                    <EmptyFrame
                        icon={searching
                            ? <SearchRemoveIcon size={28} strokeWidth={1.5} />
                            : <Key01Icon size={28} strokeWidth={1.5} />}
                        title={searching ? t('common.noMatchesTitle') : t('keychain.empty')}
                        note={searching
                            ? `“${query.trim()}”`
                            : t('keychain.emptyNote')}
                    />
                ) : (
                    <div ref={gridRef} className={CARD_GRID}>
                        {visible.map(entry => (
                            <KeyCard
                                key={entry.key.id}
                                entry={entry}
                                onEdit={() => handleEditKey(entry.key)}
                                onCopyPublicKey={() => copy(entry.key.publicKey, 'Public key')}
                                onCopyFingerprint={() => copy(entry.key.fingerprint, 'Fingerprint')}
                                onDelete={() => confirmDelete(entry)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {modalOpen && (
                <KeyModal
                    keyData={editingKey}
                    initialMode={initialMode}
                    dismiss={reachedForPage}
                    onClose={() => {
                        setModalOpen(false);
                        setEditingKey(null);
                    }}
                    onSave={handleSaveKey}
                    onGenerate={handleGenerateKey}
                    // The editor asks; the page confirms, the same way the card
                    // menu does. Deleting straight from inside the sheet was the
                    // one destructive action in the app that never asked.
                    onRequestDelete={() => {
                        const entry = entries.find(item => item.key.id === editingKey?.id);
                        if (entry) confirmDelete(entry);
                    }}
                />
            )}

            {confirming && <ConfirmDialog {...confirming} onCancel={() => setConfirming(null)} />}
        </div>
    );
}

export default memo(KeychainPanel);
