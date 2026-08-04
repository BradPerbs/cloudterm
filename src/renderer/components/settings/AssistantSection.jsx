import { useCallback, useEffect, useState } from 'react';
import { PROVIDER_NAMES } from '../../lib/ai-catalog';
import ProviderPicker from './ProviderPicker';
import SettingCard from './ui/SettingCard';
import SettingRow, { DIVIDED } from './ui/SettingRow';
import Toggle from './ui/Toggle';
import Slider from './ui/Slider';
import SegmentedControl from '../ui/SegmentedControl';
import Button from '../ui/Button';

/**
 * How the assistant is set up.
 *
 * Every control here changes something that outlives the conversation it was
 * changed during, which is what makes this a settings page rather than a menu
 * on the panel: the approval policy is a property of the app, not of the chat
 * that happens to be open.
 *
 * The model and the effort are not here, though they are stored the same way.
 * They live in the composer, because they are the two people change mid
 * conversation and walking to a settings page to do it costs the thread they
 * were pulling on. Having them in both places meant two controls for one
 * setting, each having to be told when the other moved.
 */

/** The field look this page uses: the two text areas and the key input. */
const FIELD_CLASS = `w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-neutral-800
    border border-gray-300 dark:border-neutral-700
    text-gray-900 dark:text-gray-100 outline-none
    focus-visible:ring-2 focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25`;

const APPROVALS = [
    { value: 'always', label: 'Every action' },
    { value: 'writes', label: 'Changes only' },
    { value: 'never', label: 'Never' },
];

const COMMAND_MODES = [
    { value: 'terminal', label: 'In my terminal' },
    { value: 'background', label: 'Out of sight' },
];

const COMMAND_MODE_NOTES = {
    terminal: 'Commands are typed into the session you are looking at, so you watch them run and the '
        + 'output stays in your scrollback. They go into that shell\'s history, and the assistant reads '
        + 'the result off the screen rather than getting an exit code.',
    background: 'Commands run on a separate channel you cannot see. Tidier, and the assistant gets a real '
        + 'exit code and clean output, but you are taking its word for what happened.',
};

const APPROVAL_NOTES = {
    always: 'Every tool call waits for you, including reading a file or the terminal. Thorough, but a long '
        + 'investigation becomes a lot of clicking.',
    writes: 'Reading runs freely. Anything that changes a system stops and shows you the exact command and the '
        + 'host it would run on.',
    never: 'Nothing stops for approval, including commands that delete data or restart services. Only sensible '
        + 'for hosts you can afford to break.',
};

/**
 * How the assistant is authenticating, said plainly.
 *
 * The runtime is asked once a conversation has run, so before that there is
 * nothing to report and the page says as much. Guessing here is how someone on
 * a subscription ends up reading that they are being charged per token.
 */
function describeAccount(account, hasApiKey, provider) {
    const agent = PROVIDER_NAMES[provider] || 'the agent';
    if (provider === 'opencode') {
        return 'OpenCode uses the providers and credentials already configured in its CLI. '
            + 'Manage them with "opencode auth login"; keys stored in CloudBlast are not passed to OpenCode.';
    }
    if (account?.subscriptionType) {
        return `Signed in through ${agent} on this machine, on a ${account.subscriptionType} plan. `
            + 'Usage comes out of that plan, so no key is needed here.';
    }
    if (account?.apiProvider && account.apiProvider !== 'firstParty') {
        return `${agent} on this machine is set up against ${account.apiProvider}, `
            + 'which handles its own credentials. Nothing is needed here.';
    }
    if (account?.apiKeySource && account.apiKeySource !== 'none') {
        return `${agent} on this machine is using an API key, so usage is charged per token.`;
    }
    if (hasApiKey) {
        return 'A key is stored here and will be used. Clear the box and save to remove it and fall back '
            + `to the ${agent} login.`;
    }
    return `Nothing to do if you are already signed in to ${agent} on this machine, which is the usual `
        + 'case. A key is only needed when you are not.';
}

