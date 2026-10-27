const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Slash skills: the `SKILL.md` folders other agents keep, read here so a
 * leading `/` in the composer can invoke one.
 *
 * Sources are the places they are kept: `~/.agents/skills`, `~/.claude/skills`
 * and `~/.pi/agent/skills` (usually a link into the first, which the
 * de-duplication below takes care of). Each skill is a directory holding a
 * `SKILL.md` with frontmatter (`name`, `description`, `argument-hint`) and
 * Markdown instructions below it.
 *
 * The renderer lists metadata only. The full text is read here when a message
 * carrying `{ kind: 'skill', id }` is sent (see `mentions.js`), so a
 * sixty-kilobyte skill never crosses the bridge until it is actually invoked,
 * and is read as it stands then rather than as it stood when the list was.
 *
 * Kept free of Electron so it can be tested on its own. Every reader takes the
 * directories to look in, which default to the ones above.
 */

/** How much of a skill rides along. Past this it is a file, not a mention. */
const MAX_TEXT = 60000;

/** How much of a file is read to list it: the frontmatter is at the top. */
const HEAD_BYTES = 4096;

/** Where skills are looked for. The first to hold an id wins. */
function skillDirs() {
    const home = os.homedir();
    return [
        path.join(home, '.agents', 'skills'),
        path.join(home, '.claude', 'skills'),
        path.join(home, '.pi', 'agent', 'skills'),
    ];
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** A YAML block scalar's marker: `|` keeps the lines, `>` folds them into one. */
const BLOCK = /^[|>][-+]?\d*$/;

/**
 * The frontmatter of a SKILL.md: the `---` block at the top. Parsed by hand
 * rather than with a YAML dependency: the fields read here are plain strings,
 * on one line or folded over several (`description: >-` and the indented
 * lines under it is how a long one is usually written), and anything fancier
 * is skipped rather than allowed to spoil the whole list.
 */
function parseFrontmatter(text) {
    const found = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
    if (!found) return {};
    const lines = found[1].split(/\r?\n/);
    const fields = {};
    for (let at = 0; at < lines.length; at += 1) {
        const line = lines[at];
        // An indented line belongs to the field above it, read with that field.
        if (/^\s/.test(line)) continue;
        const mark = line.indexOf(':');
        if (mark <= 0) continue;
        const key = line.slice(0, mark).trim().toLowerCase();
        let value = line.slice(mark + 1).trim();

        const more = [];
        while (at + 1 < lines.length && (/^\s/.test(lines[at + 1]) || !lines[at + 1].trim())) {
            more.push(lines[at + 1].trim());
            at += 1;
        }
        if (BLOCK.test(value)) {
            value = more.join(value.startsWith('|') ? '\n' : ' ').trim();
        } else if (more.length) {
            value = [value, ...more].join(' ').trim();
        }

        if ((value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key && value && !(key in fields)) fields[key] = value;
    }
    return fields;
}

/** An agent-only skill is not something a person invokes with `/`. */
const hidden = front => String(front['user-invocable'] || '').toLowerCase() === 'false';

/** The directories holding a SKILL.md, one per id, case-insensitively. */
function discover(dirs = skillDirs()) {
    const seen = new Set();
    const found = [];
    for (const base of dirs) {
        let entries = [];
        try {
            entries = fs.readdirSync(base, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const id = entry.name;
            const key = id.toLowerCase();
            if (!id || id.startsWith('.') || seen.has(key)) continue;
            const file = path.join(base, id, 'SKILL.md');
            try {
                if (!fs.statSync(file).isFile()) continue;
            } catch {
                continue;
            }
            seen.add(key);
            found.push({ id, file, source: base });
        }
    }
    return found;
}

/**
 * What the `/` picker shows: one row per skill and no instructions. Only the
 * head of each file is read, so listing thirty skills does not read thirty
 * files whole.
 */
function list({ dirs } = {}) {
    const rows = [];
    for (const { id, file, source } of discover(dirs)) {
        let head = '';
        try {
            const handle = fs.openSync(file, 'r');
            try {
                const buffer = Buffer.alloc(HEAD_BYTES);
                const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
                head = buffer.subarray(0, read).toString('utf8');
            } finally {
                fs.closeSync(handle);
            }
        } catch {
            continue;
        }
        const front = parseFrontmatter(head);
        if (hidden(front)) continue;
        rows.push({
            id,
            name: clean(front.name) || id,
            description: clean(front.description),
            hint: clean(front['argument-hint']),
            source,
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
}

/**
 * One skill with its instructions, or null when there is no such skill. Found
 * by its directory name among the ones listed, so an id can only ever name a
 * SKILL.md in one of the skill folders.
 */
function get(id, { dirs } = {}) {
    const wanted = String(id || '').toLowerCase();
    if (!wanted) return null;
    for (const { id: found, file } of discover(dirs)) {
        if (found.toLowerCase() !== wanted) continue;
        let text = '';
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            return null;
        }
        const front = parseFrontmatter(text);
        if (hidden(front)) return null;
        return {
            id: found,
            name: clean(front.name) || found,
            description: clean(front.description),
            hint: clean(front['argument-hint']),
            text: text.slice(0, MAX_TEXT),
            path: file,
        };
    }
    return null;
}

module.exports = { skillDirs, parseFrontmatter, list, get, MAX_TEXT };
