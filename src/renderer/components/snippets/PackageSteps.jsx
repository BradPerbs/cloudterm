import { useCallback, useMemo, useRef, useState } from 'react';
import {
    PlusSignIcon,
    Delete02Icon,
    ArrowUp01Icon,
    ArrowDown01Icon,
    Link01Icon,
    Alert02Icon,
} from 'hugeicons-react';
import SegmentedControl from '../ui/SegmentedControl';
import Tooltip from '../ui/Tooltip';
import { MONO_FIELD_CLASS } from '../ui/Field';
import { composeSnippet, emptyStep, isPackage, MAX_STEPS } from '../../lib/snippets';

/**
 * The step list for a package.
 *
 * Two kinds of step, deliberately not one:
 *
 *   from the library   a reference. Editing that command later changes every
 *                      package that uses it, which is the reason to reference
 *                      rather than copy.
 *   written here       text that belongs to this package alone.
 *
 * A reference holds no text of its own, so there is never a question of which
 * of the two is the real one.
 *
 * Reordering is buttons rather than drag and drop: order is the whole meaning
 * of a package, and a keyboard has to be able to set it.
 */

const ROW = 'group/step flex items-start gap-2 rounded-lg border border-gray-200 '
    + 'dark:border-surface-control bg-white dark:bg-surface-base px-2 py-2';

const ICON_BUTTON = 'w-6 h-6 flex items-center justify-center rounded-md text-gray-400 '
    + 'hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-surface-control '
    + 'transition-colors disabled:opacity-30 disabled:pointer-events-none';

