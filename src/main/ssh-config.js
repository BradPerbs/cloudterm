const fs = require('fs');
const path = require('path');
const os = require('os');
const { tunnelFromForward } = require('./tunnel-config');

/**
 * A reader for OpenSSH `ssh_config` files, scoped to what this app can act on.
 *
 * The parts of the format that matter here:
 *   - `Host pattern...` opens a block; a host takes settings from every block
 *     whose patterns match it, and the *first* value of a keyword wins.
 *   - `Include` pulls in more files, optionally through a glob. Tooling writes
 *     these constantly now (1Password, Colima, orbstack), so a parser that
 *     skips them misses most of a modern config.
 *   - `Match` blocks are conditional on things we cannot evaluate here
 *     (exec, originalhost, final). They are skipped, and reported as skipped.
 */

/** Include depth cap. OpenSSH's own limit is 16; nothing legitimate nests far. */
const MAX_INCLUDE_DEPTH = 8;

/** Keywords that accumulate rather than being overridden by the first value. */
const REPEATABLE = new Set([
    'identityfile',
    'localforward',
    'remoteforward',
    'dynamicforward',
]);

const FORWARD_TYPES = {
    localforward: 'local',
    remoteforward: 'remote',
    dynamicforward: 'dynamic',
};

const expandTilde = (value) =>
    (value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value);

/**
 * Split a directive's arguments on whitespace, honouring double quotes so a
 * path containing a space survives.
 */
function splitArgs(text) {
    const args = [];
    let current = '';
    let quoted = false;
    let started = false;

    for (const char of text) {
        if (char === '"') {
            quoted = !quoted;
            started = true;
            continue;
        }
        if (!quoted && (char === ' ' || char === '\t')) {
            if (started) {
                args.push(current);
                current = '';
                started = false;
            }
            continue;
        }
        current += char;
        started = true;
    }

    if (started) args.push(current);
    return args;
}

/**
 * Split a line into keyword and arguments. OpenSSH allows the keyword and its
 * first argument to be separated by whitespace, `=`, or both, but only there,
 * which is why this is not a blanket split on `=` (that would take `SetEnv
 * FOO=bar` apart).
 */
function parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)[ \t]*=?[ \t]*(.*)$/);
    if (!match) return null;

    return { keyword: match[1].toLowerCase(), args: splitArgs(match[2]) };
}

/** ssh_config globbing: `*` and `?` only, matched case-insensitively. */
function patternToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

const isConcrete = (pattern) => !/[*?!]/.test(pattern);

/** A block applies when some pattern matches and no negated pattern does. */
function blockMatches(patterns, name) {
    let matched = false;

    for (const pattern of patterns) {
        if (pattern.startsWith('!')) {
            if (patternToRegex(pattern.slice(1)).test(name)) return false;
        } else if (patternToRegex(pattern).test(name)) {
            matched = true;
        }
    }

    return matched;
}

/**
 * Resolve one `Include` to real files. Relative paths belong to `~/.ssh` for a
 * user config; the directory of the including file is tried as a fallback so a
 * config kept elsewhere still resolves its own neighbours.
 */
function resolveInclude(spec, baseDir, sshDir) {
    const raw = expandTilde(spec);
    const roots = path.isAbsolute(raw)
        ? [raw]
        : [path.join(sshDir, raw), path.join(baseDir, raw)];

    for (const candidate of roots) {
        const directory = path.dirname(candidate);
        const leaf = path.basename(candidate);
        const found = [];

        if (!/[*?]/.test(leaf)) {
            try {
                if (fs.statSync(candidate).isFile()) found.push(candidate);
            } catch {
                // Missing includes are not an error in ssh_config.
            }
        } else {
            let entries = [];
            try {
                entries = fs.readdirSync(directory).sort();
            } catch {
                entries = [];
            }

            const matcher = patternToRegex(leaf);
            for (const entry of entries) {
                if (!matcher.test(entry)) continue;
                const full = path.join(directory, entry);
                try {
                    if (fs.statSync(full).isFile()) found.push(full);
                } catch {
                    // Raced or unreadable; skip it.
                }
            }
        }

        if (found.length > 0) return found;
    }

    return [];
}

