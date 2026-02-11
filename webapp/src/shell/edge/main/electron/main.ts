import {app, BrowserWindow, nativeImage, dialog, screen} from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import fixPath from 'fix-path';
import electronUpdater, {type UpdateCheckResult} from 'electron-updater';
import log from 'electron-log';
import {setupApplicationMenu} from '@/shell/edge/main/electron/application-menu';
import {StubTextToTreeServerManager} from './server/StubTextToTreeServerManager';
import {RealTextToTreeServerManager} from './server/RealTextToTreeServerManager';
import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance';
import {setupToolsDirectory, getToolsDirectory} from './tools-setup';
import {setupOnboardingDirectory} from './onboarding-setup';
import {startNotificationScheduler, stopNotificationScheduler, recordAppUsage} from './notification-scheduler';
import {migrateAgentPromptIfNeeded} from '@/shell/edge/main/settings/settings_IO';
import {setBackendPort, setMainWindow} from '@/shell/edge/main/state/app-electron-state';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {startOTLPReceiver, stopOTLPReceiver} from '@/shell/edge/main/metrics/otlp-receiver';
import {registerTerminalIpcHandlers} from '@/shell/edge/main/terminals/ipc-terminal-handlers';
import {setupRPCHandlers} from '@/shell/edge/main/edge-auto-rpc/rpc-handler';
import {writeAllPositionsSync} from '@/shell/edge/main/graph/writeAllPositionsOnExit';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {startMcpServer} from '@/shell/edge/main/mcp-server/mcp-server';
import {cleanupOrphanedContextNodes} from '@/shell/edge/main/saveNodePositions';
import {setOnFolderSwitchCleanup, setStartupFolderOverride} from "@/shell/edge/main/state/watch-folder-store";
// Conditionally load trackpad detection (macOS only, optional dependency)
 
let trackpadDetect: { startMonitoring: () => boolean; stopMonitoring: () => void; isTrackpadScroll: () => boolean } | null = null;
if (process.platform === 'darwin') {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        trackpadDetect = require('electron-trackpad-detect');
    } catch {
        console.warn('[Main] electron-trackpad-detect not available');
    }
}

// Redirect all console.* to electron-log in production (handles EPIPE errors on Linux AppImage)
// Writes asynchronously to ~/Library/Logs/Voicetree/ (macOS) or ~/.config/Voicetree/logs/ (Linux)
if (app.isPackaged) {
    Object.assign(console, log.functions);
}

// ============================================================================
// Startup CWD Diagnostics
// ============================================================================
// Log process.cwd() early to diagnose ENOTDIR issues when spawn() inherits it
const startupCwd: string = process.cwd();
//console.log(`[Startup] process.cwd(): ${startupCwd}`);
//console.log(`[Startup] process.execPath: ${process.execPath}`);
//console.log(`[Startup] process.argv: ${JSON.stringify(process.argv)}`);

try {
    fs.accessSync(startupCwd, fs.constants.R_OK);
    //console.log('[Startup] cwd is valid and readable');
} catch (cwdError: unknown) {
    const errorMessage: string = cwdError instanceof Error ? cwdError.message : String(cwdError);
    console.error(`[Startup] WARNING: cwd is INVALID - ${errorMessage}`);
    // Change to a known-good directory to prevent spawn ENOTDIR errors
    // Use app.getPath('home') or '/' as fallback
    const fallbackCwd: string = os.homedir();
    try {
        process.chdir(fallbackCwd);
        //console.log(`[Startup] Changed cwd to fallback: ${fallbackCwd}`);
    } catch (chdirError: unknown) {
        const chdirErrorMessage: string = chdirError instanceof Error ? chdirError.message : String(chdirError);
        console.error(`[Startup] Failed to change to fallback cwd: ${chdirErrorMessage}`);
    }
}

const {autoUpdater} = electronUpdater;



// Fix PATH for macOS/Linux GUI apps
// This ensures the Electron process and all child processes have access to
// binaries installed via Homebrew, npm, etc. that are in the user's shell PATH
fixPath();

// Set app name (shows in macOS menu bar, taskbar, etc.)
app.setName('Voicetree');

