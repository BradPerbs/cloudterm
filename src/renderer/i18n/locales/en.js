/**
 * English, and the fallback every other locale falls back to.
 *
 * Keys are flat and dotted so one can be grepped for across the app. Keys
 * ending `_one` / `_few` / `_many` / `_other` are plural forms, chosen by
 * Intl.PluralRules from the `count` passed to `t`; a key with a `count` but no
 * suffixed variants is used as-is, which is right whenever the sentence does
 * not inflect.
 *
 * When adding a string: add it here first, then to the other four. A key
 * missing from a translation falls back to this file rather than showing the
 * raw key, so a partly translated locale is still a working app.
 */
export default {
    /* ---------------------------------------------------------------- *
     * Words the whole app shares
     * ---------------------------------------------------------------- */
    'common.allFiles': 'All files',
    'common.apply': 'Apply',
    'common.cancel': 'Cancel',
    'common.change': 'Change',
    'common.changeEllipsis': 'Change…',
    'common.clear': 'Clear',
    'common.close': 'Close',
    'common.filter': 'Filter',
    'common.filtered': 'Filtered.',
    'common.keepCurrentColors': 'Nothing (keep current colors)',
    'common.left': 'Left',
    'common.loading': 'Loading…',
    'common.noFilterMatches': 'Nothing matches those filters.',
    'common.noMatches': 'Nothing matches “{query}”',
    'common.noMatchesTitle': 'No matches',
    'common.off': 'Off',
    'common.remove': 'Remove',
    'common.reset': 'Reset',
    'common.right': 'Right',
    'common.save': 'Save',
    'common.saveAndApply': 'Save & Apply',
    'common.startFrom': 'Start from',
    'common.working': 'Working…',

    /* ---------------------------------------------------------------- *
     * Sidebar
     * ---------------------------------------------------------------- */
    'nav.hosts': 'Hosts',
    'nav.keychain': 'Keychain',
    'nav.proxies': 'Proxies',
    'nav.snippets': 'Snippets',
    'nav.logs': 'Logs',
    'nav.settings': 'Settings',

    /* ---------------------------------------------------------------- *
     * Hosts
     * ---------------------------------------------------------------- */
    'hosts.count_one': '{count} host',
    'hosts.count_other': '{count} hosts',
    'hosts.folderCount_one': '{count} folder',
    'hosts.folderCount_other': '{count} folders',
    'hosts.empty': 'No hosts yet',
    'hosts.emptyNote': 'Add a server to get started.',
    'hosts.emptyFolder': 'Nothing here yet',
    'hosts.layout': 'Card layout',
    'hosts.newFolder': 'New folder',
    'hosts.newHost': 'New Host',
    'hosts.search': 'Search hosts',
    'hosts.viewGrid': 'Grid',
    'hosts.viewList': 'List',

    /* ---------------------------------------------------------------- *
     * Keychain
     * ---------------------------------------------------------------- */
    'keychain.count_one': '{count} key',
    'keychain.count_other': '{count} keys',
    'keychain.empty': 'No keys yet',
    'keychain.emptyNote': 'Generate or import one to get started.',
    'keychain.helloAdd': 'Add a Windows Hello key, held in this PC’s TPM',
    'keychain.helloWaiting': 'Waiting for Windows Hello…',
    'keychain.import': 'Import an existing key, from a file or pasted',
    'keychain.newKey': 'New Key',
    'keychain.search': 'Search keys',

    /* ---------------------------------------------------------------- *
     * Proxies
     * ---------------------------------------------------------------- */
    'proxies.empty': 'No proxies yet',
    'proxies.emptyNote': 'Add a SOCKS or HTTP proxy and any host can be dialled through it: '
        + 'terminal sessions, SFTP, port forwards and remote desktops alike.',
    'proxies.newProxy': 'New Proxy',
    'proxies.search': 'Search proxies',

    /* ---------------------------------------------------------------- *
     * Snippets
     * ---------------------------------------------------------------- */
    'snippets.count_one': '{count} snippet',
    'snippets.count_other': '{count} snippets',
    'snippets.empty': 'No snippets yet',
    'snippets.emptyNote': 'Save the commands you retype on every box.',
    'snippets.newPackage': 'New package',
    'snippets.newSnippet': 'New Snippet',
    'snippets.nothingShown': 'Nothing shown',
    'snippets.search': 'Search snippets',
    'snippets.showing': 'Showing: {kind}',
    'snippets.kind.all': 'Everything',
    'snippets.kind.command': 'Commands only',
    'snippets.kind.package': 'Packages only',

    /* ---------------------------------------------------------------- *
     * Logs
     * ---------------------------------------------------------------- */
    'logs.blurbStart': 'Every connection made and every record changed on this machine, newest '
        + 'first. Recorded against the signed-in OS account',
    'logs.blurbEnd': ', and tagged on the row only when it was somebody else. Passwords and key '
        + 'material are never recorded.',
    'logs.categoryConnection': 'Connections',
    'logs.categoryData': 'Changes',
    'logs.categoryFiles': 'Files',
    'logs.categorySecurity': 'Security',
    'logs.empty': 'Nothing recorded yet',
    'logs.emptyNote': 'Connections and changes appear here as you make them.',
    'logs.export': 'Export as JSON',
    'logs.filterAll': 'All',
    'logs.filterAria': 'Filter the activity log',
    'logs.noMatches': 'Nothing matches those filters',
    'logs.noMatchesNote': 'Try another category, or clear the filter box.',
    'logs.problemsOnly': 'Problems only',
    'logs.reading': 'Reading the log…',
    'logs.refresh': 'Refresh',

    /* ---------------------------------------------------------------- *
     * New session tab
     * ---------------------------------------------------------------- */
    'newTab.title': 'New Session',
    'newTab.subtitle': 'Pick a host, or type an address to connect straight to it.',
    'newTab.searchPlaceholder': 'Search hosts, or type an address…',
    'newTab.recent': 'Recent',
    'newTab.allHosts': 'All hosts',
    'newTab.notSaved': 'Not saved',
    'newTab.notSavedNote': 'Not saved. It asks for the login as it connects.',
    'newTab.connectTo': 'Connect to',
    'newTab.hintNavigate': 'navigate',
    'newTab.hintConnect': 'connect',
    'newTab.hintClose': 'close tab',

    /* ---------------------------------------------------------------- *
     * Title bar and the tab strip
     * ---------------------------------------------------------------- */
    'titleBar.reload': 'Reload',
    'titleBar.devTools': 'Developer Tools',
    'titleBar.minimize': 'Minimize',
    'titleBar.maximize': 'Maximize',
    'titleBar.exit': 'Exit',
    'titleBar.rename': 'Rename…',
    'titleBar.renameAria': 'Rename {name}',
    'titleBar.renameGroup': 'Rename group…',
    'titleBar.renameGroupAria': 'Rename group {name}',
    'titleBar.useHostName': 'Use the host name again',
    'titleBar.colour': 'Colour',
    'titleBar.removeFromGroup': 'Remove from group',
    'titleBar.newGroup': 'New group from this tab',
    'titleBar.moveToGroup': 'Move to “{group}”',
    'titleBar.duplicate': 'Duplicate',
    'titleBar.reconnect': 'Reconnect',
    'titleBar.reconnectAll': 'Reconnect all',
    'titleBar.disconnect': 'Disconnect',
    'titleBar.disconnectAll': 'Disconnect all',
    'titleBar.closeTab': 'Close tab',
    'titleBar.closeOthers': 'Close others',
    'titleBar.closeRight': 'Close to the right',
    'titleBar.ungroup': 'Ungroup',
    'titleBar.closeGroupTabs_one': 'Close the tab',
    'titleBar.closeGroupTabs_other': 'Close all {count} tabs',

    /* ---------------------------------------------------------------- *
     * Reachability monitoring, shared by the settings page and host cards
     * ---------------------------------------------------------------- */
    'monitor.every30s': '30s',
    'monitor.every1min': '1 min',
    'monitor.every5min': '5 min',
    'monitor.every15min': '15 min',
    'monitor.wait5s': '5s',
    'monitor.wait10s': '10s',
    'monitor.wait20s': '20s',
    'monitor.wait30s': '30s',
    'monitor.onceFailed': 'Once',
    'monitor.twiceFailed': 'Twice',
    'monitor.thriceFailed': '3 times',
    'monitor.stateOnline': 'Answering',
    'monitor.stateOffline': 'Not answering',
    'monitor.stateProblem': 'Cannot check',
    'monitor.stateUnknown': 'Not checked yet',
    'monitor.unsupportedSerial': 'A serial console has no network address to check.',
    'monitor.unsupportedJump': 'This host is reached through a jump host, so there is no route to '
        + 'it from this machine to check. Watch the jump host instead.',
    'monitor.justNow': 'just now',
    'monitor.minutesAgo': '{count} min ago',
    'monitor.hoursAgo': '{count} h ago',
    'monitor.daysAgo': '{count} d ago',
    'monitor.notAnswering': 'not answering',
    'monitor.describeOffline': '{reason}, since {when}',
    'monitor.describeOnline': 'answered, checked {when}',
    'monitor.describeOnlineLatency': 'answered in {latency} ms, checked {when}',
    'monitor.describeUnknown': 'not checked yet',

    /* ---------------------------------------------------------------- *
     * The app palette editor
     * ---------------------------------------------------------------- */
    'appColors.subtitle': 'The six surfaces the app is built from. Pick the window colour and the '
        + 'rest follows, or set every step yourself.',
    'appColors.surfaces': 'Surfaces',
    'appColors.derive': 'Build from one colour',
    'appColors.deriveHint': 'Rewrites all six steps, keeping the app’s spacing between them',
    'appColors.base': 'Window',
    'appColors.baseHint': 'What the whole shell sits on',
    'appColors.raised': 'Panels',
    'appColors.raisedHint': 'Cards, dialogs, the sidebar',
    'appColors.control': 'Controls',
    'appColors.controlHint': 'Buttons, inputs and their borders',
    'appColors.hover': 'Hover',
    'appColors.hoverHint': 'A control under the pointer',
    'appColors.active': 'Pressed',
    'appColors.activeHint': 'A control being used, and rules',
    'appColors.muted': 'Muted text',
    'appColors.mutedHint': 'Secondary labels and placeholders',

    /* ---------------------------------------------------------------- *
     * The terminal palette editor
     * ---------------------------------------------------------------- */
    'termColors.title': 'Custom Terminal Theme',
    'termColors.subtitle': 'Pick every color yourself, or start from a built-in theme and change '
        + 'what you want.',
    'termColors.groupBase': 'Base',
    'termColors.groupAnsi': 'ANSI Colors',
    'termColors.background': 'Background',
    'termColors.foreground': 'Text',
    'termColors.cursor': 'Cursor',
    'termColors.selection': 'Selection',
    'termColors.black': 'Black',
    'termColors.red': 'Red',
    'termColors.green': 'Green',
    'termColors.yellow': 'Yellow',
    'termColors.blue': 'Blue',
    'termColors.magenta': 'Magenta',
    'termColors.cyan': 'Cyan',
    'termColors.white': 'White',

    /* ---------------------------------------------------------------- *
     * Importing from OpenSSH
     * ---------------------------------------------------------------- */
    'import.title': 'From OpenSSH',
    'import.desc': 'Read ~/.ssh/config and ~/.ssh/known_hosts and bring the hosts, their port '
        + 'forwards and their trusted keys in here.',
    'import.nothingFound': 'Nothing found in {dir}. You can still pick a file.',
    'import.scan': 'Scan ~/.ssh',
    'import.scanning': 'Scanning…',
    'import.scanFailed': 'Could not read the SSH config: {reason}',
    'import.chooseConfigTitle': 'Choose an SSH config file',
    'import.trustedKeys': 'Trusted host keys',
    'import.statusPresent': 'already added',
    'import.statusConflict': 'differs from stored key',
    'import.selectedOf': '{selected} of {count} selected',
    'import.keyNote': 'key {name}',
    'import.keyNoteState': 'key {name} ({state})',
    'import.included': '+{count} included',
    'import.nothingToImport': 'Nothing to import from these files.',
    'import.copyKeys': 'Copy the private keys these hosts reference',
    'import.copyKeysDesc': 'Each IdentityFile is read into the keychain and encrypted with the OS '
        + 'keystore. Without this, imported hosts are set to use your SSH agent instead.',
    'import.importing': 'Importing…',
    'import.importSelected': 'Import {count} selected',
    'import.nothingSelected': 'Nothing selected',
    'import.imported': 'Imported {what}',
    'import.nothingNew': 'Nothing new to import',
    'import.failed': 'Import failed: {reason}',
    'import.hostKeyCount_one': '{count} host key',
    'import.hostKeyCount_other': '{count} host keys',
    'import.report': 'Imported {hosts} hosts, {keys} keys, {hostKeys} host keys.',
    'import.reportSkipped': '{count} already present.',
    'import.reportRelayed': '{count} set to connect through a jump host.',
    'import.skipHashed': '{count} hashed',
    'import.skipPatterns': '{count} wildcard',
    'import.skipMarkers': '{count} certificate/revoked',
    'import.skipMalformed': '{count} unreadable',
    'import.skipped': '{what} skipped',

    /* ---------------------------------------------------------------- *
     * Importing from other terminals
     * ---------------------------------------------------------------- */
    'appImport.title': 'From other apps',
    'appImport.desc': 'Hosts, port forwards, folders and serial or desktop settings come across. '
        + 'Passwords stay behind; each app keeps those encrypted with its own scheme.',
    'appImport.checking': 'Checking…',
    'appImport.notFound': 'Not found',
    'appImport.sessionCount_one': '{count} saved session',
    'appImport.sessionCount_other': '{count} saved sessions',
    'appImport.import': 'Import',
    'appImport.chooseFile': 'Choose a MobaXterm file…',
    'appImport.choosePortable': 'Portable install? Choose a MobaXterm file…',
    'appImport.chooseFileHint': 'A portable MobaXterm.ini, or a .mxtsessions export',
    'appImport.chooseFileTitle': 'Choose a MobaXterm.ini or .mxtsessions file',
    'appImport.fileKind': 'MobaXterm sessions',
    'appImport.scanFailed': 'Could not read the {source} sessions: {reason}',
    'appImport.sessionsOf': '{app} sessions',
    'appImport.nothingIn': 'Nothing importable in {app}.',
    'appImport.inFolder': 'in {folder}',
    'appImport.keyEncrypted': 'passphrase-protected',
    'appImport.keyNeedsConversion': 'needs conversion',
    'appImport.keyUnreadable': 'unreadable',
    'appImport.copyKeysDesc': 'Each key file is read into the keychain and encrypted with the OS '
        + 'keystore. Without this, imported hosts are set to use your SSH agent instead.',
    'appImport.report': 'Imported {hosts} hosts',

    /* ---------------------------------------------------------------- *
     * Settings: the category list
     * ---------------------------------------------------------------- */
    'settings.nav.aria': 'Settings categories',
    'settings.nav.general': 'General',
    'settings.nav.appearance': 'Appearance',
    'settings.nav.terminal': 'Terminal',
    'settings.nav.assistant': 'Assistant',
    'settings.nav.monitoring': 'Monitoring',
    'settings.nav.logging': 'Logging',
    'settings.nav.security': 'Security',
    'settings.nav.account': 'Account',
    'settings.nav.backup': 'Backup',
    'settings.nav.about': 'About',

    /* ---------------------------------------------------------------- *
     * Settings: General
     * ---------------------------------------------------------------- */
    'settings.general.title': 'General',
    'settings.general.desc': 'How the app behaves when it starts.',
    'settings.general.language': 'Language',
    'settings.general.languageDesc': 'The language the app’s own text is shown in. Terminal output '
        + 'and anything your servers print is left exactly as it arrives.',
    'settings.general.languageChanged': 'Language changed to {language}',
    'settings.general.startup': 'Start at login',
    'settings.general.startupDesc': 'Open CloudTerm automatically when you sign in to this computer',
    'settings.general.startupOn': 'CloudTerm will open when you sign in',
    'settings.general.startupOff': 'CloudTerm will no longer open when you sign in',
    'settings.general.startupFailed': 'That could not be changed',
    'settings.general.startupUnknown': 'Could not read whether the app starts at boot',
    'settings.general.restore': 'Restore sessions',
    'settings.general.restoreDesc': 'Reopen the tabs that were open when the app closed and '
        + 'reconnect to their hosts',

    /* ---------------------------------------------------------------- *
     * Settings: Appearance
     * ---------------------------------------------------------------- */
    'settings.appearance.title': 'Appearance',
    'settings.appearance.desc': 'How the app itself looks.',
    'settings.appearance.theme': 'Theme',
    'settings.appearance.themeDesc': 'Select your preferred interface theme',
    'settings.appearance.themeCustomDesc': 'The app is using your own palette. Pick one to start '
        + 'from below, or set every color yourself.',
    'settings.appearance.theme.light': 'Light',
    'settings.appearance.theme.dark': 'Dark',
    'settings.appearance.theme.system': 'System',
    'settings.appearance.theme.custom': 'Custom',
    'settings.appearance.themeToast.light': 'Light Mode',
    'settings.appearance.themeToast.dark': 'Dark Mode',
    'settings.appearance.themeToast.system': 'System',
    'settings.appearance.themeToast.custom': 'Custom',
    'settings.appearance.themeChanged': 'Theme changed to {theme}',
    'settings.appearance.appColors': 'App Colors',
    'settings.appearance.appColorsDesc': 'A palette to start from. Every surface in the app is '
        + 'drawn from it.',
    'settings.appearance.appColorsChanged': 'App colors changed to {palette}',
    'settings.appearance.yours': 'Yours',
    'settings.appearance.customColors': 'Custom Colors',
    'settings.appearance.customColorsDesc': 'Set the window, panel, control and text colors yourself',
    'settings.appearance.editColors': 'Edit colors',
    'settings.appearance.colorsApplied': 'App colors applied',
    'settings.appearance.showLogo': 'Show the logo',
    'settings.appearance.showLogoDesc': 'The mark in the title bar. Turning it off gives the tab '
        + 'strip the space instead.',
    'settings.appearance.showLogoAria': 'Show the logo in the title bar',
    'settings.appearance.logoShown': 'Logo shown',
    'settings.appearance.logoHidden': 'Logo hidden',
    'settings.appearance.customLogo': 'Custom logo',
    'settings.appearance.customLogoSet': 'Your own image, in place of the CloudBlast mark.',
    'settings.appearance.customLogoDesc': 'Use your own image instead of the CloudBlast mark. PNG, '
        + 'JPG, GIF, WebP, SVG, BMP or ICO, up to 512 KB.',
    'settings.appearance.choosing': 'Choosing…',
    'settings.appearance.chooseImage': 'Choose image',
    'settings.appearance.logoUnreadable': 'That image could not be read',
    'settings.appearance.logoSet': 'Logo set to {name}',
    'settings.appearance.logoCleared': 'Back to the CloudBlast mark',
    'settings.appearance.position': 'Position',
    'settings.appearance.positionDesc': 'Which end of the title bar the mark sits at: beside the '
        + 'menu button, or over by the window buttons.',
    'settings.appearance.positionAria': 'Logo position',
    'settings.appearance.logoMovedLeft': 'Logo moved left',
    'settings.appearance.logoMovedRight': 'Logo moved right',

    /* ---------------------------------------------------------------- *
     * Settings: Terminal
     * ---------------------------------------------------------------- */
    'settings.terminal.title': 'Terminal',
    'settings.terminal.desc': 'How the shell looks inside a session, and what is kept of it.',
    'settings.terminal.font': 'Font',
    'settings.terminal.fontAria': 'Terminal font',
    'settings.terminal.fontDesc': 'Only faces this machine actually has are listed. JetBrains Mono '
        + 'ships with the app.',
    'settings.terminal.fontMissing': 'This font is no longer installed on this machine, so the '
        + 'terminal has fallen back to JetBrains Mono.',
    'settings.terminal.fontBundled': 'bundled',
    'settings.terminal.fontNotInstalled': 'not installed',
    'settings.terminal.size': 'Size',
    'settings.terminal.sizeAria': 'Font size',
    'settings.terminal.sizeDesc': 'Applies to every open session. Each one refits and tells the '
        + 'remote its new window size.',
    'settings.terminal.weight': 'Weight',
    'settings.terminal.weightAria': 'Font weight',
    'settings.terminal.weightDesc': 'Bold keeps its contrast: it is drawn 300 heavier than whatever '
        + 'is set here.',
    'settings.terminal.lineHeight': 'Line height',
    'settings.terminal.lineHeightAria': 'Line height',
    'settings.terminal.lineHeightDesc': 'A multiple of the font size. Taller lines cost rows, which '
        + 'the remote is told about.',
    'settings.terminal.letterSpacing': 'Letter spacing',
    'settings.terminal.letterSpacingAria': 'Letter spacing',
    'settings.terminal.letterSpacingDesc': 'Added to every cell. Negative tightens a face that sets '
        + 'too loose for a terminal.',
    'settings.terminal.ligatures': 'Ligatures',
    'settings.terminal.ligaturesDesc': 'Draws pairs like -> and != as one glyph. Turns off GPU '
        + 'rendering, which cannot draw them, so a very busy session may scroll less smoothly.',
    'settings.terminal.ligaturesNone': '{font} has no ligatures, so this will not change anything. '
        + 'JetBrains Mono, Cascadia Code and Fira Code have them.',
    'settings.terminal.thisFont': 'This font',
    'settings.terminal.cursor': 'Cursor',
    'settings.terminal.cursorAria': 'Cursor style',
    'settings.terminal.cursorDesc': 'What the caret looks like where the shell is waiting.',
    'settings.terminal.cursor.bar': 'Bar',
    'settings.terminal.cursor.block': 'Block',
    'settings.terminal.cursor.underline': 'Underline',
    'settings.terminal.blink': 'Blink the cursor',
    'settings.terminal.scrollback': 'Scrollback',
    'settings.terminal.scrollbackAria': 'Scrollback lines',
    'settings.terminal.scrollbackDesc': 'Lines kept above the top of the window, per session. '
        + 'Find-in-scrollback searches all of them, and every line costs memory in this window '
        + 'rather than on the server.',
    'settings.terminal.links': 'Opening links',
    'settings.terminal.linksDesc': 'A URL printed in the session is clickable and opens in your '
        + 'browser. Asking for {modifier} as well is what editors do: it stops a click meant for '
        + 'the text under a URL from throwing a browser at the screen mid-session.',
    'settings.terminal.link.click': 'Click',
    'settings.terminal.link.modifier': '{modifier} + click',
    'settings.terminal.reset': 'Back to the defaults',
    'settings.terminal.resetAlready': 'Everything above is already at its default.',
    'settings.terminal.resetDesc': 'Resets the font, spacing, cursor, scrollback and link clicking. '
        + 'Leaves the colour scheme alone.',
    'settings.terminal.resetDone': 'Terminal type reset',
    'settings.terminal.colors': 'Terminal Colors',
    'settings.terminal.colorsDesc': 'Choose a color scheme for your terminal, or build your own',
    'settings.terminal.custom': 'Custom',
    'settings.terminal.customTheme': 'Custom Theme',
    'settings.terminal.customThemeDesc': 'Set your own background, text, cursor and ANSI colors',
    'settings.terminal.themeChanged': 'Terminal theme changed to {theme}',
    'settings.terminal.customApplied': 'Custom terminal theme applied',

    /* ---------------------------------------------------------------- *
     * Settings: Assistant
     * ---------------------------------------------------------------- */
    'settings.assistant.title': 'Assistant',
    'settings.assistant.desc': 'The assistant reads your terminals and works on your servers '
        + 'through the connections you have already opened. It never sees a stored password or key.',
    'settings.assistant.loading': 'Loading the assistant settings...',
    'settings.assistant.agent': 'Agent',
    'settings.assistant.agentDesc': 'Which coding agent answers, using the copy already installed '
        + 'on this machine. Switching starts a fresh conversation.',
    'settings.assistant.provider.claudeCode': 'Uses the Claude Code already installed and signed in '
        + 'on this machine.',
    'settings.assistant.provider.codex': 'Uses the Codex CLI installed on this machine.',
    'settings.assistant.provider.opencode': 'Uses the OpenCode CLI and providers configured on this '
        + 'machine.',
    'settings.assistant.provider.unavailable': 'Not available in this build yet.',
    'settings.assistant.commandMode': 'Where commands run',
    'settings.assistant.commandMode.terminal': 'In my terminal',
    'settings.assistant.commandMode.background': 'Out of sight',
    'settings.assistant.commandMode.terminal.note': 'Commands are typed into the session you are '
        + 'looking at, so you watch them run and the output stays in your scrollback. They go into '
        + 'that shell’s history, and the assistant reads the result off the screen rather than '
        + 'getting an exit code.',
    'settings.assistant.commandMode.background.note': 'Commands run on a separate channel you '
        + 'cannot see. Tidier, and the assistant gets a real exit code and clean output, but you '
        + 'are taking its word for what happened.',
    'settings.assistant.approval': 'Ask before running',
    'settings.assistant.approval.always': 'Every action',
    'settings.assistant.approval.writes': 'Changes only',
    'settings.assistant.approval.never': 'Never',
    'settings.assistant.approval.always.note': 'Every tool call waits for you, including reading a '
        + 'file or the terminal. Thorough, but a long investigation becomes a lot of clicking.',
    'settings.assistant.approval.writes.note': 'Reading runs freely. Anything that changes a system '
        + 'stops and shows you the exact command and the host it would run on.',
    'settings.assistant.approval.never.note': 'Nothing stops for approval, including commands that '
        + 'delete data or restart services. Only sensible for hosts you can afford to break.',
    'settings.assistant.localTools': 'Allow tools on this computer',
    'settings.assistant.localToolsDesc': 'Lets the assistant read and write local files and run '
        + 'local commands. Off by default: the panel is for managing servers, and your own machine '
        + 'is a far wider surface than that needs.',
    'settings.assistant.allowList': 'Commands that never need approval',
    'settings.assistant.allowListDesc': 'One per line, matched on the whole first words. A command '
        + 'containing a pipe, a redirect, a semicolon, a substitution or a second line is always '
        + 'asked about, whatever it starts with.',
    'settings.assistant.allowListNote': 'Only applies while approvals are set to "{mode}".',
    'settings.assistant.blockList': 'Commands it may never run',
    'settings.assistant.blockListDesc': 'One per line. These are refused outright rather than asked '
        + 'about, in every approval mode including "Never", and whether the assistant runs them on '
        + 'their own channel or types them into your terminal. Flags count: "rm -rf" also stops '
        + '"rm -fr", "rm -r -f" and "sudo /bin/rm --recursive --force".',
    'settings.assistant.blockListEmpty': 'Clear the box to block nothing.',
    'settings.assistant.blockListWarning': 'A guardrail against mistakes, not a security control. A '
        + 'shell has too many ways to spell the same command for any list to catch them all, so '
        + 'keep approvals on for anything that matters.',
    'settings.assistant.saveList': 'Save list',
    'settings.assistant.restoreDefaults': 'Restore defaults',
    'settings.assistant.quickPrompts': 'Quick prompts',
    'settings.assistant.quickPromptsDesc': 'Questions the panel offers as one-click buttons when a '
        + 'conversation is empty. One per line. Nothing is set up to begin with, because the ones '
        + 'worth having are the ones you find yourself asking your own machines every week.',
    'settings.assistant.quickPromptsPlaceholder': 'What is filling up the disk?\n'
        + 'Why did the last deploy fail?',
    'settings.assistant.quickPromptsNote': 'Up to 12. Clicking one puts it in the box rather than '
        + 'sending it, so you can add to it first.',
    'settings.assistant.savePrompts': 'Save prompts',
    'settings.assistant.steps': 'Steps per turn',
    'settings.assistant.stepsDesc': 'How many tool calls one question may take before the assistant '
        + 'stops and reports back. A run that is not converging ends on its own rather than when '
        + 'you notice.',
    'settings.assistant.lines': 'Terminal lines it can read',
    'settings.assistant.linesDesc': 'How much of a session’s recent output one read returns. Higher '
        + 'gives it more context to work from and uses more of the conversation’s budget.',
    'settings.assistant.signIn': 'Signing in',
    'settings.assistant.theAgent': 'the agent',
    'settings.assistant.accountOpencode': 'OpenCode uses the providers and credentials already '
        + 'configured in its CLI. Manage them with "opencode auth login"; keys stored in CloudBlast '
        + 'are not passed to OpenCode.',
    'settings.assistant.accountPlan': 'Signed in through {agent} on this machine, on a {plan} plan. '
        + 'Usage comes out of that plan, so no key is needed here.',
    'settings.assistant.accountProvider': '{agent} on this machine is set up against {provider}, '
        + 'which handles its own credentials. Nothing is needed here.',
    'settings.assistant.accountAgentKey': '{agent} on this machine is using an API key, so usage is '
        + 'charged per token.',
    'settings.assistant.accountStoredKey': 'A key is stored here and will be used. Clear the box '
        + 'and save to remove it and fall back to the {agent} login.',
    'settings.assistant.accountNone': 'Nothing to do if you are already signed in to {agent} on '
        + 'this machine, which is the usual case. A key is only needed when you are not.',
    'settings.assistant.apiKey': 'API key',
    'settings.assistant.keyStored': 'A key is stored',
    'settings.assistant.keySaved': 'Key saved.',
    'settings.assistant.keyRemoved': 'Key removed.',
    'settings.assistant.keyFailed': 'That key could not be saved.',
    'settings.assistant.noSecureStore': 'This system has no secure store available, so a key cannot '
        + 'be saved here.',
    'settings.assistant.tools': 'What it can do',
    'settings.assistant.toolsDesc': '{count} tools, of which {readOnly} only read. The rest are '
        + 'subject to the approval setting above.',

    /* ---------------------------------------------------------------- *
     * Settings: Monitoring
     * ---------------------------------------------------------------- */
    'settings.monitoring.title': 'Monitoring',
    'settings.monitoring.desc': 'Check that hosts are still reachable while the app is open, and '
        + 'get a notification when one stops answering. It takes two switches: this page turns the '
        + 'feature on, and each host you want watched is switched on in its own editor.',
    'settings.monitoring.unreadable': 'Monitoring could not be read from the app. Restart CloudTerm '
        + 'and open this page again.',
    'settings.monitoring.saveFailed': 'Could not save that setting',
    'settings.monitoring.checkFailed': 'Could not check the hosts',
    'settings.monitoring.master': 'Watch hosts for outages',
    'settings.monitoring.masterDesc': 'The master switch. Hosts are watched one at a time rather '
        + 'than all at once, so this on its own checks nothing: each host you want watched is '
        + 'switched on in its own editor, under Monitoring.',
    'settings.monitoring.interval': 'How often',
    'settings.monitoring.intervalDesc': 'Every watched host is checked on this interval. A check is '
        + 'a single connection that is closed the moment it opens, so this is cheap even on a long '
        + 'host list.',
    'settings.monitoring.timeout': 'How long to wait',
    'settings.monitoring.timeoutDesc': 'A host that has not accepted the connection within this has '
        + 'failed the check. Worth raising for something on the far side of a VPN.',
    'settings.monitoring.failures': 'Before calling it offline',
    'settings.monitoring.failuresDesc': 'How many checks in a row have to fail. On wifi, leave this '
        + 'at two or more: a single dropped packet is not a server going down, and being told that '
        + 'it is, once a minute, is how a notification stops being read.',
    'settings.monitoring.notify': 'Notify me when a host goes offline',
    'settings.monitoring.notifyDesc': 'A desktop notification, once, when a host crosses from '
        + 'answering to not. Turn this off to keep the states on the host cards and the bell '
        + 'without being interrupted by them.',
    'settings.monitoring.notifyBack': 'And when it comes back',
    'settings.monitoring.notifyBackDesc': 'A second notification when a host that was down starts '
        + 'answering again, saying how long it was gone for.',
    'settings.monitoring.list': 'What is being watched',
    'settings.monitoring.checkNow': 'Check now',
    'settings.monitoring.checking': 'Checking…',
    'settings.monitoring.noneWatched': 'Watching is switched on per host, in the host editor.',
    'settings.monitoring.watched_one': '{count} host.',
    'settings.monitoring.watched_other': '{count} hosts.',
    'settings.monitoring.watchedButOff_one': '{count} host set up, and nothing checking it while '
        + 'the switch above is off.',
    'settings.monitoring.watchedButOff_other': '{count} hosts set up, and nothing checking them '
        + 'while the switch above is off.',
    'settings.monitoring.watchedWithOffline_one': '{count} host, {offline} not answering.',
    'settings.monitoring.watchedWithOffline_other': '{count} hosts, {offline} not answering.',
    'settings.monitoring.emptyList': 'No hosts are being watched yet.',
    'settings.monitoring.emptyListHow': 'Open a host from the Hosts page, find Monitoring under '
        + 'Optional, and switch on “Watch this host”.',
    'settings.monitoring.noNetwork': 'This machine has no network connection, so nothing is being '
        + 'checked and nothing has been reported offline.',
    'settings.monitoring.allFailed': 'Every host failed the last check at the same moment, which is '
        + 'usually this machine rather than all of them. Those results were discarded and nothing '
        + 'was reported.',
    'settings.monitoring.lastChecked': 'Last checked {when}.',

    /* ---------------------------------------------------------------- *
     * Settings: Logging
     * ---------------------------------------------------------------- */
    'settings.logging.title': 'Logging',
    'settings.logging.desc': 'Write what each session showed to a file, and decide which sessions '
        + 'are recorded and how long the files are kept.',
    'settings.logging.saveFailed': 'Could not save that setting',
    'settings.logging.folderFailed': 'Could not use that folder',
    'settings.logging.folderChanged': 'Session logs will go there from now on',
    'settings.logging.openFailed': 'Could not open that folder',
    'settings.logging.revealFailed': 'Could not find that log',
    'settings.logging.recordAll': 'Record every session',
    'settings.logging.recordAllDesc': 'Write what the server prints to a file, for every session as '
        + 'it opens. A single session can always be recorded on its own from its header, without '
        + 'turning this on.',
    'settings.logging.whichSessions': 'Which sessions',
    'settings.logging.whichSessionsDesc': 'What kinds of session the switch above records. '
        + 'Recording one session from its own header ignores this list.',
    'settings.logging.format': 'What to write',
    'settings.logging.formatDesc': 'Readable strips the colour and cursor codes, which is what '
        + 'makes a log greppable. Verbatim keeps every byte, for replaying it through a terminal '
        + 'later.',
    'settings.logging.formatPlain': 'Readable',
    'settings.logging.formatRaw': 'Verbatim',
    'settings.logging.timestamps': 'Stamp each line with the time',
    'settings.logging.timestampsDesc': 'Prefixes every line with the local time it arrived.',
    'settings.logging.timestampsUnavailable': 'Not available for verbatim logs: a timestamp in the '
        + 'middle of an escape sequence would corrupt it.',
    'settings.logging.retention': 'How long to keep them',
    'settings.logging.retentionDesc': 'Older transcripts are deleted, at launch and as sessions '
        + 'open. One still being written is never touched, whatever its age.',
    'settings.logging.forever': 'Forever',
    'settings.logging.days_one': '{count} day',
    'settings.logging.days_other': '{count} days',
    'settings.logging.cap': 'Cap the folder size',
    'settings.logging.capDesc': 'Once the folder grows past this, the oldest transcripts are '
        + 'deleted first until it fits again.',
    'settings.logging.noCap': 'No cap',
    'settings.logging.folder': 'Where they go',
    'settings.logging.folderDesc': 'Logs hold whatever was on screen, which for a session that ran '
        + 'a password manager or printed a token is as sensitive as the credentials themselves. '
        + 'Keep them somewhere you would keep those.',
    'settings.logging.openFolder': 'Open the folder',
    'settings.logging.defaultFolder': 'Back to the default folder',
    'settings.logging.showInFolder': 'Show in folder',

    /* ---------------------------------------------------------------- *
     * Settings: Security
     * ---------------------------------------------------------------- */
    'settings.security.title': 'Security',
    'settings.security.desc': 'Who can open this app, and which servers it trusts.',

    'settings.lock.title': 'Opening password',
    'settings.lock.badgeOn': 'on',
    'settings.lock.descOn': 'Asked for every time the app opens. Your saved passwords, keys and '
        + 'passphrases are encrypted with it, so the stored file is unreadable without it.',
    'settings.lock.descOff': 'Require a password to open the app, and encrypt your saved passwords, '
        + 'keys and passphrases with it.',
    'settings.lock.warnOn': 'There is no recovery. If you forget this password the saved '
        + 'credentials cannot be read back.',
    'settings.lock.warnOff': 'Without it, credentials are protected only by the OS keystore, which '
        + 'means anyone signed in as you can read them.',
    'settings.lock.lockNow': 'Lock now',
    'settings.lock.setPassword': 'Set password',
    'settings.lock.changePassword': 'Change password',
    'settings.lock.removePassword': 'Remove password',
    'settings.lock.currentPassword': 'Current password',
    'settings.lock.password': 'Password',
    'settings.lock.newPassword': 'New password',
    'settings.lock.confirmPassword': 'Confirm password',
    'settings.lock.mismatch': 'The two passwords do not match',
    'settings.lock.failed': 'That did not work',
    'settings.lock.passwordSet': 'Opening password set',
    'settings.lock.passwordChanged': 'Password changed',
    'settings.lock.passwordRemoved': 'Opening password removed',
    'settings.lock.acknowledge': 'I understand this password cannot be recovered',
    'settings.lock.acknowledgeDesc': 'Your saved passwords, keys and passphrases are encrypted with '
        + 'it. Forget it and they cannot be read back, by this app or anything else.',
    'settings.lock.confirmTitle': 'Lock the app now?',
    'settings.lock.confirmMessage': 'Every open session will be disconnected, and the password will '
        + 'be needed to get back in.',
    'settings.lock.confirmAction': 'Lock',

    'settings.knownHosts.title': 'Known hosts',
    'settings.knownHosts.desc': 'Server keys you have trusted. Forget one to be asked about it '
        + 'again, which you need if a server was legitimately rebuilt.',
    'settings.knownHosts.unknownType': 'unknown',
    'settings.knownHosts.copy': 'Copy fingerprint',
    'settings.knownHosts.copied': 'Fingerprint copied',
    'settings.knownHosts.forget': 'Forget',
    'settings.knownHosts.forgetKey': 'Forget this key',
    'settings.knownHosts.keyCount_one': '{count} key',
    'settings.knownHosts.keyCount_other': '{count} keys',
    'settings.knownHosts.empty': 'No host keys trusted yet',
    'settings.knownHosts.emptyNote': 'The first time you connect to a server, its key will be '
        + 'recorded here.',
    'settings.knownHosts.confirmTitle': 'Forget this host key?',
    'settings.knownHosts.confirmMessage': '{host} will be treated as a new host the next time you '
        + 'connect, and you will be asked to confirm its key again.',
    'settings.knownHosts.forgotHost': 'Forgot {host}',
    'settings.knownHosts.forgotKey': 'Forgot the {type} key for {host}',

    /* ---------------------------------------------------------------- *
     * Settings: Account
     * ---------------------------------------------------------------- */
    'settings.account.title': 'Account',
    'settings.account.fallbackName': 'CloudBlast account',
    'settings.account.yourAccount': 'your CloudBlast account',
    'settings.account.connectedAs': 'Connected as {account}',
    'settings.account.disconnect': 'Disconnect',
    'settings.account.disconnecting': 'Disconnecting…',
    'settings.account.disconnected': 'Account disconnected',
    'settings.account.disconnectedLocally': 'Signed out on this device, but the console could not '
        + 'be reached to revoke access. Remove the device from Settings → API.',
    'settings.account.connect': 'Connect your account',
    'settings.account.connectAction': 'Connect',
    'settings.account.connectDesc': 'Sync your servers and back up your setup.',
    'settings.account.unlockFirst': 'Unlock the app first.',
    'settings.account.waitingForBrowser': 'Waiting for browser…',
    'settings.account.syncServers': 'Sync my servers',
    'settings.account.syncServersDesc': 'Your CloudBlast servers appear in Hosts, ready to connect.',
    'settings.account.syncOn': 'Syncing your CloudBlast servers into Hosts',
    'settings.account.syncOff': 'Sync turned off. Hosts already added stay where they are.',
    'settings.account.syncNow': 'Sync now',
    'settings.account.syncing': 'Syncing…',
    'settings.account.syncedAgo': 'Synced {when}',
    'settings.account.notSyncedYet': 'Not synced yet',
    'settings.account.serverCount_one': '{count} server',
    'settings.account.serverCount_other': '{count} servers',
    'settings.account.serversSynced_one': '{count} server synced',
    'settings.account.serversSynced_other': '{count} servers synced',
    'settings.account.noServers': 'No servers on this account yet',
    'settings.account.cloudBackup': 'Cloud backup',
    'settings.account.cloudBackupDesc': 'Your hosts, folders, keys and settings, saved to your '
        + 'account for your other devices.',
    'settings.account.backupOn': 'Cloud backup is on',
    'settings.account.backupOff': 'Cloud backup is off. What is already saved stays until you '
        + 'replace it.',
    'settings.account.backedUp': 'Backed up to your CloudBlast account',
    'settings.account.saveNow': 'Save now',
    'settings.account.saving': 'Saving…',
    'settings.account.savedAgo': 'Saved {when}',
    'settings.account.notSavedYet': 'Not saved yet',
    'settings.account.justNow': 'just now',
    'settings.account.minutesAgo': '{count}m ago',
    'settings.account.hoursAgo': '{count}h ago',
    'settings.account.daysAgo': '{count}d ago',

    /* ---------------------------------------------------------------- *
     * Settings: Backup
     * ---------------------------------------------------------------- */
    'settings.backup.title': 'Backup',
    'settings.backup.desc': 'Bring an existing setup in, or take a copy out.',
    'settings.backup.exportTitle': 'Export a backup',
    'settings.backup.exportDesc': 'Writes every host, folder, SSH key, snippet, port forward and '
        + 'trusted host key to a single encrypted file, protected by a passphrase you choose here.',
    'settings.backup.exportNote': 'The passphrase is independent of your opening password, so the '
        + 'file opens on a machine that has never seen this one.',
    'settings.backup.create': 'Create backup',
    'settings.backup.passphrase': 'Backup passphrase',
    'settings.backup.confirmPassphrase': 'Confirm passphrase',
    'settings.backup.tooShort': 'Use at least {count} characters',
    'settings.backup.mismatch': 'The two passphrases do not match',
    'settings.backup.acknowledge': 'I understand this file contains my saved credentials',
    'settings.backup.acknowledgeDesc': 'Anyone who has both the file and this passphrase can read '
        + 'every stored password, private key and passphrase in it. Keep it somewhere you would '
        + 'keep the credentials themselves.',
    'settings.backup.chooseLocation': 'Choose location…',
    'settings.backup.exportFailed': 'The backup could not be written',
    'settings.backup.exported': 'Backup saved: {hosts}, {keys}, {snippets}',
    'settings.backup.restoreTitle': 'Restore a backup',
    'settings.backup.restoreDesc': 'Reads a .cbbackup file and adds what it holds. You are shown '
        + 'what is in it before anything changes.',
    'settings.backup.restoreNote': 'Anything already here is left alone by default, so restoring '
        + 'twice is safe.',
    'settings.backup.chooseFile': 'Choose file…',
    'settings.backup.openTitle': 'Open encrypted backup',
    'settings.backup.fileKind': 'CloudBlast backup',
    'settings.backup.pickerFailed': 'Could not open the file picker',
    'settings.backup.file': 'File',
    'settings.backup.open': 'Open backup',
    'settings.backup.opening': 'Opening…',
    'settings.backup.openFailed': 'That backup could not be opened',
    'settings.backup.from': 'Backup from {when}',
    'settings.backup.unknownDate': 'an unknown date',
    'settings.backup.appVersion': 'app {version}',
    'settings.backup.emptyFile': 'This backup is empty.',
    'settings.backup.folders': 'Folders',
    'settings.backup.keys': 'SSH keys',
    'settings.backup.newCount': '{count} new',
    'settings.backup.existingReplaced': '{count} already here, will be replaced',
    'settings.backup.existingSkipped': '{count} already here, will be skipped',
    'settings.backup.trustedKeys': 'Trusted keys',
    'settings.backup.hostWord_one': 'host',
    'settings.backup.hostWord_other': 'hosts',
    'settings.backup.overwrite': 'Replace items that are already here',
    'settings.backup.overwriteDesc': 'Matches on the record’s id, not its name. Leave this off to '
        + 'add only what is missing; turn it on to make this machine match the backup, discarding '
        + 'local edits to those records.',
    'settings.backup.overwriteWarning': 'Local changes to the matching records will be lost.',
    'settings.backup.restore': 'Restore',
    'settings.backup.restoring': 'Restoring…',
    'settings.backup.restoreFailed': 'The restore did not finish',
    'settings.backup.restored_one': 'Restored {count} new item',
    'settings.backup.restored_other': 'Restored {count} new items',
    'settings.backup.restoredAndReplaced_one': 'Restored {count} new item, replaced {replaced}',
    'settings.backup.restoredAndReplaced_other': 'Restored {count} new items, replaced {replaced}',
    'settings.backup.duplicateKeys_one': '{count} host now trusts more than one key of the same '
        + 'type. Check Security, then Known hosts.',
    'settings.backup.duplicateKeys_other': '{count} hosts now trust more than one key of the same '
        + 'type. Check Security, then Known hosts.',

    /* ---------------------------------------------------------------- *
     * Settings: About
     * ---------------------------------------------------------------- */
    'settings.about.title': 'About',
    'settings.about.version': 'Version {version}',
    'settings.about.updates': 'Updates',
    'settings.about.checking': 'Checking for updates…',
    'settings.about.checkingShort': 'Checking…',
    'settings.about.checkNow': 'Check for updates',
    'settings.about.disabled': 'Update checks are turned off for this install.',
    'settings.about.ready': 'Version {version} is ready to install. Restart to finish.',
    'settings.about.downloading': 'Downloading the update…',
    'settings.about.downloadingVersion': 'Downloading version {version}…',
    'settings.about.available': 'Version {version} is available.',
    'settings.about.availableToDownload': 'Version {version} is available to download.',
    'settings.about.upToDate': 'Up to date. Last checked {when}.',
    'settings.about.neverChecked': 'Not checked yet.',
    'settings.about.restartToUpdate': 'Restart to update',
    'settings.about.download': 'Download {version}',
    'settings.about.noChecksLeft': 'No checks left this hour.',
    'settings.about.noChecksUntil': 'No checks left this hour, until {when}.',
    'settings.about.checksLeft_one': '{count} of {limit} check left this hour.',
    'settings.about.checksLeft_other': '{count} of {limit} checks left this hour.',
    'settings.about.noteInstall': 'Updates download in the background and install when you quit. '
        + 'Checking asks GitHub for the latest release and sends nothing about you or your machine.',
    'settings.about.noteNotify': 'Updates are not installed automatically. The download opens in '
        + 'your browser, where your system can check it. Checking asks GitHub for the latest '
        + 'release and sends nothing about you or your machine.',
};
