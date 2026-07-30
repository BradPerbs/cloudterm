import { Cancel01Icon } from 'hugeicons-react';
import { tagTone } from '../../lib/tags';

/**
 * One tag, drawn the same way everywhere it appears.
 *
 * It shows up on a card, in the sort menu, in the host editor and in the bulk
 * dialog, and those four had every chance to drift into four different pills.
 * Same reasoning as `Field`: they read as one thing, so they are styled from
 * one place.
 *
 * The colour comes from the tag's own letters (see `tagTone`), which is what
 * makes a grid of cards scannable rather than a wall of identical grey. It is a
 * solid fill and carries no border: at this size a border around a filled chip
 * only muddies its edge, and the fill is already the shape.
 *
 * The radius follows the app's own scale rather than a half-height pill —
 * `rounded-lg` under a `rounded-2xl` card is the same corner seen closer up,
 * where a lozenge would be a second vocabulary on the same page.
 *
 * There is deliberately no dimmed variant. A filled chip cannot be faded to say
 * "not picked": element opacity takes the white label down with the fill, and a
 * half-transparent white on a washed blue is unreadable on the light theme. The
 * lists that need to show what is picked — the sort menu, the bulk dialog — say
 * so with a tick or a checkbox beside the chip, which is a clearer signal than
 * a shade of the same colour anyway.
 */

const SIZES = {
    xs: 'h-[18px] px-1.5 text-[10px] rounded-lg gap-1',
    sm: 'h-6 px-2.5 text-[11px] rounded-[10px] gap-1.5',
    md: 'h-7 px-3 text-xs rounded-xl gap-1.5',
};

export default function Tag({
    tag,
    size = 'sm',
    icon,
    onClick,
    onRemove,
    title,
    className = '',
    ...rest
}) {
    const shape = [
        'inline-flex items-center font-semibold max-w-full transition-all',
        SIZES[size] || SIZES.sm,
        tagTone(tag),
        // Brightness rather than a colour swap, so one rule covers eight tones
        // and reads the same way on both themes.
        onClick ? 'cursor-pointer hover:brightness-110 active:scale-95' : '',
        className,
    ].join(' ');

    const body = (
        <>
            {/* A leading mark for a chip that does something when pressed — the
                editor's suggestions use it to say they are there to be added
                rather than to report what is already true. */}
            {icon && <span className="shrink-0 -ml-0.5 opacity-80">{icon}</span>}

            <span className="truncate">{tag}</span>

            {/* Its own button rather than a click target on the whole chip: the
                chip in the editor is not otherwise clickable, and a pill that
                deletes wherever you press it is a pill you delete by accident. */}
            {onRemove && (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Remove ${tag}`}
                    onClick={(event) => { event.stopPropagation(); onRemove(); }}
                    className="shrink-0 -mr-1 w-4 h-4 flex items-center justify-center rounded-md
                        opacity-70 hover:opacity-100 hover:bg-black/20 transition-all"
                >
                    <Cancel01Icon size={10} strokeWidth={3} />
                </button>
            )}
        </>
    );

    if (!onClick) {
        return <span className={shape} title={title || tag} {...rest}>{body}</span>;
    }

    return (
        <button type="button" onClick={onClick} title={title || tag} className={shape} {...rest}>
            {body}
        </button>
    );
}
