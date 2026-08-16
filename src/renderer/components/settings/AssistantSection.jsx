import { useCallback, useEffect, useState } from 'react';
import { PROVIDER_NAMES } from '../../lib/ai-catalog';
import ProviderPicker from './ProviderPicker';
import SettingCard from './ui/SettingCard';
import SettingRow, { DIVIDED } from './ui/SettingRow';
import Toggle from './ui/Toggle';
import Slider from './ui/Slider';
import SegmentedControl from '../ui/SegmentedControl';
import Button from '../ui/Button';
import Reveal from '../ui/Reveal';
import { useT } from '../../i18n';

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

const APPROVALS = ['always', 'writes', 'never'];

/**
 * What a key for each agent looks like, as the field's placeholder.
 *
 * A key is stored per agent, so this is also the one thing on the row that
 * says whose key is being asked for: an Anthropic key typed into the box while
 * Grok is selected is not a fallback, it is a login failure a week later.
 */
const KEY_HINTS = {
    'claude-code': 'sk-ant-...',
    codex: 'sk-proj-...',
    grok: 'xai-...',
    kimi: 'sk-...',
};

/** What the key box says when it is empty. */
function keyPlaceholder(t, settings) {
    if (settings.hasApiKey) return t('settings.assistant.keyStored');
    // A local server usually wants no key at all, so the box says that rather
    // than showing the shape of a credential nobody has to go and find.
    if (settings.provider === 'local') return t('settings.assistant.keyOptional');
    return KEY_HINTS[settings.provider] || 'sk-ant-...';
}

const COMMAND_MODES = ['terminal', 'background'];

/**
 * How the assistant is authenticating, said plainly.
 *
 * The runtime is asked once a conversation has run, so before that there is
 * nothing to report and the page says as much. Guessing here is how someone on
 * a subscription ends up reading that they are being charged per token.
 */
function describeAccount(t, account, hasApiKey, provider) {
    const agent = PROVIDER_NAMES[provider] || t('settings.assistant.theAgent');
    if (provider === 'opencode') return t('settings.assistant.accountOpencode');
    // Nothing is signed in to and nothing is charged. The only credential a
    // model server ever wants is one the user put on it themselves.
    if (provider === 'local') return t('settings.assistant.accountLocal');
    // Grok with no CLI on the machine, which the provider says by naming the
    // API as what answered. It is a different arrangement from the other four
    // and the page should not describe it as an agent that is signed in here.
    if (provider === 'grok' && account?.apiProvider === 'xAI API') {
        return t('settings.assistant.accountGrokApi');
    }
    // Kimi Code always runs on the key stored here, whether the CLI is driving
    // or the API is, so the page says so instead of offering the login line
    // that is true of the others and never of this one.
    if (provider === 'kimi') return t('settings.assistant.accountKimi');
    if (account?.subscriptionType) {
        return t('settings.assistant.accountPlan', { agent, plan: account.subscriptionType });
    }
    if (account?.apiProvider && account.apiProvider !== 'firstParty') {
        return t('settings.assistant.accountProvider', { agent, provider: account.apiProvider });
    }
    if (account?.apiKeySource && account.apiKeySource !== 'none') {
        return t('settings.assistant.accountAgentKey', { agent });
    }
    if (hasApiKey) return t('settings.assistant.accountStoredKey', { agent });
    return t('settings.assistant.accountNone', { agent });
}

