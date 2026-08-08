import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Refresh01Icon } from 'hugeicons-react';
import SettingCard from './ui/SettingCard';
import SettingRow, { DIVIDED } from './ui/SettingRow';
import Toggle from './ui/Toggle';
import Button from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import { OsIcon, hostOs } from '../../lib/os-icons';
import useMonitor from '../../hooks/useMonitor';
import { INTERVALS, TIMEOUTS, THRESHOLDS, STATE_STYLES, stateOf, since, describeStatus } from '../../lib/monitor';
import { toastOptions } from '../../lib/toast';

/**
 * Watching hosts, and being told when one stops answering.
 *
 * The settings live in the main process rather than in localStorage, for the
 * same reason the session log's do: that is where the work happens. A timer the
 * renderer owned would stop for the length of every window reload, which is
 * exactly the wrong moment to stop noticing a server going down.
 *
 * Which hosts are watched is not decided here. It is a property of a host, set
 * in the host editor, and this page lists what came of that: a checkbox list of
 * the whole collection would be a second place to keep the same fact, and the
 * two would disagree within a week. The list below is read from the records
 * rather than from the last sweep, so it says what is being watched before
 * anything has been checked, and while the switch above it is off.
 */

/**
 * Which states float to the top.
 *
 * A monitoring list is read for the bad news, and on a long one the bad news
 * would otherwise be wherever the host happens to sit in the collection. States
 * change rarely enough that this is not a list that shuffles under the pointer:
 * a host has to actually go down to move.
 */
const SEVERITY = { offline: 0, problem: 1, unknown: 2, online: 3 };

/**
 * One host: its icon, its name, and whether it is answering.
 *
 * Three things on one line, and nothing else. The address, the latency and when
 * it was last checked are all on the row's tooltip, where they are there to be
 * looked up rather than read past forty times.
 *
 * `host` is the saved record, joined on the id by the section below. The icon
 * comes from there rather than from the monitor's own payload so that it is the
 * same answer, from the same field, that the host card draws: one host is one
 * icon wherever it appears.
 */
function StatusRow({ status, host }) {
    const style = STATE_STYLES[stateOf(status)] || STATE_STYLES.unknown;

    return (
        <div className="flex items-center gap-3 px-3 h-11" title={describeStatus(status)}>
            <OsIcon
                os={hostOs(host || {})}
                distro={host?.distro}
                className="w-5 h-5 shrink-0"
            />

            <span className="flex-1 min-w-0 truncate text-xs font-medium text-gray-900 dark:text-white">
                {status.name}
            </span>

            <span className={`shrink-0 text-[11px] font-medium ${style.text}`}>
                {style.label}
            </span>
        </div>
    );
}

