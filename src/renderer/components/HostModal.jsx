import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { AlertSquareIcon, ViewIcon, ViewOffIcon } from 'hugeicons-react';
import AgentAuthFields from './AgentAuthFields';
import SerialFields from './hosts/SerialFields';
import TunnelsEditor from './tunnels/TunnelsEditor';
import DesktopEditor from './desktop/DesktopEditor';
import BmcEditor from './bmc/BmcEditor';
import Sheet from './ui/Sheet';
import Button, { IconButton } from './ui/Button';
import Checkbox from './ui/Checkbox';
import Disclosure from './ui/Disclosure';
import TagInput from './ui/TagInput';
import StoredSecretHint from './ui/StoredSecretHint';
import Field, { FIELD_CLASS, MONO_FIELD_CLASS } from './ui/Field';
import Select from './ui/Select';
import { HOST_KINDS, DEFAULT_PORTS, DEFAULT_SERIAL, hostKind, kindLabel } from '../lib/protocols';
import { monitorSupport, defaultCheckPort } from '../lib/monitor';
import { nameProxy, proxyRoute } from '../lib/proxies';
import { useProxies } from '../hooks/useProxies';
import useMonitor from '../hooks/useMonitor';
import { useT } from '../i18n';

const AUTH_METHODS = [
    { id: 'password', label: 'Password', hint: 'Send a stored password' },
    { id: 'keychain', label: 'Keychain', hint: 'Use a key from the app keychain' },
    { id: 'key', label: 'Key', hint: 'Paste a private key for this host only' },
    { id: 'agent', label: 'Agent', hint: 'Use keys held by your SSH agent' },
];

/**
 * The hosts that could relay this one.
 *
 * SSH only, because a relay is a channel on an SSH connection and neither a
 * telnet device nor a serial console has one to open. Anything already reached
 * *through* this host is out too: choosing it would close a loop, which the
 * connection layer refuses at connect time, far too late to be told about a
 * choice this form offered.
 *
 * The host being edited needs no separate check. A chain starting at it reaches
 * it immediately, so the same walk drops it.
 */
function jumpCandidates(hosts, hostId) {
    const byId = new Map(hosts.map(candidate => [candidate.id, candidate]));

    const passesThrough = (startId) => {
        const seen = new Set();
        let currentId = startId;
        // `seen` guards the walk itself: a cycle that predates this edit would
        // otherwise spin here rather than in the connection layer that reports it.
        while (currentId && !seen.has(currentId)) {
            if (currentId === hostId) return true;
            seen.add(currentId);
            currentId = byId.get(currentId)?.jumpHostId || '';
        }
        return false;
    };

    return hosts.filter(candidate =>
        hostKind(candidate) === 'ssh' && !passesThrough(candidate.id));
}

/**
 * Mounted only while open: the sheet owns the enter and exit animations and
 * calls `onClose` once it has finished leaving, so the form state can simply be
 * seeded from props instead of being reset by an effect on every open.
 */
