import { memo, useCallback, useEffect, useState } from 'react';
import { Alert02Icon, Loading03Icon, Refresh01Icon, UsbConnected01Icon } from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import Field, { FIELD_CLASS } from '../ui/Field';
import Select from '../ui/Select';
import { useT } from '../../i18n';
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
 * SSH editor: a USB adapter enumerates under a different name every time it
 * moves socket, so an empty list or a missing port is worth seeing here rather
 * than at connect time.
 */
function SerialFields({ serial, onChange }) {
    const t = useT();
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
                label={t('serial.port')}
                hint={missing ? undefined : 'The port the console cable is on.'}
            >
                <div className="flex gap-2">
                    <Select
                        value={config.path}
                        onChange={(next) => set('path', next)}
                        containerClassName="flex-1"
                        className={FIELD_CLASS}
                        required
                        options={[
                            { value: '', label: t('serial.selectPort') },
                            ...(missing ? [{
                                value: config.path,
                                label: `${config.path} (not connected)`,
                            }] : []),
                            ...ports.map(port => ({
                                value: port.path,
                                label: port.label ? `${port.path} (${port.label})` : port.path,
                            })),
                        ]}
                    />
                    <button
                        type="button"
                        onClick={refresh}
                        title={t('serial.rescan')}
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
                        {t('serial.noPorts')}
                    </p>
                )}

                {missing && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-500">
                        {t('serial.portMissing', { path: config.path })}
                    </p>
                )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
                <Field label={t('serial.baudRate')}>
                    <Select
                        value={config.baudRate}
                        onChange={(next) => set('baudRate', Number(next))}
                        className={`${FIELD_CLASS} font-mono`}
                        menuClassName="font-mono"
                        options={[
                            /* A rate the record already carries but the list
                               does not (an adapter running at 31250) would
                               otherwise be silently rewritten to whatever sits
                               first. */
                            ...(BAUD_RATES.includes(config.baudRate)
                                ? []
                                : [{ value: config.baudRate, label: String(config.baudRate) }]),
                            ...BAUD_RATES.map(rate => ({ value: rate, label: String(rate) })),
                        ]}
                    />
                </Field>

                <Field label={t('serial.flowControl')}>
                    <Select
                        value={config.flowControl}
                        onChange={(next) => set('flowControl', next)}
                        className={FIELD_CLASS}
                        options={FLOW_CONTROLS.map(entry => ({
                            value: entry.id,
                            label: t(entry.labelKey),
                        }))}
                    />
                </Field>
            </div>

            <div className="grid grid-cols-3 gap-4">
                <Field label={t('serial.dataBits')}>
                    <Select
                        value={config.dataBits}
                        onChange={(next) => set('dataBits', Number(next))}
                        className={`${FIELD_CLASS} font-mono`}
                        menuClassName="font-mono"
                        options={DATA_BITS.map(bits => ({ value: bits, label: String(bits) }))}
                    />
                </Field>

                <Field label={t('serial.parity')}>
                    <Select
                        value={config.parity}
                        onChange={(next) => set('parity', next)}
                        className={FIELD_CLASS}
                        options={PARITIES.map(entry => ({
                            value: entry.id,
                            label: t(entry.labelKey),
                        }))}
                    />
                </Field>

                <Field label={t('serial.stopBits')}>
                    <Select
                        value={config.stopBits}
                        onChange={(next) => set('stopBits', Number(next))}
                        className={`${FIELD_CLASS} font-mono`}
                        menuClassName="font-mono"
                        options={STOP_BITS.map(bits => ({ value: bits, label: String(bits) }))}
                    />
                </Field>
            </div>

            {/* The one-line summary of everything above, in the form the label
                on the back of a switch is written in. */}
            <p className="text-[11px] font-mono text-gray-500 dark:text-neutral-500">
                {config.path || t('hosts.noPort')} · {describeLine(config)} · {
                    t(FLOW_CONTROLS.find(entry => entry.id === config.flowControl)?.labelKey || 'serial.flowNone')
                }
            </p>

            <Field
                label={t('serial.enterSends')}
                hint={t('serial.enterSendsHint')}
            >
                <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                    {NEWLINES.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            title={t(entry.hintKey)}
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
                label={t('serial.localEcho')}
                description={t('serial.localEchoHint')}
            />

            <Checkbox
                variant="card"
                checked={config.dtr}
                onChange={(event) => set('dtr', event.target.checked)}
                label={t('serial.dtr')}
                description={t('serial.dtrHint')}
            />

            <Checkbox
                variant="card"
                checked={config.rts}
                onChange={(event) => set('rts', event.target.checked)}
                label={t('serial.rts')}
                description={config.flowControl === 'rtscts'
                    ? t('serial.rtsIgnored')
                    : t('serial.rtsHint')}
            />

            <p className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-neutral-500">
                <UsbConnected01Icon size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                    {t('serial.noWindowSize')}
                </span>
            </p>
        </div>
    );
}

export default memo(SerialFields);
