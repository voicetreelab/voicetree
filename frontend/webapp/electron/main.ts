import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import fixPath from 'fix-path';
import FileWatchHandler from './handlers/file-watch-handler';
import { StubTextToTreeServerManager } from './server/StubTextToTreeServerManager';
import { RealTextToTreeServerManager } from './server/RealTextToTreeServerManager';
import TerminalManager from './terminal-manager';
import PositionManager from './position-manager';
import { setupToolsDirectory, getToolsDirectory } from './tools-setup';
import { loadGraphFromDisk } from '../src/functional_graph/shell/main/load-graph-from-disk';
import './handlers/ipc-graph-handlers'; // Auto-registers IPC handlers
import type { Graph } from '../src/functional_graph/pure/types';

// Fix PATH for macOS/Linux GUI apps
// This ensures the Electron process and all child processes have access to
// binaries installed via Homebrew, npm, etc. that are in the user's shell PATH
fixPath();

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
const fileWatchManager = new FileWatchHandler();
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

// The ONLY mutable state in the functional architecture
let currentGraph: Graph | null = null;
let currentVaultPath: string | null = null;
let currentMainWindow: BrowserWindow | null = null;
let isGraphInitialized = false; // Guard against double initialization

// Getter/setter for controlled access to graph state
export const getGraph = (): Graph => {
  if (!currentGraph) {
    throw new Error('Graph not initialized');
  }
  return currentGraph;
};

export const setGraph = (graph: Graph): void => {
  currentGraph = graph;
};

// Getter/setter for controlled access to vault path
export const getVaultPath = (): string => {
  if (!currentVaultPath) {
    throw new Error('Vault path not initialized');
  }
  return currentVaultPath;
};

export const setVaultPath = (path: string): void => {
  currentVaultPath = path;
};

// Getter/setter for controlled access to main window
export const getMainWindow = (): BrowserWindow => {
  if (!currentMainWindow) {
    throw new Error('Main window not initialized');
  }
  return currentMainWindow;
};

export const setMainWindow = (window: BrowserWindow): void => {
  currentMainWindow = window;
};

/**
 * Initialize functional graph from disk.
 * MUST be called BEFORE any file watching starts.
 * Safe to call multiple times - will only initialize once.
 *
 * @param vaultPath - Path to the vault directory
 */