export default function AssistantSection() {
    const [settings, setSettings] = useState(null);
    const [account, setAccount] = useState(null);
    // Which agents the main process actually has, so the picker offers what
    // exists rather than what is planned.
    const [providers, setProviders] = useState([]);
    const [tools, setTools] = useState([]);
    const [keyValue, setKeyValue] = useState('');
    const [keyState, setKeyState] = useState('');
    const [commands, setCommands] = useState('');
    const [blocked, setBlocked] = useState('');
    const [prompts, setPrompts] = useState('');

    useEffect(() => {
        let cancelled = false;
        window.api.ai.status().then((status) => {
            if (cancelled || !status) return;
            setSettings(status.settings);
            setAccount(status.account || null);
            setProviders(status.providers || []);
            setTools(status.tools || []);
            setCommands((status.settings.autoApproveCommands || []).join('\n'));
            setBlocked((status.settings.blockedCommands || []).join('\n'));
            setPrompts((status.settings.quickPrompts || []).join('\n'));
        }).catch(() => {});

        return () => { cancelled = true; };
    }, []);

    // The composer changes the model, the effort and the approvals from its own
    // controls while this page is open behind it. The two text areas are left
    // alone deliberately: resyncing them would take away what someone is
    // halfway through typing.
    useEffect(() => window.api.ai.onSettings(setSettings), []);

    const update = useCallback(async (patch) => {
        const next = await window.api.ai.setSettings(patch);
        setSettings(next);
        return next;
    }, []);

    const saveKey = useCallback(async () => {
        const result = await window.api.ai.setApiKey(keyValue);
        if (result?.success) {
            setKeyValue('');
            setKeyState(keyValue ? 'Key saved.' : 'Key removed.');
            const status = await window.api.ai.status();
            setSettings(status.settings);
        } else {
            setKeyState(result?.message || 'That key could not be saved.');
        }
    }, [keyValue]);

    const saveCommands = useCallback(async () => {
        const list = commands.split('\n').map(line => line.trim()).filter(Boolean);
        const next = await update({ autoApproveCommands: list });
        setCommands((next.autoApproveCommands || []).join('\n'));
    }, [commands, update]);

    const saveBlocked = useCallback(async () => {
        const list = blocked.split('\n').map(line => line.trim()).filter(Boolean);
        const next = await update({ blockedCommands: list });
        setBlocked((next.blockedCommands || []).join('\n'));
    }, [blocked, update]);

    /**
     * Back to what the app shipped with.
     *
     * Both lists are free to be emptied or rewritten, which is the point of
     * them. What that leaves is no way back: once the seeded entries are gone
     * there is nothing on screen that remembers what they were. Main sends the
     * defaults with the settings so this does not need its own copy of them.
     */
    const restoreCommands = useCallback(async () => {
        const next = await update({ autoApproveCommands: settings.defaults.autoApproveCommands });
        setCommands((next.autoApproveCommands || []).join('\n'));
    }, [settings?.defaults, update]);

    const restoreBlocked = useCallback(async () => {
        const next = await update({ blockedCommands: settings.defaults.blockedCommands });
        setBlocked((next.blockedCommands || []).join('\n'));
    }, [settings?.defaults, update]);

    const savePrompts = useCallback(async () => {
        const list = prompts.split('\n').map(line => line.trim()).filter(Boolean);
        const next = await update({ quickPrompts: list });
        setPrompts((next.quickPrompts || []).join('\n'));
    }, [prompts, update]);

    if (!settings) {
        return (
            <SettingCard>
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading the assistant settings...</p>
            </SettingCard>
        );
    }

    const readOnlyTools = tools.filter(tool => tool.readOnly).length;

    // Offered only once a list has actually moved away from the shipped one,
    // so the row is not carrying a button that would do nothing. Compared
    // against what is saved rather than what is in the box, because a list
    // someone is halfway through typing has not changed anything yet.
    const sameAsDefault = (list, fallback) => (list || []).join('\n') === (fallback || []).join('\n');
    const canRestoreCommands = settings.defaults
        && !sameAsDefault(settings.autoApproveCommands, settings.defaults.autoApproveCommands);
    const canRestoreBlocked = settings.defaults
        && !sameAsDefault(settings.blockedCommands, settings.defaults.blockedCommands);

    return (
        <>
            {/* First, because it decides what everything under it means: the
                models, the effort scale and the shape of a tool call all
                belong to whichever agent is running. */}
            <SettingCard>
                <SettingRow
                    title="Agent"
                    description="Which coding agent answers, using the copy already installed on this machine.
                        Switching starts a fresh conversation."
                >
                    <ProviderPicker
                        value={settings.provider}
                        available={providers}
                        onChange={(value) => update({ provider: value })}
                    />
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title="Where commands run"
                    description={COMMAND_MODE_NOTES[settings.commandMode]}
                >
                    <SegmentedControl
                        ariaLabel="Where commands run"
                        segments={COMMAND_MODES}
                        value={settings.commandMode}
                        onChange={(value) => update({ commandMode: value })}
                    />
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    title="Ask before running"
                    description={APPROVAL_NOTES[settings.approval]}
                >
                    <SegmentedControl
                        ariaLabel="When to ask for approval"
                        segments={APPROVALS}
                        value={settings.approval}
                        onChange={(value) => update({ approval: value })}
                    />
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Allow tools on this computer"
                    description="Lets the assistant read and write local files and run local commands. Off by
                        default: the panel is for managing servers, and your own machine is a far wider surface
                        than that needs."
                    control={
                        <Toggle
                            ariaLabel="Allow tools on this computer"
                            checked={settings.allowLocalTools}
                            onChange={(value) => update({ allowLocalTools: value })}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    title="Commands that never need approval"
                    description="One per line, matched on the whole first words. A command containing a pipe,
                        a redirect, a semicolon, a substitution or a second line is always asked about,
                        whatever it starts with."
                >
                    <div className="space-y-3">
                        <textarea
                            aria-label="Commands that never need approval"
                            rows={6}
                            spellCheck={false}
                            className={`${FIELD_CLASS} font-jetbrains text-xs leading-relaxed resize-y`}
                            value={commands}
                            onChange={(event) => setCommands(event.target.value)}
                        />
                        <div className="flex items-center gap-3">
                            <Button size="sm" variant="secondary" onClick={saveCommands}>
                                Save list
                            </Button>
                            {canRestoreCommands && (
                                <Button size="sm" variant="ghost" onClick={restoreCommands}>
                                    Restore defaults
                                </Button>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                Only applies while approvals are set to "Changes only".
                            </span>
                        </div>
                    </div>
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    title="Commands it may never run"
                    description={'One per line. These are refused outright rather than asked about, in every '
                        + 'approval mode including "Never ask", and whether the assistant runs them on their '
                        + 'own channel or types them into your terminal. Flags count: "rm -rf" also stops '
                        + '"rm -fr", "rm -r -f" and "sudo /bin/rm --recursive --force".'}
                >
                    <div className="space-y-3">
                        <textarea
                            aria-label="Commands it may never run"
                            rows={4}
                            spellCheck={false}
                            placeholder={'rm -rf\nshutdown\nmkfs'}
                            className={`${FIELD_CLASS} font-jetbrains text-xs leading-relaxed resize-y
                                placeholder:text-gray-500 dark:placeholder:text-neutral-400`}
                            value={blocked}
                            onChange={(event) => setBlocked(event.target.value)}
                        />
                        <div className="flex items-center gap-3">
                            <Button size="sm" variant="secondary" onClick={saveBlocked}>
                                Save list
                            </Button>
                            {canRestoreBlocked && (
                                <Button size="sm" variant="ghost" onClick={restoreBlocked}>
                                    Restore defaults
                                </Button>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                Clear the box to block nothing.
                            </span>
                        </div>
                        {/* Said plainly, because a list like this invites the
                            belief that it is a wall. It stops the destructive
                            command that arrives by mistake, which is nearly all
                            of them. It cannot stop one that is trying not to be
                            recognised, and nothing here should be relied on as
                            though it could. */}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            A guardrail against mistakes, not a security control. A shell has too many ways to
                            spell the same command for any list to catch them all, so keep approvals on for
                            anything that matters.
                        </p>
                    </div>
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title="Quick prompts"
                    description="Questions the panel offers as one-click buttons when a conversation is empty.
                        One per line. Nothing is set up to begin with, because the ones worth having are the
                        ones you find yourself asking your own machines every week."
                >
                    <div className="space-y-3">
                        <textarea
                            aria-label="Quick prompts"
                            rows={5}
                            spellCheck={false}
                            placeholder={'What is filling up the disk?\nWhy did the last deploy fail?'}
                            className={`${FIELD_CLASS} text-xs leading-relaxed resize-y
                                placeholder:text-gray-500 dark:placeholder:text-neutral-400`}
                            value={prompts}
                            onChange={(event) => setPrompts(event.target.value)}
                        />
                        <div className="flex items-center gap-3">
                            <Button size="sm" variant="secondary" onClick={savePrompts}>
                                Save prompts
                            </Button>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                Up to 12. Clicking one puts it in the box rather than sending it, so you can
                                add to it first.
                            </span>
                        </div>
                    </div>
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    align="center"
                    title="Steps per turn"
                    description="How many tool calls one question may take before the assistant stops and
                        reports back. A run that is not converging ends on its own rather than when you notice."
                    control={
                        <Slider
                            ariaLabel="Steps per turn"
                            value={settings.maxTurns}
                            min={5}
                            max={100}
                            step={5}
                            onChange={(value) => update({ maxTurns: value })}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title="Terminal lines it can read"
                    description="How much of a session's recent output one read returns. Higher gives it more
                        context to work from and uses more of the conversation's budget."
                    control={
                        <Slider
                            ariaLabel="Terminal lines it can read"
                            value={settings.transcriptLines}
                            min={40}
                            max={1000}
                            step={20}
                            onChange={(value) => update({ transcriptLines: value })}
                        />
                    }
                />
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title="Signing in"
                    description={describeAccount(
                        account,
                        settings.hasApiKey,
                        settings.provider
                    )}
                >
                    {settings.provider === 'opencode' ? (
                        <code className="inline-flex px-3 py-2 rounded-xl text-xs font-jetbrains
                            bg-gray-50 dark:bg-neutral-800 text-gray-700 dark:text-gray-300">
                            opencode auth login
                        </code>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex gap-3">
                                <input
                                    type="password"
                                    aria-label="API key"
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={settings.hasApiKey
                                        ? 'A key is stored'
                                        : settings.provider === 'codex' ? 'sk-proj-...' : 'sk-ant-...'}
                                    className={`${FIELD_CLASS} flex-1 font-jetbrains text-xs`}
                                    value={keyValue}
                                    onChange={(event) => { setKeyValue(event.target.value); setKeyState(''); }}
                                />
                                <Button size="md" variant="secondary" onClick={saveKey}>Save</Button>
                            </div>
                            {keyState && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{keyState}</p>
                            )}
                            {!settings.encryptionAvailable && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    This system has no secure store available, so a key cannot be saved here.
                                </p>
                            )}
                        </div>
                    )}
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title="What it can do"
                    description={`${tools.length} tools, of which ${readOnlyTools} only read. The rest are
                        subject to the approval setting above.`}
                >
                    <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
                        {tools.map(tool => (
                            <li key={tool.name} className="flex items-center gap-2 min-w-0">
                                <span
                                    aria-hidden="true"
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        tool.readOnly ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                                    {tool.title}
                                </span>
                            </li>
                        ))}
                    </ul>
                </SettingRow>
            </SettingCard>
        </>
    );
}
