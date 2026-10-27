import { useCallback, useRef, useState } from 'react';
import { IMAGE_TYPES } from '../lib/images';
import { MAX_FILES, isAttachableFile, readTextFile } from '../lib/files';
import { useT } from '../i18n';

/**
 * The documents waiting in the composer, and the road every picked, dropped
 * or pasted file takes to get there.
 *
 * Pictures go to the picture handler the composer already had, when the agent
 * answering can read one, and are refused with a word otherwise. Everything
 * else is read into words here (text as it is, a PDF through PDF.js, a Word,
 * Excel or PowerPoint file unzipped) and held as `{ id, name, mediaType,
 * text }` until it is sent. Words travel with every agent, so there is no
 * gate on these.
 *
 * One file at a time, in the order given, so a handful land in the order they
 * were dropped. What did not make it in, or went in cut short, is said under
 * the chips by name rather than left for the user to notice.
 */

/** The sentence for each way a file can fail to be read. See `lib/files`. */
const REFUSALS = {
    'too large': 'assistant.fileTooLarge',
    empty: 'assistant.fileEmpty',
    'not text': 'assistant.fileNotText',
    'not office': 'assistant.fileUnreadable',
};

export default function useComposerFiles({ canAttachImages, addImages, onSettled }) {
    const t = useT();
    const [files, setFiles] = useState([]);
    const [notice, setNotice] = useState('');

    // Read alongside the state, so a drop of six arriving while the first is
    // still being read still counts the ones already taken.
    const count = useRef(0);
    count.current = files.length;

    const add = useCallback(async (picked) => {
        const list = Array.from(picked || []);
        if (list.length === 0) return;

        const pictures = list.filter(file => IMAGE_TYPES.includes(file.type));
        const documents = list.filter(file => !IMAGE_TYPES.includes(file.type));
        const notes = [];

        if (pictures.length > 0) {
            if (canAttachImages) await addImages(pictures);
            else notes.push(t('assistant.imageUnsupported', { name: pictures[0].name || t('assistant.image') }));
        }

        let taken = count.current;
        for (const file of documents) {
            const name = file.name || 'file';
            if (!isAttachableFile(file)) {
                notes.push(t('assistant.fileNotText', { name }));
                continue;
            }
            if (taken >= MAX_FILES) {
                notes.push(t('assistant.fileTooMany', { count: MAX_FILES }));
                break;
            }
            try {
                const { truncated, ...read } = await readTextFile(file);
                taken += 1;
                setFiles(current => [...current, { id: `${Date.now()}-${current.length}-${name}`, ...read }]);
                if (truncated) notes.push(t('assistant.fileTruncated', { name }));
            } catch (error) {
                notes.push(t(REFUSALS[error?.message] || 'assistant.fileUnreadable', { name }));
            }
        }

        setNotice(notes.join(' '));
        onSettled?.();
    }, [canAttachImages, addImages, onSettled, t]);

    const remove = useCallback((id) => {
        setFiles(current => current.filter(file => file.id !== id));
        setNotice('');
    }, []);

    const clear = useCallback(() => {
        setFiles([]);
        setNotice('');
    }, []);

    return { files, setFiles, notice, setNotice, add, remove, clear };
}