function StepRow({
    index, total, step, source, onChange, onMove, onRemove,
}) {
    const missing = Boolean(step.ref) && !source;

    return (
        <div className={ROW}>
            <span className="shrink-0 w-5 h-6 flex items-center justify-center text-[11px] font-mono tabular-nums text-gray-400 dark:text-neutral-500">
                {index + 1}
            </span>

            <div className="min-w-0 flex-1">
                {step.ref ? (
                    <div className="flex flex-col gap-1 py-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Link01Icon
                                size={12}
                                strokeWidth={2}
                                className={missing ? 'shrink-0 text-red-500' : 'shrink-0 text-gray-400'}
                            />
                            <span className={`text-[13px] font-medium truncate ${missing
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-900 dark:text-white'}`}>
                                {source?.name || 'Deleted snippet'}
                            </span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400 dark:text-neutral-500">
                                from library
                            </span>
                        </div>
                        <p className="text-[11px] font-mono text-gray-500 dark:text-neutral-400 truncate">
                            {missing
                                ? 'This snippet no longer exists, so the package will not run.'
                                : source.command.split('\n')[0]}
                        </p>
                    </div>
                ) : (
                    <textarea
                        value={step.command}
                        onChange={(event) => onChange({ ...step, command: event.target.value })}
                        rows={Math.min(6, Math.max(1, step.command.split('\n').length))}
                        spellCheck={false}
                        placeholder="A command for this package"
                        aria-label={`Step ${index + 1}`}
                        className={`${MONO_FIELD_CLASS} resize-y py-1.5`}
                    />
                )}
            </div>

            <div className="shrink-0 flex items-center gap-0.5">
                <Tooltip label={index === 0 ? 'Already the first step' : 'Move up'}>
                    <button
                        type="button"
                        onClick={() => onMove(-1)}
                        disabled={index === 0}
                        className={ICON_BUTTON}
                    >
                        <ArrowUp01Icon size={13} strokeWidth={2.5} />
                    </button>
                </Tooltip>
                <Tooltip label={index === total - 1 ? 'Already the last step' : 'Move down'}>
                    <button
                        type="button"
                        onClick={() => onMove(1)}
                        disabled={index === total - 1}
                        className={ICON_BUTTON}
                    >
                        <ArrowDown01Icon size={13} strokeWidth={2.5} />
                    </button>
                </Tooltip>
                <Tooltip label="Remove step">
                    <button
                        type="button"
                        onClick={onRemove}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <Delete02Icon size={13} strokeWidth={2} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

export default function PackageSteps({ form, library = [], onChange }) {
    const [picking, setPicking] = useState(false);
    const pickerRef = useRef(null);

    const steps = form.steps || [];

    // Only commands can be referenced. A package referencing a package is what
    // would make a cycle possible, so the option is never offered.
    const referable = useMemo(
        () => library.filter(entry => !isPackage(entry) && entry.id !== form.id),
        [library, form.id]
    );

    const byId = useMemo(
        () => new Map(library.map(entry => [entry.id, entry])),
        [library]
    );

    const setSteps = useCallback((next) => onChange('steps', next), [onChange]);

    const addInline = useCallback(() => {
        setSteps([...steps, emptyStep()]);
    }, [steps, setSteps]);

    const addReference = useCallback((snippetId) => {
        setPicking(false);
        if (!snippetId) return;
        setSteps([...steps, emptyStep(snippetId)]);
    }, [steps, setSteps]);

    const updateStep = useCallback((index, next) => {
        setSteps(steps.map((step, position) => (position === index ? next : step)));
    }, [steps, setSteps]);

    const moveStep = useCallback((index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= steps.length) return;
        const next = [...steps];
        [next[index], next[target]] = [next[target], next[index]];
        setSteps(next);
    }, [steps, setSteps]);

    const removeStep = useCallback((index) => {
        setSteps(steps.filter((_, position) => position !== index));
    }, [steps, setSteps]);

    // Composed against the live library, so a preview always shows what would
    // actually be sent right now rather than what it was when the step was added.
    const { text, missing } = useMemo(
        () => composeSnippet({ ...form, kind: 'package' }, library),
        [form, library]
    );

    const full = steps.length >= MAX_STEPS;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Steps
                </span>
                <SegmentedControl
                    size="sm"
                    ariaLabel="How the steps run"
                    value={form.chain ? 'chain' : 'sequence'}
                    onChange={(value) => onChange('chain', value === 'chain')}
                    segments={[
                        {
                            value: 'sequence',
                            label: 'One after another',
                            title: 'Every step runs, whatever the one before it did',
                        },
                        {
                            value: 'chain',
                            label: 'Stop on failure',
                            title: 'Joined with &&, so the series halts at the first step that fails',
                        },
                    ]}
                />
            </div>

            {steps.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 dark:border-surface-control px-3 py-6 text-center text-[13px] text-gray-500 dark:text-gray-400">
                    A package runs a series of commands in order. Add the first one below.
                </p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {steps.map((step, index) => (
                        <StepRow
                            key={step.id}
                            index={index}
                            total={steps.length}
                            step={step}
                            source={step.ref ? byId.get(step.ref) : null}
                            onChange={(next) => updateStep(index, next)}
                            onMove={(delta) => moveStep(index, delta)}
                            onRemove={() => removeStep(index)}
                        />
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={addInline}
                    disabled={full}
                    className="h-8 px-3 rounded-lg border border-gray-300 dark:border-surface-control text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-control transition-colors flex items-center gap-1.5 disabled:opacity-40"
                >
                    <PlusSignIcon size={13} strokeWidth={2.5} />
                    Write a command
                </button>

                <div className="relative">
                    {/* The disabled case is the one worth explaining, and the
                        native bubble never shows on a disabled control at all. */}
                    <Tooltip
                        label="No saved commands to reference yet"
                        enabled={referable.length === 0 && !full}
                    >
                        <button
                            type="button"
                            onClick={() => setPicking(open => !open)}
                            disabled={full || referable.length === 0}
                            className="h-8 px-3 rounded-lg border border-gray-300 dark:border-surface-control text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-control transition-colors flex items-center gap-1.5 disabled:opacity-40"
                        >
                            <Link01Icon size={13} strokeWidth={2.5} />
                            Add from library
                        </button>
                    </Tooltip>

                    {picking && (
                        <>
                            {/* Click anywhere else and the list goes away. */}
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setPicking(false)}
                                aria-hidden="true"
                            />
                            <div
                                ref={pickerRef}
                                className="absolute left-0 bottom-full mb-1.5 z-50 w-72 max-h-64 overflow-y-auto
                                    rounded-xl border border-gray-200 dark:border-surface-control
                                    bg-white dark:bg-surface-raised shadow-xl p-1"
                                role="listbox"
                                aria-label="Saved commands"
                            >
                                {referable.map(entry => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        role="option"
                                        onClick={() => addReference(entry.id)}
                                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-surface-control transition-colors"
                                    >
                                        <span className="block text-[13px] font-medium text-gray-900 dark:text-white truncate">
                                            {entry.name}
                                        </span>
                                        <span className="block text-[11px] font-mono text-gray-500 dark:text-neutral-400 truncate">
                                            {entry.command.split('\n')[0]}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {full && (
                    <span className="text-[11px] text-gray-400 dark:text-neutral-500">
                        {MAX_STEPS} steps is the limit
                    </span>
                )}
            </div>

            {missing.length > 0 && (
                <p className="text-[11px] text-red-500 flex items-start gap-1.5">
                    <Alert02Icon size={13} strokeWidth={2} className="shrink-0 mt-px" />
                    {missing.length === 1
                        ? 'One step points at a snippet that no longer exists. Remove it, or the package will refuse to run.'
                        : `${missing.length} steps point at snippets that no longer exist. Remove them, or the package will refuse to run.`}
                </p>
            )}

            {text && (
                <div className="rounded-lg border border-gray-200 dark:border-surface-control overflow-hidden">
                    <div className="px-2.5 h-7 flex items-center gap-2 border-b border-gray-200 dark:border-surface-control bg-gray-50 dark:bg-surface-base/60">
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-neutral-500">
                            What gets sent
                        </span>
                    </div>
                    <pre className="px-2.5 py-2 text-[11px] font-mono leading-relaxed text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-all max-h-36 overflow-y-auto">
                        {text}
                    </pre>
                </div>
            )}
        </div>
    );
}
