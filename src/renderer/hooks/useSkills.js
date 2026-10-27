import { useCallback, useEffect, useState } from 'react';

/**
 * The slash skills for the `/` picker.
 *
 * Unlike snippets these live outside the app, as `SKILL.md` folders under
 * `~/.agents/skills`, `~/.claude/skills` and `~/.pi/agent/skills`, and main
 * reads them (see `src/main/ai/skills.js`). What arrives here is metadata
 * only, `{ id, name, description, hint }`: a skill's instructions are read in
 * main when a message actually invokes it.
 *
 * Every bridge call is guarded the way `useSnippets` guards its own: the
 * preload API is established once per page load, so during development the
 * renderer can hot-reload against a `window.api` that predates this feature.
 */

let cache = null;
const listeners = new Set();

function publish(list) {
    cache = list;
    for (const listener of listeners) listener(list);
}

async function reload() {
    if (!window.api?.ai?.skills) return [];
    try {
        const list = (await window.api.ai.skills()) || [];
        publish(list);
        return list;
    } catch {
        publish([]);
        return [];
    }
}

export function useSkills() {
    const [skills, setSkills] = useState(() => cache || []);

    useEffect(() => {
        listeners.add(setSkills);
        if (cache === null) reload();
        else setSkills(cache);
        return () => listeners.delete(setSkills);
    }, []);

    // A skill installed while the app is open (by another agent, or a git
    // pull) shows up when the window comes back, without a reload.
    useEffect(() => {
        const onFocus = () => reload();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);

    const refresh = useCallback(() => reload(), []);

    return { skills, refresh };
}

/** How well a skill answers what was typed after the `/`. */
function score(skill, needle) {
    if (!needle) return 1;
    const name = String(skill.name || skill.id || '').toLowerCase();
    const id = String(skill.id || '').toLowerCase();
    if (name.startsWith(needle) || id.startsWith(needle)) return 3;
    if (name.includes(needle) || id.includes(needle)) return 2;
    if ((skill.description || '').toLowerCase().includes(needle)) return 1;
    return 0;
}

/** The skills worth showing, best first, kept to a list that fits on screen. */
export function matchSkills(skills, query, limit = 40) {
    const needle = String(query || '').trim().toLowerCase();
    return (skills || [])
        .map(skill => ({ skill, rank: score(skill, needle) }))
        .filter(entry => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank
            || String(a.skill.name || a.skill.id).localeCompare(String(b.skill.name || b.skill.id)))
        .slice(0, limit)
        .map(entry => entry.skill);
}

export default useSkills;