export default function AssistantSection() {
    const t = useT();
    const [settings, setSettings] = useState(null);
    const [account, setAccount] = useState(null);
    // Which agents the main process actually has, so the picker offers what
    // exists rather than what is planned.
    const [providers, setProviders] = useState([]);
    const [tools, setTools] = useState([]);
    const [keyValue, setKeyValue] = useState('');
    const [keyState, setKeyState] = useState('');
    const [endpoint, setEndpoint] = useState('');
    const [endpointState, setEndpointState] = useState('');
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
            setEndpoint(status.settings.localBaseUrl || '');
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
            setKeyState(keyValue
                ? t('settings.assistant.keySaved')
                : t('settings.assistant.keyRemoved'));
            const status = await window.api.ai.status();
            setSettings(status.settings);
        } else {
            setKeyState(result?.message || t('settings.assistant.keyFailed'));
        }
    }, [keyValue, t]);

    /**
     * Save the address, then say what is listening at it.
     *
     * The check is the point of the button. An address that is one digit out
     * looks exactly like a correct one until a conversation fails several
     * minutes later, and asking the server for its model list is the cheapest
     * question that can tell the two apart.
     */
    const saveEndpoint = useCallback(async () => {
        const next = await update({ localBaseUrl: endpoint });
        setEndpoint(next.localBaseUrl || '');
        setEndpointState(t('settings.assistant.endpointChecking'));

        const rows = await window.api.ai.models({ refresh: true }).catch(() => null);
        setEndpointState(rows?.length
            ? t('settings.assistant.endpointFound', { count: rows.length })
            : t('settings.assistant.endpointNone'));
    }, [endpoint, update, t]);

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
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('settings.assistant.loading')}
                </p>
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
                    title={t('settings.assistant.agent')}
                    description={t('settings.assistant.agentDesc')}
                >
                    <ProviderPicker
                        value={settings.provider}
                        available={providers}
                        onChange={(value) => update({ provider: value })}
                    />
                </SettingRow>

                {/* Only for the one agent that has no installer to find it by.
                    The other four are somewhere on the machine or they are
                    not; this one is wherever the user said it is. It opens
                    rather than appearing, because it belongs to the card
                    above it and a row that blinks into existence reads as the
                    page having been rebuilt. */}
                <Reveal open={settings.provider === 'local'}>
                    <SettingRow
                        className={DIVIDED}
                        title={t('settings.assistant.endpoint')}
                        description={t('settings.assistant.endpointDesc')}
                    >
                        <div className="space-y-3">
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    aria-label={t('settings.assistant.endpoint')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="http://localhost:1234/v1"
                                    className={`${FIELD_CLASS} flex-1 font-jetbrains text-xs`}
                                    value={endpoint}
                                    onChange={(event) => {
                                        setEndpoint(event.target.value);
                                        setEndpointState('');
                                    }}
                                />
                                <Button size="md" variant="secondary" onClick={saveEndpoint}>
                                    {t('common.save')}
                                </Button>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {endpointState || t('settings.assistant.endpointNote')}
                            </p>
                        </div>
                    </SettingRow>
                </Reveal>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title={t('settings.assistant.commandMode')}
                    description={t(`settings.assistant.commandMode.${settings.commandMode}.note`)}
                >
                    <SegmentedControl
                        ariaLabel={t('settings.assistant.commandMode')}
                        segments={COMMAND_MODES.map(value => ({
                            value,
                            label: t(`settings.assistant.commandMode.${value}`),
                        }))}
                        value={settings.commandMode}
                        onChange={(value) => update({ commandMode: value })}
                    />
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    title={t('settings.assistant.approval')}
                    description={t(`settings.assistant.approval.${settings.approval}.note`)}
                >
                    <SegmentedControl
                        ariaLabel={t('settings.assistant.approval')}
                        segments={APPROVALS.map(value => ({
                            value,
                            label: t(`settings.assistant.approval.${value}`),
                        }))}
                        value={settings.approval}
                        onChange={(value) => update({ approval: value })}
                    />
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    align="center"
                    title={t('settings.assistant.localTools')}
                    description={t('settings.assistant.localToolsDesc')}
                    control={
                        <Toggle
                            ariaLabel={t('settings.assistant.localTools')}
                            checked={settings.allowLocalTools}
                            onChange={(value) => update({ allowLocalTools: value })}
                        />
                    }
                />

                <SettingRow
                    className={DIVIDED}
                    title={t('settings.assistant.allowList')}
                    description={t('settings.assistant.allowListDesc')}
                >
                    <div className="space-y-3">
                        <textarea
                            aria-label={t('settings.assistant.allowList')}
                            rows={6}
                            spellCheck={false}
                            className={`${FIELD_CLASS} font-jetbrains text-xs leading-relaxed resize-y`}
                            value={commands}
                            onChange={(event) => setCommands(event.target.value)}
                        />
                        <div className="flex items-center gap-3">
                            <Button size="sm" variant="secondary" onClick={saveCommands}>
                                {t('settings.assistant.saveList')}
                            </Button>
                            {canRestoreCommands && (
                                <Button size="sm" variant="ghost" onClick={restoreCommands}>
                                    {t('settings.assistant.restoreDefaults')}
                                </Button>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.assistant.allowListNote', {
                                    mode: t('settings.assistant.approval.writes'),
                                })}
                            </span>
                        </div>
                    </div>
                </SettingRow>

                <SettingRow
                    className={DIVIDED}
                    title={t('settings.assistant.blockList')}
                    description={t('settings.assistant.blockListDesc')}
                >
                    <div className="space-y-3">
                        <textarea
                            aria-label={t('settings.assistant.blockList')}
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
                                {t('settings.assistant.saveList')}
                            </Button>
                            {canRestoreBlocked && (
                                <Button size="sm" variant="ghost" onClick={restoreBlocked}>
                                    {t('settings.assistant.restoreDefaults')}
                                </Button>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.assistant.blockListEmpty')}
                            </span>
                        </div>
                        {/* Said plainly, because a list like this invites the
                            belief that it is a wall. It stops the destructive
                            command that arrives by mistake, which is nearly all
                            of them. It cannot stop one that is trying not to be
                            recognised, and nothing here should be relied on as
                            though it could. */}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t('settings.assistant.blockListWarning')}
                        </p>
                    </div>
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title={t('settings.assistant.quickPrompts')}
                    description={t('settings.assistant.quickPromptsDesc')}
                >
                    <div className="space-y-3">
                        <textarea
                            aria-label={t('settings.assistant.quickPrompts')}
                            rows={5}
                            spellCheck={false}
                            placeholder={t('settings.assistant.quickPromptsPlaceholder')}
                            className={`${FIELD_CLASS} text-xs leading-relaxed resize-y
                                placeholder:text-gray-500 dark:placeholder:text-neutral-400`}
                            value={prompts}
                            onChange={(event) => setPrompts(event.target.value)}
                        />
                        <div className="flex items-center gap-3">
                            <Button size="sm" variant="secondary" onClick={savePrompts}>
                                {t('settings.assistant.savePrompts')}
                            </Button>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.assistant.quickPromptsNote')}
                            </span>
                        </div>
                    </div>
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    align="center"
                    title={t('settings.assistant.steps')}
                    description={t('settings.assistant.stepsDesc')}
                    control={
                        <Slider
                            ariaLabel={t('settings.assistant.steps')}
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
                    title={t('settings.assistant.lines')}
                    description={t('settings.assistant.linesDesc')}
                    control={
                        <Slider
                            ariaLabel={t('settings.assistant.lines')}
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
                    title={t('settings.assistant.signIn')}
                    description={describeAccount(
                        t,
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
                                    aria-label={t('settings.assistant.apiKey')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={keyPlaceholder(t, settings)}
                                    className={`${FIELD_CLASS} flex-1 font-jetbrains text-xs`}
                                    value={keyValue}
                                    onChange={(event) => { setKeyValue(event.target.value); setKeyState(''); }}
                                />
                                <Button size="md" variant="secondary" onClick={saveKey}>
                                    {t('common.save')}
                                </Button>
                            </div>
                            {keyState && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{keyState}</p>
                            )}
                            {!settings.encryptionAvailable && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    {t('settings.assistant.noSecureStore')}
                                </p>
                            )}
                        </div>
                    )}
                </SettingRow>
            </SettingCard>

            <SettingCard>
                <SettingRow
                    title={t('settings.assistant.tools')}
                    description={t('settings.assistant.toolsDesc', {
                        count: tools.length,
                        readOnly: readOnlyTools,
                    })}
                >
                    {/* Two across at the card's full width, one once it has
                        less: these names truncate, and half of a narrow card is
                        where they start truncating to nothing. */}
                    <ul className="grid gap-x-6 gap-y-2 grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))]">
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
