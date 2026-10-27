import { useCallback, useRef, useState } from 'react';
import { Attachment01Icon } from 'hugeicons-react';
import useEnter from '../../hooks/useEnter';
import { useT } from '../../i18n';

/**
 * Files dragged over the conversation, and the cover that says they can be
 * let go there.
 *
 * `useFileDrop` hands back the four drag handlers for whatever element should
 * take a drop, and whether a file is over it now. Only a drag carrying files
 * counts: text dragged out of a reply and back into the composer is left to
 * the browser.
 *
 * Drags enter and leave every child on the way across, so the hover follows a
 * depth rather than a single event, and the last leave is what ends it. The
 * cover itself lets the pointer through, so the drop and that last leave still
 * land on the element underneath.
 */

const carriesFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');

export function useFileDrop(onFiles) {
    const [dragging, setDragging] = useState(false);
    const depth = useRef(0);

    const onDragEnter = useCallback((event) => {
        if (!carriesFiles(event)) return;
        depth.current += 1;
        setDragging(true);
    }, []);

    const onDragLeave = useCallback((event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
    }, []);

    // Without this the browser refuses the drop and opens the file itself.
    const onDragOver = useCallback((event) => {
        if (carriesFiles(event)) event.preventDefault();
    }, []);

    const onDrop = useCallback((event) => {
        depth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length === 0) return;
        event.preventDefault();
        onFiles(files);
    }, [onFiles]);

    return { dragging, dropProps: { onDragEnter, onDragLeave, onDragOver, onDrop } };
}

/** The cover, drawn over the whole conversation while a file hovers it. */
export default function DropOverlay() {
    const t = useT();
    const ref = useEnter('fade');

    return (
        <div
            ref={ref}
            aria-hidden="true"
            className="absolute inset-2 z-30 pointer-events-none select-none
                flex flex-col items-center justify-center gap-2.5 rounded-2xl
                border-2 border-dashed border-gray-300 dark:border-white/25
                bg-white/90 dark:bg-surface-raised/90 backdrop-blur-sm"
        >
            <span className="w-11 h-11 flex items-center justify-center rounded-full
                bg-gray-100 dark:bg-surface-control text-gray-600 dark:text-gray-200">
                <Attachment01Icon size={20} strokeWidth={2} />
            </span>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                {t('assistant.dropFiles')}
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {t('assistant.dropFilesHint')}
            </span>
        </div>
    );
}
