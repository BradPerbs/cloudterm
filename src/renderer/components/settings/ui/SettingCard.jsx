/** The panel every group of settings sits on. */
export default function SettingCard({ children, className = '' }) {
    return (
        <div
            className={`bg-white dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-800
                rounded-xl p-6 ${className}`}
        >
            {children}
        </div>
    );
}
