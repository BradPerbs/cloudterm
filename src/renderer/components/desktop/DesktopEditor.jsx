import { useCallback, useState } from 'react';
import { ViewIcon, ViewOffIcon } from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import Field, { FIELD_CLASS } from '../ui/Field';
import Select from '../ui/Select';
import { IconButton } from '../ui/Button';

/**
 * The remote desktop settings inside the host editor. Config only: nothing here
 * opens a connection; the session's Desktop view does that.
 *
 * The defaults are the interesting part. A desktop is tunnelled through this
 * host's own SSH connection and points at the server's loopback, because that is
 * both the safe arrangement and the one that needs no setup on the far side:
 * a server bound to 127.0.0.1 is reachable this way and reachable no other
 * way. "Direct" is there for a box with no SSH on it.
 *
 * Which protocol is chosen changes more than the port. VNC is authenticated by
 * the app itself, so its password never leaves the main process; RDP
 * authenticates with CredSSP inside the viewer and needs a username as well.
 * The fields follow from that rather than being a superset of both.
 */

const PROTOCOLS = [
    {
        id: 'vnc',
        label: 'VNC',
        hint: 'RFB, for Linux and macOS desktops and anything running a VNC server.',
    },
    {
        id: 'rdp',
        label: 'RDP',
        hint: 'Windows Remote Desktop, with Network Level Authentication.',
    },
];

const TRANSPORTS = [
    {
        id: 'tunnel',
        label: 'Through SSH',
        hint: 'The desktop rides this host\'s SSH connection. The desktop port never has to be exposed.',
    },
    {
        id: 'direct',
        label: 'Direct',
        hint: 'This machine connects straight to the server.',
    },
];

const SCALING = [
    { id: 'fit', label: 'Fit', hint: 'Scale the desktop to the pane' },
    { id: 'actual', label: 'Actual size', hint: '1:1 pixels, pan around' },
    { id: 'resize', label: 'Resize server', hint: 'Ask the server to match the pane' },
];

/** Switching protocol should move these with it, unless they were customised. */
const DEFAULT_PORTS = { vnc: 5900, rdp: 3389 };
const DEFAULT_TRANSPORTS = { vnc: 'tunnel', rdp: 'direct' };

/**
 * `managed` means the form above has already decided this host *is* a desktop.
 *
 * Two controls then have nothing left to ask. "Remote desktop" would be a
 * checkbox that cannot be unticked without contradicting the picker, and
 * "Desktop only" would be asking again in different words. Both are hidden and
 * the settings shown directly; the record still carries `enabled` and `only`,
 * set by whoever chose the kind.
 *
 * The address is the same case. A managed desktop has no other connection, so
 * the box below writes the host's own address (`hostAddress`) rather than an
 * override on the desktop block.
 */
