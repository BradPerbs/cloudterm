/**
 * The nothing a page shows where its collection would be.
 *
 * It takes the whole area the list would have taken, edge to edge with the
 * toolbar above it, because that area is the thing that is empty. Dashed, so it
 * reads as the outline of what is missing rather than as a card in its own
 * right, and nothing inside it beyond the line saying so: the actions each page
 * offers are in its header, where they are on every other visit.
 *
 * `flex-1` and `h-full` are both here so the one component fills its space in
 * either kind of parent: the flex column a page header sits in, and the block
 * that scrolls a grid.
 */
export default function EmptyFrame({ icon, title, note, children }) {
    return (
        <div
            className="flex-1 h-full min-h-[200px] flex flex-col items-center justify-center gap-3 rounded-2xl
                border border-dashed border-gray-300 dark:border-white/[0.12] px-6 text-center"
        >
            {icon && <span className="text-gray-400 dark:text-neutral-500">{icon}</span>}
            <div className="max-w-sm">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
                {note && (
                    <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400 break-words">{note}</p>
                )}
                {children}
            </div>
        </div>
    );
}
