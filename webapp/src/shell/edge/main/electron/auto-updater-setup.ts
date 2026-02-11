/// <reference types="node" />
import {app, BrowserWindow, dialog} from 'electron';
import type {AppUpdater} from 'electron-updater';
import log from 'electron-log';

/** Send update status messages to the renderer process via IPC. */
function sendUpdateStatusToWindow(text: string): void {
    log.info(text);
    const mainWindow: Electron.BrowserWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-message', text);
    }
}

/**
 * Wire up all auto-updater event handlers: logging, download progress,
 * and the update-downloaded dialog that offers "Restart Now / Later".
 *
 * `isQuitting` is managed in main.ts; getter/setter callbacks keep
 * this module free of shared mutable state.
 */
export function setupAutoUpdater(
    autoUpdater: AppUpdater,
    _getIsQuitting: () => boolean,
    setIsQuitting: (v: boolean) => void
): void {
    // Configure auto-updater logging
    autoUpdater.logger = log;
    if (autoUpdater.logger && 'transports' in autoUpdater.logger) {
        (autoUpdater.logger as typeof log).transports.file.level = 'info';
    }
    // Ensure updates are installed when the app quits naturally
    autoUpdater.autoInstallOnAppQuit = true;

    // Auto-update event handlers
    autoUpdater.on('checking-for-update', () => {
        sendUpdateStatusToWindow('Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        sendUpdateStatusToWindow(`Update available: ${info.version}`);
    });

    autoUpdater.on('update-not-available', () => {
        sendUpdateStatusToWindow('App is up to date.');
    });

    autoUpdater.on('error', (err) => {
        sendUpdateStatusToWindow(`Error in auto-updater: ${err.toString()}`);
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const message: string = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
        sendUpdateStatusToWindow(message);
    });

    autoUpdater.on('update-downloaded', (info) => {
        sendUpdateStatusToWindow('Update downloaded. Will install on quit.');

        // Show native dialog asking user if they want to install now
        const mainWindow: Electron.BrowserWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
            void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Ready',
                message: `Version ${info.releaseName} is ready to install`,
                detail: 'The update will be installed the next time you restart the app. Would you like to restart now?',
                buttons: ['Restart Now', 'Later'],
                defaultId: 0,
                cancelId: 1
            }).then((result) => {
                if (result.response === 0) {
                    // User chose "Restart Now"
                    // Use setImmediate to ensure dialog is fully released before quit
                    // Remove window-all-closed listeners to prevent them blocking the quit
                    // See: https://github.com/electron-userland/electron-builder/issues/1604
                    setImmediate(() => {
                        setIsQuitting(true); // Prevent macOS hide-on-close from blocking the quit
                        app.removeAllListeners('window-all-closed');
                        mainWindow.close();
                        autoUpdater.quitAndInstall(false, true); // (isSilent=false, isForceRunAfter=true)
                    });
                }
                // If user chose "Later", update will install on next natural app restart
            });
        }
    });
}
