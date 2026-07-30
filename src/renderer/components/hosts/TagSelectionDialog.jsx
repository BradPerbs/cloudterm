import { useMemo, useState } from 'react';
import { Tag01Icon } from 'hugeicons-react';
import Dialog, { DialogButton } from '../ui/Dialog';
import Checkbox from '../ui/Checkbox';
import Tag from '../ui/Tag';
import { FIELD_CLASS } from '../ui/Field';
import { MAX_TAG_LENGTH, normalizeTag } from '../../lib/tags';

/**
 * Tag several hosts at once.
 *
 * The awkward part of tagging a selection is that the hosts in it do not agree:
 * eight of the twelve are already "prod". So each tag is a checkbox with three
 * starting positions — on all of them, on some, on none — and the third is the
 * one the design turns on:
 *
 *   on all     unticking it takes the tag off all of them
 *   on none    ticking it puts the tag on all of them
 *   on some    shown part-ticked, and left alone unless you touch it. Touch it
 *              and it becomes a plain yes or no, because "add it to the four
 *              that haven't got it" and "take it off the eight that have" are
 *              the only two things anyone means by clicking it.
 *
 * A part-ticked tag you never touch is not in the payload at all, so the hosts
 * that disagree go on disagreeing. That is the behaviour that makes it safe to
 * open this dialog to add one tag to a mixed selection without auditing the
 * rest of the list first.
 */
export default function TagSelectionDialog({ hosts, allTags, onApply, onCancel }) {
    // tag -> true (on all of them) | false (on none of them). Absent means
    // untouched, which for a mixed tag means "leave them as they are".
    const [desired, setDesired] = useState(() => new Map());
    const [draft, setDraft] = useState('');
    const [added, setAdded] = useState([]);
    const [busy, setBusy] = useState(false);

    const total = hosts.length;

    /** How many of the selected hosts carry each tag on offer. */
    const rows = useMemo(() => {
        const counts = new Map();
        for (const host of hosts) {
            for (const tag of host.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
        }

        const names = new Set([...allTags, ...counts.keys(), ...added]);

        return [...names]
            .map(tag => ({ tag, on: counts.get(tag) || 0 }))
            // Most-carried first: the tags this selection is already about lead
            // the list, and the rest of the collection's vocabulary follows.
            .sort((a, b) => b.on - a.on || a.tag.localeCompare(b.tag));
    }, [hosts, allTags, added]);

    const stateOf = (tag, on) => {
        if (desired.has(tag)) return desired.get(tag) ? 'add' : 'remove';
        if (total > 0 && on === total) return 'all';
        return on > 0 ? 'some' : 'none';
    };

    const set = (tag, value) => setDesired((prev) => {
        const next = new Map(prev);
        next.set(tag, value);
        return next;
    });

    /** What actually has to change, which is what the button counts and sends. */
    const edit = useMemo(() => {
        const add = [];
        const remove = [];

        for (const { tag, on } of rows) {
            if (!desired.has(tag)) continue;
            // Only what is not already true: ticking a tag every host has is
            // not an edit, and the store would drop it anyway.
            if (desired.get(tag)) { if (on < total) add.push(tag); }
            else if (on > 0) remove.push(tag);
        }

        /**
         * A tag typed into the field but not yet committed counts too.
         *
         * Without this, typing a new tag and reaching straight for Apply finds
         * a dead button: the field only commits on Enter or on blur, and a
         * disabled button never takes the click that would have blurred it. So
         * the draft is part of the edit from the moment it is legible.
         */
        const pending = normalizeTag(draft);
        if (pending && !add.includes(pending)) {
            const row = rows.find(entry => entry.tag === pending);
            if (!row || row.on < total) add.push(pending);
        }

        return { add, remove };
    }, [rows, desired, total, draft]);

    const nothingToDo = edit.add.length === 0 && edit.remove.length === 0;

    const commitDraft = () => {
        const tag = normalizeTag(draft);
        setDraft('');
        if (!tag) return;
        // An existing tag typed in full is not a new row, it is that row: tick
        // it where it already is rather than growing a duplicate.
        if (!rows.some(row => row.tag === tag)) setAdded(prev => [...prev, tag]);
        set(tag, true);
    };

    const apply = async () => {
        if (nothingToDo || busy) return;
        setBusy(true);
        try {
            await onApply(edit);
        } finally {
            // The caller unmounts this on success; on failure it stays up with
            // the choices still in it, so the work is not lost.
            setBusy(false);
        }
    };

    const summary = [
        edit.add.length > 0 && `+${edit.add.length}`,
        edit.remove.length > 0 && `−${edit.remove.length}`,
    ].filter(Boolean).join(' ');

    return (
        <Dialog
            width="30rem"
            title="Tag hosts"
            subtitle={`${total} host${total === 1 ? '' : 's'} selected. Part-ticked tags are on some of them, and stay that way unless you touch them.`}
            onClose={busy ? undefined : onCancel}
            icon={
                <span className="w-9 h-9 rounded-xl flex items-center justify-center
                    bg-gray-100 dark:bg-surface-control text-gray-500 dark:text-gray-300">
                    <Tag01Icon size={20} strokeWidth={2} />
                </span>
            }
            footer={
                <>
                    <DialogButton onClick={onCancel} disabled={busy}>Cancel</DialogButton>
                    <DialogButton variant="primary" onClick={apply} disabled={nothingToDo || busy}>
                        {busy ? 'Applying…' : `Apply${summary ? ` ${summary}` : ''}`}
                    </DialogButton>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ',') return;
                        event.preventDefault();
                        commitDraft();
                    }}
                    onBlur={commitDraft}
                    maxLength={MAX_TAG_LENGTH}
                    placeholder="New tag…"
                    spellCheck={false}
                    aria-label="New tag"
                    data-autofocus
                    className={FIELD_CLASS}
                />

                {rows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        No tags yet. Type one above to start.
                    </p>
                ) : (
                    <div className="flex flex-col max-h-[42vh] overflow-y-auto -mx-1 px-1">
                        {rows.map(({ tag, on }) => {
                            const state = stateOf(tag, on);
                            const checked = state === 'add' || state === 'all';

                            return (
                                <div
                                    key={tag}
                                    className="flex items-center gap-3 py-1.5 rounded-lg min-w-0"
                                >
                                    <Checkbox
                                        size="sm"
                                        checked={checked}
                                        indeterminate={state === 'some'}
                                        onChange={() => set(tag, !checked)}
                                        aria-label={tag}
                                    />

                                    <span className="min-w-0 flex-1 flex">
                                        <Tag tag={tag} />
                                    </span>

                                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">
                                        {state === 'add' && on < total && 'will be added'}
                                        {state === 'remove' && on > 0 && 'will be removed'}
                                        {state === 'all' && 'on all'}
                                        {state === 'some' && `on ${on} of ${total}`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Dialog>
    );
}
