import { useState } from 'react';
import {
    ArrowDown01Icon,
    BrainIcon,
    BubbleChatQuestionIcon,
    ChartLineData01Icon,
    CheckListIcon,
    CommandLineIcon,
    ComputerTerminal01Icon,
    Edit02Icon,
    EyeIcon,
    File01Icon,
    FileEditIcon,
    FloppyDiskIcon,
    Globe02Icon,
    KeyboardIcon,
    LeftToRightListBulletIcon,
    Note01Icon,
    Plug01Icon,
    Search01Icon,
    StopCircleIcon,
    Unlink01Icon,
    UserMultipleIcon,
} from 'hugeicons-react';
import CopyButton from '../ui/CopyButton';
import { chipFor, todoProgress, toolKey, verbFor } from '../../lib/tool-bucket';
import { translate, useT } from '../../i18n';

/**
 * One tool call, as a row in the transcript.
 *
 * This is the honest record of what happened on the server, as opposed to the
 * assistant's account of it in prose above. That is why the output is here at
 * all and why it opens: when the summary says a service came back up, this is
 * where you check.
 *
 * Collapsed by default and kept to a single line, because a working answer is
 * usually several calls and nobody wants to scroll past a full `systemctl
 * status` to reach the conclusion. A failure opens itself, since that is the
 * one people always go looking for.
 *
 * The line reads as a verb and what it acted on ("Read nginx.conf", "Run
 * systemctl reload nginx"), with an icon for the kind of action. The icon
 * carries the status, so the row never changes height or width with it:
 * tinted and pulsing while the call runs, amber while it waits on you, red
 * when it failed, grey once it is over. A tool the app cannot name gets a dot
 * in the same place and its own name. See `lib/tool-bucket`.
 */

/** The verb's icon, by the name tool-bucket gives it. Kept here so that file stays free of JSX. */
const VERB_ICONS = {
    read: EyeIcon,
    list: LeftToRightListBulletIcon,
    run: CommandLineIcon,
    type: KeyboardIcon,
    edit: Edit02Icon,
    write: FileEditIcon,
    search: Search01Icon,
    fetch: Globe02Icon,
    todo: CheckListIcon,
    ask: BubbleChatQuestionIcon,
    connect: Plug01Icon,
    disconnect: Unlink01Icon,
    subagent: UserMultipleIcon,
    think: BrainIcon,
    terminal: ComputerTerminal01Icon,
    snippet: Note01Icon,
    save: FloppyDiskIcon,
    chart: ChartLineData01Icon,
    stop: StopCircleIcon,
};

/**
 * The icon's colour, by where the call stands. `motion-safe` so the pulse is
 * not drawn for someone who has asked the system for less movement.
 */
const TINTS = {
    running: 'text-blue-500 motion-safe:animate-pulse',
    waiting: 'text-amber-500',
    error: 'text-red-500',
    stopped: 'text-gray-400 dark:text-gray-600',
    done: 'text-gray-400 dark:text-gray-500',
};

/** The same, as a dot, for a tool with no icon of its own. */
export const DOTS = {
    running: 'bg-blue-500 motion-safe:animate-pulse',
    waiting: 'bg-amber-500',
    error: 'bg-red-500',
    stopped: 'bg-gray-300 dark:bg-gray-600',
    done: 'bg-gray-300 dark:bg-gray-600',
};

/**
 * A call that was put to the user and turned down.
 *
 * It never ran, so the row does not get to say "Run". This is also the state
 * the approval card collapses into once it is answered, which is why the shape
 * is identical: the same row, still naming the same command.
 */
const REFUSED = {
    denied: 'assistant.declined',
    expired: 'assistant.timedOut',
};

/** A path out of whichever field a runtime puts it in. */
const pathOf = input => input.path ?? input.file_path ?? input.filePath ?? input.notebook_path ?? '';

/** A command, which Codex can hand over as an argument list. */
const commandOf = (input) => {
    const command = input.command ?? input.cmd ?? '';
    return Array.isArray(command) ? command.join(' ') : String(command);
};

/** Which lines of a file a read asked for, in words, or '' for the whole file. */
function lineRange(input) {
    const offset = Number(input.offset) || 0;
    const limit = Number(input.limit) || 0;
    if (!offset && !limit) return '';
    const from = offset || 1;
    return limit
        ? translate('assistant.lineRange', { from, to: from + limit - 1 })
        : translate('assistant.fromLine', { from });
}

