const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.warn('node-pty not available, falling back to child_process');
  const { spawn } = require('child_process');
}
const FileWatchManager = require('./file-watch-manager.cjs');

// Global file watch manager instance
const fileWatchManager = new FileWatchManager();

// Terminal process management
const terminals = new Map();

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

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    // Use Electron's shell.trashItem to move to trash instead of permanently deleting
    const { shell } = require('electron');
    await shell.trashItem(filePath);
    return { success: true };
  } catch (error) {
    console.error(`Failed to delete file ${filePath}:`, error);
    return { success: false, error: error.message };
  }
});

// Terminal IPC handlers
ipcMain.handle('terminal:spawn', async (event) => {
  try {
    const terminalId = `term-${Date.now()}`;
    let shellProcess;

    if (process.platform === 'win32') {
      // Windows: Use cmd.exe directly
      shellProcess = spawn('cmd.exe', [], {
        cwd: process.env.USERPROFILE || process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' }
      });
    } else {
      // Unix/Mac: Use bash/zsh directly in simple interactive mode
      const shell = process.env.SHELL || '/bin/bash';

      console.log(`Spawning shell: ${shell}`);

      // Use the shell in interactive mode without TTY-specific commands
      shellProcess = spawn(shell, ['-i'], {
        cwd: process.env.HOME || process.cwd(),
        env: {
          ...process.env,
          TERM: 'dumb',  // Use dumb terminal to avoid escape sequences
          PS1: '$ ',      // Simple prompt
          PS2: '> '       // Continuation prompt
        }
      });
    }

    // Store the process
    terminals.set(terminalId, shellProcess);

    // Handle stdout
    shellProcess.stdout.on('data', (data) => {
      event.sender.send('terminal:data', terminalId, data.toString());
    });

    // Handle stderr
    shellProcess.stderr.on('data', (data) => {
      event.sender.send('terminal:data', terminalId, data.toString());
    });

    // Handle process exit
    shellProcess.on('exit', (code) => {
      event.sender.send('terminal:exit', terminalId, code);
      terminals.delete(terminalId);
    });

    // Handle errors
    shellProcess.on('error', (error) => {
      console.error(`Terminal ${terminalId} error:`, error);
      event.sender.send('terminal:data', terminalId, `\r\nError: ${error.message}\r\n`);
    });

    return { success: true, terminalId };
  } catch (error) {
    console.error('Failed to spawn terminal:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('terminal:write', async (event, terminalId, data) => {
  try {
    const shellProcess = terminals.get(terminalId);
    if (!shellProcess) {
      return { success: false, error: 'Terminal not found' };
    }

    // Write to shell process stdin
    shellProcess.stdin.write(data);
    return { success: true };
  } catch (error) {
    console.error(`Failed to write to terminal ${terminalId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('terminal:resize', async (event, terminalId, cols, rows) => {
  try {
    const shellProcess = terminals.get(terminalId);
    if (!shellProcess) {
      return { success: false, error: 'Terminal not found' };
    }

    // For script command, we can send window size change signal
    // Note: This won't work perfectly without real PTY, but it's better than nothing
    if (process.platform !== 'win32') {
      // Send SIGWINCH signal to notify about window resize
      shellProcess.kill('SIGWINCH');
    }
    return { success: true };
  } catch (error) {
    console.error(`Failed to resize terminal ${terminalId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('terminal:kill', async (event, terminalId) => {
  try {
    const shellProcess = terminals.get(terminalId);
    if (!shellProcess) {
      return { success: false, error: 'Terminal not found' };
    }

    // Kill the shell process
    shellProcess.kill();
    terminals.delete(terminalId);
    return { success: true };
  } catch (error) {
    console.error(`Failed to kill terminal ${terminalId}:`, error);
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