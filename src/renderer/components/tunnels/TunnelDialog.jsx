import { useCallback, useMemo, useState } from 'react';
import { ArrowDataTransferHorizontalIcon, Alert02Icon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import Checkbox from '../ui/Checkbox';
import { FIELD_CLASS as BASE_FIELD_CLASS } from '../ui/Field';
import {
    TUNNEL_TYPES,
    typeInfo,
    emptyTunnel,
    validateTunnel,
    isWildcardHost,
} from '../../lib/tunnels';

/**
 * The shared field, in mono: everything typed into this dialog is an address or
 * a port. The placeholders stay in the UI font, since they are prompts rather
 * than values.
 */
const FIELD_CLASS = `${BASE_FIELD_CLASS} font-mono placeholder:font-sans`;

function Field({ label, hint, children }) {
    return (
        <label className="flex flex-col gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</span>
            {children}
            {hint && <span className="text-[11px] text-gray-500 dark:text-neutral-500">{hint}</span>}
        </label>
    );
}

/**
 * Add or edit one port forward. Purely a form: it hands a record back and lets
 * the caller decide whether that means saving a host or restarting a tunnel.
 */
export default function TunnelDialog({ tunnel, onSave, onClose }) {
    const [form, setForm] = useState(() => ({ ...emptyTunnel(), ...(tunnel || {}) }));
    const [touched, setTouched] = useState(false);

    const set = useCallback((field, value) => {
        setForm(previous => ({ ...previous, [field]: value }));
    }, []);

    const info = typeInfo(form.type);
    const isDynamic = form.type === 'dynamic';
    const isRemote = form.type === 'remote';

    const error = useMemo(() => validateTunnel(form), [form]);
    const exposed = isWildcardHost(form.listenHost);

    const submit = useCallback(() => {
        setTouched(true);
        if (validateTunnel(form)) return;

        onSave({
            ...form,
            listenPort: Number(form.listenPort) || 0,
            destPort: isDynamic ? 0 : Number(form.destPort) || 0,
            destHost: isDynamic ? '' : String(form.destHost || '').trim(),
        });
    }, [form, isDynamic, onSave]);

    return (
        <Dialog
            title={tunnel?.id ? 'Edit port forward' : 'New port forward'}
            subtitle={info.detail}
            width="34rem"
            onClose={onClose}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-500">
                    <ArrowDataTransferHorizontalIcon size={20} strokeWidth={2} />
                </span>
            }
            footer={
                <>
                    <DialogButton onClick={onClose}>Cancel</DialogButton>
                    <DialogButton variant="primary" onClick={submit} disabled={Boolean(error)}>
                        {tunnel?.id ? 'Save' : 'Add forward'}
                    </DialogButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {/* Type */}
                <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                    {TUNNEL_TYPES.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            title={option.summary}
                            onClick={() => set('type', option.id)}
                            className={`px-2 py-2 rounded-lg text-sm font-medium transition-all ${
                                form.type === option.id
                                    ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                            }`}
                        >
                            {option.label}
                            <span className="ml-1.5 font-mono text-[10px] opacity-60">{option.flag}</span>
                        </button>
                    ))}
                </div>

                <Field label="Label" hint="Optional, shown instead of the addresses">
                    <input
                        data-autofocus
                        value={form.name}
                        onChange={(event) => set('name', event.target.value)}
                        placeholder="e.g. Production database"
                        className={`${FIELD_CLASS} font-sans`}
                    />
                </Field>

                {/* Listener */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                        <Field
                            label={isRemote ? 'Bind address on the server' : 'Listen address'}
                            hint={isRemote ? 'Needs "GatewayPorts yes" for anything but loopback' : undefined}
                        >
                            <input
                                value={form.listenHost}
                                onChange={(event) => set('listenHost', event.target.value)}
                                placeholder="127.0.0.1"
                                spellCheck={false}
                                className={FIELD_CLASS}
                            />
                        </Field>
                    </div>
                    <Field label={isRemote ? 'Remote port' : 'Listen port'}>
                        <input
                            type="number"
                            min={isRemote ? 0 : 1}
                            max={65535}
                            value={form.listenPort}
                            onChange={(event) => set('listenPort', event.target.value)}
                            placeholder={isRemote ? '0 = auto' : '8080'}
                            className={FIELD_CLASS}
                        />
                    </Field>
                </div>

                {/* Destination: a SOCKS proxy is told where to go per connection. */}
                {!isDynamic && (
                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                            <Field
                                label="Destination host"
                                hint={isRemote
                                    ? 'Resolved from this machine'
                                    : 'Resolved from the server, so its private names work'}
                            >
                                <input
                                    value={form.destHost}
                                    onChange={(event) => set('destHost', event.target.value)}
                                    placeholder="localhost"
                                    spellCheck={false}
                                    className={FIELD_CLASS}
                                />
                            </Field>
                        </div>
                        <Field label="Destination port">
                            <input
                                type="number"
                                min={1}
                                max={65535}
                                value={form.destPort}
                                onChange={(event) => set('destPort', event.target.value)}
                                placeholder="5432"
                                className={FIELD_CLASS}
                            />
                        </Field>
                    </div>
                )}

                <Checkbox
                    variant="card"
                    checked={form.autoStart}
                    onChange={(event) => set('autoStart', event.target.checked)}
                    label="Start with the connection"
                    description="Brought up whenever this host connects, including after a reconnect."
                />

                {/* Binding past loopback is a real exposure, so it is said out loud. */}
                {exposed && !isRemote && (
                    <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                        <Alert02Icon size={14} strokeWidth={2} className="shrink-0 mt-px" />
                        <span>
                            Anyone who can reach this machine on the network will be able to use
                            this forward. Use 127.0.0.1 unless you mean to share it.
                        </span>
                    </p>
                )}

                {touched && error && (
                    <p className="text-xs text-red-500 font-medium">{error}</p>
                )}
            </div>
        </Dialog>
    );
}
