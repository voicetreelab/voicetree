import path from 'path';
import { promises as fs, statSync } from 'fs';
import chokidar, { FSWatcher } from 'chokidar';
import { app, BrowserWindow } from 'electron';

interface FileInfo {
  filePath: string;
  relativePath: string;
}

class FileWatchManager {
  private watcher: FSWatcher | null = null;
  private watchedDirectory: string | null = null;
  private mainWindow: BrowserWindow | null = null;
  private initialScanFiles: FileInfo[] = [];
  private isInitialScan: boolean = true;

  // Get path to config file for storing last directory
  getConfigPath(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'voicetree-config.json');
  }

  // Load last watched directory from config
  async loadLastDirectory(): Promise<string | null> {
    try {
      const configPath = this.getConfigPath();
      const data = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(data);
      return config.lastDirectory || null;
    } catch {
      // TODO: Handle edge cases:
      // - Config file doesn't exist (first run)
      // - JSON parse error (corrupted config)
      // - Permission errors
      return null;
    }
  }

  // Save last watched directory to config
  async saveLastDirectory(directoryPath: string): Promise<void> {
    try {
      const configPath = this.getConfigPath();
      const config = { lastDirectory: directoryPath };
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch {
      // TODO: Handle edge cases:
      // - Permission errors
      // - Disk full
      console.error('Failed to save last directory');
    }
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  async startWatching(directoryPath: string): Promise<{ success: boolean; directory?: string; error?: string }> {
    // Stop any existing watcher
    await this.stopWatching();

    console.log(`[FileWatchManager] Starting to watch: ${directoryPath}`);

    try {
      // Verify directory exists and is accessible
      await fs.access(directoryPath, fs.constants.R_OK);
      console.log(`[FileWatchManager] Directory accessible: ${directoryPath}`);

      this.watchedDirectory = directoryPath;
      this.initialScanFiles = [];
      this.isInitialScan = true;

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
          (path: string) => {
            // Only watch .md files and directories
            try {
              const stats = statSync(path);
              if (stats.isDirectory()) return false; // Don't ignore directories
            } catch {
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

      // Save as last directory for auto-start on next launch
      await this.saveLastDirectory(directoryPath);

      return { success: true, directory: directoryPath };

    } catch (error: unknown) {
      console.error('Failed to start file watching:', error);

      let errorMessage = 'Unknown error occurred';
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code: string }).code;
        if (code === 'ENOENT') {
          errorMessage = 'Directory does not exist';
        } else if (code === 'EACCES') {
          errorMessage = 'Access denied to directory';
        } else if (code === 'EPERM') {
          errorMessage = 'Permission denied';
        } else {
          errorMessage = (error as Error).message;
        }
      }

      this.sendToRenderer('file-watch-error', {
        type: 'start_failed',
        message: errorMessage,
        directory: directoryPath
      });

      return { success: false, error: errorMessage };
    }
  }

  private setupWatcherListeners(): void {
    if (!this.watcher) return;

    // File added
    this.watcher.on('add', async (filePath: string) => {
      console.log(`File detected: ${filePath} in directory: ${this.watchedDirectory}`);
      try {
        // filePath is already absolute when watching a directory
        const fullPath = filePath;
        const relativePath = path.relative(this.watchedDirectory!, filePath);

        if (this.isInitialScan) {
          // Collect files during initial scan
          console.log(`[FileWatchManager] Collecting file for bulk load: ${relativePath} (total now: ${this.initialScanFiles.length + 1})`);
          this.initialScanFiles.push({
            filePath: fullPath,
            relativePath: relativePath
          });
        } else {
          // After initial scan, send individually
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
        }
      } catch (error) {
        console.error(`Error reading added file ${filePath}:`, error);
        this.sendToRenderer('file-watch-error', {
          type: 'read_error',
          message: `Failed to read added file: ${(error as Error).message}`,
          filePath: filePath
        });
      }
    });

    // File changed
    this.watcher.on('change', async (filePath: string) => {
      try {
        // filePath is already absolute when watching a directory
        const fullPath = filePath;
        const relativePath = path.relative(this.watchedDirectory!, filePath);
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
          message: `Failed to read changed file: ${(error as Error).message}`,
          filePath: filePath
        });
      }
    });

    // File deleted
    this.watcher.on('unlink', (filePath: string) => {
      // filePath is already absolute when watching a directory
      const relativePath = path.relative(this.watchedDirectory!, filePath);
      this.sendToRenderer('file-deleted', {
        path: relativePath,
        fullPath: filePath
      });
    });

    // Directory added
    this.watcher.on('addDir', (dirPath: string) => {
      this.sendToRenderer('directory-added', {
        path: dirPath,
        fullPath: path.join(this.watchedDirectory!, dirPath)
      });
    });

    // Directory deleted
    this.watcher.on('unlinkDir', (dirPath: string) => {
      this.sendToRenderer('directory-deleted', {
        path: dirPath,
        fullPath: path.join(this.watchedDirectory!, dirPath)
      });
    });

    // Initial scan complete
    this.watcher.on('ready', async () => {
      console.log(`[FileWatchManager] ===== READY EVENT FIRED =====`);
      console.log(`[FileWatchManager] Initial scan complete - collected ${this.initialScanFiles.length} files`);
      console.log(`[FileWatchManager] isInitialScan = ${this.isInitialScan}`);

      try {
        // Read all collected files in parallel
        const filePromises = this.initialScanFiles.map(async ({ filePath, relativePath }) => {
          try {
            const content = await this.readFileWithRetry(filePath);
            const stats = await fs.stat(filePath);
            return {
              path: relativePath,
              fullPath: filePath,
              content: content,
              size: stats.size,
              modified: stats.mtime.toISOString()
            };
          } catch (error) {
            console.error(`Error reading file ${relativePath}:`, error);
            return null;
          }
        });

        const files = (await Promise.all(filePromises)).filter(f => f !== null);

        console.log(`Sending bulk load with ${files.length} files`);
        this.sendToRenderer('initial-files-loaded', {
          files: files,
          directory: this.watchedDirectory
        });

        // Clear the initial scan state
        this.initialScanFiles = [];
        this.isInitialScan = false;

      } catch (error) {
        console.error('Error during bulk file load:', error);
        this.sendToRenderer('file-watch-error', {
          type: 'bulk_load_error',
          message: `Failed to load initial files: ${(error as Error).message}`,
          directory: this.watchedDirectory
        });
      }
    });

    // Watch error
    this.watcher.on('error', (error: Error & { code?: string; path?: string }) => {
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

  private async readFileWithRetry(filePath: string, maxRetries = 3, delay = 100): Promise<string> {
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
    throw new Error('Failed to read file after retries');
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      try {
        await this.watcher.close();
        console.log('File watcher stopped');
      } catch (error) {
        console.error('Error stopping file watcher:', error);
      }

      this.watcher = null;
      this.watchedDirectory = null;
      this.initialScanFiles = [];
      this.isInitialScan = true;

      this.sendToRenderer('file-watching-stopped');
    }
  }

  private sendToRenderer(channel: string, data?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  getWatchedDirectory(): string | null {
    return this.watchedDirectory;
  }
}

export default FileWatchManager;
