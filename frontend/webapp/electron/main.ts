import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import pty from 'node-pty';
import FileWatchManager from './file-watch-manager.cjs';

// Global file watch manager instance
const fileWatchManager = new FileWatchManager();

// Terminal process management with node-pty ONLY
const terminals = new Map();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
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
      // For tests: show window without stealing focus, then minimize
      mainWindow.showInactive();
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
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
    watchedPath: fileWatchManager.watchedPath || null
  };
  console.log('Watch status:', status);
  return status;
});

// File content handlers
ipcMain.handle('save-file-content', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error deleting file:', error);
    return { success: false, error: error.message };
  }
});

// Terminal IPC handlers using node-pty ONLY - No fallbacks!
ipcMain.handle('terminal:spawn', async (event) => {
  try {
    const terminalId = `term-${Date.now()}`;

    // Determine shell based on platform
    const shell = process.platform === 'win32'
      ? 'powershell.exe'
      : process.env.SHELL || '/bin/bash';

    // Get home directory
    const cwd = process.platform === 'win32'
      ? process.env.USERPROFILE || process.cwd()
      : process.env.HOME || process.cwd();

    console.log(`Spawning PTY with shell: ${shell} in directory: ${cwd}`);

    // Create PTY instance - THIS IS THE ONLY WAY, NO FALLBACKS
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: process.env
    });

    // Store the PTY process
    terminals.set(terminalId, ptyProcess);

    // Handle PTY data
    ptyProcess.onData((data) => {
      event.sender.send('terminal:data', terminalId, data);
    });

    // Handle PTY exit
    ptyProcess.onExit((exitInfo) => {
      event.sender.send('terminal:exit', terminalId, exitInfo.exitCode);
      terminals.delete(terminalId);
    });

    console.log(`Terminal ${terminalId} spawned successfully with PID: ${ptyProcess.pid}`);
    return { success: true, terminalId };
  } catch (error) {
    console.error('Failed to spawn terminal:', error);

    // Send error message to display in terminal
    const errorMessage = `\r\n\x1b[31mError: Failed to spawn terminal\x1b[0m\r\n${error.message}\r\n\r\nMake sure node-pty is properly installed and rebuilt for Electron:\r\nnpx electron-rebuild\r\n`;

    // Create a fake terminal ID for error display
    const terminalId = `error-${Date.now()}`;
    setTimeout(() => {
      event.sender.send('terminal:data', terminalId, errorMessage);
    }, 100);

    return { success: true, terminalId }; // Return success with error terminal
  }
});

ipcMain.handle('terminal:write', async (event, terminalId, data) => {
  try {
    const ptyProcess = terminals.get(terminalId);
    if (!ptyProcess) {
      // Check if it's an error terminal
      if (terminalId.startsWith('error-')) {
        return { success: true }; // Ignore writes to error terminals
      }
      return { success: false, error: 'Terminal not found' };
    }

    // Write to PTY
    ptyProcess.write(data);
    return { success: true };
  } catch (error) {
    console.error(`Failed to write to terminal ${terminalId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('terminal:resize', async (event, terminalId, cols, rows) => {
  try {
    const ptyProcess = terminals.get(terminalId);
    if (!ptyProcess) {
      // Ignore resize for error terminals
      if (terminalId.startsWith('error-')) {
        return { success: true };
      }
      return { success: false, error: 'Terminal not found' };
    }

    // Resize PTY
    ptyProcess.resize(cols, rows);
    console.log(`Terminal ${terminalId} resized to ${cols}x${rows}`);
    return { success: true };
  } catch (error) {
    console.error(`Failed to resize terminal ${terminalId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('terminal:kill', async (event, terminalId) => {
  try {
    const ptyProcess = terminals.get(terminalId);
    if (!ptyProcess) {
      // Clean up error terminals too
      if (terminalId.startsWith('error-')) {
        terminals.delete(terminalId);
        return { success: true };
      }
      return { success: false, error: 'Terminal not found' };
    }

    // Kill the PTY process
    ptyProcess.kill();
    terminals.delete(terminalId);
    return { success: true };
  } catch (error) {
    console.error(`Failed to kill terminal ${terminalId}:`, error);
    return { success: false, error: error.message };
  }
});

// App event handlers
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Clean up all terminals
  for (const [id, ptyProcess] of terminals) {
    console.log(`Cleaning up terminal ${id}`);
    try {
      if (!id.startsWith('error-') && ptyProcess.kill) {
        ptyProcess.kill();
      }
    } catch (e) {
      console.error(`Error killing terminal ${id}:`, e);
    }
  }
  terminals.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});