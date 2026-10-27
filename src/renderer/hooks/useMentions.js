import { useCallback, useMemo, useState } from 'react';
import { matchMentions } from '../components/assistant/MentionPicker';

/**
 * What the message being written tags with `@`, and the picker that tags it.
 *
 * Each tag is held as `{ kind, id, name }` and sent as the first two, so main
 * reads the record as it stands when the message goes rather than a copy taken
 * when it was picked (see `src/main/ai/mentions.js`). Picking one also puts
 * `@name` in the text where the `@` was typed, so the sentence reads the way
 * it was meant: "restart nginx on @web-01".
 *
 * The picker is not a mode. Whether it is open is read from the text and the
 * caret on every change: an `@` at the start of a word with the caret still in
 * that word. So clicking elsewhere in the line, or backspacing over the `@`,
 * closes it without anything having to notice.
 *
 * `text` and `setText` are the composer's own; `inputRef` is its textarea,
 * which keeps the focus throughout.
 */

/** The `@word` the caret is in, if any: `{ query, start }`. */
export function readMention(value, caret) {
    const found = /(?:^|\s)@([^\s@]{0,60})$/.exec(String(value || '').slice(0, caret));
    if (!found) return null;
    return { query: found[1], start: caret - found[1].length - 1 };
}

/** The caret put back where it belongs once React has drawn the new text. */
function placeCaret(inputRef, at) {
    requestAnimationFrame(() => {
        const node = inputRef.current;
        if (!node) return;
        node.focus({ preventScroll: true });
        try {
            node.setSelectionRange(at, at);
        } catch {
            // The field is being redrawn; the caret follows on the next frame.
        }
    });
}

export default function useMentions({ text, setText, inputRef, mentionables }) {
    const [mentions, setMentions] = useState([]);
    const [picker, setPicker] = useState(null);
    const [row, setRow] = useState(0);

    const matches = useMemo(
        () => (picker ? matchMentions(mentionables, picker.query) : []),
        [picker, mentionables],
    );

    /** Read the picker's state off the text, after a keystroke or a click. */
    const follow = useCallback((value, caret) => {
        setPicker(readMention(value, caret));
        setRow(0);
    }, []);

    const close = useCallback(() => setPicker(null), []);

    /**
     * Take a row: the `@query` in the text becomes `@name `, the thing itself
     * is held as a chip, and the caret lands after the name so the sentence
     * can carry on being written.
     */
    const pick = useCallback((item) => {
        if (!picker || !item) return;
        const end = picker.start + 1 + picker.query.length;
        const inserted = `@${item.name} `;
        setText(`${text.slice(0, picker.start)}${inserted}${text.slice(end)}`);
        setMentions(current => (
            current.some(entry => entry.kind === item.kind && entry.id === item.id)
                ? current
                : [...current, {
                    kind: item.kind,
                    id: item.id,
                    name: item.name,
                    ...(item.snippetKind ? { snippetKind: item.snippetKind } : {}),
                    ...(item.os ? { os: item.os, distro: item.distro } : {}),
                }]
        ));
        setPicker(null);
        placeCaret(inputRef, picker.start + inserted.length);
    }, [picker, text, setText, inputRef]);

    /** The `@` button: what typing one at the caret does, for a pointer. */
    const open = useCallback(() => {
        const node = inputRef.current;
        if (!node) return;
        const caret = node.selectionStart ?? text.length;
        const spaced = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? ' ' : '';
        const at = caret + spaced.length + 1;
        setText(`${text.slice(0, caret)}${spaced}@${text.slice(caret)}`);
        setPicker({ query: '', start: at - 1 });
        setRow(0);
        placeCaret(inputRef, at);
    }, [text, setText, inputRef]);

    /**
     * The picker's keys, from the textarea. True when the key was the
     * picker's, so the composer does not also act on it.
     */
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

    /** One more tag, from outside the picker: a skill picked with `/`. Once only. */
    const add = useCallback((entry) => {
        if (!entry?.kind || !entry?.id) return;
        setMentions(current => (
            current.some(held => held.kind === entry.kind && held.id === entry.id) ? current : [...current, entry]
        ));
    }, []);

    const remove = useCallback((kind, id) => {
        setMentions(current => current.filter(entry => !(entry.kind === kind && entry.id === id)));
    }, []);

    /** Add tags back, as a queued message being edited brings its own. */
    const restore = useCallback((list) => {
        setMentions(Array.isArray(list) ? list : []);
    }, []);

    const clear = useCallback(() => {
        setMentions([]);
        setPicker(null);
    }, []);

    return {
        mentions, setMentions, picker, matches, row, setRow,
        follow, close, pick, open, onKeyDown, add, remove, restore, clear,
    };
}