/**
 * The one line that says what this call actually was.
 *
 * Matched on the tool's bare name, lower-cased, so CloudTerm's own tools and
 * each runtime's spelling of the same thing (`Bash`, `bash`, `Shell`) land in
 * one place. Shared with the approval card, which says the same thing larger.
 *
 * Two optional parts besides the line. `aside` is a few words the row puts
 * after the file chip, which stands in for the line there. `detail` is what
 * the approval card shows under the line, for a call whose line alone is not
 * enough to say yes to: an edit is its path and, under it, the text it takes
 * out and the text it puts in.
 */
export function describeCall(name, input = {}) {
    switch (toolKey(name)) {
        case 'read_file': {
            const range = lineRange(input);
            return { mono: true, text: pathOf(input), aside: range, detail: range };
        }
        case 'edit_file': {
            const every = input.all ? translate('assistant.everyMatch') : '';
            return {
                mono: true,
                text: pathOf(input),
                aside: every,
                detail: input.old !== undefined
                    ? [`- ${String(input.old)}`, `+ ${String(input.new ?? '')}`, every].filter(Boolean).join('\n')
                    : every,
            };
        }
        case 'run_command':
        case 'bash':
        case 'shell':
        case 'command_execution':
        case 'run_terminal_cmd':
        case 'watch_metric':
            // The verb already says Run, so the row carries the bare command
            // rather than a "command: ..." dump.
            return { mono: true, text: commandOf(input) };
        case 'send_input':
            return { mono: true, text: input.text || '' };
        case 'write_file':
        case 'list_directory':
        case 'read':
        case 'write':
        case 'edit':
        case 'multiedit':
        case 'notebookread':
        case 'notebookedit':
        case 'readfile':
        case 'writefile':
        case 'strreplacefile':
        case 'view_file':
        case 'create_file':
        case 'str_replace_editor':
        case 'ls':
        case 'list':
            return { mono: true, text: pathOf(input) };
        case 'apply_patch':
        case 'file_change':
        case 'patch': {
            const paths = (Array.isArray(input.changes) ? input.changes : []).map(change => change?.path).filter(Boolean);
            return { mono: true, text: paths.join(', ') || pathOf(input) };
        }
        case 'grep':
            return { mono: true, text: [input.pattern, input.path || input.glob].filter(Boolean).join('  ') };
        case 'glob':
            return { mono: true, text: input.pattern || '' };
        case 'websearch':
        case 'searchweb':
        case 'search':
            return { mono: false, text: input.query || input.pattern || '' };
        case 'webfetch':
        case 'fetchurl':
            return { mono: true, text: input.url || '' };
        case 'task':
        case 'agent':
            return { mono: false, text: input.description || input.prompt || '' };
        case 'think':
            return { mono: false, text: input.thought || '' };
        case 'bashoutput':
        case 'killshell':
        case 'killbash':
            return { mono: true, text: input.bash_id || input.shell_id || '' };
        case 'todowrite':
        case 'todoread':
        case 'settodolist':
        case 'create_todo_list':
        case 'update_todo_list':
            // The row counts the list instead; see `todoProgress`.
            return { mono: false, text: '' };
        case 'read_metric':
        case 'stop_metric':
            return { mono: true, text: input.watchId || '' };
        case 'read_terminal':
            return {
                mono: false,
                text: input.lines
                    ? translate('assistant.lastLines', { count: input.lines })
                    : translate('assistant.recentOutput'),
            };
        case 'list_hosts':
            return {
                mono: false,
                text: input.query ? translate('assistant.matching', { query: input.query }) : '',
            };
        case 'list_snippets':
            return {
                mono: false,
                text: [input.kind, input.query ? translate('assistant.matching', { query: input.query }) : '']
                    .filter(Boolean).join(' '),
            };
        case 'read_snippet':
        case 'save_snippet':
            // The name and nothing else. A snippet's body can hold a password,
            // and it must not be drawn on the row or in its tooltip.
            return { mono: false, text: input.name || input.id || '' };
        case 'connect_host':
            return { mono: false, text: input.hostId || '' };
        case 'ask_user':
            return { mono: false, text: input.question || '' };
        // The question itself, not its machinery. The options are on the card
        // while it stands and in the answer once it is over, so a row that
        // listed them again would be the same thing three times.
        case 'askuserquestion':
            return {
                mono: false,
                text: (Array.isArray(input.questions) ? input.questions : [])
                    .map(entry => entry?.question || '')
                    .filter(Boolean)
                    .join(' · '),
            };
        default: {
            const entries = Object.entries(input || {}).filter(([key]) => key !== 'session');
            if (entries.length === 0) return { mono: false, text: '' };
            return {
                mono: false,
                text: entries
                    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                    .join(', '),
            };
        }
    }
}

