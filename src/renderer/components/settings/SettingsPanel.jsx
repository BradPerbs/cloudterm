import { memo, useCallback, useState } from 'react';
import SettingsNav, { SETTINGS_CATEGORIES } from './SettingsNav';
import { StackedProvider } from './ui/stacked';
import useNarrow from '../../hooks/useNarrow';
import GeneralPage from './pages/GeneralPage';
import AppearancePage from './pages/AppearancePage';
import TerminalPage from './pages/TerminalPage';
import AssistantPage from './pages/AssistantPage';
import MonitoringPage from './pages/MonitoringPage';
import LoggingPage from './pages/LoggingPage';
import SecurityPage from './pages/SecurityPage';
import AccountPage from './pages/AccountPage';
import BackupPage from './pages/BackupPage';
import AboutPage from './pages/AboutPage';

/** Keyed by the ids in SETTINGS_CATEGORIES, so every category needs an entry. */
const PAGES = {
    general: GeneralPage,
    appearance: AppearancePage,
    terminal: TerminalPage,
    assistant: AssistantPage,
    monitoring: MonitoringPage,
    logging: LoggingPage,
    security: SecurityPage,
    account: AccountPage,
    backup: BackupPage,
    about: AboutPage,
};

/**
 * The two widths this page changes shape at, measured on the panel itself: the
 * assistant opens as a column beside it and takes 340px or more off it, so how
 * much room settings has is not a question about the size of the display.
 *
 * A page is a 160px category list, a 24px gutter, then cards whose rows put a
 * label on the left and a control on the right. The controls are the fixed part
 * (a slider is 320px, a segmented control not much less), so everything a row
 * loses comes out of the label, and the label is the part that has to be read.
 *
 * Under 780 the category list drops to a rail of icons, which is 124px handed
 * straight to the cards, and the rows stay side by side.
 *
 * Under 660 there is no width left to hand over: the rows stack instead, label
 * on one line and control under it, and the cards take their padding in a
 * little. Nothing is hidden and nothing is truncated, the page just gets taller.
 */
const NARROW = [780, 660];

// Which page was open last. Settings unmounts whenever the user navigates to
// Hosts, and coming back to the top of the list every time is tiresome when you
// are adjusting one thing repeatedly.
const CATEGORY_KEY = 'settings.category';

const readCategory = () => {
    const saved = localStorage.getItem(CATEGORY_KEY);
    return SETTINGS_CATEGORIES.some(category => category.id === saved) ? saved : 'general';
};

/**
 * The settings shell: a category list on the left, one page on the right. Pages
 * are given the whole prop bag and take what they need. The alternative is
 * threading each new setting through here by hand.
 */
function SettingsPanel(props) {
    const [category, setCategory] = useState(readCategory);

    // How much room the page has, which is not how big the window is: see NARROW.
    const [panelRef, [railed, stacked]] = useNarrow(NARROW);

    const changeCategory = useCallback((next) => {
        setCategory(next);
        localStorage.setItem(CATEGORY_KEY, next);
    }, []);

    const Page = PAGES[category] || PAGES.general;

    return (
        <div ref={panelRef} className="flex items-start gap-6" id="settings-panel">
            <SettingsNav active={category} onChange={changeCategory} collapsed={railed} />

            <div className="flex-1 min-w-0 max-w-3xl pb-8">
                <StackedProvider value={stacked}>
                    <Page {...props} />
                </StackedProvider>
            </div>
        </div>
    );
}

export default memo(SettingsPanel);
