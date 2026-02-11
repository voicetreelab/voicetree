/// <reference types="node" />
import {app, BrowserWindow, nativeImage, dialog} from 'electron';
import path from 'path';
import electronUpdater, {type UpdateCheckResult} from 'electron-updater';
import log from 'electron-log';
import {setupApplicationMenu} from '@/shell/edge/main/electron/application-menu';
import {StubTextToTreeServerManager} from './server/StubTextToTreeServerManager';
import {RealTextToTreeServerManager} from './server/RealTextToTreeServerManager';
import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance';
import {setupToolsDirectory, getToolsDirectory} from './tools-setup';
import {setupOnboardingDirectory} from './onboarding-setup';
import {startNotificationScheduler, stopNotificationScheduler} from './notification-scheduler';
import {migrateAgentPromptIfNeeded} from '@/shell/edge/main/settings/settings_IO';
import {setBackendPort} from '@/shell/edge/main/state/app-electron-state';
import {startOTLPReceiver, stopOTLPReceiver} from '@/shell/edge/main/metrics/otlp-receiver';
import {registerTerminalIpcHandlers} from '@/shell/edge/main/terminals/ipc-terminal-handlers';
import {setupRPCHandlers} from '@/shell/edge/main/edge-auto-rpc/rpc-handler';
import {startMcpServer} from '@/shell/edge/main/mcp-server/mcp-server';
import {cleanupOrphanedContextNodes} from '@/shell/edge/main/saveNodePositions';
import {setOnFolderSwitchCleanup} from "@/shell/edge/main/state/watch-folder-store";
import {validateStartupCwd} from './startup-diagnostics';
import {configureEnvironment} from './environment-config';
import {setupAutoUpdater} from './auto-updater-setup';
import {createWindow, stopTrackpadMonitoring} from './create-window';

// Redirect all console.* to electron-log in production (handles EPIPE errors on Linux AppImage)
// Writes asynchronously to ~/Library/Logs/Voicetree/ (macOS) or ~/.config/Voicetree/logs/ (Linux)
if (app.isPackaged) {
    Object.assign(console, log.functions);
}

// ============================================================================
// Startup
// ============================================================================
validateStartupCwd();

const {autoUpdater} = electronUpdater;

configureEnvironment();
setupAutoUpdater(autoUpdater, () => isQuitting, (v: boolean) => { isQuitting = v; });

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

    // Inject backend port into mainAPI
    setBackendPort(textToTreeServerPort);

    console.time('[Startup] createWindow');
    createWindow({terminalManager, isQuitting: () => isQuitting});
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
    stopTrackpadMonitoring();
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
            createWindow({terminalManager, isQuitting: () => isQuitting});
        } else {
            // Show the hidden window (macOS hide-on-close behavior)
            windows[0].show();
        }
    })();
});