/**
 * Read one file into `context.blocks`, following includes in place so the
 * resulting block order matches the order OpenSSH would evaluate.
 */
function readFile(filePath, context, depth) {
    const resolved = path.resolve(filePath);

    if (depth > MAX_INCLUDE_DEPTH) {
        context.warnings.push(`Stopped at ${resolved}: includes nested more than ${MAX_INCLUDE_DEPTH} deep`);
        return;
    }
    if (context.visited.has(resolved)) return; // include cycle
    context.visited.add(resolved);

    let text;
    try {
        text = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
        context.warnings.push(`Could not read ${resolved}: ${error.message}`);
        return;
    }

    context.files.push(resolved);

    // Settings before the first `Host` are global, which is `Host *`.
    let current = { patterns: ['*'], settings: new Map(), source: resolved };
    context.blocks.push(current);

    for (const line of text.split(/\r?\n/)) {
        const parsed = parseLine(line);
        if (!parsed) continue;

        const { keyword, args } = parsed;

        if (keyword === 'host') {
            current = { patterns: args, settings: new Map(), source: resolved };
            context.blocks.push(current);
            continue;
        }

        if (keyword === 'match') {
            // Everything until the next Host/Match belongs to a condition we
            // cannot evaluate, so it is dropped rather than half-applied.
            current = { patterns: [], settings: new Map(), source: resolved, isMatch: true };
            context.blocks.push(current);
            context.matchBlocks += 1;
            continue;
        }

        if (keyword === 'include') {
            for (const spec of args) {
                for (const file of resolveInclude(spec, path.dirname(resolved), context.sshDir)) {
                    readFile(file, context, depth + 1);
                }
            }
            // An include does not end the block it sits in, but the included
            // blocks have to land ahead of whatever follows it. Continuing
            // into a fresh block with the same patterns preserves that order.
            const resumed = {
                patterns: current.patterns,
                settings: new Map(),
                source: resolved,
                isMatch: current.isMatch,
            };
            context.blocks.push(resumed);
            current = resumed;
            continue;
        }

        const existing = current.settings.get(keyword);
        if (existing) existing.push(args);
        else current.settings.set(keyword, [args]);
    }
}

/**
 * Collect every keyword that applies to `name`, in precedence order.
 * Returns a Map of keyword -> array of argument arrays.
 */
function settingsFor(blocks, name) {
    const resolved = new Map();

    for (const block of blocks) {
        if (block.isMatch || !blockMatches(block.patterns, name)) continue;

        for (const [keyword, occurrences] of block.settings) {
            const collected = resolved.get(keyword);
            if (!collected) resolved.set(keyword, [...occurrences]);
            else if (REPEATABLE.has(keyword)) collected.push(...occurrences);
            // Otherwise the earlier value stands: first wins.
        }
    }

    return resolved;
}

const firstValue = (settings, keyword) => settings.get(keyword)?.[0]?.[0] || '';

/** `%h` is the only token we can expand without a live connection. */
function expandTokens(value, alias, warnings) {
    if (!value.includes('%')) return value;

    const unsupported = value.match(/%[^h%]/g);
    if (unsupported) {
        warnings.push(`HostName uses ${[...new Set(unsupported)].join(', ')}, which cannot be resolved here`);
    }

    return value.replace(/%h/g, alias).replace(/%%/g, '%');
}

