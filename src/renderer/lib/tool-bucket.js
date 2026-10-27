/**
 * What a tool call is, in a word, for the transcript.
 *
 * A row leads with a verb and an icon ("Read nginx.conf", "Run systemctl
 * status nginx") rather than the tool's raw name, so a burst of calls scans as
 * a timeline: the kind of action first, the thing it acted on after it. The
 * same reading sorts calls into the buckets a group of them is summed up by
 * ("8 reads · 3 commands"), and picks the working line's phrases while one
 * runs.
 *
 * Three sources of names arrive here. CloudTerm's own tools, which are known
 * exactly. The runtimes' own (Claude Code's Read and Bash, Codex's command and
 * patch items, OpenCode's and Kimi's and Grok's equivalents), which are known
 * by their usual names. And anything else, from an MCP server the user added,
 * which is guessed at from the name and left with no verb when the guess would
 * be a stretch: the row then shows the tool's own name beside a plain dot.
 *
 * Pure, and free of JSX, so it can be tested under plain node. Icons are named
 * here and resolved to components by the row.
 */

/**
 * A verb: its label key (`assistant.verb.<verb>`), the icon the row draws, and
 * the bucket a group counts it in. `file` marks the verbs whose call names one
 * file, which the row shows as a chip.
 */
const READ = { verb: 'read', icon: 'read', bucket: 'views', file: true };
const LIST = { verb: 'list', icon: 'list', bucket: 'views' };
const RUN = { verb: 'run', icon: 'run', bucket: 'commands' };
const EDIT = { verb: 'edit', icon: 'edit', bucket: 'edits', file: true };
const WRITE = { verb: 'write', icon: 'write', bucket: 'edits', file: true };
const SEARCH = { verb: 'search', icon: 'search', bucket: 'searches' };
const FETCH = { verb: 'fetch', icon: 'fetch', bucket: 'views' };
const TODO = { verb: 'todo', icon: 'todo', bucket: 'other' };
const ASK = { verb: 'ask', icon: 'ask', bucket: 'other' };
const CONNECT = { verb: 'connect', icon: 'connect', bucket: 'connections' };
const SUBAGENT = { verb: 'subagent', icon: 'subagent', bucket: 'other' };
const THINK = { verb: 'think', icon: 'think', bucket: 'other' };

/** Every name this knows exactly, lower-cased. */
const KNOWN = {
    // CloudTerm's own.
    list_hosts: { verb: 'listHosts', icon: 'list', bucket: 'views' },
    list_sessions: { verb: 'listSessions', icon: 'list', bucket: 'views' },
    read_terminal: { verb: 'readTerminal', icon: 'terminal', bucket: 'views' },
    run_command: RUN,
    send_input: { verb: 'type', icon: 'type', bucket: 'commands' },
    list_directory: LIST,
    read_file: READ,
    write_file: WRITE,
    edit_file: EDIT,
    connect_host: CONNECT,
    disconnect_session: { verb: 'disconnect', icon: 'disconnect', bucket: 'connections' },
    ask_user: ASK,
    list_snippets: { verb: 'listSnippets', icon: 'list', bucket: 'views' },
    read_snippet: { verb: 'readSnippet', icon: 'snippet', bucket: 'views' },
    save_snippet: { verb: 'saveSnippet', icon: 'save', bucket: 'edits' },
    watch_metric: { verb: 'watch', icon: 'chart', bucket: 'commands' },
    read_metric: { verb: 'readChart', icon: 'chart', bucket: 'views' },
    stop_metric: { verb: 'stopChart', icon: 'stop', bucket: 'commands' },

    // Claude Code's.
    read: READ,
    notebookread: READ,
    edit: EDIT,
    multiedit: EDIT,
    notebookedit: EDIT,
    write: WRITE,
    bash: RUN,
    bashoutput: { verb: 'readOutput', icon: 'terminal', bucket: 'views' },
    killshell: { verb: 'stop', icon: 'stop', bucket: 'commands' },
    killbash: { verb: 'stop', icon: 'stop', bucket: 'commands' },
    grep: SEARCH,
    glob: SEARCH,
    ls: LIST,
    webfetch: FETCH,
    websearch: SEARCH,
    todowrite: TODO,
    task: SUBAGENT,
    agent: SUBAGENT,
    askuserquestion: ASK,

    // Codex's, as items rather than tools.
    command_execution: RUN,
    apply_patch: EDIT,
    file_change: EDIT,
    patch: EDIT,

    // OpenCode's. Its read, write, edit, bash, grep and glob are the names
    // above in lower case already.
    list: LIST,
    todoread: TODO,

    // Kimi's.
    shell: RUN,
    readfile: READ,
    writefile: WRITE,
    strreplacefile: EDIT,
    searchweb: SEARCH,
    fetchurl: FETCH,
    settodolist: TODO,
    think: THINK,

    // Grok CLI's.
    view_file: READ,
    create_file: WRITE,
    str_replace_editor: EDIT,
    search: SEARCH,
    create_todo_list: TODO,
    update_todo_list: TODO,
    run_terminal_cmd: RUN,
};

