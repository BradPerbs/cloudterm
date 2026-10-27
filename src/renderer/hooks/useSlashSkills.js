import { useCallback, useMemo, useState } from 'react';
import useSkills, { matchSkills } from './useSkills';

/**
 * The `/` picker: the SKILL.md skills on this machine, offered while the
 * message starts with `/` and the caret is still in that first word.
 *
 * A picked skill leaves the text and goes with the message as a chip, so main
 * reads its instructions when it is sent (see `src/main/ai/skills.js`); what
 * was typed after the command stays in the box as the request. A message sent
 * with `/name` still at its start, as someone used to a terminal agent will
 * type it, invokes the skill of that name the same way (`typedSkill`).
 *
 * Read from the text and the caret on every change, like the `@` picker, so
 * backspacing over the `/` or typing past the first word closes it without
 * anything having to notice.
 */

/** The command being typed, if the caret is in it: `{ query }`. */
export function readSlash(value, caret) {
    const before = String(value || '').slice(0, caret);
    const found = /^\/([A-Za-z0-9_.:-]{0,60})$/.exec(before);
    return found ? { query: found[1] } : null;
}

/**
 * A skill named at the very start of a message being sent, and the words
 * after it, or null. Matched on the folder name or the skill's own name.
 */
export function typedSkill(text, skills) {
    const found = /^\/([A-Za-z0-9_.:-]+)(?:\s+|$)/.exec(String(text || ''));
    if (!found) return null;
    const wanted = found[1].toLowerCase();
    const skill = (skills || []).find(entry => (
        String(entry.id || '').toLowerCase() === wanted || String(entry.name || '').toLowerCase() === wanted
    ));
    return skill ? { skill, rest: String(text).slice(found[0].length) } : null;
}

export default function useSlashSkills({ text, setText, inputRef, onPick }) {
    const { skills } = useSkills();
    const [picker, setPicker] = useState(null);
    const [row, setRow] = useState(0);

    const matches = useMemo(() => (picker ? matchSkills(skills, picker.query) : []), [picker, skills]);

    const follow = useCallback((value, caret) => {
        setPicker(readSlash(value, caret));
        setRow(0);
    }, []);

    const close = useCallback(() => setPicker(null), []);

    /**
     * Take a skill: the `/command` leaves the text, the skill is held as a
     * chip, and the caret goes to the start so the request can be written in
     * front of whatever was already there.
     */
    const pick = useCallback((skill) => {
        if (!skill) return;
        const token = /^\/\S*/.exec(text)?.[0] || '';
        setText(text.slice(token.length).replace(/^ /, ''));
        onPick({ kind: 'skill', id: skill.id, name: skill.name || skill.id });
        setPicker(null);
        requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node) return;
            node.focus({ preventScroll: true });
            node.setSelectionRange(0, 0);
        });
    }, [text, setText, onPick, inputRef]);

    /** The `/` button: what typing one at the start does, for a pointer. */
    const open = useCallback(() => {
        const next = text.startsWith('/') ? text : `/${text}`;
        setText(next);
        const end = /^\/\S*/.exec(next)[0].length;
        setPicker(readSlash(next, end));
        setRow(0);
        requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node) return;
            node.focus({ preventScroll: true });
            node.setSelectionRange(end, end);
        });
    }, [text, setText, inputRef]);

    /** The picker's keys, from the textarea. True when the key was the picker's. */
    const onKeyDown = useCallback((event) => {
        if (!picker) return false;
        if (matches.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setRow(current => (current + step + matches.length) % matches.length);
            return true;
        }
        if (matches.length > 0 && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
            event.preventDefault();
            pick(matches[row] || matches[0]);
            return true;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setPicker(null);
            return true;
        }
        return false;
    }, [picker, matches, row, pick]);

    return { skills, picker, matches, row, setRow, follow, close, pick, open, onKeyDown };
}
