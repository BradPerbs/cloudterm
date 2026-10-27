import {
    Cancel01Icon,
    Csv01Icon,
    Doc01Icon,
    File01Icon,
    Pdf01Icon,
    Ppt01Icon,
    SourceCodeIcon,
    Txt01Icon,
    Xls01Icon,
} from 'hugeicons-react';
import { useT } from '../../i18n';

/**
 * Documents going with a message, as chips: in the composer, where each can be
 * taken back until it is sent, and on the sent message, where only the name is
 * left (the words went to the agent and are not kept in the history).
 *
 * The mark says what kind of document it was read from, since by now every
 * one of them is words: a PDF and the log it was printed from would otherwise
 * be two identical chips.
 */

const CODE = /\.(js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|c|h|cpp|hpp|cc|cs|php|sh|bash|zsh|ps1|sql|lua|kt|swift|vue|svelte|json|ya?ml|toml|xml|html?|css|scss|ini|conf|cfg)$/i;

/** The mark for a document, from its type and failing that its name. */
export function fileIcon(file) {
    const type = String(file?.mediaType || '').toLowerCase();
    const name = String(file?.name || '');
    if (type.includes('pdf') || /\.pdf$/i.test(name)) return Pdf01Icon;
    if (type.includes('wordprocessing') || type.includes('opendocument.text') || /\.(docx|odt|rtf)$/i.test(name)) return Doc01Icon;
    if (type.includes('spreadsheet') || /\.(xlsx|ods)$/i.test(name)) return Xls01Icon;
    if (type.includes('presentation') || /\.(pptx|odp)$/i.test(name)) return Ppt01Icon;
    if (/\.(csv|tsv)$/i.test(name) || type.includes('csv')) return Csv01Icon;
    if (CODE.test(name)) return SourceCodeIcon;
    if (type.startsWith('text/') || /\.(txt|md|log)$/i.test(name)) return Txt01Icon;
    return File01Icon;
}

/** The composer's chips, each with a way to take it back. */
export default function AttachmentChips({ files, onRemove }) {
    const t = useT();
    if (!files?.length) return null;

    return (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {files.map((file) => {
                const Icon = fileIcon(file);
                return (
                    <span
                        key={file.id}
                        title={file.name}
                        className="inline-flex items-center gap-1 pl-2 pr-1 h-6 rounded-md
                            text-xs font-medium select-none
                            bg-gray-100 dark:bg-surface-control
                            text-gray-700 dark:text-gray-200"
                    >
                        <Icon size={12} strokeWidth={2} className="shrink-0 opacity-70" />
                        <span className="max-w-[12rem] truncate">{file.name}</span>
                        <button
                            type="button"
                            aria-label={t('assistant.removeFile', { name: file.name })}
                            onClick={() => onRemove(file.id)}
                            className="w-4 h-4 flex items-center justify-center rounded
                                text-gray-500 dark:text-gray-400
                                hover:text-gray-900 dark:hover:text-white
                                hover:bg-black/[0.06] dark:hover:bg-white/10 transition-colors"
                        >
                            <Cancel01Icon size={10} strokeWidth={2.5} />
                        </button>
                    </span>
                );
            })}
        </div>
    );
}

/**
 * The same documents on the message that carried them, by name. `spaced` puts
 * room under them when something else in the bubble follows.
 */
export function SentFiles({ files, spaced }) {
    if (!files?.length) return null;

    return (
        <div className={`flex flex-wrap gap-1.5 ${spaced ? 'mb-1.5' : ''}`}>
            {files.map((file, index) => {
                const Icon = fileIcon(file);
                return (
                    <span
                        key={`${file.name}-${index}`}
                        title={file.name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                            text-xs bg-white/15 dark:bg-black/10"
                    >
                        <Icon size={12} strokeWidth={2} />
                        <span className="max-w-[14rem] truncate">{file.name}</span>
                    </span>
                );
            })}
        </div>
    );
}
