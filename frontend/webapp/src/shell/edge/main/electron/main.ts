import {app, BrowserWindow, nativeImage, dialog, Menu, type MenuItemConstructorOptions} from 'electron';
import path from 'path';
import os from 'os';
import fixPath from 'fix-path';
import electronUpdater, {type UpdateCheckResult} from 'electron-updater';
import log from 'electron-log';
import {startFileWatching, getWatchedDirectory, setStartupFolderOverride} from '@/shell/edge/main/graph/watchFolder';

const {autoUpdater} = electronUpdater;
import {StubTextToTreeServerManager} from './server/StubTextToTreeServerManager';
import {RealTextToTreeServerManager} from './server/RealTextToTreeServerManager';
import TerminalManager from './terminal-manager';
import {setupToolsDirectory, getToolsDirectory} from './tools-setup';
import {setupOnboardingDirectory} from './onboarding-setup';
import {startNotificationScheduler, stopNotificationScheduler, recordAppUsage} from './notification-scheduler';
import {setBackendPort, setMainWindow} from '@/shell/edge/main/state/app-electron-state';
import {registerTerminalIpcHandlers} from '@/shell/edge/main/ipc-terminal-handlers';
import {setupRPCHandlers} from '@/shell/edge/main/edge-auto-rpc/rpc-handler';
import {writeAllPositionsSync} from '@/shell/edge/main/graph/writeAllPositionsOnExit';
import {getGraph} from '@/shell/edge/main/state/graph-store';


// Fix PATH for macOS/Linux GUI apps
// This ensures the Electron process and all child processes have access to
// binaries installed via Homebrew, npm, etc. that are in the user's shell PATH
fixPath();

// Set app name (shows in macOS menu bar, taskbar, etc.)
app.setName('VoiceTree');

// Fresh start mode: use temporary userData to mimic first-time user experience
// Only in development/test mode, opt-out with VOICETREE_PERSIST_STATE=1
// Production builds persist settings to real userData
const isDev: boolean = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
if (process.env.VOICETREE_PERSIST_STATE !== '1' && isDev) {
    const tempDir: string = path.join(os.tmpdir(), `voicetree-fresh-${Date.now()}`);
    app.setPath('userData', tempDir);
    console.log(`[Fresh Start] Using temporary userData: ${tempDir}`);
}

// Parse CLI arguments for --open-folder (used by "Open Folder in New Instance")
const openFolderIndex: number = process.argv.indexOf('--open-folder');
if (openFolderIndex !== -1 && process.argv[openFolderIndex + 1]) {
    setStartupFolderOverride(process.argv[openFolderIndex + 1]);
}

// ============================================================================
// Auto-Update Configuration
// ============================================================================
// Configure auto-updater logging
autoUpdater.logger = log;
if (autoUpdater.logger && 'transports' in autoUpdater.logger) {
    (autoUpdater.logger as typeof log).transports.file.level = 'info';
}
// Ensure updates are installed when the app quits naturally
autoUpdater.autoInstallOnAppQuit = true;

// Send update status messages to renderer process
function sendUpdateStatusToWindow(text: string): void {
    log.info(text);
    const mainWindow: Electron.BrowserWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-message', text);
    }
}

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
                    isQuitting = true; // Prevent macOS hide-on-close from blocking the quit
                    app.removeAllListeners('window-all-closed');
                    mainWindow.close();
                    autoUpdater.quitAndInstall(false, true); // (isSilent=false, isForceRunAfter=true)
                });
            }
            // If user chose "Later", update will install on next natural app restart
        });
    }
});

// Suppress Electron security warnings in development and test environments
// These warnings are only shown in dev mode and don't appear in production
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// Default to minimized/headless mode in test environment (can override with MINIMIZE_TEST=0)
if (process.env.NODE_ENV === 'test' && process.env.MINIMIZE_TEST === undefined) {
    process.env.MINIMIZE_TEST = '1';
}