export default function MonitoringSection() {
    const { settings, ready, state, hosts, suspectReason, configure, checkNow } = useMonitor();
    const [checking, setChecking] = useState(false);
    const [records, setRecords] = useState(() => new Map());

    /*
     * The saved hosts, for the icons. Read once and again whenever the watched
     * set changes, which is the only thing that can put a host in this list that
     * was not in it before.
     *
     * Keyed on the ids rather than the array, because the monitor state arrives
     * fresh on every sweep and an effect that watched the array itself would
     * re-read the whole host list every thirty seconds to draw the same icons.
     */
    const watchedIds = hosts.map(entry => entry.hostId).join(',');

    useEffect(() => {
        let alive = true;

        window.api?.hosts?.list?.()
            .then((list) => {
                if (alive) setRecords(new Map((list || []).map(host => [host.id, host])));
            })
            .catch(() => {
                // Locked, or the bridge is older than this page. The rows still
                // draw, with the fallback icon a host with no detected OS gets.
            });

        return () => { alive = false; };
    }, [watchedIds]);

    const update = useCallback(async (patch) => {
        try {
            await configure(patch);
        } catch (error) {
            toast.error(error?.message || 'Could not save that setting', toastOptions());
        }
    }, [configure]);

    const runCheck = useCallback(async () => {
        setChecking(true);
        try {
            await checkNow();
        } catch (error) {
            toast.error(error?.message || 'Could not check the hosts', toastOptions());
        } finally {
            setChecking(false);
        }
    }, [checkNow]);

    // Still being read. Distinct from monitoring being off, and the card would
    // otherwise flash "off" on its way to saying the opposite.
    if (!settings && !ready) return null;

    /*
     * Asked, and nothing came back. Only reachable when the main process cannot
     * answer the channel: during development that means Electron is still
     * running the build it started with, since Vite reloads the renderer alone.
     *
     * Said out loud rather than rendered as an empty panel. A settings page that
     * silently draws nothing is indistinguishable from one that is broken, and
     * costs whoever is looking at it half an hour finding out which.
     */
    if (!settings) {
        return (
            <SettingCard>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Monitoring could not be read from the app. Restart CloudTerm and open this page
                    again.
                </p>
            </SettingCard>
        );
    }

    const offline = hosts.filter(entry => stateOf(entry) === 'offline').length;
    const plural = (count) => `${count} host${count === 1 ? '' : 's'}`;

    // Trouble first, the collection's own order within each group. `sort` is
    // stable in every engine this runs on, so hosts that share a state keep the
    // order the Hosts page lists them in.
    const rows = [...hosts].sort((a, b) => SEVERITY[stateOf(a)] - SEVERITY[stateOf(b)]);

    /**
     * The line under the list. A discarded sweep outranks the timestamp: saying
     * when the last check ran, next to results that check was not allowed to
     * write, would be describing something that did not happen.
     */
    const footnote = suspectReason === 'offline'
        ? `This machine has no network connection, so nothing is being checked and nothing
           has been reported offline.`
        : suspectReason === 'all-failed'
            ? `Every host failed the last check at the same moment, which is usually this
               machine rather than all of them. Those results were discarded and nothing
               was reported.`
            : state?.lastSweepAt > 0
                ? `Last checked ${since(state.lastSweepAt)}.`
                : '';

    /**
     * What the list card says about itself, which has to tell four states
     * apart. The two in the middle are the ones worth the words: hosts set up
     * with nothing running, and hosts running with nothing checked yet.
     */
    const listSummary = hosts.length === 0
        ? 'Watching is switched on per host, in the host editor.'
        : !settings.enabled
            ? `${plural(hosts.length)} set up, and nothing checking them while the switch above is off.`
            : offline
                ? `${plural(hosts.length)}, ${offline} not answering.`
                : `${plural(hosts.length)}.`;

    return (
        <>
            <SettingCard>
                <SettingRow
                    align="center"
                    title="Watch hosts for outages"
                    description="The master switch. Hosts are watched one at a time rather than all at
                        once, so this on its own checks nothing: each host you want watched is switched
                        on in its own editor, under Monitoring."
                    control={
                        <Toggle
                            checked={settings.enabled}
                            onChange={(next) => update({ enabled: next })}
                            ariaLabel="Watch hosts for outages"
                        />
                    }
                />

                {/* Everything below only means something while the switch above
                    is on. A disabled fieldset takes its contents out of the tab
                    order as well as dimming them, so they cannot be reached by
                    keyboard while they would do nothing. */}
                <fieldset
                    disabled={!settings.enabled}
                    className="disabled:opacity-50 transition-opacity"
                >
                    <SettingRow
                        className={DIVIDED}
                        align="center"
                        title="How often"
                        description="Every watched host is checked on this interval. A check is a single
                            connection that is closed the moment it opens, so this is cheap even on a
                            long host list."
                        control={
                            <SegmentedControl
                                ariaLabel="How often to check"
                                value={settings.intervalSeconds}
                                onChange={(next) => update({ intervalSeconds: next })}
                                segments={INTERVALS.map(entry => ({
                                    value: entry.value,
                                    label: entry.label,
                                }))}
                            />
                        }
                    />

                    <SettingRow
                        className={DIVIDED}
                        align="center"
                        title="How long to wait"
                        description="A host that has not accepted the connection within this has failed
                            the check. Worth raising for something on the far side of a VPN."
                        control={
                            <SegmentedControl
                                ariaLabel="How long to wait for an answer"
                                value={settings.timeoutSeconds}
                                onChange={(next) => update({ timeoutSeconds: next })}
                                segments={TIMEOUTS.map(entry => ({
                                    value: entry.value,
                                    label: entry.label,
                                }))}
                            />
                        }
                    />

                    <SettingRow
                        className={DIVIDED}
                        align="center"
                        title="Before calling it offline"
                        description="How many checks in a row have to fail. On wifi, leave this at two or
                            more: a single dropped packet is not a server going down, and being told that
                            it is, once a minute, is how a notification stops being read."
                        control={
                            <SegmentedControl
                                ariaLabel="Failed checks before a host is called offline"
                                value={settings.failures}
                                onChange={(next) => update({ failures: next })}
                                segments={THRESHOLDS.map(entry => ({
                                    value: entry.value,
                                    label: entry.label,
                                }))}
                            />
                        }
                    />
                </fieldset>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    align="center"
                    title="Notify me when a host goes offline"
                    description="A desktop notification, once, when a host crosses from answering to not.
                        Turn this off to keep the states on the host cards and the bell without being
                        interrupted by them."
                    control={
                        <Toggle
                            checked={settings.notify}
                            disabled={!settings.enabled}
                            onChange={(next) => update({ notify: next })}
                            ariaLabel="Notify me when a host goes offline"
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="And when it comes back"
                    description="A second notification when a host that was down starts answering again,
                        saying how long it was gone for."
                    control={
                        <Toggle
                            checked={settings.notifyOnRecovery}
                            disabled={!settings.enabled || !settings.notify}
                            onChange={(next) => update({ notifyOnRecovery: next })}
                            ariaLabel="Notify me when a host comes back"
                        />
                    }
                />
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title="What is being watched"
                    description={listSummary}
                    control={
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={runCheck}
                            disabled={checking || !settings.enabled || hosts.length === 0}
                            icon={<Refresh01Icon size={14} strokeWidth={2} />}
                        >
                            {checking ? 'Checking…' : 'Check now'}
                        </Button>
                    }
                >
                    <div className="flex flex-col gap-3">
                        <div className="rounded-xl border border-gray-200 dark:border-neutral-700
                            divide-y divide-gray-100 dark:divide-neutral-800 overflow-hidden">
                            {rows.length > 0 ? (
                                rows.map(status => (
                                    <StatusRow
                                        key={status.hostId}
                                        status={status}
                                        host={records.get(status.hostId)}
                                    />
                                ))
                            ) : (
                                // The one instruction this page cannot carry out
                                // for you, in the place you look for the answer.
                                <p className="px-4 py-6 text-center text-[11px] leading-relaxed
                                    text-gray-400 dark:text-neutral-500">
                                    No hosts are being watched yet.
                                    <br />
                                    Open a host from the Hosts page, find Monitoring under Optional,
                                    and switch on “Watch this host”.
                                </p>
                            )}
                        </div>

                        {/* The fine print under the list: when it last ran, or
                            the one case where the states above are not to be
                            taken at face value. Never both, and rendered at all
                            only when there is something to say, so the card does
                            not carry an empty line before its first sweep. */}
                        {footnote && (
                            <p className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-neutral-500">
                                {suspectReason && (
                                    <span
                                        aria-hidden="true"
                                        className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                                    />
                                )}
                                <span className="min-w-0">{footnote}</span>
                            </p>
                        )}
                    </div>
                </SettingRow>
            </SettingCard>
        </>
    );
}
