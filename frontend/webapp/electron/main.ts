import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import pty from 'node-pty';
import FileWatchManager from './file-watch-manager.cjs';

// Suppress Electron security warnings in development and test environments
// These warnings are only shown in dev mode and don't appear in production
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// Global file watch manager instance
const fileWatchManager = new FileWatchManager();

// Terminal process management with node-pty ONLY
const terminals = new Map();
// Track which window owns which terminal for cleanup
const terminalToWindow = new Map(); // terminalId -> webContents.id

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
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
    mainWindow.loadURL('http://localhost:3000');
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
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  // Clean up terminals when window closes
  mainWindow.on('closed', () => {
    console.log(`Window ${windowId} closed, cleaning up terminals`);

    // Find and kill all terminals owned by this window
    for (const [terminalId, webContentsId] of terminalToWindow.entries()) {
      if (webContentsId === windowId) {
        console.log(`Cleaning up terminal ${terminalId} for window ${windowId}`);
        const ptyProcess = terminals.get(terminalId);
        if (ptyProcess && ptyProcess.kill) {
          try {
            ptyProcess.kill();
          } catch (error) {
            console.error(`Error killing terminal ${terminalId}:`, error);
          }
        }
        terminals.delete(terminalId);
        terminalToWindow.delete(terminalId);
      }
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
ipcMain.handle('terminal:spawn', async (event, nodeMetadata) => {
  try {
    const terminalId = `term-${Date.now()}`;

    // Determine shell based on platform
    const shell = process.platform === 'win32'
      ? 'powershell.exe'
      : process.env.SHELL || '/bin/bash';

    // TODO: WILL NEED TO MAKE THE TOOLS DISTRIBUTED WITH APP, and this path customizable
    const homeDir = process.platform === 'win32'
      ? process.env.USERPROFILE
      : process.env.HOME;
    const cwd = homeDir
      ? path.join(homeDir, 'repos', 'VoiceTree', 'tools')
      : process.cwd();

    // Build custom environment with node metadata
    const customEnv = { ...process.env };

    if (nodeMetadata) {
      // Set node-based environment variables
      if (nodeMetadata.filePath) {
        // OBSIDIAN_SOURCE_NOTE is the relative path from vault root (e.g., "2025-10-03/23_Commitment.md")
        customEnv.OBSIDIAN_SOURCE_NOTE = nodeMetadata.filePath;

        // OBSIDIAN_SOURCE_DIR is just the directory part (e.g., "2025-10-03")
        customEnv.OBSIDIAN_SOURCE_DIR = path.dirname(nodeMetadata.filePath);

        // OBSIDIAN_SOURCE_NAME is the filename with extension (e.g., "23_Commitment.md")
        customEnv.OBSIDIAN_SOURCE_NAME = path.basename(nodeMetadata.filePath);

        customEnv.OBSIDIAN_VAULT_PATH = "/Users/bobbobby/repos/VoiceTree/markdownTreeVault" // todo-hardcoded

        // OBSIDIAN_SOURCE_BASENAME is filename without extension (e.g., "23_Commitment")
        const ext = path.extname(nodeMetadata.filePath);
        customEnv.OBSIDIAN_SOURCE_BASENAME = path.basename(nodeMetadata.filePath, ext);
      }

      // Extra env vars (e.g., agent info)
      if (nodeMetadata.extraEnv) {
        Object.assign(customEnv, nodeMetadata.extraEnv);
      }
    }

    console.log(`Spawning env PTY with shell: ${shell} in directory: ${cwd}`);
    if (nodeMetadata) {
      console.log(`Node metadata:`, nodeMetadata);
    }

    // Create PTY instance - THIS IS THE ONLY WAY, NO FALLBACKS
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: customEnv
    });

    // Store the PTY process
    terminals.set(terminalId, ptyProcess);

    // Track terminal ownership for cleanup when window closes
    terminalToWindow.set(terminalId, event.sender.id);

    // Handle PTY data
    ptyProcess.onData((data) => {
      try {
        event.sender.send('terminal:data', terminalId, data);
      } catch (error) {
        console.error(`Failed to send terminal data for ${terminalId}:`, error);
      }
    });

    // Handle PTY exit
    ptyProcess.onExit((exitInfo) => {
      try {
        event.sender.send('terminal:exit', terminalId, exitInfo.exitCode);
      } catch (error) {
        console.error(`Failed to send terminal exit for ${terminalId}:`, error);
      }
      terminals.delete(terminalId);
      terminalToWindow.delete(terminalId);
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