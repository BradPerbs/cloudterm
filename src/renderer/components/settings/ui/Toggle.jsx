/**
 * An on/off switch, for settings where the change takes effect immediately and
 * there is nothing to confirm. Anything that needs an explanation alongside it
 * belongs in a SettingRow, which is what supplies the label, hence `ariaLabel`
 * rather than visible text on the control itself.
 */
export default function Toggle({ checked, onChange, disabled = false, ariaLabel, className = '' }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative w-11 h-6 shrink-0 rounded-full outline-none transition-colors
                focus-visible:ring-[3px] focus-visible:ring-gray-900/20 dark:focus-visible:ring-white/25
                disabled:opacity-40 disabled:cursor-not-allowed
                ${checked ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-neutral-700'}
                ${className}`}
        >
            <span
                aria-hidden="true"
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white dark:bg-black
                    transition-transform motion-reduce:transition-none
                    ${checked ? 'translate-x-5' : ''}`}
            />
        </button>
    );
}