async function initializeFunctionalGraph(vaultPath: string): Promise<void> {
  // Guard against double initialization
  if (isGraphInitialized) {
    console.log('[FunctionalGraph] Already initialized, skipping');
    return;
  }

  try {
    console.log('[FunctionalGraph] Loading graph from disk...');

    // Step 1: Set global vault path (used by handlers)
    setVaultPath(vaultPath);

    // Step 2: Load graph from disk (IO effect)
    const loadGraph = loadGraphFromDisk(vaultPath);
    currentGraph = await loadGraph();
    console.log(`[FunctionalGraph] Loaded ${Object.keys(currentGraph.nodes).length} nodes`);

    // Step 3: Inject graph dependencies into FileWatchHandler
    fileWatchManager.setGraphDependencies(getGraph, setGraph, getVaultPath);
    console.log('[FunctionalGraph] Graph dependencies injected into FileWatchHandler');

    isGraphInitialized = true;
    console.log('[FunctionalGraph] Initialization complete');
  } catch (error) {
    console.error('[FunctionalGraph] Failed to initialize:', error);
    throw error; // Fail fast - don't start file watching if graph init fails
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // titleBarStyle: 'hiddenInset', //todo enable this later, but we need soemthing to be able to drag the window by and double click to maximize.
    ...(process.env.MINIMIZE_TEST === '1' && {
      focusable: false,
      skipTaskbar: true
    }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  });

  // Capture window ID before it gets destroyed
  const windowId = mainWindow.webContents.id;

  // Set global main window reference (used by handlers)
  setMainWindow(mainWindow);

  // Set the main window reference for managers
  fileWatchManager.setMainWindow(mainWindow);
  fileWatchManager.setPositionManager(positionManager);

  // Auto-start watching last directory if it exists
  // Uses 'on' instead of 'once' to handle page refreshes (cmd+r)
  // FileWatchHandler intelligently handles re-watching the same directory
  // TODO: Handle edge cases:
  // - Last directory no longer exists (deleted/moved)
  // - Permission issues accessing last directory
  // - Race condition with manual watch start
  mainWindow.webContents.on('did-finish-load', async () => {
    // Skip auto-loading in test mode to avoid blocking app startup
    if (process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') {
      console.log('[AutoWatch] Skipping auto-load in test mode');
      return;
    }

    const lastDirectory = await fileWatchManager.loadLastDirectory();
    if (lastDirectory) {
      console.log(`[AutoWatch] Found last directory: ${lastDirectory}`);

      // CRITICAL: Initialize functional graph BEFORE starting file watching
      // File watch handlers need the graph to exist when events fire
      try {
        await initializeFunctionalGraph(lastDirectory);
      } catch (error) {
        console.error('[AutoWatch] Graph initialization failed, skipping file watch:', error);
        return;
      }

      console.log(`[AutoWatch] Auto-starting watch...`);
      await fileWatchManager.startWatching(lastDirectory);
    }
  });

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
      // For tests: show window without stealing focus, then minimize
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

// IPC handler for backend server port
ipcMain.handle('get-backend-port', () => {
  return textToTreeServerPort;
});

// IPC handlers for file watching
ipcMain.handle('start-file-watching', async (event, directoryPath) => {
  try {
    let selectedDirectory = directoryPath;

    if (!selectedDirectory) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Directory to Watch for Markdown Files',
        buttonLabel: 'Watch Directory'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No directory selected' };
      }

      selectedDirectory = result.filePaths[0];
    }

    // FAIL FAST: Validate directory exists before proceeding
    if (!fs.existsSync(selectedDirectory)) {
      const error = `Directory does not exist: ${selectedDirectory}`;
      console.error('[IPC] start-file-watching failed:', error);
      return { success: false, error };
    }

    if (!fs.statSync(selectedDirectory).isDirectory()) {
      const error = `Path is not a directory: ${selectedDirectory}`;
      console.error('[IPC] start-file-watching failed:', error);
      return { success: false, error };
    }

    // Get main window for handlers
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      return { success: false, error: 'No main window found' };
    }

    // CRITICAL: Initialize functional graph BEFORE starting file watching
    // File watch handlers need the graph to exist when events fire
    try {
      await initializeFunctionalGraph(selectedDirectory);
    } catch (error) {
      console.error('[IPC] Graph initialization failed:', error);
      return {
        success: false,
        error: `Failed to initialize graph: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }

    return await fileWatchManager.startWatching(selectedDirectory);
  } catch (error: any) {
    console.error('Error in start-file-watching handler:', error);
    return {
      success: false,
      error: `Failed to start file watching: ${error.message}`
    };
  }
});

ipcMain.handle('stop-file-watching', async () => {
  try {
    await fileWatchManager.stopWatching();
    return { success: true };
  } catch (error: any) {
    console.error('Error in stop-file-watching handler:', error);
    return {
      success: false,
      error: `Failed to stop file watching: ${error.message}`
    };
  }
});

ipcMain.handle('get-watch-status', () => {
  const status = {
    isWatching: fileWatchManager.isWatching(),
    directory: fileWatchManager.getWatchedDirectory()
  };
  console.log('Watch status:', status);
  return status;
});


// Terminal IPC handlers
ipcMain.handle('terminal:spawn', async (event, nodeMetadata) => {
  console.log('[MAIN] terminal:spawn IPC called, event.sender.id:', event.sender.id);
  const result = await terminalManager.spawn(
    event.sender,
    nodeMetadata,
    () => fileWatchManager.getWatchedDirectory(),
    getToolsDirectory
  );
  console.log('[MAIN] terminal:spawn result:', result);
  return result;
});

ipcMain.handle('terminal:write', async (event, terminalId, data) => {
  return terminalManager.write(terminalId, data);
});

ipcMain.handle('terminal:resize', async (event, terminalId, cols, rows) => {
  return terminalManager.resize(terminalId, cols, rows);
});

ipcMain.handle('terminal:kill', async (event, terminalId) => {
  return terminalManager.kill(terminalId);
});

// Position management IPC handlers
ipcMain.handle('positions:save', async (event, directoryPath, positions) => {
  try {
    await positionManager.savePositions(directoryPath, positions);
    return { success: true };
  } catch (error: any) {
    console.error('[MAIN] Error saving positions:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('positions:load', async (event, directoryPath) => {
  try {
    const positions = await positionManager.loadPositions(directoryPath);
    return { success: true, positions };
  } catch (error: any) {
    console.error('[MAIN] Error loading positions:', error);
    return { success: false, error: error.message, positions: {} };
  }
});

// App event handlers
app.whenReady().then(async () => {
  // Hide dock icon on macOS when running tests to prevent focus stealing
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
});

// Handle hot reload and app quit scenarios
// IMPORTANT: before-quit fires on hot reload, window-all-closed does not
app.on('before-quit', (event) => {
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
