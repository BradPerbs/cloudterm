import { useCallback, useState } from 'react';
import { ViewIcon, ViewOffIcon } from 'hugeicons-react';
import Checkbox from '../ui/Checkbox';
import Field, { FIELD_CLASS } from '../ui/Field';
import Select from '../ui/Select';
import { IconButton } from '../ui/Button';

/**
 * The IPMI settings inside the host editor. Config only: nothing here opens
 * anything; the session's IPMI view does that.
 *
 * What this is asking for is a web address and a login, because that is all the
 * feature needs. The pane loads the board's own interface and the main process
 * fills in its login form; the app does not reimplement power control, sensors
 * or the console, all of which live behind that UI.
 *
 * The one setting worth explaining is the vendor. It picks which inputs on the
 * login page get filled, and "Detect automatically" answers it by asking the
 * board over Redfish. A board that is detected as nothing still works: there is
 * a generic fallback that finds the password box and the field in front of it,
 * which is how every board with no entry of its own is handled anyway.
 */

const VENDORS = [
    { id: 'auto', label: 'Detect automatically', hint: 'Asks the board what it is over Redfish, and falls back to filling whatever login form it finds.' },
    { id: 'supermicro', label: 'Supermicro', hint: 'X9, X10 and X11, and the ASPEED reference interface built on them.' },
    { id: 'idrac', label: 'Dell iDRAC', hint: 'iDRAC 7, 8 and 9.' },
    { id: 'ilo', label: 'HPE iLO', hint: 'iLO 4, 5 and 6.' },
    { id: 'openbmc', label: 'OpenBMC', hint: 'The webui-vue interface, and the boards shipping it.' },
    { id: 'ami', label: 'AMI MegaRAC', hint: 'What most of the white-box world ships: Tyan, ASRock Rack, Gigabyte and Quanta.' },
    { id: 'basic', label: 'HTTP Basic auth', hint: 'No login page at all: the board asks for credentials in the browser\'s own dialog, and the app answers it.' },
    { id: 'manual', label: 'No auto-login', hint: 'Opens the page and leaves it alone. For a board behind a one-time code or a sign-on redirect.' },
];

const SCHEMES = [
    { id: 'auto', label: 'Auto', hint: 'Asks the board. Tries TLS on 443, then plain HTTP on 80, and uses whichever answers.' },
    { id: 'https', label: 'HTTPS', hint: 'Always HTTPS. The certificate is self-signed and accepted once, per host.' },
    { id: 'http', label: 'HTTP', hint: 'Always plain HTTP, for an old board with TLS turned off. The password is sent in the clear.' },
];

const DEFAULT_PORTS = { https: 443, http: 80 };

/** What the port box shows for each scheme when nothing has been typed into it. */
const PORT_HINTS = {
    auto: 'Blank follows the scheme',
    https: '443 is standard',
    http: '80 is standard',
};

/**
 * `managed` means the form above has already decided this host *is* an IPMI.
 *
 * Two controls then have nothing left to ask, exactly as in DesktopEditor:
 * "Show an IPMI view" would be a checkbox that cannot be unticked without
 * contradicting the picker, and "IPMI only" would be asking again in different
 * words. Both are hidden, and the record still carries `enabled` and `only`,
 * set by whoever chose the kind.
 */
