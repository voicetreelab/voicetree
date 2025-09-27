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

    console.log(`[FileWatchManager] Starting to watch: ${directoryPath}`);

    try {
      // Verify directory exists and is accessible
      await fs.access(directoryPath, fs.constants.R_OK);
      console.log(`[FileWatchManager] Directory accessible: ${directoryPath}`);

      this.watchedDirectory = directoryPath;

      // Configure chokidar watcher with optimized settings
      console.log(`[FileWatchManager] Creating chokidar watcher for *.md files`);
      // IMPORTANT: Watch the directory itself, not a glob pattern
      // Glob patterns don't work reliably with chokidar 4.x
      this.watcher = chokidar.watch(directoryPath, {
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.*', // Hidden files
          '**/*.tmp',
          '**/*.temp',
          // Ignore non-markdown files
          (path) => {
            // Only watch .md files and directories
            try {
              const stats = require('fs').statSync(path);
              if (stats.isDirectory()) return false; // Don't ignore directories
            } catch (e) {
              // File might not exist yet
            }
            return !path.endsWith('.md');
          }
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

      console.log(`[FileWatchManager] Watcher created and listeners attached`);
      console.log(`[FileWatchManager] Started watching directory: ${directoryPath}`);

      // Emit watching-started event to sync UI state
      this.sendToRenderer('watching-started', {
        directory: directoryPath,
        timestamp: new Date().toISOString()
      });

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
      console.log(`File detected: ${filePath} in directory: ${this.watchedDirectory}`);
      try {
        // filePath is already absolute when watching a directory
        const fullPath = filePath;
        const relativePath = path.relative(this.watchedDirectory, filePath);
        const content = await this.readFileWithRetry(fullPath);
        const stats = await fs.stat(fullPath);

        console.log(`Sending file-added event for: ${relativePath}`);
        this.sendToRenderer('file-added', {
          path: relativePath,
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
        // filePath is already absolute when watching a directory
        const fullPath = filePath;
        const relativePath = path.relative(this.watchedDirectory, filePath);
        const content = await this.readFileWithRetry(fullPath);
        const stats = await fs.stat(fullPath);

        this.sendToRenderer('file-changed', {
          path: relativePath,
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
      // filePath is already absolute when watching a directory
      const relativePath = path.relative(this.watchedDirectory, filePath);
      this.sendToRenderer('file-deleted', {
        path: relativePath,
        fullPath: filePath
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

module.exports = FileWatchManager;