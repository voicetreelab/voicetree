import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fixPath from 'fix-path';
import electronUpdater from 'electron-updater';
import log from 'electron-log';

const { autoUpdater } = electronUpdater;
import { StubTextToTreeServerManager } from './server/StubTextToTreeServerManager.ts';
import { RealTextToTreeServerManager } from './server/RealTextToTreeServerManager.ts';
import TerminalManager from './terminal-manager.ts';
import PositionManager from './position-manager.ts';
import { setupToolsDirectory, getToolsDirectory } from './tools-setup.ts';
import { setMainWindow } from '@/functional/shell/state/app-electron-state.ts';
import { registerAllIpcHandlers } from '@/functional/shell/main/graph/ipc-graph-handlers.ts';

// Fix PATH for macOS/Linux GUI apps
// This ensures the Electron process and all child processes have access to
// binaries installed via Homebrew, npm, etc. that are in the user's shell PATH
fixPath();

// Set app name (shows in macOS menu bar, taskbar, etc.)
app.setName('VoiceTree');

// ============================================================================
// Auto-Update Configuration
// ============================================================================
// Configure auto-updater logging
autoUpdater.logger = log;
if (autoUpdater.logger && 'transports' in autoUpdater.logger) {
  (autoUpdater.logger as typeof log).transports.file.level = 'info';
}

// Send update status messages to renderer process
function sendUpdateStatusToWindow(text: string) {
  log.info(text);
  const mainWindow = BrowserWindow.getAllWindows()[0];
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
  const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
  sendUpdateStatusToWindow(message);
});

autoUpdater.on('update-downloaded', () => {
  sendUpdateStatusToWindow('Update downloaded. Will install on quit.');
});

// Suppress Electron security warnings in development and test environments
// These warnings are only shown in dev mode and don't appear in production
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
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
const textToTreeServerManager = (process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1')
  ? new StubTextToTreeServerManager()
  : new RealTextToTreeServerManager();
const terminalManager = new TerminalManager();
const positionManager = new PositionManager();

// Store the TextToTreeServer port (set during app startup)
let textToTreeServerPort: number | null = null;

// ============================================================================
// Functional Graph Architecture
// ============================================================================

function createWindow() {
  // Note: BrowserWindow icon property only works on Windows/Linux
  // macOS uses app.dock.setIcon() instead
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(__dirname, '../../build/icon.png');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    ...(process.platform !== 'darwin' && { icon: iconPath }),
    // titleBarStyle: 'hiddenInset', //todo enable this later, but we need soemthing to be able to drag the window by and double click to maximize.
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
  const windowId = mainWindow.webContents.id;

  // Set global main window reference (used by handlers)
  setMainWindow(mainWindow);

  // Auto-start watching last directory if it exists
  // Uses 'on' instead of 'once' to handle page refreshes (cmd+r)
  // TODO: Handle edge cases:
  // - Last directory no longer exists (deleted/moved)
  // - Permission issues accessing last directory
  // - Race condition with manual watch start
  // mainWindow.webContents.on('did-finish-load', async () => {
  //   // Skip auto-loading in test mode to avoid blocking app startup
  //   if (process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') {
  //     console.log('[AutoWatch] Skipping auto-load in test mode');
  //     return;
  //   }
  //
  //   // Load last directory and set up file watching using functional approach
  //   // await initialLoad(); THIS IS INSTEAD CALLED FROM UI
  // });

  // Pipe renderer console logs to electron terminal
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // Filter out Electron security warnings in dev mode
    if (message.includes('Electron Security Warning')) return;

    const levels = ['LOG', 'WARNING', 'ERROR'];
    const levelName = levels[level] || 'LOG';

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
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  } else if (process.env.VITE_DEV_SERVER_URL) {
    // electron-vite dev mode
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_SERVER_PORT || '3000';
    mainWindow.loadURL(`http://localhost:${devPort}`);
    mainWindow.webContents.openDevTools();
  } else {
    // Production or test mode
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
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

  // Clean up terminals when window closes
  mainWindow.on('closed', () => {
    terminalManager.cleanupForWindow(windowId);
  });
}

// Register all IPC handlers
registerAllIpcHandlers({
  terminalManager,
  positionManager,
  getBackendPort: () => textToTreeServerPort,
  getToolsDirectory
});

// App event handlers
app.whenReady().then(async () => {
  // Set dock icon for macOS (BrowserWindow icon property doesn't work on macOS)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, '../../build/icon.png');
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock.setIcon(dockIcon);
  }

  // Hide dock icon on macOS when running e2e-tests to prevent focus stealing
  if (process.env.MINIMIZE_TEST === '1' && process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Set up agent tools directory on first launch (skipped in test mode)
  await setupToolsDirectory();

  // Start the server and store the port it's using
  // Factory automatically chooses StubServer (test) or RealServer (production)
  textToTreeServerPort = await textToTreeServerManager.start();
  console.log(`[App] Server started on port ${textToTreeServerPort}`);

  createWindow();

  // Check for updates (production only, not in dev or test mode)
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test' && !process.env.MINIMIZE_TEST) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

// Handle hot reload and app quit scenarios
// IMPORTANT: before-quit fires on hot reload, window-all-closed does not
app.on('before-quit', () => {
  console.log('[App] before-quit event - cleaning up resources...');

  // Clean up server process
  textToTreeServerManager.stop();

  // Clean up all terminals
  terminalManager.cleanup();
});

app.on('window-all-closed', () => {
  // Server cleanup moved to before-quit only to allow macOS to keep server running when window closes
  // This prevents the "worst of both worlds" where app stays in dock but server is dead

  // TODO: terminalManager.cleanup() should maybe also be moved to before-quit only,
  // but it's complicated because the graph renderer (which hosts terminal UI) is destroyed
  // when the window closes, so terminals lose their renderer connection anyway
  terminalManager.cleanup();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Restart server if it's not running (macOS dock click after window close)
    if (!textToTreeServerManager.isRunning()) {
      console.log('[App] Reactivating - restarting server...');
      textToTreeServerPort = await textToTreeServerManager.start();
      console.log(`[App] Server restarted on port ${textToTreeServerPort}`);
    }
    createWindow();
  }
});