// Prevent focus stealing in test mode
if (process.env.MINIMIZE_TEST === '1') {
    // Add command line switches to run in background mode
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

// Global manager instances
// TextToTreeServer: Converts text input (voice/typed) to markdown tree structure
// Select implementation based on environment (no fallbacks)
// USE_REAL_SERVER=1 forces real Python server even in test mode (for SSE E2E tests)
const useRealServer: boolean = process.env.USE_REAL_SERVER === '1';
const textToTreeServerManager: StubTextToTreeServerManager | RealTextToTreeServerManager =
    ((process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') && !useRealServer)
        ? new StubTextToTreeServerManager()
        : new RealTextToTreeServerManager();
const terminalManager: TerminalManager = new TerminalManager();

// Store the TextToTreeServer port (set during app startup)
let textToTreeServerPort: number | null = null;

// ============================================================================
// Functional Graph Architecture
// ============================================================================

/**
 * Setup native macOS application menu with File > Open
 */
function setupApplicationMenu(): void {
    const template: MenuItemConstructorOptions[] = [
        {
            label: app.name,
            submenu: [
                {role: 'about'},
                {type: 'separator'},
                {role: 'quit'}
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Folder...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        void startFileWatching();
                    }
                },
                {
                    label: 'Open Folder in New Instance...',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        void (async () => {
                            const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
                                properties: ['openDirectory', 'createDirectory'],
                                title: 'Select Directory to Open in New Instance',
                                buttonLabel: 'Open in New Instance'
                            });
                            if (!result.canceled && result.filePaths.length > 0) {
                                const folderPath: string = result.filePaths[0];
                                const {spawn} = await import('child_process');
                                // Spawn new instance: electron binary + app path + args
                                spawn(process.execPath, [app.getAppPath(), '--open-folder', folderPath], {
                                    detached: true,
                                    stdio: 'ignore'
                                }).unref();
                            }
                        })();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {role: 'undo'},
                {role: 'redo'},
                {type: 'separator'},
                {role: 'cut'},
                {role: 'copy'},
                {role: 'paste'},
                {role: 'selectAll'}
            ]
        },
        {
            label: 'View',
            submenu: [
                {role: 'reload'},
                {role: 'forceReload'},
                {role: 'toggleDevTools'},
                {type: 'separator'},
                {role: 'resetZoom'},
                {role: 'zoomIn'},
                {role: 'zoomOut'}
            ]
        },
        {
            label: 'Window',
            submenu: [
                {role: 'minimize'},
                {role: 'zoom'},
                {role: 'togglefullscreen'},
                {type: 'separator'},
                {role: 'front'}
            ]
        }
    ];

    const menu: Menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createWindow(): void {
    // Note: BrowserWindow icon property only works on Windows/Linux
    // macOS uses app.dock.setIcon() instead
    const iconPath: string = process.platform === 'darwin'
        ? path.join(__dirname, '../../build/icon.png')
        : path.join(__dirname, '../../build/icon.png');

    const mainWindow: BrowserWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        ...(process.platform !== 'darwin' && {icon: iconPath}),
        // macOS: extend web content into title bar (traffic lights remain visible)
        // Requires -webkit-app-region: drag in CSS for draggable areas
        ...(process.platform === 'darwin' && {titleBarStyle: 'hiddenInset'}),
        ...(process.env.MINIMIZE_TEST === '1' && {
            focusable: false,
            skipTaskbar: true
        }),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/index.js')
        }
    });

    // Capture window ID before it gets destroyed
    const windowId: number = mainWindow.webContents.id;

    // Set global main window reference (used by handlers)
    setMainWindow(mainWindow);

    // Pipe renderer console logs to electron terminal
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        // Filter out Electron security warnings in dev mode
        if (message.includes('Electron Security Warning')) return;

        const levels: string[] = ['LOG', 'WARNING', 'ERROR'];
        const levelName: string = levels[level] || 'LOG';

        try {
            console.log(`[Renderer ${levelName}] ${message} (${sourceId}:${line})`);
        } catch (error) {
            // Silently ignore EPIPE errors when stdout/stderr is closed
            // This can happen when the terminal that launched Electron is closed
            if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
                // Re-throw non-EPIPE errors
                throw error;
            }
        }
    });

    // Load the app
    if (process.env.MINIMIZE_TEST === '1') {
        void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    } else if (process.env.VITE_DEV_SERVER_URL) {
        // electron-vite dev mode
        void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    } else if (process.env.NODE_ENV === 'development') {
        const devPort: string = process.env.DEV_SERVER_PORT ?? '3000';
        void mainWindow.loadURL(`http://localhost:${devPort}`);
        mainWindow.webContents.openDevTools();
    } else {
        // Production or test mode
        void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }

    // Control window visibility after content is ready
    mainWindow.once('ready-to-show', () => {
        if (process.env.MINIMIZE_TEST === '1') {
            // For e2e-tests: show window without stealing focus, then minimize
            mainWindow.showInactive();
            mainWindow.hide() // THIS IS THE FINAL THING THAT ACTUALLY WORKED?????????
            // mainWindow.minimize(); // THIS IS ANNOYING IT CAUSES VISUAL ANMIATION
        } else {
            mainWindow.show();
        }
    });

    // Track user activity for re-engagement notifications
    mainWindow.on('focus', () => {
        void recordAppUsage();
    });

    // macOS: Hide window instead of destroying on close (red X button)
    // This preserves state (terminals, editors, graph) for quick reopen from dock
    // Cmd+Q or menu Quit will still fully quit the app via before-quit event
    mainWindow.on('close', (event) => {
        if (process.platform === 'darwin' && !isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // Clean up terminals when window closes
    mainWindow.on('closed', () => {
        terminalManager.cleanupForWindow(windowId);
        // Persist node positions to disk before exit
        // Use watchedDirectory (not vaultPath) because node IDs include the vault suffix
        const watchedDir: string | null = getWatchedDirectory();
        if (watchedDir !== null) {
            console.log('[App] Saving node positions to disk...');
            writeAllPositionsSync(getGraph(), watchedDir);
        }
    });
}

// Inject dependencies into mainAPI (must be done before IPC handler registration)
registerTerminalIpcHandlers(
    terminalManager,
    getToolsDirectory
);

// App event handlers
void app.whenReady().then(async () => {
    setupRPCHandlers();
    setupApplicationMenu();

    // Start MCP server in-process (shares graph state with Electron)
    // void startMcpServer();

    // Set dock icon for macOS (BrowserWindow icon property doesn't work on macOS)
    if (process.platform === 'darwin' && app.dock) {
        const dockIconPath: string = path.join(__dirname, '../../build/icon.png');
        const dockIcon: Electron.NativeImage = nativeImage.createFromPath(dockIconPath);
        app.dock.setIcon(dockIcon);
    }

    // Hide dock icon on macOS when running e2e-tests to prevent focus stealing
    if (process.env.MINIMIZE_TEST === '1' && process.platform === 'darwin' && app.dock) {
        app.dock.hide();
    }

    // Set up agent tools directory on first launch (skipped in test mode)
    await setupToolsDirectory();

    // Set up onboarding directory on first launch (skipped in test mode)
    await setupOnboardingDirectory();

    // Start the server and store the port it's using
    // Factory automatically chooses StubServer (test) or RealServer (production)
    textToTreeServerPort = await textToTreeServerManager.start();
    console.log(`[App] Server started on port ${textToTreeServerPort}`);

    // Inject backend port into mainAPI
    setBackendPort(textToTreeServerPort);

    createWindow();

    // Start re-engagement notification scheduler
    startNotificationScheduler();

    console.log(`[AutoUpdate] CL Check`);
    log.info(`[AutoUpdate] Check)`);
    // Check for updates
    autoUpdater.checkForUpdatesAndNotify()
        .then((result: UpdateCheckResult | null) => {
            if (result) {
                console.log(`[AutoUpdate] CL Check result: ${result.updateInfo.version} (current: ${app.getVersion()})`);
                log.info(`[AutoUpdate] Check result: ${result.updateInfo.version} (current: ${app.getVersion()})`);
            } else {
                log.info('[AutoUpdate] Check returned null (likely dev mode or no-op)');
            }
        })
        .catch((err: Error) => {
            log.error(`[AutoUpdate] Check failed: ${err.message}`);
        });
});

// Track if app is truly quitting (vs window close on macOS)
let isQuitting: boolean = false;

// Handle hot reload and app quit scenarios
// IMPORTANT: before-quit fires on hot reload, window-all-closed does not
app.on('before-quit', () => {
    isQuitting = true;
    console.log('[App] before-quit event - cleaning up resources...');

    // Clean up server process
    textToTreeServerManager.stop();

    // Clean up all terminals
    terminalManager.cleanup();

    // Stop notification scheduler
    stopNotificationScheduler();
});

app.on('window-all-closed', () => {
    // Server cleanup moved to before-quit only to allow macOS to keep server running when window closes
    // This prevents the "worst of both worlds" where app stays in dock but server is dead

    // TODO: terminalManager.cleanup() should maybe also be moved to before-quit only,
    // but it's complicated because the graph renderer (which hosts terminal UI-edge) is destroyed
    // when the window closes, so terminals lose their renderer connection anyway
    terminalManager.cleanup();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    void (async () => {
        const windows: BrowserWindow[] = BrowserWindow.getAllWindows();
        if (windows.length === 0) {
            // Restart server if it's not running (macOS dock click after window close)
            if (!textToTreeServerManager.isRunning()) {
                console.log('[App] Reactivating - restarting server...');
                textToTreeServerPort = await textToTreeServerManager.start();
                console.log(`[App] Server restarted on port ${textToTreeServerPort}`);
                // Inject backend port into mainAPI
                setBackendPort(textToTreeServerPort);
            }
            createWindow();
        } else {
            // Show the hidden window (macOS hide-on-close behavior)
            windows[0].show();
        }
    })();
});
