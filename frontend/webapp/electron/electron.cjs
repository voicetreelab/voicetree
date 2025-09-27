const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const FileWatchManager = require('./file-watch-manager.cjs');

// Global file watch manager instance
const fileWatchManager = new FileWatchManager();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't show initially, we'll control it below
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set the main window reference
  fileWatchManager.setMainWindow(mainWindow);

  // Load the app
  if (process.env.MINIMIZE_TEST === '1') {
    // For Playwright tests, always load built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Control window visibility after content is ready
  mainWindow.once('ready-to-show', () => {
    if (process.env.MINIMIZE_TEST === '1') {
      // For tests: show window but minimize it immediately
      mainWindow.show();
      mainWindow.minimize();
    } else {
      // Normal operation: just show the window
      mainWindow.show();
    }
  });
}

// IPC handlers
ipcMain.handle('start-file-watching', async (event, directoryPath) => {
  try {
    let selectedDirectory = directoryPath;

    // If no directory provided, show directory picker
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

  } catch (error) {
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
  } catch (error) {
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
  console.log('Watch status requested:', status, 'watcher exists:', !!fileWatchManager.watcher);
  return status;
});

ipcMain.handle('save-file-content', async (event, filePath, content) => {
  try {
    // The watcher gets the absolute path, so we expect one here.
    // No need to join with watchedDirectory.
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    console.error(`Failed to save file ${filePath}:`, error);
    return { success: false, error: error.message };
  }
});

// App event handlers
app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  // Clean up file watcher before quitting
  await fileWatchManager.stopWatching();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean up on app quit
app.on('before-quit', async () => {
  await fileWatchManager.stopWatching();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  fileWatchManager.stopWatching();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});