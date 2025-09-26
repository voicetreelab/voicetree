const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');

class FileWatchManager {
  constructor() {
    this.watcher = null;
    this.watchedDirectory = null;
    this.mainWindow = null;
  }

  setMainWindow(window) {
    this.mainWindow = window;
  }

  async startWatching(directoryPath) {
    // Stop any existing watcher
    await this.stopWatching();

    try {
      // Verify directory exists and is accessible
      await fs.access(directoryPath, fs.constants.R_OK);

      this.watchedDirectory = directoryPath;

      // Configure chokidar watcher with optimized settings
      this.watcher = chokidar.watch('**/*.md', {
        cwd: directoryPath,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.*', // Hidden files except .md
          '**/*.tmp',
          '**/*.temp'
        ],
        persistent: true,
        ignoreInitial: false,
        followSymlinks: false,
        depth: 99,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50
        },
        usePolling: false // Use native events when possible
      });

      // Set up event listeners
      this.setupWatcherListeners();

      console.log(`Started watching directory: ${directoryPath}`);
      return { success: true, directory: directoryPath };

    } catch (error) {
      console.error('Failed to start file watching:', error);

      let errorMessage = 'Unknown error occurred';
      if (error.code === 'ENOENT') {
        errorMessage = 'Directory does not exist';
      } else if (error.code === 'EACCES') {
        errorMessage = 'Access denied to directory';
      } else if (error.code === 'EPERM') {
        errorMessage = 'Permission denied';
      } else {
        errorMessage = error.message;
      }

      this.sendToRenderer('file-watch-error', {
        type: 'start_failed',
        message: errorMessage,
        directory: directoryPath
      });

      return { success: false, error: errorMessage };
    }
  }

  setupWatcherListeners() {
    if (!this.watcher) return;

    // File added
    this.watcher.on('add', async (filePath) => {
      try {
        const fullPath = path.join(this.watchedDirectory, filePath);
        const content = await this.readFileWithRetry(fullPath);
        const stats = await fs.stat(fullPath);

        this.sendToRenderer('file-added', {
          path: filePath,
          fullPath: fullPath,
          content: content,
          size: stats.size,
          modified: stats.mtime.toISOString()
        });
      } catch (error) {
        console.error(`Error reading added file ${filePath}:`, error);
        this.sendToRenderer('file-watch-error', {
          type: 'read_error',
          message: `Failed to read added file: ${error.message}`,
          filePath: filePath
        });
      }
    });

    // File changed
    this.watcher.on('change', async (filePath) => {
      try {
        const fullPath = path.join(this.watchedDirectory, filePath);
        const content = await this.readFileWithRetry(fullPath);
        const stats = await fs.stat(fullPath);

        this.sendToRenderer('file-changed', {
          path: filePath,
          fullPath: fullPath,
          content: content,
          size: stats.size,
          modified: stats.mtime.toISOString()
        });
      } catch (error) {
        console.error(`Error reading changed file ${filePath}:`, error);
        this.sendToRenderer('file-watch-error', {
          type: 'read_error',
          message: `Failed to read changed file: ${error.message}`,
          filePath: filePath
        });
      }
    });

    // File deleted
    this.watcher.on('unlink', (filePath) => {
      this.sendToRenderer('file-deleted', {
        path: filePath,
        fullPath: path.join(this.watchedDirectory, filePath)
      });
    });

    // Directory added
    this.watcher.on('addDir', (dirPath) => {
      this.sendToRenderer('directory-added', {
        path: dirPath,
        fullPath: path.join(this.watchedDirectory, dirPath)
      });
    });

    // Directory deleted
    this.watcher.on('unlinkDir', (dirPath) => {
      this.sendToRenderer('directory-deleted', {
        path: dirPath,
        fullPath: path.join(this.watchedDirectory, dirPath)
      });
    });

    // Initial scan complete
    this.watcher.on('ready', () => {
      console.log('Initial scan complete');
      this.sendToRenderer('initial-scan-complete', {
        directory: this.watchedDirectory
      });
    });

    // Watch error
    this.watcher.on('error', (error) => {
      console.error('File watcher error:', error);

      let errorMessage = error.message;
      let errorType = 'watch_error';

      if (error.code === 'ENOENT' && error.path === this.watchedDirectory) {
        errorType = 'directory_deleted';
        errorMessage = 'Watched directory was deleted';
        // Auto-stop watching when directory is deleted
        this.stopWatching();
      }

      this.sendToRenderer('file-watch-error', {
        type: errorType,
        message: errorMessage,
        directory: this.watchedDirectory
      });
    });
  }

  async readFileWithRetry(filePath, maxRetries = 3, delay = 100) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const stats = await fs.stat(filePath);

        // Handle large files efficiently
        if (stats.size > 1024 * 1024) { // 1MB threshold
          this.sendToRenderer('file-watch-info', {
            type: 'large_file_reading',
            message: `Reading large file (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${path.basename(filePath)}`
          });
        }

        const content = await fs.readFile(filePath, 'utf8');
        return content;

      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  async stopWatching() {
    if (this.watcher) {
      try {
        await this.watcher.close();
        console.log('File watcher stopped');
      } catch (error) {
        console.error('Error stopping file watcher:', error);
      }

      this.watcher = null;
      this.watchedDirectory = null;

      this.sendToRenderer('file-watching-stopped');
    }
  }

  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  isWatching() {
    return this.watcher !== null;
  }

  getWatchedDirectory() {
    return this.watchedDirectory;
  }
}

// Global file watch manager instance
const fileWatchManager = new FileWatchManager();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
  if (process.env.HEADLESS_TEST === '1') {
    // For Playwright tests, always load built files
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  } else if (process.env.NODE_ENV === 'development') {
    // For testing, load our simple test HTML file
    if (process.env.TEST_FILE_WATCHER) {
      mainWindow.loadFile(path.join(__dirname, 'test-electron.html'));
    } else {
      mainWindow.loadURL('http://localhost:3000');
    }
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
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
  return {
    isWatching: fileWatchManager.isWatching(),
    directory: fileWatchManager.getWatchedDirectory()
  };
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