// Fresh start mode: use temporary userData to mimic first-time user experience
// Only in development/test mode, opt-out with VOICETREE_PERSIST_STATE=1
// Production builds persist settings to real userData
const isDev: boolean = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
if (process.env.VOICETREE_PERSIST_STATE !== '1' && isDev) {
    const tempDir: string = path.join(os.tmpdir(), `voicetree-fresh-${Date.now()}`);
    app.setPath('userData', tempDir);
    //console.log(`[Fresh Start] Using temporary userData: ${tempDir}`);
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

// Enable remote debugging for Playwright MCP connections
// This allows external Playwright instances to connect via CDP (Chrome DevTools Protocol)
// Port configurable via PLAYWRIGHT_MCP_CDP_ENDPOINT (e.g. http://localhost:9223) to avoid collisions between worktrees
if (process.env.ENABLE_PLAYWRIGHT_DEBUG === '1') {
    let cdpPort: string = '9222';
    const cdpEndpoint: string | undefined = process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
    if (cdpEndpoint) {
        try { cdpPort = new URL(cdpEndpoint).port || '9222'; } catch { /* default */ }
    }
    app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
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
const terminalManager: ReturnType<typeof getTerminalManager> = getTerminalManager();

// Store the TextToTreeServer port (set during app startup)
let textToTreeServerPort: number | null = null;

// ============================================================================
// Functional Graph Architecture
// ============================================================================

function createWindow(): void {
    // Note: BrowserWindow icon property only works on Windows/Linux
    // macOS uses app.dock.setIcon() instead
    const iconPath: string = process.platform === 'darwin'
        ? path.join(__dirname, '../../build/icon.png')
        : path.join(__dirname, '../../build/icon.png');

    // Get full screen dimensions (work area excludes dock/taskbar)
    const primaryDisplay: Electron.Display = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const mainWindow: BrowserWindow = new BrowserWindow({
        width: screenWidth,
        height: screenHeight,
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
    mainWindow.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
        // Filter out Electron security warnings in dev mode
        if (message.includes('Electron Security Warning')) return;

        // const levels: string[] = ['LOG', 'WARNING', 'ERROR'];
        // const levelName: string = levels[level] || 'LOG';

        try {
            //console.log(`[Renderer ${levelName}] ${message} (${sourceId}:${line})`);
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
    const skipDevTools: boolean = process.env.ENABLE_PLAYWRIGHT_DEBUG === '1';
    if (process.env.MINIMIZE_TEST === '1') {
        void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    } else if (process.env.VITE_DEV_SERVER_URL) {
        // electron-vite dev mode
        void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        if (!skipDevTools) mainWindow.webContents.openDevTools();
    } else if (process.env.NODE_ENV === 'development') {
        const devPort: string = process.env.DEV_SERVER_PORT ?? '3000';
        void mainWindow.loadURL(`http://localhost:${devPort}`);
        if (!skipDevTools) mainWindow.webContents.openDevTools();
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
        //console.log('[App] Saving node positions to disk...');
        writeAllPositionsSync(getGraph());
    });

    // Trackpad detection using native addon (macOS only)
    // Uses NSEvent.hasPreciseScrollingDeltas - the authoritative signal for trackpad vs mouse
    if (trackpadDetect) {
        // Start monitoring scroll events for trackpad detection
        const monitoringStarted: boolean = trackpadDetect.startMonitoring();
        if (monitoringStarted) {
            console.log('[Main] Trackpad scroll detection enabled');
        }

        // Listen for scroll wheel events and update trackpad state
        mainWindow.webContents.on('input-event', (_, input) => {
            if (input.type === 'mouseWheel') {
                // Query the native addon for whether this was a trackpad scroll
                // The addon monitors NSEvent and stores the hasPreciseScrollingDeltas value
                const isTrackpad: boolean = trackpadDetect!.isTrackpadScroll();
                uiAPI.setIsTrackpadScrolling(isTrackpad);
            }
        });
    }
}

// Inject dependencies into mainAPI (must be done before IPC handler registration)
registerTerminalIpcHandlers(
    terminalManager,
    getToolsDirectory
);

// Register terminal cleanup for when folders are switched
setOnFolderSwitchCleanup(() => {
    //console.log('[main] Cleaning up terminals on folder switch');
    terminalManager.cleanup();
});

// App event handlers
void app.whenReady().then(async () => {
    console.time('[Startup] Total time to window');

    setupRPCHandlers();
    setupApplicationMenu();

    // Start MCP server in-process (shares graph state with Electron)
    void startMcpServer();

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
    console.time('[Startup] setupToolsDirectory');
    await setupToolsDirectory();
    console.timeEnd('[Startup] setupToolsDirectory');

    // Set up onboarding directory on first launch (skipped in test mode)
    console.time('[Startup] setupOnboardingDirectory');
    await setupOnboardingDirectory();
    console.timeEnd('[Startup] setupOnboardingDirectory');

    // Start the server and store the port it's using
    // Factory automatically chooses StubServer (test) or RealServer (production)
    console.time('[Startup] textToTreeServer.start');
    textToTreeServerPort = await textToTreeServerManager.start();
    console.timeEnd('[Startup] textToTreeServer.start');
    //console.log(`[App] Server started on port ${textToTreeServerPort}`);

    // Inject backend port into mainAPI
    setBackendPort(textToTreeServerPort);

    console.time('[Startup] createWindow');
    createWindow();
    console.timeEnd('[Startup] createWindow');
    console.timeEnd('[Startup] Total time to window');

    // Check if AGENT_PROMPT needs migration to new default
    // Shows dialog after window is ready to ensure proper parent
    const migrationOccurred: boolean = await migrateAgentPromptIfNeeded();
    if (migrationOccurred) {
        const mainWindow: BrowserWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
            void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Agent Prompt Updated',
                message: 'Agent prompt has been updated to the latest version.',
                detail: 'Your previous prompt has been saved to AGENT_PROMPT_PREVIOUS_BACKUP in your settings.',
                buttons: ['OK'],
                defaultId: 0,
            });
        }
    }

    // Start OTLP receiver for Claude Code metrics (port 4318)
    await startOTLPReceiver();

    // Start re-engagement notification scheduler
    startNotificationScheduler();

    //console.log(`[AutoUpdate] CL Check`);
    log.info(`[AutoUpdate] Check)`);
    // Check for updates
    autoUpdater.checkForUpdatesAndNotify()
        .then((result: UpdateCheckResult | null) => {
            if (result) {
                //console.log(`[AutoUpdate] CL Check result: ${result.updateInfo.version} (current: ${app.getVersion()})`);
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
    //console.log('[App] before-quit event - cleaning up resources...');
    // Clean up server process
    textToTreeServerManager.stop();

    // Clean up all terminals
    terminalManager.cleanup();

    // Clean up orphaned context nodes (fire-and-forget, best effort on quit)
    void cleanupOrphanedContextNodes();

    // Stop OTLP receiver
    void stopOTLPReceiver();

    // Stop notification scheduler
    stopNotificationScheduler();

    // Stop trackpad monitoring
    if (trackpadDetect) {
        trackpadDetect.stopMonitoring();
    }
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
                //console.log('[App] Reactivating - restarting server...');
                textToTreeServerPort = await textToTreeServerManager.start();
                //console.log(`[App] Server restarted on port ${textToTreeServerPort}`);
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
