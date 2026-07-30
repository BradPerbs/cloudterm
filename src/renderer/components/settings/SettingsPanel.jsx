import { memo, useCallback, useState } from 'react';
import SettingsNav, { SETTINGS_CATEGORIES } from './SettingsNav';
import GeneralPage from './pages/GeneralPage';
import AppearancePage from './pages/AppearancePage';
import TerminalPage from './pages/TerminalPage';
import SecurityPage from './pages/SecurityPage';
import AccountPage from './pages/AccountPage';
import BackupPage from './pages/BackupPage';
import AboutPage from './pages/AboutPage';

/** Keyed by the ids in SETTINGS_CATEGORIES, so every category needs an entry. */
const PAGES = {
    general: GeneralPage,
    appearance: AppearancePage,
    terminal: TerminalPage,
    security: SecurityPage,
    account: AccountPage,
    backup: BackupPage,
    about: AboutPage,
};

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

    const changeCategory = useCallback((next) => {
        setCategory(next);
        localStorage.setItem(CATEGORY_KEY, next);
    }, []);

    const Page = PAGES[category] || PAGES.general;

    return (
        <div className="flex items-start gap-6" id="settings-panel">
            <SettingsNav active={category} onChange={changeCategory} />

            <div className="flex-1 min-w-0 max-w-3xl pb-8">
                <Page {...props} />
            </div>
        </div>
    );
}

export default memo(SettingsPanel);
