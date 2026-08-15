import { OsIcon } from '../../lib/os-icons';
import useEnter from '../../hooks/useEnter';

/**
 * The screen a session shows while it is coming up.
 *
 * Lifted out of TerminalView so the desktop views can show the same thing.
 * A shell and a desktop take about as long to open and are waited on the same
 * way, so there was no reason for one of them to answer with a badge breathing
 * halos and the other with a static icon and a full stop.
 *
 * Every colour here is `currentColor`, so this takes on whatever it is dropped
 * into: the terminal's own theme in a shell pane, the app surface in a desktop
 * one. The caller owns the positioning and the background — `className` and
 * `style` land on the outer element — and everything below is the contents.
 */
export default function ConnectingSplash({
    title,
    subtitle = '',
    note = '',
    os,
    distro,
    className = '',
    style,
}) {
    /** Comes up rather than being there. See lib/enterMotion. */
    const splashRef = useEnter('connect');

    return (
        <div
            className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-300 ${className}`}
            style={style}
        >
            <div ref={splashRef} className="flex flex-col items-center">
                {/* Host badge with halos breathing outward */}
                <div className="relative flex items-center justify-center w-24 h-24">
                    <span
                        className="connect-halo absolute w-16 h-16 rounded-full border"
                        style={{ borderColor: 'currentColor' }}
                    />
                    <span
                        className="connect-halo connect-halo-delayed absolute w-16 h-16 rounded-full border"
                        style={{ borderColor: 'currentColor' }}
                    />
                    {/* Circular, to match the rings expanding out of it */}
                    <span className="connect-badge relative w-14 h-14 rounded-full flex items-center justify-center">
                        <OsIcon os={os} distro={distro} className="w-7 h-7" />
                    </span>
                </div>

                <p className="mt-5 text-sm font-medium">
                    Connecting to <span className="font-semibold">{title}</span>
                </p>

                {subtitle && (
                    <p className="mt-1 text-xs font-mono" style={{ opacity: 0.55 }}>
                        {subtitle}
                    </p>
                )}

                {/* Indeterminate sweep, since we have no real progress to report */}
                <div className="connect-track mt-6 h-[3px] w-44 rounded-full overflow-hidden">
                    <span
                        className="connect-sweep block h-full w-1/3 rounded-full"
                        style={{ backgroundColor: 'currentColor', opacity: 0.65 }}
                    />
                </div>

                {/* For the steps the sweep cannot distinguish. A shell has none
                    and passes nothing; a desktop spends a moment preparing the
                    session and loading a WASM decoder before it reaches the
                    server, which is worth naming rather than leaving as a
                    longer wait on the same word. */}
                {note && (
                    <p className="mt-3 text-[11px]" style={{ opacity: 0.45 }}>
                        {note}
                    </p>
                )}
            </div>
        </div>
    );
}