function HostModal({ host, dismiss, onClose, onSave, keys = [], hosts = [], allTags = [] }) {
    const [formData, setFormData] = useState(() => ({
        id: host?.id,
        name: host?.name || '',
        tags: host?.tags || [],
        protocol: host?.protocol || 'ssh',
        // A desktop-only host has one address. The record may still carry a
        // leftover on the desktop block from when the form asked twice; seed
        // from the one that is actually used so a reopen does not change it.
        host: hostKind(host) === 'desktop'
            ? (host?.desktop?.host || host?.host || '')
            : (host?.host || ''),
        port: host?.port || DEFAULT_PORTS[host?.protocol || 'ssh'] || 22,
        serial: { ...DEFAULT_SERIAL, ...(host?.serial || {}) },
        username: host?.username || '',
        password: '',
        privateKey: '',
        passphrase: '',
        authMethod: host?.authMethod || 'password',
        keychainKeyId: host?.keychainKeyId || '',
        agentPath: host?.agentPath || '',
        agentForward: Boolean(host?.agentForward),
        legacyAlgorithms: Boolean(host?.legacyAlgorithms),
        // The saved host this one is reached through, by id. Blank is a direct
        // connection, which is almost every host.
        jumpHostId: host?.jumpHostId || '',
        // The saved proxy the socket is opened through, by id. Blank dials
        // straight out, which is almost every host.
        proxyId: host?.proxyId || '',
        initCommand: host?.initCommand || '',
        tunnels: host?.tunnels || [],
        // Whether a timer checks that this host is still answering, and on what
        // port. Port 0 means the one it connects on, resolved at check time so
        // that moving the SSH port moves the check with it.
        monitor: { enabled: false, port: 0, ...(host?.monitor || {}) },
        // The editor keeps the VNC password inside this block for the sake of
        // the form; `submit` lifts it back out to the flat field the store
        // encrypts, which is the only place it is ever stored.
        desktop: host?.desktop ? { ...host.desktop, password: '' } : {},
        // Same arrangement as `desktop`: the editor keeps the IPMI password
        // inside this block for the sake of the form, and `submit` lifts it back
        // out to the flat field the store encrypts.
        bmc: host?.bmc ? { ...host.bmc, password: '' } : {},
    }));
    const [showPassword, setShowPassword] = useState(false);
    // Secrets are never sent to the renderer, so an existing one shows as a
    // "stored" hint. Blank means keep it; this flag means delete it.
    const [clearSecrets, setClearSecrets] = useState(false);
    // Tracked apart from the SSH secrets: removing a stored login password is
    // not a reason to also drop the desktop's.
    const [clearDesktopPassword, setClearDesktopPassword] = useState(false);
    // And again for the IPMI's, which belongs to the board rather than to the
    // machine and has no reason to be cleared alongside either of the others.
    const [clearBmcPassword, setClearBmcPassword] = useState(false);
    const formRef = useRef(null);

    // Read straight from the hook rather than threaded down as a prop: the list
    // is global, cached, and the Proxies page keeps every mounted copy current,
    // so a proxy added a moment ago is already on offer here.
    const { proxies } = useProxies();
    const t = useT();

    // Monitoring has a master switch elsewhere, and a host set to be watched
    // while that is off would sit there doing nothing with this form having
    // cheerfully accepted the setting. So it is read here, and can be turned on
    // from here: sending someone to Settings to make the switch they just used
    // mean something is a worse answer than offering it where they are.
    const { settings: monitorSettings, configure: configureMonitor } = useMonitor();

    const handleChange = useCallback((field, value) => {
        setFormData(previous => ({ ...previous, [field]: value }));
    }, []);

    /**
     * What kind of host this is, which is the question the picker asks.
     *
     * Three of the four answers are the stored `protocol`. The fourth,
     * `desktop`, is not a protocol at all: it is a host with no shell, which the
     * record has always expressed as `desktop.only`. Resolving between the two
     * happens here so that nothing below, and nothing in main, has to know
     * the picker exists.
     */
    const kind = hostKind(formData);
    const isSerial = kind === 'serial';
    const isDesktop = kind === 'desktop';
    const isIpmi = kind === 'ipmi';
    // A shell of some sort. The things that need one (run-on-connect, the
    // session port) are offered for the protocols and not for a desktop or an
    // IPMI, neither of which opens a session at all.
    const hasShell = !isDesktop && !isIpmi;
    // Files, forwards and a tunnelled desktop are SSH channels, and telnet and
    // serial reach devices that have none.
    const sshHost = kind === 'ssh';

    /**
     * Whether this host can be watched, answered against the form rather than
     * against the saved record: choosing a jump host should close the section
     * as you choose it, not after a save and a reopen.
     */
    const watchable = monitorSupport(formData);
    const checkPort = defaultCheckPort(formData);
    const checkPortHint = checkPort
        ? `Left blank, this host is checked on port ${checkPort}, the one it connects on.`
        : 'Left blank, this host is checked on the port it connects on.';

    /**
     * What the jump host picker offers. The current choice stays on the list
     * even once it would no longer be offered (a host since switched to telnet,
     * or a loop closed from the other end), so that merely opening this form
     * cannot silently drop a setting nobody touched.
     */
    const jumpOptions = useMemo(() => {
        const candidates = jumpCandidates(hosts, host?.id);
        const chosen = formData.jumpHostId;
        if (!chosen || candidates.some(candidate => candidate.id === chosen)) return candidates;

        const stale = hosts.find(candidate => candidate.id === chosen);
        return stale ? [stale, ...candidates] : candidates;
    }, [hosts, host?.id, formData.jumpHostId]);

    /**
     * The relay chain in dial order, outermost first.
     *
     * A jump host may be reached through a jump host of its own, so choosing one
     * here can add more than one hop. That is worth saying out loud: it is the
     * one part of this setting assembled out of records the form is not showing.
     */
    const jumpChain = useMemo(() => {
        const byId = new Map(hosts.map(candidate => [candidate.id, candidate]));
        const names = [];
        const seen = new Set();

        let currentId = formData.jumpHostId;
        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            const found = byId.get(currentId);
            if (!found) break;
            names.push(found.name || found.host || currentId);
            currentId = found.jumpHostId || '';
        }

        return names.reverse();
    }, [hosts, formData.jumpHostId]);

    /**
     * The proxy route this host's socket is opened through, in dial order.
     *
     * Same shape as the jump chain above and for the same reason: choosing one
     * proxy can add more than one hop, because a proxy may itself be reached
     * through another, and that is the part assembled out of records this form is
     * not showing.
     */
    const proxyChain = useMemo(
        () => proxyRoute(proxies, formData.proxyId).map(nameProxy),
        [proxies, formData.proxyId],
    );

    /**
     * What each folded section says about itself while it is closed.
     *
     * A blank string means nothing is configured there, which is what leaves a
     * section reading as an empty row rather than one worth opening. These
     * double as the "does this already hold something" test that decides which
     * sections open themselves, so the two can never disagree.
     */
    const summaries = useMemo(() => {
        const tagCount = formData.tags?.length || 0;
        const tunnelCount = formData.tunnels?.length || 0;
        const desktop = formData.desktop || {};
        const jump = hosts.find(candidate => candidate.id === formData.jumpHostId);
        const via = proxies.find(candidate => candidate.id === formData.proxyId);
        const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

        return {
            naming: [
                formData.name.trim(),
                tagCount ? plural(tagCount, 'tag') : '',
            ].filter(Boolean).join(', '),
            jump: jump ? (jump.name || jump.host || '') : '',
            proxy: via ? nameProxy(via) : '',
            initCommand: (formData.initCommand || '').split('\n')[0].trim(),
            tunnels: tunnelCount ? plural(tunnelCount, 'forward') : '',
            desktop: desktop.enabled ? (desktop.protocol === 'rdp' ? 'RDP' : 'VNC') : '',
            bmc: formData.bmc?.enabled
                ? (formData.bmc.host || 'Same as the host')
                : '',
            // Not "Watched" for a host that has since been given a jump host:
            // the switch is still set, and the save is about to clear it,
            // because there is no route from here to check. Asked again here
            // rather than read off `watchable`, which is a fresh object every
            // render and would defeat the memo it was added to.
            monitor: formData.monitor?.enabled && monitorSupport(formData).ok
                ? (formData.monitor.port ? `Watched on port ${formData.monitor.port}` : 'Watched')
                : '',
            advanced: formData.legacyAlgorithms ? 'Legacy algorithms allowed' : '',
        };
    }, [formData, hosts, proxies]);

    const handleKind = useCallback((next) => {
        setFormData(previous => {
            const desktop = previous.desktop || {};
            const bmc = previous.bmc || {};

            if (next === 'desktop') {
                return {
                    ...previous,
                    // Still stored as an SSH host. `only` is what stops it
                    // dialling, and it is the field the rest of the app reads.
                    protocol: 'ssh',
                    // Keep whatever was already typed. A leftover desktop
                    // override is folded into it so switching kind cannot
                    // blank the only address the form will now show.
                    host: previous.host || desktop.host || '',
                    desktop: {
                        ...desktop,
                        enabled: true,
                        only: true,
                        // Tunnelling rides an SSH session, and this kind of host
                        // does not open one. Left on `tunnel` the desktop would
                        // be configured to travel down a connection that is
                        // never made.
                        transport: 'direct',
                        // One address, the host's. A leftover override is
                        // usually 127.0.0.1 from a tunnelled view, which is
                        // the wrong answer once this host no longer has SSH.
                        host: '',
                    },
                    // The two shell-less kinds are one answer to one question,
                    // so choosing this one puts the other back to being a view
                    // rather than the whole host.
                    bmc: { ...bmc, only: false },
                };
            }

            if (next === 'ipmi') {
                return {
                    ...previous,
                    protocol: 'ssh',
                    bmc: { ...bmc, enabled: true, only: true },
                    desktop: { ...desktop, only: false },
                };
            }

            // Switching protocol carries the port with it, but only when it was
            // still the old protocol's default. A host on 2222 stays on 2222;
            // one left on 22 becomes 23 rather than pointing telnet at the SSH
            // port.
            const wasDefault = !previous.port
                || previous.port === DEFAULT_PORTS[previous.protocol || 'ssh'];

            return {
                ...previous,
                protocol: next,
                port: wasDefault ? (DEFAULT_PORTS[next] || previous.port) : previous.port,
                // The host has a shell again. Whatever desktop was configured is
                // kept, since an SSH host with a desktop view is an ordinary thing
                // to be, but it is no longer the only reason to open the host.
                desktop: { ...desktop, only: false },
                // And the same for the IPMI, which is if anything more ordinary
                // to have alongside a shell than instead of one.
                bmc: { ...bmc, only: false },
            };
        });
    }, []);

    /**
     * `reportValidity` keeps the browser's own `required` handling now that the
     * action sits in the sheet footer, outside the form. The close is the
     * sheet's animated one, so saving leaves the same way cancelling does.
     */
    const submit = useCallback(async (close) => {
        if (!formRef.current?.reportValidity()) return;

        // '' keeps the stored secret, null deletes it.
        const secret = (value) => (value ? value : (clearSecrets ? null : ''));

        // The desktop's password is stored flat, next to the other secrets,
        // rather than nested in the block; that is what puts it under the same
        // encryption, redaction and backup handling as everything else. Which
        // field it lands in follows the protocol, so switching between them
        // leaves the other's password stored and untouched.
        const { password: desktopPassword, ...desktopRest } = formData.desktop || {};
        // A desktop-only host stores the address on the host itself. The
        // desktop block's copy is the override used when an SSH host also has
        // a desktop view, and must stay blank here or a save would resurrect
        // the second field the form just stopped asking.
        const desktop = isDesktop ? { ...desktopRest, host: '' } : desktopRest;
        const isRdp = desktop.protocol === 'rdp';
        const desktopSecret = desktopPassword || (clearDesktopPassword ? null : '');

        // The IPMI password goes the same way, and for the same reason. There is
        // only one field for it to land in, so unlike the desktop's it needs no
        // choosing between two.
        const { password: bmcPassword, ...bmc } = formData.bmc || {};
        const bmcSecret = bmcPassword || (clearBmcPassword ? null : '');

        // Every list, tab and log line calls a host by its name, so the record
        // always carries one, but it does not have to be typed. Left blank it
        // becomes the address, which is what anyone would have written anyway
        // for a box they only ever refer to by its IP. Resolved here, once, so
        // nothing downstream has to know the field was optional.
        const address = (isSerial ? formData.serial?.path : formData.host) || '';
        const name = formData.name.trim() || address.trim() || 'Untitled host';

        try {
            await onSave({
                ...formData,
                name,
                desktop,
                bmc,
                // '' keeps whatever is stored, so the protocol not in use is
                // left exactly as it was.
                vncPassword: isRdp ? '' : desktopSecret,
                rdpPassword: isRdp ? desktopSecret : '',
                bmcPassword: bmcSecret,
                password: secret(formData.password),
                privateKey: secret(formData.privateKey),
                passphrase: secret(formData.passphrase),
            });
        } catch {
            // Stay open so a failed save does not discard what was typed.
            return;
        }
        close();
    }, [formData, isSerial, isDesktop, clearSecrets, clearDesktopPassword, onSave]);

    return (
        <Sheet
            title={host ? 'Edit host' : 'New host'}
            subtitle="Where to connect, how to authenticate, and what to do once you are in."
            dismiss={dismiss}
            onClose={onClose}
            footer={(close) => (
                <>
                    <Button onClick={close}>Cancel</Button>
                    <Button variant="primary" onClick={() => submit(close)}>
                        {host ? 'Save host' : 'Create host'}
                    </Button>
                </>
            )}
        >
            {(close) => (
            <form
                ref={formRef}
                onSubmit={(event) => { event.preventDefault(); submit(close); }}
                className="flex flex-col gap-5"
            >
                {/* What kind of host this is. First, because every field below
                    it depends on the answer: a serial console has no address, a
                    telnet device has no key, and a desktop has no shell.

                    All four live in one row even though only three of them are
                    session protocols, because "what kind of host is this" is one
                    question to the person answering it. RDP and VNC are reached
                    through Desktop. */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        This host is
                    </span>
                    {/* One column per kind, so the row is the whole question and
                        not the first four fifths of it. Counted by hand because
                        Tailwind reads class names out of the source and cannot
                        be handed a computed one: adding a kind to HOST_KINDS
                        means changing this number, and forgetting to wraps the
                        new one onto a line of its own. */}
                    <div className="grid grid-cols-5 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                        {HOST_KINDS.map((entry) => (
                            <button
                                key={entry.id}
                                type="button"
                                title={t(entry.detailKey)}
                                className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                    kind === entry.id
                                        ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                                }`}
                                onClick={() => handleKind(entry.id)}
                            >
                                {kindLabel(entry)}
                            </button>
                        ))}
                    </div>
                    {/* SSH is the default and the overwhelming majority, and
                        "encrypted shell" under a button marked SSH is a line
                        nobody needs. The other four are worth a word. */}
                    {kind !== 'ssh' && (
                        <p className="text-[11px] text-gray-500 dark:text-neutral-500">
                            {t(HOST_KINDS.find(entry => entry.id === kind)?.summaryKey)}
                        </p>
                    )}
                </div>

                {/* Telnet puts a password on the wire in the clear. Said once,
                    here, where it is being chosen, not as a warning on every
                    connection, which is how a warning stops being read. */}
                {kind === 'telnet' && (
                    <p className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-500 rounded-lg border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/5 px-3 py-2">
                        <AlertSquareIcon size={14} strokeWidth={2} className="shrink-0 mt-px" />
                        <span>
                            Telnet is unencrypted. Everything sent over it, including whatever you
                            type at a login prompt, is readable by anything on the path. Use it for
                            devices that offer nothing better.
                        </span>
                    </p>
                )}

                {/* A desktop names its address in the section below, next to
                    the port, because that is the only address it has. Showing
                    Hostname / IP as well would ask the same question twice. */}
                {!isSerial && !isDesktop && (
                    <div className="grid grid-cols-4 gap-4">
                        <Field
                            label="Hostname / IP"
                            className={hasShell ? 'col-span-3' : 'col-span-4'}
                            hint={isIpmi
                                ? 'Where the service processor is. Used unless the IPMI section below names a different address.'
                                : undefined}
                        >
                            <input
                                data-autofocus
                                type="text"
                                value={formData.host}
                                onChange={(e) => handleChange('host', e.target.value)}
                                className={`${FIELD_CLASS} font-mono`}
                                placeholder="192.168.1.1"
                                required
                            />
                        </Field>
                        {/* The session's port, so a host with no session has no
                            use for it: the desktop carries its own, below. */}
                        {hasShell && (
                        <Field label="Port">
                            <input
                                type="number"
                                value={formData.port}
                                onChange={(e) => handleChange(
                                    'port',
                                    parseInt(e.target.value) || DEFAULT_PORTS[kind] || 22
                                )}
                                className={`${FIELD_CLASS} font-mono`}
                            />
                        </Field>
                        )}
                    </div>
                )}

                {isSerial && (
                    <SerialFields
                        serial={formData.serial}
                        onChange={(next) => handleChange('serial', next)}
                    />
                )}

                {/* The SSH user, and only that. A desktop host has no SSH
                    session to name one for and carries its own below; a telnet
                    or serial device asks for a login over the connection itself,
                    the way it would to a physical terminal. Asking here in
                    either case would be demanding a value nothing ever reads. */}
                {sshHost && (
                <Field label="Username">
                    <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => handleChange('username', e.target.value)}
                        className={`${FIELD_CLASS} font-mono`}
                        placeholder="root"
                        required
                    />
                </Field>
                )}

                {/* Auth method. SSH only: neither of the others authenticates
                    from this end at all. Whatever a host had configured stays on
                    the record untouched, so switching to telnet to reach a box's
                    console and back does not lose its key. */}
                {sshHost && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Authentication method
                    </span>
                    <div className="grid grid-cols-4 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                        {AUTH_METHODS.map((method) => (
                            <button
                                key={method.id}
                                type="button"
                                title={method.hint}
                                className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                    formData.authMethod === method.id
                                        ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                                }`}
                                onClick={() => handleChange('authMethod', method.id)}
                            >
                                {method.label}
                            </button>
                        ))}
                    </div>
                </div>
                )}

                {sshHost && formData.authMethod === 'keychain' && (
                    <Field label="SSH key">
                        {keys.length === 0 ? (
                            <div className="px-3 py-2.5 rounded-xl border border-gray-300 dark:border-surface-control bg-gray-50 dark:bg-surface-base text-gray-500 dark:text-gray-400 text-sm flex items-center gap-2">
                                <AlertSquareIcon className="w-4 h-4 shrink-0" size={16} />
                                No SSH keys found. Add keys in the Keychain page first.
                            </div>
                        ) : (
                            <Select
                                value={formData.keychainKeyId}
                                onChange={(next) => handleChange('keychainKeyId', next)}
                                className={FIELD_CLASS}
                                required
                                options={[
                                    { value: '', label: 'Select a key…' },
                                    ...keys.map(key => ({
                                        value: key.id,
                                        label: `${key.name} (${key.type})`,
                                    })),
                                ]}
                            />
                        )}
                    </Field>
                )}

                {sshHost && formData.authMethod === 'agent' && (
                    <AgentAuthFields
                        agentPath={formData.agentPath}
                        agentForward={formData.agentForward}
                        onChange={handleChange}
                    />
                )}

                {sshHost && formData.authMethod === 'password' && (
                    <Field label="Password">
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={(e) => handleChange('password', e.target.value)}
                                className={`${FIELD_CLASS} pr-10`}
                                placeholder={host?.hasPassword ? 'Stored, leave blank to keep' : '••••••••'}
                            />
                            <IconButton
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowPassword(!showPassword)}
                                title={showPassword ? 'Hide password' : 'Show password'}
                                className="absolute right-1 top-1/2 -translate-y-1/2"
                                icon={showPassword
                                    ? <ViewOffIcon size={15} strokeWidth={2} />
                                    : <ViewIcon size={15} strokeWidth={2} />}
                            />
                        </div>
                        {host?.hasPassword && !formData.password && (
                            <StoredSecretHint
                                label="A password is stored for this host."
                                cleared={clearSecrets}
                                onClear={() => setClearSecrets(true)}
                            />
                        )}
                    </Field>
                )}

                {sshHost && formData.authMethod === 'key' && (
                    <>
                        <Field label="Private key">
                            <textarea
                                value={formData.privateKey}
                                onChange={(e) => handleChange('privateKey', e.target.value)}
                                rows={4}
                                spellCheck={false}
                                className={`${MONO_FIELD_CLASS} resize-y`}
                                placeholder={host?.hasPrivateKey
                                    ? 'Stored, leave blank to keep'
                                    : '-----BEGIN OPENSSH PRIVATE KEY-----…'}
                            />
                            {host?.hasPrivateKey && !formData.privateKey && (
                                <StoredSecretHint
                                    label="A private key is stored for this host."
                                    cleared={clearSecrets}
                                    onClear={() => setClearSecrets(true)}
                                />
                            )}
                        </Field>

                        <Field label="Key passphrase">
                            <input
                                type="password"
                                value={formData.passphrase}
                                onChange={(e) => handleChange('passphrase', e.target.value)}
                                className={FIELD_CLASS}
                                placeholder="Leave empty if the key has no passphrase"
                            />
                        </Field>
                    </>
                )}

                {/* A desktop host is nothing but this, so it stays above the
                    fold rather than folded away with the extras: the picker at
                    the top has already said the host is a desktop, `managed`
                    tells the editor not to ask again, and for this one kind
                    these settings are the essentials. */}
                {isDesktop && (
                    <div className="pt-1 border-t border-gray-100 dark:border-surface-control">
                        <DesktopEditor
                            managed
                            desktop={formData.desktop}
                            hostAddress={formData.host}
                            onHostAddressChange={(next) => handleChange('host', next)}
                            hasPassword={formData.desktop?.protocol === 'rdp'
                                ? host?.hasRdpPassword
                                : host?.hasVncPassword}
                            passwordCleared={clearDesktopPassword}
                            onChange={(next) => handleChange('desktop', next)}
                            onClearPassword={() => setClearDesktopPassword(true)}
                        />
                    </div>
                )}

                {/* And the same for an IPMI host, which is likewise nothing but
                    this: the picker at the top has already said so, `managed`
                    tells the editor not to ask again, and these settings are the
                    whole of what it needs. */}
                {isIpmi && (
                    <div className="pt-1 border-t border-gray-100 dark:border-surface-control">
                        <BmcEditor
                            managed
                            bmc={formData.bmc}
                            hasPassword={host?.hasBmcPassword}
                            passwordCleared={clearBmcPassword}
                            onChange={(next) => handleChange('bmc', next)}
                            onClearPassword={() => setClearBmcPassword(true)}
                        />
                    </div>
                )}

                {/* Everything past this line has a working default, and most
                    hosts never touch any of it. Saying so once, here, is what
                    lets the four fields above read as the whole job. */}
                <div className="flex items-center gap-3 pt-2">
                    {/* The same muted-label tone the rest of the app uses for a
                        section heading, see NewTabView and PanePicker. A step
                        darker than this and it sinks into the surface behind it. */}
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                        Optional
                    </span>
                    <span className="h-px flex-1 bg-gray-200 dark:bg-surface-control" />
                </div>

                {/* Tighter than the form's own spacing: these are bordered rows
                    and read as one list rather than as separate fields. */}
                <div className="flex flex-col gap-2">
                    {/* Always closed, unlike the rest. A name is fully said by
                        the summary, so opening it on every edit would expand a
                        section to show what the closed row already showed. */}
                    <Disclosure title="Name and tags" summary={summaries.naming}>
                        <Field
                            label="Display name"
                            hint={`Left blank, this host is listed as ${
                                (isSerial ? formData.serial?.path : formData.host) || 'its address'
                            }.`}
                        >
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                className={FIELD_CLASS}
                                placeholder="e.g. Production Server"
                            />
                        </Field>

                        {/* Beside the name, because that is what a tag is:
                            another way of naming this host, one it can share
                            with others. Not a `Field`, which is a `<label>`, and
                            a label wrapping a row of buttons is a label that
                            forwards clicks it should not.

                            The tags already in use are offered underneath, so a
                            collection ends up with one "staging" rather than a
                            "staging", a "stage" and a "stg". */}
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="host-tags"
                                className="text-xs font-semibold text-gray-700 dark:text-gray-300"
                            >
                                Tags
                            </label>
                            <TagInput
                                id="host-tags"
                                value={formData.tags}
                                suggestions={allTags}
                                onChange={(tags) => handleChange('tags', tags)}
                            />
                            <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                                Cuts across folders: a host sits in one folder and carries as many tags as you like.
                            </span>
                        </div>
                    </Disclosure>

                    {/* How this host is reached rather than what it is. Another
                        saved host, by reference, not an address typed here: that
                        is what makes the hop dial with its own key, its own
                        agent and its own host-key trust instead of a second set
                        of credentials on this record.

                        SSH only, because a relay is a channel on an SSH
                        connection and neither a telnet device nor a serial cable
                        has one. */}
                    {sshHost && (
                    <Disclosure
                        title="Connect through"
                        summary={summaries.jump}
                        defaultOpen={Boolean(formData.jumpHostId)}
                    >
                        <Field
                            hint={formData.jumpHostId
                                ? 'Dialled first; this host is then reached over a channel on it. The session inside stays encrypted end to end, so the relay carries bytes it cannot read.'
                                : 'For a host with no route from this machine, name the bastion that does have one.'}
                        >
                            <Select
                                value={formData.jumpHostId}
                                onChange={(next) => handleChange('jumpHostId', next)}
                                className={FIELD_CLASS}
                                options={[
                                    { value: '', label: 'Connect directly' },
                                    ...jumpOptions.map(candidate => ({
                                        value: candidate.id,
                                        label: candidate.name
                                            + (candidate.host ? ` (${candidate.host})` : ''),
                                    })),
                                ]}
                            />
                            {/* Only once there is something the picker did not
                                already say. One hop is what was just chosen; two
                                came from that hop's own record, and that is the
                                surprise worth naming. */}
                            {jumpChain.length > 1 && (
                                <p className="text-[11px] text-gray-500 dark:text-neutral-500 font-mono">
                                    {['this machine', ...jumpChain, formData.name || formData.host || 'this host'].join(' → ')}
                                </p>
                            )}
                        </Field>
                    </Disclosure>
                    )}

                    {/* Its own section rather than a second field under "Connect
                        through", because it is a different kind of answer. A jump
                        host is a machine this connection passes through and comes
                        out of; a proxy decides how the *socket* is opened, and so
                        applies to everything that runs on top of it: a shell,
                        telnet, SFTP, a port forward, an RDP or VNC pane dialled
                        directly.

                        Offered for every kind of host but serial, which has no
                        socket for a proxy to open. */}
                    {!isSerial && (
                    <Disclosure
                        title="Proxies"
                        summary={summaries.proxy}
                        defaultOpen={Boolean(formData.proxyId)}
                    >
                        <Field
                            hint={formData.proxyId
                                ? 'The socket is opened through the proxy, which is asked to reach the address above. Everything the session carries travels inside it: files, port forwards and a directly dialled desktop alike.'
                                : 'For a network only reachable through a SOCKS or HTTP proxy. Saved proxies are managed on the Proxies page.'}
                        >
                            {proxies.length === 0 ? (
                                <div className="px-3 py-2.5 rounded-xl border border-gray-300 dark:border-surface-control bg-gray-50 dark:bg-surface-base text-gray-500 dark:text-gray-400 text-sm flex items-center gap-2">
                                    <AlertSquareIcon className="w-4 h-4 shrink-0" size={16} />
                                    No proxies saved. Add one on the Proxies page first.
                                </div>
                            ) : (
                                <Select
                                    value={formData.proxyId}
                                    onChange={(next) => handleChange('proxyId', next)}
                                    className={FIELD_CLASS}
                                    options={[
                                        { value: '', label: 'Dial straight out' },
                                        ...proxies.map(candidate => ({
                                            value: candidate.id,
                                            label: nameProxy(candidate),
                                        })),
                                    ]}
                                />
                            )}

                            {/* Same rule as the jump chain: only say it when the
                                picker did not. Two entries means the chosen proxy
                                is itself reached through another. */}
                            {proxyChain.length > 1 && (
                                <p className="text-[11px] text-gray-500 dark:text-neutral-500 font-mono">
                                    {['this machine', ...proxyChain, formData.host || 'this host'].join(' → ')}
                                </p>
                            )}

                            {/* The one combination worth spelling out, because
                                neither section can say it on its own and guessing
                                wrong means looking for a proxy problem in the
                                wrong record.

                                Each hop is dialled with its own settings, the way
                                `ssh` treats a ProxyJump host as a host in its own
                                right. Relayed, the only socket leaving this
                                machine goes to the first hop, so it is that
                                host's proxy that opens it. */}
                            {formData.proxyId && formData.jumpHostId && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                                    Reached through {jumpChain[0] || 'a jump host'}, the only connection
                                    out of this machine is the one to {jumpChain[0] || 'that host'}, so its
                                    own proxy setting is what opens it. The proxy chosen here is used when
                                    this host is dialled without the relay.
                                </p>
                            )}
                        </Field>
                    </Disclosure>
                    )}

                    {/* Written into a shell, so a host that opens no shell has
                        nowhere to put it. */}
                    {hasShell && (
                    <Disclosure
                        title="Run on connect"
                        summary={summaries.initCommand}
                        defaultOpen={Boolean(formData.initCommand)}
                    >
                        <Field
                            hint={sshHost
                                ? 'Sent to the shell as soon as it opens, and again after a reconnect. One command per line.'
                                : 'Sent the moment the session opens, with nothing waited for. There is no prompt detection here, so on a device that asks for a login this is typed at the login prompt.'}
                        >
                            <textarea
                                value={formData.initCommand}
                                onChange={(e) => handleChange('initCommand', e.target.value)}
                                rows={2}
                                spellCheck={false}
                                className={`${MONO_FIELD_CLASS} resize-y`}
                                placeholder={sshHost ? 'cd /srv/app && tmux attach' : 'terminal length 0'}
                            />
                        </Field>
                    </Disclosure>
                    )}

                    {/* Whether a timer checks this host is still there. Offered
                        for every kind but serial, because it is a question about
                        an address rather than about a session: a telnet console
                        server and a Windows box with nothing but RDP on it are
                        both worth knowing the state of. A serial cable has no
                        socket to knock on. */}
                    {!isSerial && (
                    <Disclosure
                        title="Monitoring"
                        summary={summaries.monitor}
                        defaultOpen={Boolean(formData.monitor?.enabled)}
                    >
                        {watchable.ok ? (
                            <div className="flex flex-col gap-3">
                                <Checkbox
                                    variant="card"
                                    checked={Boolean(formData.monitor?.enabled)}
                                    onChange={(e) => handleChange('monitor', {
                                        ...formData.monitor,
                                        enabled: e.target.checked,
                                    })}
                                    label="Watch this host"
                                    description="While the app is open, check on a timer that something is
                                        still answering here. A host that stops raises a notification once,
                                        and its card is marked until it comes back."
                                />

                                {formData.monitor?.enabled && (
                                    <>
                                        <Field
                                            label="Check port"
                                            hint={`${checkPortHint} Set it to watch something else on the
                                                same machine, a web server or a database, rather than the
                                                login this host is reached by.`}
                                        >
                                            <input
                                                type="number"
                                                min={1}
                                                max={65535}
                                                value={formData.monitor?.port || ''}
                                                onChange={(e) => handleChange('monitor', {
                                                    ...formData.monitor,
                                                    port: parseInt(e.target.value, 10) || 0,
                                                })}
                                                className={`${FIELD_CLASS} font-mono`}
                                                placeholder={checkPort ? String(checkPort) : 'e.g. 443'}
                                            />
                                        </Field>

                                        {/* Without this the switch above is
                                            saved and silently never acted on,
                                            which is the whole trap of a feature
                                            with a master switch somewhere else.

                                            The same box the sections above use
                                            to say a list is empty, rather than a
                                            warning: nothing is wrong here, there
                                            is just one more switch, and it is
                                            offered rather than pointed at. */}
                                        {monitorSettings && !monitorSettings.enabled && (
                                            <div className="px-3 py-2.5 rounded-xl border border-gray-300
                                                dark:border-surface-control bg-gray-50 dark:bg-surface-base
                                                text-gray-500 dark:text-gray-400 text-sm flex items-center gap-3">
                                                <span className="flex-1 min-w-0">
                                                    Monitoring is off for the app, so this host will be set up
                                                    and not yet checked.
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="shrink-0"
                                                    onClick={() => configureMonitor({ enabled: true })}
                                                >
                                                    Turn it on
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <p className="text-[11px] text-gray-500 dark:text-neutral-500">
                                {watchable.reason}
                            </p>
                        )}
                    </Disclosure>
                    )}

                    {/* Files, forwards, a desktop riding the session and the
                        algorithm list are all properties of an SSH connection. A
                        telnet or serial host has a shell and nothing else, so
                        these are dropped rather than shown as sections that
                        could never do anything. */}
                    {sshHost && (
                    <>
                    {/* Configured with the host, started by the session that
                        connects to it. `labelled` off because the row above the
                        contents has already said "Port forwarding". */}
                    <Disclosure
                        title="Port forwarding"
                        summary={summaries.tunnels}
                        defaultOpen={(formData.tunnels?.length || 0) > 0}
                    >
                        <TunnelsEditor
                            labelled={false}
                            tunnels={formData.tunnels}
                            onChange={(list) => handleChange('tunnels', list)}
                        />
                    </Disclosure>

                    {/* The *other* way to reach RDP and VNC: a desktop view
                        alongside the shell and files rather than instead of
                        them, riding the connection configured above. A host that
                        is only a desktop is the Desktop kind at the top. */}
                    <Disclosure
                        title="Remote desktop"
                        summary={summaries.desktop}
                        defaultOpen={Boolean(formData.desktop?.enabled)}
                    >
                        <DesktopEditor
                            desktop={formData.desktop}
                            hasPassword={formData.desktop?.protocol === 'rdp'
                                ? host?.hasRdpPassword
                                : host?.hasVncPassword}
                            passwordCleared={clearDesktopPassword}
                            onChange={(next) => handleChange('desktop', next)}
                            onClearPassword={() => setClearDesktopPassword(true)}
                        />
                    </Disclosure>

                    {/* The *other* way to reach a service processor: an IPMI
                        view alongside the shell and files rather than instead of
                        them. A host that is only a BMC is the IPMI kind at the
                        top. Unlike the desktop, this needs nothing from the
                        connection configured above; it is a second address for
                        the same machine, reachable when the machine is not. */}
                    <Disclosure
                        title="IPMI"
                        summary={summaries.bmc}
                        defaultOpen={Boolean(formData.bmc?.enabled)}
                    >
                        <BmcEditor
                            bmc={formData.bmc}
                            hasPassword={host?.hasBmcPassword}
                            passwordCleared={clearBmcPassword}
                            onChange={(next) => handleChange('bmc', next)}
                            onClearPassword={() => setClearBmcPassword(true)}
                        />
                    </Disclosure>

                    <Disclosure
                        title="Advanced"
                        summary={summaries.advanced}
                        defaultOpen={formData.legacyAlgorithms}
                    >
                        <Checkbox
                            variant="card"
                            checked={formData.legacyAlgorithms}
                            onChange={(e) => handleChange('legacyAlgorithms', e.target.checked)}
                            label="Allow legacy algorithms"
                            description="Enables SHA-1, CBC and 3DES for old servers. Weakens the connection, so leave off unless the handshake fails."
                        />
                    </Disclosure>
                    </>
                    )}
                </div>
            </form>
            )}
        </Sheet>
    );
}

export default memo(HostModal);
