import { memo } from 'react';
import HostsPanel from './HostsPanel';
import KeychainPanel from './KeychainPanel';
import ProxiesPanel from './ProxiesPanel';
import SnippetsPanel from './SnippetsPanel';
import LogsPanel from './LogsPanel';
import SettingsPanel from './settings/SettingsPanel';

function HomeView({
    activeNav,
    // Home stays mounted behind a terminal tab. Panels that can open a sheet
    // need to know when they are no longer the thing on screen.
    isActive = true,
    // Bumped when the chrome asks for the page that is already up, which is a
    // way of asking for whatever is over it to go. See App.
    reachedForPage = 0,
    hosts,
    folders,
    allHosts,
    allFolders,
    currentFolderId,
    connectedHostIds,
    theme,
    appColors,
    showLogo,
    logoImage,
    logoSide,
    terminalTheme,
    customTerminalTheme,
    terminalSettings,
    terminalFonts,
    onThemeChange,
    onAppColorsChange,
    onShowLogoChange,
    onLogoImageChange,
    onLogoSideChange,
    onTerminalThemeChange,
    onCustomTerminalThemeChange,
    onTerminalSettingsChange,
    onTerminalSettingsReset,
    onDataImported,
    onNewHost,
    onEditHost,
    onDuplicateHost,
    onDeleteHost,
    onConnect,
    onNewFolder,
    onCreateFolder,
    onEditFolder,
    onDeleteFolder,
    onDeleteMany,
    onNavigateFolder,
    onArrange,
    onTagHosts,
    // Keychain props
    keys,
    onLoadKeys,
    onSaveKey,
    onDeleteKey,
    onGenerateKey,
}) {
    return (
        <div className="absolute inset-0 flex flex-col p-6 overflow-y-auto" id="home-view">
            {activeNav === 'hosts' && (
                <HostsPanel
                    isActive={isActive}
                    reachedForPage={reachedForPage}
                    hosts={hosts}
                    folders={folders}
                    allHosts={allHosts}
                    allFolders={allFolders}
                    currentFolderId={currentFolderId}
                    connectedHostIds={connectedHostIds}
                    onNewHost={onNewHost}
                    onEditHost={onEditHost}
                    onDuplicateHost={onDuplicateHost}
                    onDeleteHost={onDeleteHost}
                    onConnect={onConnect}
                    onNewFolder={onNewFolder}
                    onCreateFolder={onCreateFolder}
                    onEditFolder={onEditFolder}
                    onDeleteFolder={onDeleteFolder}
                    onDeleteMany={onDeleteMany}
                    onNavigateFolder={onNavigateFolder}
                    onArrange={onArrange}
                    onTagHosts={onTagHosts}
                />
            )}

            {activeNav === 'keychain' && (
                <KeychainPanel
                    isActive={isActive}
                    reachedForPage={reachedForPage}
                    keys={keys}
                    // So a key can say how many hosts are relying on it, and so
                    // deleting one can name them rather than breaking them
                    // quietly at the next connection attempt.
                    allHosts={allHosts}
                    onLoadKeys={onLoadKeys}
                    onSaveKey={onSaveKey}
                    onDeleteKey={onDeleteKey}
                    onGenerateKey={onGenerateKey}
                />
            )}

            {activeNav === 'proxies' && (
                // `allHosts` so a proxy can say how many hosts are dialling
                // through it, and so deleting one can name them rather than
                // quietly putting their traffic back on the local network.
                <ProxiesPanel isActive={isActive} reachedForPage={reachedForPage} allHosts={allHosts} />
            )}

            {activeNav === 'snippets' && (
                <SnippetsPanel isActive={isActive} reachedForPage={reachedForPage} allHosts={allHosts} />
            )}

            {activeNav === 'logs' && (
                <LogsPanel isActive={isActive} reachedForPage={reachedForPage} />
            )}

            {activeNav === 'settings' && (
                <SettingsPanel
                    theme={theme}
                    appColors={appColors}
                    showLogo={showLogo}
                    logoImage={logoImage}
                    logoSide={logoSide}
                    terminalTheme={terminalTheme}
                    customTerminalTheme={customTerminalTheme}
                    terminalSettings={terminalSettings}
                    terminalFonts={terminalFonts}
                    onThemeChange={onThemeChange}
                    onAppColorsChange={onAppColorsChange}
                    onShowLogoChange={onShowLogoChange}
                    onLogoImageChange={onLogoImageChange}
                    onLogoSideChange={onLogoSideChange}
                    onTerminalThemeChange={onTerminalThemeChange}
                    onCustomTerminalThemeChange={onCustomTerminalThemeChange}
                    onTerminalSettingsChange={onTerminalSettingsChange}
                    onTerminalSettingsReset={onTerminalSettingsReset}
                    onDataImported={onDataImported}
                />
            )}
        </div>
    );
}

export default memo(HomeView);
