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
