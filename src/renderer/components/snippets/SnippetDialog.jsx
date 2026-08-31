import { useCallback, useMemo, useRef, useState } from 'react';
import { FileImportIcon } from 'hugeicons-react';
import Sheet from '../ui/Sheet';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import SegmentedControl from '../ui/SegmentedControl';
import Field, { FIELD_CLASS, MONO_FIELD_CLASS } from '../ui/Field';
import PackageSteps from './PackageSteps';
import {
    emptySnippet,
    validateSnippet,
    placeholdersIn,
    composeSnippet,
    isPackage,
    isSpec,
    wordCount,
} from '../../lib/snippets';

/** What a spec can be read in from. Text of any kind; the name is a hint. */
const SPEC_FILE_TYPES = '.md,.markdown,.txt,text/markdown,text/plain';

/**
 * Add or edit one snippet. Purely a form: it hands a record back and lets the
 * caller decide what saving means.
 *
 * A record is a single command, a package of steps, or a spec: a document for
 * the assistant. Switching between the kinds keeps every form's work, so
 * changing your mind halfway does not throw away what you already typed; only
 * the one matching the chosen kind is validated, and only it decides what gets
 * sent.
 */
export default function SnippetDialog({ snippet, hosts = [], library = [], dismiss, onSave, onClose }) {
    const [form, setForm] = useState(() => ({ ...emptySnippet(), ...(snippet || {}) }));
    const [tagText, setTagText] = useState(() => (snippet?.tags || []).join(', '));
    const [touched, setTouched] = useState(false);
    const fileRef = useRef(null);

    const set = useCallback((field, value) => {
        setForm(previous => ({ ...previous, [field]: value }));
    }, []);

    const error = useMemo(() => validateSnippet(form), [form]);

    // Placeholders come from the composed text, so a package asks once for a
    // value several of its steps share.
    const composed = useMemo(() => composeSnippet(form, library), [form, library]);
    const placeholders = useMemo(() => placeholdersIn(composed.text), [composed.text]);

    const asPackage = isPackage(form);
    const asSpec = isSpec(form);
    const noun = asPackage ? 'package' : asSpec ? 'spec' : 'snippet';
    const scoped = form.hostIds.length > 0;

    /**
     * Read a spec in from a file on disk. Most people who keep instructions
     * for an agent already have them as a Markdown file somewhere, and
     * retyping one into a textarea is not a way anyone wants to spend an
     * afternoon. The file's name stands in for a name not yet given.
     */
    const importFile = useCallback((event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            setForm(previous => ({
                ...previous,
                command: String(reader.result || ''),
                name: previous.name || file.name.replace(/\.[^.]+$/, ''),
            }));
        };
        reader.readAsText(file);
    }, []);

    const toggleHost = useCallback((hostId) => {
        setForm(previous => ({
            ...previous,
            hostIds: previous.hostIds.includes(hostId)
                ? previous.hostIds.filter(id => id !== hostId)
                : [...previous.hostIds, hostId],
        }));
    }, []);

    const submit = useCallback(() => {
        setTouched(true);
        if (validateSnippet(form)) return;

        onSave({
            ...form,
            name: form.name.trim(),
            tags: tagText.split(',').map(tag => tag.trim()).filter(Boolean),
        });
    }, [form, tagText, onSave]);

    return (
        <Sheet
            title={`${snippet?.id ? 'Edit' : 'New'} ${noun}`}
            subtitle={asPackage
                ? 'A series of commands, sent into a session in order.'
                : asSpec
                    ? 'A document for the AI agent, attached to a message from the chat.'
                    : 'A command you keep around, sent into a session from the palette.'}
            dismiss={dismiss}
            onClose={onClose}
            footer={
                <>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button variant="primary" onClick={submit} disabled={Boolean(error)}>
                        {snippet?.id ? 'Save' : `Add ${noun}`}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                {/* Not wrapped in Field: it renders a <label>, and a <button> is
                    labelable, so clicking the caption would fire the first
                    segment rather than doing nothing. */}
                <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Kind</span>
                    <SegmentedControl
                        ariaLabel="Snippet kind"
                        value={form.kind}
                        onChange={(value) => set('kind', value)}
                        segments={[
                            { value: 'command', label: 'Command' },
                            { value: 'package', label: 'Package' },
                            { value: 'spec', label: 'Spec', title: 'Instructions for the AI agent' },
                        ]}
                        className="w-full"
                    />
                    <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                        {asPackage
                            ? 'Steps run in the order you set. A step can be written here or taken from the library.'
                            : asSpec
                                ? 'A runbook, house rules, a brief. Never typed into a terminal: the agent reads it alongside your message.'
                                : 'One piece of text, dropped at the prompt.'}
                    </span>
                </div>

                <Field label="Name">
                    <input
                        data-autofocus
                        value={form.name}
                        onChange={(event) => set('name', event.target.value)}
                        placeholder={asPackage
                            ? 'e.g. Deploy and restart'
                            : asSpec
                                ? 'e.g. Deploy checklist'
                                : 'e.g. Tail nginx errors'}
                        className={FIELD_CLASS}
                    />
                </Field>

                {asPackage ? (
                    <PackageSteps form={form} library={library} onChange={set} />
                ) : asSpec ? (
                    <Field
                        label="Instructions"
                        hint="Markdown works. Pick it from the chat's spec menu and it goes to the agent with your message."
                    >
                        <textarea
                            value={form.command}
                            onChange={(event) => set('command', event.target.value)}
                            rows={14}
                            spellCheck
                            placeholder={'# Deploy checklist\n\n1. Pull the latest tag on the app box.\n2. Run the migrations, then restart the service.\n3. Check the health endpoint before saying it is done.'}
                            className={`${MONO_FIELD_CLASS} resize-y`}
                        />
                        <div className="flex items-center justify-between gap-3 mt-2">
                            <input
                                ref={fileRef}
                                type="file"
                                accept={SPEC_FILE_TYPES}
                                className="hidden"
                                onChange={importFile}
                            />
                            <button
                                type="button"
                                onClick={() => fileRef.current?.click()}
                                className="h-8 px-3 rounded-lg border border-gray-300 dark:border-surface-control text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-control transition-colors flex items-center gap-1.5"
                            >
                                <FileImportIcon size={13} strokeWidth={2.5} />
                                Import a .md file
                            </button>
                            <span className="text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">
                                {wordCount(form.command)} words
                            </span>
                        </div>
                    </Field>
                ) : (
                    <Field
                        label="Command"
                        hint="Wrap anything you want to be asked for in double braces, e.g. {{service}}."
                    >
                        <textarea
                            value={form.command}
                            onChange={(event) => set('command', event.target.value)}
                            rows={5}
                            spellCheck={false}
                            placeholder="tail -f /var/log/nginx/error.log"
                            className={`${MONO_FIELD_CLASS} resize-y`}
                        />
                    </Field>
                )}

                {/* A spec is read, not filled in, so braces in it are just
                    braces: a Markdown document about templating has every
                    right to mention them. */}
                {placeholders.length > 0 && !asSpec && (
                    <div className="flex items-center gap-1.5 flex-wrap -mt-2">
                        <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                            Will ask for
                        </span>
                        {placeholders.map(name => (
                            <span
                                key={name}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-gray-200 dark:border-surface-control text-gray-600 dark:text-gray-400"
                            >
                                {name}
                            </span>
                        ))}
                    </div>
                )}

                <Field label="Description" hint="Optional. Searched alongside the name.">
                    <input
                        value={form.description}
                        onChange={(event) => set('description', event.target.value)}
                        placeholder="What it does, or when to reach for it"
                        className={FIELD_CLASS}
                    />
                </Field>

                <Field label="Tags" hint="Comma separated.">
                    <input
                        value={tagText}
                        onChange={(event) => setTagText(event.target.value)}
                        placeholder="nginx, logs"
                        spellCheck={false}
                        className={FIELD_CLASS}
                    />
                </Field>

                {/* Scope. Not for a spec: it is picked in the assistant panel,
                    which may be talking about several hosts at once, and it
                    is never offered to a terminal where the host would narrow
                    it. */}
                {!asSpec && (
                <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Available on
                    </span>

                    <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-surface-base rounded-xl">
                        <button
                            type="button"
                            onClick={() => set('hostIds', [])}
                            className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                !scoped
                                    ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                            }`}
                        >
                            All hosts
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (!scoped && hosts[0]) set('hostIds', [hosts[0].id]);
                            }}
                            disabled={hosts.length === 0}
                            className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 ${
                                scoped
                                    ? 'bg-white dark:bg-surface-active text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                            }`}
                        >
                            Specific hosts
                        </button>
                    </div>

                    {scoped && (
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-surface-control divide-y divide-gray-100 dark:divide-surface-control">
                            {hosts.map(host => (
                                <Checkbox
                                    key={host.id}
                                    size="sm"
                                    checked={form.hostIds.includes(host.id)}
                                    onChange={() => toggleHost(host.id)}
                                    label={host.name}
                                    description={`${host.username}@${host.host}`}
                                    className="w-full px-3 py-2 hover:bg-gray-50 dark:hover:bg-surface-base transition-colors"
                                />
                            ))}
                        </div>
                    )}

                    {scoped && form.hostIds.length === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                            With no host selected this snippet will not appear anywhere.
                        </p>
                    )}
                </div>
                )}

                {!asSpec && (
                <Checkbox
                    variant="card"
                    checked={form.runImmediately}
                    onChange={(event) => set('runImmediately', event.target.checked)}
                    label="Run as soon as it is inserted"
                    description={asPackage
                        ? 'Presses Enter for you, which starts the whole series. Leave off to drop the steps at the prompt so they can be read before anything runs.'
                        : 'Presses Enter for you. Leave off to drop the command at the prompt so it can be read before it runs.'}
                />
                )}

                {touched && error && (
                    <p className="text-xs text-red-500 font-medium">{error}</p>
                )}
            </div>
        </Sheet>
    );
}