/**
 * The bare name: lower-cased, with an MCP server's prefix taken off. Claude
 * Code reports a tool from someone else's server as `mcp__github__search`, and
 * the part after the server is the one that says what it does.
 */
export function toolKey(name = '') {
    const lower = String(name || '').toLowerCase();
    const parts = lower.split('__');
    return parts.length >= 3 && parts[0] === 'mcp' ? parts.slice(2).join('__') : lower;
}

/**
 * A guess from the name, for a tool this does not know. Ordered so the more
 * specific reading wins: a "todo" that writes is a todo, an "edit" that
 * mentions a file is still an edit, a search that reads is a search.
 */
function guess(lower) {
    if (lower.includes('todo')) return TODO;
    if (/edit|replace|patch/.test(lower)) return EDIT;
    if (/write|create_file|save/.test(lower)) return WRITE;
    if (/search|grep|glob|find/.test(lower)) return SEARCH;
    if (/fetch|browse|url/.test(lower)) return FETCH;
    if (/bash|shell|exec|command|terminal|powershell/.test(lower)) return RUN;
    if (/read|view|(^|_)cat($|_)/.test(lower)) return READ;
    if (/(^|_)list|^ls$/.test(lower)) return LIST;
    if (/connect|ssh/.test(lower)) return CONNECT;
    return null;
}

/**
 * The row's verb, `{ verb, icon, bucket, file }`, or null for a tool with
 * none, whose row keeps its own name.
 */
export function verbFor(name = '') {
    const lower = toolKey(name);
    if (!lower) return null;
    return KNOWN[lower] || guess(lower);
}

/** Which bucket a group counts the call in: views, commands, edits, searches, connections or other. */
export function toolBucket(name = '') {
    return verbFor(name)?.bucket || 'other';
}

/**
 * The file a call targets, as a chip: the base name to draw and the full path
 * for the tooltip. Only for a verb that acts on one file, and only when the
 * call names exactly one. A query or a command line is not a chip.
 */
export function chipFor(name = '', input = {}) {
    if (!verbFor(name)?.file) return null;
    let full = input?.path ?? input?.file_path ?? input?.filePath ?? input?.notebook_path ?? '';
    // A patch that touches one file names it there; one that touches several
    // is described in words instead.
    if (!full && Array.isArray(input?.changes) && input.changes.length === 1) full = input.changes[0]?.path || '';
    if (typeof full !== 'string' || !full.trim()) return null;
    full = full.trim();
    const base = full.split(/[/\\]/).filter(Boolean).pop() || full;
    return { base, full };
}

/** What counts as finished in the todo lists the runtimes keep. */
const DONE = new Set(['completed', 'complete', 'done', 'finished']);

/**
 * A todo tool's progress, `{ done, total }`, or null when the input carries no
 * list to count.
 */
export function todoProgress(input = {}) {
    const todos = Array.isArray(input?.todos) ? input.todos : null;
    if (!todos) return null;
    const done = todos.filter(todo => DONE.has(String(todo?.status || '').toLowerCase())).length;
    return { done, total: todos.length };
}

/** The working line's phrase list for each bucket. See WorkingIndicator. */
const ACTIVITY = {
    views: 'read',
    searches: 'read',
    commands: 'shell',
    edits: 'write',
    connections: 'connect',
};

/**
 * Which phrase list a running call's work is drawn from: shell, read, write,
 * connect, or think between calls and for anything else. The terminal is
 * read by watching what it prints, which is a shell's kind of work.
 */
export function activityOf(name) {
    if (!name) return 'think';
    const verb = verbFor(name);
    if (verb?.icon === 'terminal') return 'shell';
    return ACTIVITY[verb?.bucket] || 'think';
}