export default function DesktopEditor({
    desktop,
    hasPassword,
    onChange,
    onClearPassword,
    passwordCleared,
    managed = false,
    hostAddress = '',
    onHostAddressChange,
}) {
    const [showPassword, setShowPassword] = useState(false);

    // Not just `desktop || {}`: a record written by an older version, or one
    // that came back from a sync in a shape nobody expected, should leave the
    // editor showing defaults rather than spreading a string into the form.
    const value = desktop && typeof desktop === 'object' && !Array.isArray(desktop) ? desktop : {};
    const protocol = PROTOCOLS.some(p => p.id === value.protocol) ? value.protocol : 'vnc';
    // Follows the protocol's own default, so an RDP host with nothing stored
    // shows Direct, the transport it will actually use.
    const transport = value.transport === 'direct' || value.transport === 'tunnel'
        ? value.transport
        : DEFAULT_TRANSPORTS[protocol];
    const isRdp = protocol === 'rdp';

    const set = useCallback((field, next) => {
        onChange({ ...value, [field]: next });
    }, [onChange, value]);

    /**
     * Changing protocol carries the port across only when it is still the old
     * protocol's default. Someone who typed 5901 meant it; someone who never
     * touched it means 3389 now.
     */
    const setProtocol = useCallback((next) => {
        const port = value.port === undefined || value.port === DEFAULT_PORTS[protocol]
            ? DEFAULT_PORTS[next]
            : value.port;
        // RDP is normally a Windows box with no SSH server on it, so a new RDP
        // desktop starts out dialling for itself. Only moved when the transport
        // is still the one the other protocol defaulted to, so a deliberate
        // choice survives switching back and forth.
        const transport = value.transport === undefined || value.transport === DEFAULT_TRANSPORTS[protocol]
            ? DEFAULT_TRANSPORTS[next]
            : value.transport;
        onChange({ ...value, protocol: next, port, transport });
    }, [onChange, protocol, value]);

    // Both protocols can be asked to match the pane: VNC through SetDesktopSize,
    // RDP through the Display Control channel it gained in 8.1.
    const scalingModes = SCALING;
    const scaling = value.scaling || 'fit';

    return (
        <div className="flex flex-col gap-4">
            {!managed && (
                <Checkbox
                    variant="card"
                    checked={Boolean(value.enabled)}
                    onChange={(e) => set('enabled', e.target.checked)}
                    label="Show a Desktop view for this host"
                    description="Adds a Desktop view to this host's session, alongside the shell and files."
                />
            )}

            {(managed || value.enabled) && (
                <>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Protocol
                        </span>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                            {PROTOCOLS.map(option => (
                                <button
                                    key={option.id}
                                    type="button"
                                    title={option.hint}
                                    onClick={() => setProtocol(option.id)}
                                    className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        protocol === option.id
                                            ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                            {PROTOCOLS.find(option => option.id === protocol)?.hint}
                        </span>
                    </div>

                    {/* A managed desktop has no SSH session to ride, so there is
                        no choice to offer: it dials for itself, and the picker
                        that made it a desktop already set it that way. */}
                    {!managed && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            How to reach it
                        </span>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                            {TRANSPORTS.map(option => (
                                <button
                                    key={option.id}
                                    type="button"
                                    title={option.hint}
                                    onClick={() => set('transport', option.id)}
                                    className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        transport === option.id
                                            ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                            {TRANSPORTS.find(option => option.id === transport)?.hint}
                        </span>
                    </div>
                    )}

                    {/* The escape hatch from this app's central assumption, which
                        is that a host is an SSH session with other views hanging
                        off it. A Windows box usually is not.

                        Offered here only for a host that also has a shell.
                        Ticking it is the same statement as choosing the Desktop
                        kind at the top of the form, and the form reads it back
                        as exactly that. */}
                    {!managed && transport === 'direct' && (
                        <Checkbox
                            variant="card"
                            checked={Boolean(value.only)}
                            onChange={(e) => set('only', e.target.checked)}
                            label="Desktop only (no SSH)"
                            description="Open this host straight into the desktop and never dial SSH. For machines with no SSH server, which is most Windows ones."
                        />
                    )}

                    <div className="grid grid-cols-4 gap-4">
                        <Field
                            label={isRdp ? 'RDP address' : 'VNC address'}
                            className="col-span-3"
                            hint={managed
                                ? 'Where the desktop is.'
                                : transport === 'tunnel'
                                    ? 'Resolved by the server, so 127.0.0.1 means the server itself.'
                                    : 'Resolved by this machine. Leave blank to use the host\'s own address.'}
                        >
                            <input
                                data-autofocus={managed || undefined}
                                type="text"
                                value={managed
                                    ? hostAddress
                                    : (value.host ?? (transport === 'tunnel' ? '127.0.0.1' : ''))}
                                onChange={(e) => (managed
                                    ? onHostAddressChange?.(e.target.value)
                                    : set('host', e.target.value))}
                                className={`${FIELD_CLASS} font-mono`}
                                placeholder={managed
                                    ? '192.168.1.1'
                                    : (transport === 'tunnel' ? '127.0.0.1' : 'Same as the host')}
                                required={managed}
                            />
                        </Field>
                        <Field label="Port" hint={isRdp ? '3389 is standard' : '5901 is :1'}>
                            <input
                                type="number"
                                value={value.port ?? DEFAULT_PORTS[protocol]}
                                onChange={(e) => set('port', parseInt(e.target.value, 10) || DEFAULT_PORTS[protocol])}
                                className={`${FIELD_CLASS} font-mono`}
                            />
                        </Field>
                    </div>

                    {/* RDP will not draw anything before it has authenticated, so
                        the identity is part of the connection rather than
                        something to be prompted for later. */}
                    {isRdp && (
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Username" hint="The Windows account to sign in as.">
                                <input
                                    type="text"
                                    value={value.username || ''}
                                    onChange={(e) => set('username', e.target.value)}
                                    className={`${FIELD_CLASS} font-mono`}
                                    placeholder="Administrator"
                                />
                            </Field>
                            <Field label="Domain" hint="Leave blank for a local account.">
                                <input
                                    type="text"
                                    value={value.domain || ''}
                                    onChange={(e) => set('domain', e.target.value)}
                                    className={`${FIELD_CLASS} font-mono`}
                                    placeholder="Optional"
                                />
                            </Field>
                        </div>
                    )}

                    <Field
                        label={isRdp ? 'RDP password' : 'VNC password'}
                        hint={isRdp
                            // Said plainly, because it is the one exception to a
                            // rule the rest of the app keeps.
                            ? 'Stored encrypted. RDP authenticates in the viewer, so unlike every other secret here this one is handed to it when the session opens.'
                            : 'Stored encrypted, and used by the app itself: it is never given to the viewer.'}
                    >
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={value.password || ''}
                                onChange={(e) => set('password', e.target.value)}
                                className={`${FIELD_CLASS} pr-10`}
                                placeholder={hasPassword
                                    ? 'Stored, leave blank to keep'
                                    : (isRdp ? 'Required' : 'Leave blank if the server needs none')}
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
                        {hasPassword && !value.password && (
                            passwordCleared ? (
                                <p className="text-[11px] text-red-500">
                                    Stored {isRdp ? 'RDP' : 'VNC'} password will be removed on save.
                                </p>
                            ) : (
                                <p className="text-[11px] text-gray-500 dark:text-neutral-500">
                                    A {isRdp ? 'RDP' : 'VNC'} password is stored for this host.{' '}
                                    <button
                                        type="button"
                                        onClick={onClearPassword}
                                        className="text-red-500 hover:underline font-medium"
                                    >
                                        Remove it
                                    </button>
                                </p>
                            )
                        )}
                    </Field>

                    <Field label="Scaling" hint={scalingModes.find(mode => mode.id === scaling)?.hint}>
                        <Select
                            value={scaling}
                            onChange={(next) => set('scaling', next)}
                            className={FIELD_CLASS}
                            options={scalingModes.map(mode => ({
                                value: mode.id,
                                label: mode.label,
                            }))}
                        />
                    </Field>

                    {/* Both are RFB concepts with no RDP equivalent: a session is
                        not shared, and there is no view-only mode to toggle. */}
                    {!isRdp && (
                        <>
                            <Checkbox
                                variant="card"
                                checked={value.shared !== false}
                                onChange={(e) => set('shared', e.target.checked)}
                                label="Share the session"
                                description="Leave anyone already viewing that screen connected. Turning this off disconnects them."
                            />

                            <Checkbox
                                variant="card"
                                checked={Boolean(value.viewOnly)}
                                onChange={(e) => set('viewOnly', e.target.checked)}
                                label="View only"
                                description="Watch without sending keyboard or mouse input. Can be toggled during a session."
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
}
