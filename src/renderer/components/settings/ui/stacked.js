import { createContext, useContext } from 'react';

/**
 * Whether the settings pages are short enough of width that every row should
 * stack: the label on one line, the control under it, both across the card.
 *
 * A flag passed down rather than each row measuring itself. A page is thirty
 * rows and they must all answer the same way, or a card ends up half in one
 * shape and half in the other. The panel measures once, at the top, and says
 * so; see SettingsPanel and hooks/useNarrow.
 *
 * `false` by default, so a row rendered outside the settings shell is the row
 * it always was.
 */
const Stacked = createContext(false);

export const StackedProvider = Stacked.Provider;

export const useStacked = () => useContext(Stacked);