export default function ToolCall({ item, bare = false }) {
    const t = useT();
    const [open, setOpen] = useState(item.status === 'error');
    const summary = describeCall(item.name, item.input);
    const refused = REFUSED[item.approval?.status];
    const status = item.status || 'done';
    const expandable = Boolean(item.result);

    // A verb when the tool names its kind; otherwise the tool's own name,
    // written the way it would be said.
    const verb = verbFor(item.name);
    const VerbIcon = verb ? VERB_ICONS[verb.icon] : null;
    const label = refused
        ? t(refused)
        : verb
            ? t(`assistant.verb.${verb.verb}`)
            : (item.local ? item.name : String(item.name || '').replace(/_/g, ' '));

    const chip = chipFor(item.name, item.input);
    const progress = verb?.verb === 'todo' ? todoProgress(item.input) : null;
    const detail = progress
        ? t('assistant.todoProgress', { done: progress.done, total: progress.total })
        : summary.text;
    const tint = refused ? TINTS.stopped : (TINTS[status] || TINTS.done);

    return (
        <div className={bare ? 'overflow-hidden' : 'rounded-lg bg-gray-50 dark:bg-white/[0.035] overflow-hidden'}>
            {/* Not selectable, unlike the output it opens: this row is a
                control, and dragging across a transcript should pick up what
                the server said rather than the label on the toggle. */}
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                disabled={!expandable}
                aria-expanded={expandable ? open : undefined}
                className="w-full min-w-0 h-8 px-2.5 flex items-center gap-2 text-left select-none
                    transition-colors
                    hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:hover:bg-transparent
                    disabled:cursor-default"
            >
                {VerbIcon ? (
                    <VerbIcon size={14} strokeWidth={2} className={`shrink-0 ${tint}`} aria-hidden="true" />
                ) : (
                    // Centred in the icon's box, so a row with a dot lines up
                    // with the rows around it that have an icon.
                    <span aria-hidden="true" className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                        <span className={`w-1.5 h-1.5 rounded-full ${refused ? DOTS.stopped : (DOTS[status] || DOTS.done)}`} />
                    </span>
                )}

                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 shrink-0">
                    {label}
                </span>

                {chip ? (
                    <>
                        <span
                            className="min-w-0 max-w-[60%] flex items-center gap-1.5 rounded-md px-1.5 py-0.5
                                bg-black/[0.05] dark:bg-white/[0.07]
                                text-[11px] text-gray-600 dark:text-gray-300"
                            title={chip.full}
                        >
                            <File01Icon size={12} strokeWidth={2} className="shrink-0 text-gray-400 dark:text-gray-500" />
                            <span className="truncate font-jetbrains">{chip.base}</span>
                        </span>
                        {summary.aside && (
                            <span className="min-w-0 truncate text-[11px] text-gray-400 dark:text-gray-500">
                                {summary.aside}
                            </span>
                        )}
                    </>
                ) : detail ? (
                    <span
                        className={`min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-500 ${
                            summary.mono && !progress ? 'font-jetbrains' : ''
                        }`}
                        title={summary.text || detail}
                    >
                        {detail}
                    </span>
                ) : null}

                {expandable && (
                    <ArrowDown01Icon
                        size={13}
                        strokeWidth={2}
                        className={`shrink-0 ml-auto text-gray-400 dark:text-gray-600 transition-transform
                            ${open ? 'rotate-180' : ''}`}
                    />
                )}
            </button>

            {/* Where the change an edit made will be drawn, above its output,
                once the main process sends one with the call. */}
            {open && expandable && (
                // The button is a sibling of the scroller rather than a child
                // of it: inside, it would scroll away with the first screen of
                // output, which is the one place it must not be.
                <div className="group relative border-t border-black/[0.06] dark:border-white/[0.06]">
                    {/* Scrolls in both directions on its own: a wide log line must
                        not stretch the panel, and a long one must not bury the
                        reply under it. */}
                    <pre className="px-2.5 py-2 max-h-64 overflow-auto
                        font-jetbrains text-[11px] leading-[1.6] whitespace-pre
                        text-gray-600 dark:text-gray-400">
                        {item.result}
                    </pre>
                    <CopyButton text={item.result} label="Copy output" className="absolute right-1 top-1" />
                </div>
            )}
        </div>
    );
}
