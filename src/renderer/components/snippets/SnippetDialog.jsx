import { useCallback, useMemo, useState } from 'react';
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
} from '../../lib/snippets';

/**
 * Add or edit one snippet. Purely a form: it hands a record back and lets the
 * caller decide what saving means.
 *
 * A record is either a single command or a package of steps. Switching between
 * the two keeps both forms' work, so changing your mind halfway does not throw
 * away what you already typed; only the one matching the chosen kind is
 * validated, and only it decides what gets sent.
 */
export default function SnippetDialog({ snippet, hosts = [], library = [], dismiss, onSave, onClose }) {
    const [form, setForm] = useState(() => ({ ...emptySnippet(), ...(snippet || {}) }));
    const [tagText, setTagText] = useState(() => (snippet?.tags || []).join(', '));
    const [touched, setTouched] = useState(false);

    const set = useCallback((field, value) => {
        setForm(previous => ({ ...previous, [field]: value }));
    }, []);

    const error = useMemo(() => validateSnippet(form), [form]);

    // Placeholders come from the composed text, so a package asks once for a
    // value several of its steps share.
    const composed = useMemo(() => composeSnippet(form, library), [form, library]);
    const placeholders = useMemo(() => placeholdersIn(composed.text), [composed.text]);

    const asPackage = isPackage(form);
    const scoped = form.hostIds.length > 0;

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
            title={snippet?.id
                ? (asPackage ? 'Edit package' : 'Edit snippet')
                : (asPackage ? 'New package' : 'New snippet')}
            subtitle={asPackage
                ? 'A series of commands, sent into a session in order.'
                : 'A command you keep around, sent into a session from the palette.'}
            dismiss={dismiss}
            onClose={onClose}
            footer={
                <>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button variant="primary" onClick={submit} disabled={Boolean(error)}>
                        {snippet?.id ? 'Save' : (asPackage ? 'Add package' : 'Add snippet')}
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
                        ]}
                        className="w-full"
                    />
                    <span className="text-[11px] text-gray-500 dark:text-neutral-500">
                        {asPackage
                            ? 'Steps run in the order you set. A step can be written here or taken from the library.'
                            : 'One piece of text, dropped at the prompt.'}
                    </span>
                </div>

                <Field label="Name">
                    <input
                        data-autofocus
                        value={form.name}
                        onChange={(event) => set('name', event.target.value)}
                        placeholder={asPackage ? 'e.g. Deploy and restart' : 'e.g. Tail nginx errors'}
                        className={FIELD_CLASS}
                    />
                </Field>

                {asPackage ? (
                    <PackageSteps form={form} library={library} onChange={set} />
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

                {placeholders.length > 0 && (
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

                {/* Scope */}
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

                <Checkbox
                    variant="card"
                    checked={form.runImmediately}
                    onChange={(event) => set('runImmediately', event.target.checked)}
                    label="Run as soon as it is inserted"
                    description={asPackage
                        ? 'Presses Enter for you, which starts the whole series. Leave off to drop the steps at the prompt so they can be read before anything runs.'
                        : 'Presses Enter for you. Leave off to drop the command at the prompt so it can be read before it runs.'}
                />

                {touched && error && (
                    <p className="text-xs text-red-500 font-medium">{error}</p>
                )}
            </div>
        </Sheet>
    );
}