export default function BmcEditor({
    bmc,
    hasPassword,
    onChange,
    onClearPassword,
    passwordCleared,
    managed = false,
}) {
    const [showPassword, setShowPassword] = useState(false);

    // Not just `bmc || {}`: a record written by an older version, or one that
    // came back from a sync in a shape nobody expected, should leave the editor
    // showing defaults rather than spreading a string into the form.
    const value = bmc && typeof bmc === 'object' && !Array.isArray(bmc) ? bmc : {};
    const scheme = SCHEMES.some(entry => entry.id === value.scheme) ? value.scheme : 'auto';
    const vendor = VENDORS.some(entry => entry.id === value.vendor) ? value.vendor : 'auto';

    // `manual` fills nothing in, so the identity below has nobody to be.
    const fillsLogin = vendor !== 'manual';
    const autoLogin = value.autoLogin === undefined ? true : Boolean(value.autoLogin);

    const set = useCallback((field, next) => {
        onChange({ ...value, [field]: next });
    }, [onChange, value]);

    /**
     * Changing scheme leaves a port that was typed on purpose alone, and moves
     * one that was only ever the old scheme's default. Someone who typed 8443
     * meant it; someone who never touched it means the new scheme's default.
     *
     * Zero is that default under `auto`, which is the record's way of saying
     * "whichever port the detected scheme uses", so switching to Auto clears an
     * untouched port rather than pinning it to 443 behind the user's back.
     */
    const setScheme = useCallback((next) => {
        const untouched = !value.port || value.port === DEFAULT_PORTS[scheme];
        const port = untouched ? (next === 'auto' ? 0 : DEFAULT_PORTS[next]) : value.port;
        onChange({ ...value, scheme: next, port });
    }, [onChange, scheme, value]);

    return (
        <div className="flex flex-col gap-4">
            {!managed && (
                <Checkbox
                    variant="card"
                    checked={Boolean(value.enabled)}
                    onChange={(e) => set('enabled', e.target.checked)}
                    label="Show an IPMI view for this host"
                    description="Adds the service processor's own web interface to this host's session, alongside the shell and files."
                />
            )}

            {(managed || value.enabled) && (
                <>
                    {/* Unlike the desktop's, this switch is offered whatever the
                        host connects over. A switch on a serial console with a
                        BMC beside it is an ordinary pairing, and a service
                        processor answers when the machine in front of it does
                        not, which is the whole reason to have one. */}
                    {!managed && (
                        <Checkbox
                            variant="card"
                            checked={Boolean(value.only)}
                            onChange={(e) => set('only', e.target.checked)}
                            label="IPMI only (no shell)"
                            description="Open this host straight into the IPMI and never dial it. For a service processor in front of a machine this app has no session on."
                        />
                    )}

                    <div className="grid grid-cols-4 gap-4">
                        <Field
                            label="IPMI address"
                            className="col-span-3"
                            hint="The service processor's own address, which is usually not the machine's. Leave blank if the board shares the host's."
                        >
                            <input
                                type="text"
                                value={value.host || ''}
                                onChange={(e) => set('host', e.target.value)}
                                className={`${FIELD_CLASS} font-mono`}
                                placeholder="Same as the host"
                            />
                        </Field>
                        <Field label="Port" hint={PORT_HINTS[scheme]}>
                            {/* Blank is a real answer, not an empty field: it
                                stores zero, which means the default for whatever
                                scheme is in use. That is the only thing a record
                                can hold when the scheme is still to be detected. */}
                            <input
                                type="number"
                                value={value.port || ''}
                                onChange={(e) => set('port', parseInt(e.target.value, 10) || 0)}
                                className={`${FIELD_CLASS} font-mono`}
                                placeholder={scheme === 'auto' ? 'Auto' : String(DEFAULT_PORTS[scheme])}
                            />
                        </Field>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Scheme
                        </span>
                        <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                            {SCHEMES.map(option => (
                                <button
                                    key={option.id}
                                    type="button"
                                    title={option.hint}
                                    onClick={() => setScheme(option.id)}
                                    className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        scheme === option.id
                                            ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                            {SCHEMES.find(option => option.id === scheme)?.hint}
                        </span>
                    </div>

                    <Field
                        label="Firmware"
                        hint={VENDORS.find(option => option.id === vendor)?.hint}
                    >
                        <Select
                            value={vendor}
                            onChange={(next) => set('vendor', next)}
                            className={FIELD_CLASS}
                            options={VENDORS.map(option => ({
                                value: option.id,
                                label: option.label,
                            }))}
                        />
                    </Field>

                    {/* A path is the exception rather than the rule: every board
                        here redirects from its root to wherever its UI lives. It
                        is offered for the ones that do not, and for pointing a
                        pane straight at a page worth opening on. */}
                    <Field
                        label="Path"
                        hint="Where the interface lives, if the board does not send you there from its root."
                    >
                        <input
                            type="text"
                            value={value.path || ''}
                            onChange={(e) => set('path', e.target.value)}
                            className={`${FIELD_CLASS} font-mono`}
                            placeholder="/"
                        />
                    </Field>

                    {fillsLogin && (
                        <Checkbox
                            variant="card"
                            checked={autoLogin}
                            onChange={(e) => set('autoLogin', e.target.checked)}
                            label="Sign in automatically"
                            description="Fills in the board's own login when the view opens. Turn off to open the page and sign in by hand."
                        />
                    )}

                    {fillsLogin && autoLogin && (
                        <>
                            <Field
                                label="IPMI username"
                                hint="The account on the service processor, which is not an account on the machine."
                            >
                                <input
                                    type="text"
                                    value={value.username || ''}
                                    onChange={(e) => set('username', e.target.value)}
                                    className={`${FIELD_CLASS} font-mono`}
                                    placeholder="ADMIN"
                                />
                            </Field>

                            <Field
                                label="IPMI password"
                                // Worth saying plainly, because it is the
                                // strongest version of the rule the rest of the
                                // app keeps, and this is the credential where it
                                // matters most.
                                hint="Stored encrypted, and used by the app itself: it is typed into the board's page by the main process and never reaches this window."
                            >
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={value.password || ''}
                                        onChange={(e) => set('password', e.target.value)}
                                        className={`${FIELD_CLASS} pr-10`}
                                        placeholder={hasPassword ? 'Stored, leave blank to keep' : 'Required to sign in'}
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
                                            Stored IPMI password will be removed on save.
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-gray-500 dark:text-neutral-500">
                                            An IPMI password is stored for this host.{' '}
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
                        </>
                    )}

                    {/* Trust on first use, so there is nothing to configure and
                        only something to undo. Shown at all because a board that
                        was reflashed presents a new certificate, and the prompt
                        that then appears reads better if this was here. */}
                    {value.trustedCert && (
                        <div className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-surface-control p-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                    Certificate accepted
                                </p>
                                <p className="text-[11px] font-mono text-gray-500 dark:text-neutral-500 break-all">
                                    {value.trustedCert}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => set('trustedCert', '')}
                                className="text-[11px] text-red-500 hover:underline font-medium shrink-0 pt-0.5"
                            >
                                Forget
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
