/**
 * The line under a password box that already has something behind it.
 *
 * Secrets are never sent to the renderer, so a stored one cannot be shown in the
 * field: an empty box means "keep what is stored", which needs saying, and the
 * only other thing worth offering is a way to remove it.
 *
 * Shared by the host and proxy editors so the wording and the consequence read
 * the same wherever a stored secret is being left alone.
 */
export default function StoredSecretHint({ label, cleared, onClear }) {
    if (cleared) {
        return <p className="text-[11px] text-red-500">Stored secret will be removed on save.</p>;
    }

    return (
        <p className="text-[11px] text-gray-500 dark:text-neutral-500">
            {label}{' '}
            <button
                type="button"
                onClick={onClear}
                className="text-red-500 hover:underline font-medium"
            >
                Remove it
            </button>
        </p>
    );
}