function buildHost(alias, blocks) {
    const settings = settingsFor(blocks, alias);
    const warnings = [];

    const hostName = expandTokens(firstValue(settings, 'hostname') || alias, alias, warnings);
    const port = Number(firstValue(settings, 'port')) || 22;
    const user = firstValue(settings, 'user');

    const identityFiles = (settings.get('identityfile') || [])
        .map(args => args[0])
        .filter(Boolean)
        .map(expandTilde);

    const tunnels = [];
    for (const [keyword, type] of Object.entries(FORWARD_TYPES)) {
        for (const args of settings.get(keyword) || []) {
            const tunnel = tunnelFromForward(type, args);
            if (tunnel) tunnels.push(tunnel);
            else warnings.push(`Could not read "${keyword} ${args.join(' ')}"`);
        }
    }

    const proxyJump = firstValue(settings, 'proxyjump');
    const proxyCommand = (settings.get('proxycommand') || [])[0]?.join(' ') || '';

    // ProxyJump is carried through and linked to a real host record after the
    // import, so nothing is warned about here. Whether the hop it names will
    // actually exist by then is a question about the whole config rather than
    // this one block, and is answered by the scan.
    //
    // ProxyCommand is a different thing entirely: an arbitrary program whose
    // stdio becomes the transport. Said plainly rather than dropped silently,
    // because a host that needs one will not connect.
    if (proxyCommand) warnings.push('Uses ProxyCommand, which this app cannot do yet');

    return {
        alias,
        hostName,
        port,
        user,
        identityFiles,
        identityAgent: firstValue(settings, 'identityagent'),
        forwardAgent: /^(yes|true)$/i.test(firstValue(settings, 'forwardagent')),
        proxyJump,
        proxyCommand,
        tunnels,
        warnings,
    };
}

/**
 * Parse a config file and everything it includes.
 *
 * Returns the concrete hosts it defines. Patterns like `Host *` shape those
 * hosts' settings but are not themselves connectable, so they never appear.
 */
function parse(configPath) {
    const sshDir = path.dirname(path.resolve(configPath));

    const context = {
        blocks: [],
        warnings: [],
        files: [],
        visited: new Set(),
        sshDir,
        matchBlocks: 0,
    };

    readFile(configPath, context, 0);

    const aliases = [];
    const seen = new Set();
    let patternBlocks = 0;

    for (const block of context.blocks) {
        if (block.isMatch) continue;

        let hasPattern = false;
        for (const pattern of block.patterns) {
            if (!isConcrete(pattern)) {
                hasPattern = true;
                continue;
            }
            const key = pattern.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            aliases.push(pattern);
        }
        // A block that only ever matched by wildcard supplies defaults.
        if (hasPattern && block.settings.size > 0) patternBlocks += 1;
    }

    return {
        path: path.resolve(configPath),
        files: context.files,
        hosts: aliases.map(alias => buildHost(alias, context.blocks)),
        warnings: context.warnings,
        stats: {
            files: context.files.length,
            matchBlocks: context.matchBlocks,
            patternBlocks,
        },
    };
}

/**
 * The host names a `ProxyJump` value refers to, in the order they are dialled.
 *
 * The directive takes `[user@]host[:port]`, and a comma-separated list when the
 * connection is relayed through more than one. `none` cancels an inherited one,
 * which is why it resolves to nothing rather than to a host called "none".
 *
 * Only the name comes back. A user and port on a jump spec describe that hop,
 * and this app reads those from the hop's own record, which is the whole reason
 * it stores a jump host as a reference rather than as an address.
 */
function proxyJumpAliases(value) {
    const text = String(value || '').trim();
    if (!text || /^none$/i.test(text)) return [];

    return text.split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map((part) => {
            // Last `@`, not the first: a username may contain one, as it does
            // for every Azure and Google IAP login.
            const withoutUser = part.includes('@')
                ? part.slice(part.lastIndexOf('@') + 1)
                : part;

            // A bracketed IPv6 literal keeps its colons; anything else splits at
            // the last one, which is the port when there is one.
            const bracketed = withoutUser.match(/^\[([^\]]+)\](?::\d+)?$/);
            if (bracketed) return bracketed[1];

            const colon = withoutUser.lastIndexOf(':');
            return colon > 0 ? withoutUser.slice(0, colon) : withoutUser;
        })
        .filter(Boolean);
}

module.exports = {
    parse,
    proxyJumpAliases,
    // Exported for the importer and for testing the pieces in isolation.
    parseLine,
    splitArgs,
    patternToRegex,
    blockMatches,
    resolveInclude,
};
