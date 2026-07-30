/** Title block plus the stack of cards below it. One per settings category. */
export default function SettingsPage({ title, description, children }) {
    return (
        <div className="flex flex-col gap-6">
            <div className="px-1">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
                {description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
                )}
            </div>
            {children}
        </div>
    );
}
