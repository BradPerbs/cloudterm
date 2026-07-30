import { memo, useCallback, useEffect, useState } from 'react';
import { Alert02Icon, Loading03Icon, Refresh01Icon, UsbConnected01Icon } from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import Field, { FIELD_CLASS } from '../ui/Field';
import {
    BAUD_RATES,
    DATA_BITS,
    STOP_BITS,
    PARITIES,
    FLOW_CONTROLS,
    NEWLINES,
    DEFAULT_SERIAL,
    describeLine,
} from '../../lib/protocols';

/**
 * Serial console settings.
 *
 * The whole 8N1 line is in front of the user rather than behind a default,
 * because a serial port fails silently: a console at the wrong baud rate does
 * not report an error, it prints plausible-looking garbage, and a setting that
 * cannot be seen cannot be checked against the label on the device.
 *
 * Ports are listed live for the same reason the agent is probed live in the
 * SSH editor — a USB adapter enumerates under a different name every time it
 * moves socket, so an empty list or a missing port is worth seeing here rather
 * than at connect time.
 */
function SerialFields({ serial, onChange }) {
    const config = { ...DEFAULT_SERIAL, ...(serial || {}) };
    const [scan, setScan] = useState(null);

    const set = useCallback((field, value) => {
        onChange({ ...config, [field]: value });
    }, [config, onChange]);

    const refresh = useCallback(async () => {
        setScan(null);
        try {
            setScan(await window.api.serial.listPorts());
        } catch (error) {
            setScan({ available: false, message: error.message, ports: [] });
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const ports = scan?.ports || [];
    // A port saved earlier that is not plugged in right now still belongs in
    // the list: dropping it would silently blank the setting on a host whose
    // cable happens to be out.
    const missing = config.path && !ports.some(port => port.path === config.path);

    return (
        <div className="flex flex-col gap-4">
            <Field
                label="Serial port"
                hint={missing ? undefined : 'The port the console cable is on.'}
            >
                <div className="flex gap-2">
                    <select
                        value={config.path}
                        onChange={(event) => set('path', event.target.value)}
                        className={FIELD_CLASS}
                        required
                    >
                        <option value="">Select a port…</option>
                        {missing && (
                            <option value={config.path}>{config.path} (not connected)</option>
                        )}
                        {ports.map(port => (
                            <option key={port.path} value={port.path}>
                                {port.label ? `${port.path} (${port.label})` : port.path}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={refresh}
                        title="Scan for ports again"
                        className="shrink-0 w-10 flex items-center justify-center rounded-xl border border-gray-300 dark:border-surface-control text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-base transition-colors"
                    >
                        {scan === null
                            ? <Loading03Icon size={14} className="animate-spin" />
                            : <Refresh01Icon size={14} strokeWidth={2} />}
                    </button>
                </div>

                {scan && !scan.available && (
                    <p className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-500">
                        <Alert02Icon size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                        <span>{scan.message || 'Serial ports could not be listed'}</span>
                    </p>
                )}

                {scan?.available && ports.length === 0 && (
                    <p className="text-[11px] text-gray-500 dark:text-neutral-500">
                        No serial ports found. Plug the adapter in and scan again.
                    </p>
                )}

                {missing && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-500">
                        {config.path} is not connected right now. It is kept on the host, and will
                        work again when the cable is back.
                    </p>
                )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
                <Field label="Baud rate">
                    <select
                        value={config.baudRate}
                        onChange={(event) => set('baudRate', Number(event.target.value))}
                        className={`${FIELD_CLASS} font-mono`}
                    >
                        {/* A rate the record already carries but the list does
                            not — an adapter running at 31250 — would otherwise
                            be silently rewritten to whatever sits first. */}
                        {!BAUD_RATES.includes(config.baudRate) && (
                            <option value={config.baudRate}>{config.baudRate}</option>
                        )}
                        {BAUD_RATES.map(rate => (
                            <option key={rate} value={rate}>{rate}</option>
                        ))}
                    </select>
                </Field>

                <Field label="Flow control">
                    <select
                        value={config.flowControl}
                        onChange={(event) => set('flowControl', event.target.value)}
                        className={FIELD_CLASS}
                    >
                        {FLOW_CONTROLS.map(entry => (
                            <option key={entry.id} value={entry.id}>{entry.label}</option>
                        ))}
                    </select>
                </Field>
            </div>

            <div className="grid grid-cols-3 gap-4">
                <Field label="Data bits">
                    <select
                        value={config.dataBits}
                        onChange={(event) => set('dataBits', Number(event.target.value))}
                        className={`${FIELD_CLASS} font-mono`}
                    >
                        {DATA_BITS.map(bits => <option key={bits} value={bits}>{bits}</option>)}
                    </select>
                </Field>

                <Field label="Parity">
                    <select
                        value={config.parity}
                        onChange={(event) => set('parity', event.target.value)}
                        className={FIELD_CLASS}
                    >
                        {PARITIES.map(entry => (
                            <option key={entry.id} value={entry.id}>{entry.label}</option>
                        ))}
                    </select>
                </Field>

                <Field label="Stop bits">
                    <select
                        value={config.stopBits}
                        onChange={(event) => set('stopBits', Number(event.target.value))}
                        className={`${FIELD_CLASS} font-mono`}
                    >
                        {STOP_BITS.map(bits => <option key={bits} value={bits}>{bits}</option>)}
                    </select>
                </Field>
            </div>

            {/* The one-line summary of everything above, in the form the label
                on the back of a switch is written in. */}
            <p className="text-[11px] font-mono text-gray-500 dark:text-neutral-500">
                {config.path || 'No port'} · {describeLine(config)} · {
                    FLOW_CONTROLS.find(entry => entry.id === config.flowControl)?.label
                }
            </p>

            <Field
                label="Enter sends"
                hint="No protocol answers this. A device given the wrong one looks dead: the prompt simply never comes back."
            >
                <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                    {NEWLINES.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            title={entry.hint}
                            onClick={() => set('newline', entry.id)}
                            className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                config.newline === entry.id
                                    ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                            }`}
                        >
                            {entry.label}
                        </button>
                    ))}
                </div>
            </Field>

            <Checkbox
                variant="card"
                checked={config.localEcho}
                onChange={(event) => set('localEcho', event.target.checked)}
                label="Echo what I type"
                description="Turn on for a device that does not echo back. Without it the pane stays blank while you type, which reads as a dead port rather than a quiet one."
            />

            <Checkbox
                variant="card"
                checked={config.dtr}
                onChange={(event) => set('dtr', event.target.checked)}
                label="Assert DTR on open"
                description="On by default, which is what most devices expect. Turn it off for a board wired to reset on DTR, which would otherwise reboot every time this port is opened."
            />

            <Checkbox
                variant="card"
                checked={config.rts}
                onChange={(event) => set('rts', event.target.checked)}
                label="Assert RTS on open"
                description={config.flowControl === 'rtscts'
                    ? 'Ignored while hardware flow control is on: RTS belongs to the driver then.'
                    : 'On by default. Some adapters wire RTS to a reset or boot pin.'}
            />

            <p className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-neutral-500">
                <UsbConnected01Icon size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                    A serial line carries no window size and no terminal type, so the device
                    assumes 80×24 however large the pane is.
                </span>
            </p>
        </div>
    );
}

export default memo(SerialFields);
