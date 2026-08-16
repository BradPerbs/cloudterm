import { useStacked } from './stacked';

/**
 * The panel every group of settings sits on.
 *
 * The padding comes in once the page is narrow enough that its rows have
 * stacked. 48px of it either side is a comfortable margin on a wide card and a
 * sixth of a narrow one, and by that point every pixel inside is being read.
 */
export default function SettingCard({ children, className = '' }) {
    const stacked = useStacked();

    return (
        <div
            className={`bg-white dark:bg-neutral-800/50 border border-gray-200 dark:border-neutral-800
                rounded-xl ${stacked ? 'p-4' : 'p-6'} ${className}`}
        >
            {children}
        </div>
    );
}
