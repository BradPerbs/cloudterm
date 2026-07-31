// One gutter drives the whole shell: the space above the title bar, below it,
// and to the left and right of everything are all this value.
export const APP_GUTTER = 12;

/**
 * Height of the title bar's control row.
 *
 * The buttons and tabs inside it are 32px and centred, so this only has to be
 * *at least* 32. It is 40 because a tab group draws a border around a run of
 * tabs, and a 32px strip holding 32px tabs leaves nowhere for it to go: the
 * outline would be clipped to its left and right ends and read as a pair of
 * parentheses rather than a box. 40 = 32 for the tab, 2 of padding either side,
 * and the border itself.
 */
export const TITLE_BAR_HEIGHT = 40;

// Y coordinate where the title bar ends. Drawers open flush against it.
export const TITLE_BAR_BOTTOM = APP_GUTTER + TITLE_BAR_HEIGHT;

// Total sidebar width, including the gutter it holds to the content panel.
export const SIDEBAR_WIDTH = 172;

// Height of a terminal pane's own header row.
export const PANE_HEADER_HEIGHT = 44;

// Where a panel that belongs to one pane starts: just under that pane's header,
// close enough to read as having come out of it. Find and the snippet palette
// both hang from here, so they line up with each other and neither covers the
// view switcher.
export const PANE_OVERLAY_TOP = PANE_HEADER_HEIGHT + 8;

/**
 * The card grid the library panels use: hosts, keys, proxies, snippets.
 *
 * Columns are worked out from the width the grid actually has, not from the
 * width of the window. Those are different numbers here, and increasingly so:
 * the sidebar takes a fixed slice off the left and the assistant takes an
 * adjustable one off the right, so `lg:grid-cols-3` cheerfully keeps three
 * columns in a container that has since been squeezed to the width of two, and
 * every card in it ends up eliding its own title.
 *
 * `auto-fill` with a floor of 15rem drops a column whenever the remaining ones
 * would go under about 240px, which is roughly where a hostname and an address
 * stop fitting on their lines. The `min()` is the standard guard: without it a
 * container narrower than the floor gets one column that overflows it rather
 * than one column that fits.
 */
export const CARD_GRID = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))]';
