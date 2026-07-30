/**
 * The badge a card's icon sits in.
 *
 * A square with a heavily rounded corner, echoing the card's own. Distro logos
 * arrive as PNGs at different aspect ratios, weights and amounts of padding, so
 * dropping them straight onto the card left every row a slightly different
 * shape; the tile gives them one silhouette to share.
 *
 * `relative`, because the connection dot hangs off its corner.
 */

const SIZES = {
    sm: 'w-8 h-8 rounded-[10px]',
    md: 'w-9 h-9 rounded-xl',
};

export default function IconTile({ size = 'md', className = '', children }) {
    return (
        <span
            className={`${SIZES[size] || SIZES.md} shrink-0 relative flex items-center justify-center
                bg-gray-900/[0.06] dark:bg-white/[0.07] ${className}`}
        >
            {children}
        </span>
    );
}
