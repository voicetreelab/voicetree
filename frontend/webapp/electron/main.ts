import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fixPath from 'fix-path';
import FileWatchManager from './file-watch-manager';
import ServerManager from './server-manager';
import TerminalManager from './terminal-manager';
import MarkdownNodeManager from './markdown-node-manager';
import PositionManager from './position-manager';
import { setupToolsDirectory, getToolsDirectory } from './tools-setup';

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
const fileWatchManager = new FileWatchManager();
const serverManager = new ServerManager();
const terminalManager = new TerminalManager();
const nodeManager = new MarkdownNodeManager();
const positionManager = new PositionManager();

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

  // Set the main window reference
  fileWatchManager.setMainWindow(mainWindow);

  // Auto-start watching last directory if it exists
  // TODO: Handle edge cases:
  // - Last directory no longer exists (deleted/moved)
  // - Permission issues accessing last directory
  // - Race condition with manual watch start
  mainWindow.webContents.once('did-finish-load', async () => {
    const lastDirectory = await fileWatchManager.loadLastDirectory();
    if (lastDirectory) {
      console.log(`[AutoWatch] Found last directory: ${lastDirectory}`);
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
    console.log(`[Renderer ${levelName}] ${message} (${sourceId}:${line})`);
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

// IPC handlers for file watching
ipcMain.handle('start-file-watching', async (event, directoryPath) => {
  try {
    let selectedDirectory = directoryPath;

    if (!selectedDirectory) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Directory to Watch for Markdown Files',
        buttonLabel: 'Watch Directory'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No directory selected' };
      }

      selectedDirectory = result.filePaths[0];
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

// File content handlers
ipcMain.handle('save-file-content', async (event, filePath, content) => {
  return await nodeManager.saveContent(filePath, content);
});

ipcMain.handle('delete-file', async (event, filePath) => {
  return await nodeManager.delete(filePath);
});

// Create child node handler
ipcMain.handle('create-child-node', async (event, parentNodeId) => {
  return await nodeManager.createChild(
    parentNodeId,
    fileWatchManager.getWatchedDirectory()
  );
});

// Create standalone node handler
ipcMain.handle('create-standalone-node', async (_event, position?: { x: number; y: number }) => {
  const watchDirectory = fileWatchManager.getWatchedDirectory();
  const result = await nodeManager.createStandaloneNode(watchDirectory);

  // If node creation succeeded and position was provided, save it immediately
  if (result.success && result.filePath && position && watchDirectory) {
    try {
      // Extract relative filename from full path
      const filename = path.basename(result.filePath);
      await positionManager.updatePosition(watchDirectory, filename, position);
      console.log(`[create-standalone-node] Saved position (${position.x}, ${position.y}) for ${filename}`);
    } catch (error) {
      console.error('[create-standalone-node] Failed to save position:', error);
      // Don't fail the whole operation if position save fails
    }
  }

  return result;
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

  // Set up agent tools directory on first launch
  await setupToolsDirectory();

  // Start the Python server before creating window
  await serverManager.start();

  createWindow();
});

app.on('window-all-closed', () => {
  // Clean up server process
  serverManager.stop();

  // Clean up all terminals
  terminalManager.cleanup();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Restart server if it's not running (macOS dock click after window close)
    if (!serverManager.isRunning()) {
      console.log('[App] Reactivating - restarting server...');
      await serverManager.start();
    }
    createWindow();
  }
});
