import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { promises as fs, createWriteStream } from 'fs';
import { spawn, ChildProcess } from 'child_process';
import pty from 'node-pty';
import FileWatchManager from './file-watch-manager';

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

// Global file watch manager instance
const fileWatchManager = new FileWatchManager();

// Server process management
let serverProcess: ChildProcess | null = null;

// Terminal process management with node-pty ONLY
const terminals = new Map();
// Track which window owns which terminal for cleanup
const terminalToWindow = new Map(); // terminalId -> webContents.id

async function startServer() {
  // Create a debug log file to capture environment differences
  const debugLogPath = path.join(app.getPath('userData'), 'server-debug.log');
  const logStream = createWriteStream(debugLogPath, { flags: 'a' });

  function debugLog(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    logStream.write(logMessage);
    console.log(message);
  }

  try {
    debugLog('=== VoiceTree Server Startup ===');
    debugLog(`App launched from: ${process.argv0}`);
    debugLog(`App packaged: ${app.isPackaged}`);
    debugLog(`Process CWD: ${process.cwd()}`);
    debugLog(`Process Platform: ${process.platform}`);
    debugLog(`Node version: ${process.version}`);
    debugLog(`Electron version: ${process.versions.electron}`);

    // Log critical environment variables
    debugLog('--- Environment Variables ---');
    debugLog(`PATH: ${process.env.PATH || 'UNDEFINED'}`);
    debugLog(`HOME: ${process.env.HOME || 'UNDEFINED'}`);
    debugLog(`USER: ${process.env.USER || 'UNDEFINED'}`);
    debugLog(`SHELL: ${process.env.SHELL || 'UNDEFINED'}`);
    debugLog(`PYTHONPATH: ${process.env.PYTHONPATH || 'NOT SET'}`);
    debugLog(`PYTHONHOME: ${process.env.PYTHONHOME || 'NOT SET'}`);
    debugLog(`Total env vars count: ${Object.keys(process.env).length}`);

    // Log all environment variables to file (not console to avoid clutter)
    logStream.write(`Full environment:\n${JSON.stringify(process.env, null, 2)}\n`);

    // Determine server path based on whether app is packaged
    let serverPath: string;

    if (app.isPackaged) {
      // Packaged app: Use process.resourcesPath
      serverPath = path.join(process.resourcesPath, 'server', 'voicetree-server');
      debugLog(`[Server] Packaged app - using server at: ${serverPath}`);
    } else {
      // Unpackaged (development/test): Use app path to find project root
      // app.getAppPath() returns frontend/webapp in dev mode
      const appPath = app.getAppPath();
      const projectRoot = path.resolve(appPath, '../..');
      serverPath = path.join(projectRoot, 'dist', 'resources', 'server', 'voicetree-server');
      debugLog(`[Server] Unpackaged app - using server at: ${serverPath}`);

      // Verify the server exists in development
      try {
        await fs.access(serverPath);
        const stats = await fs.stat(serverPath);
        debugLog(`[Server] Server file exists, size: ${stats.size} bytes`);
      } catch (error) {
        debugLog('[Server] Server executable not found at: ' + serverPath);
        debugLog('[Server] Run build_server.sh first to build the server');
        logStream.end();
        return;
      }
    }

    // Make server executable on Unix systems
    if (process.platform !== 'win32') {
      try {
        await fs.chmod(serverPath, 0o755);
        debugLog('[Server] Made server executable');
      } catch (error) {
        debugLog(`[Server] Could not set executable permissions: ${error}`);
      }
    }

    // Get the directory where the server is located
    const serverDir = path.dirname(serverPath);
    debugLog(`[Server] Server directory: ${serverDir}`);

    // Spawn the server process with port 8001 and explicit working directory
    debugLog('[Server] Starting VoiceTree server on port 8001...');
    debugLog(`[Server] Spawn command: ${serverPath} 8001`);

    // Create environment with explicit paths for the server
    const serverEnv = {
      ...process.env,
      // Ensure the server knows where to create files
      VOICETREE_DATA_DIR: serverDir,
      VOICETREE_VAULT_DIR: path.join(serverDir, 'markdownTreeVault'),
      // Add minimal PATH if it's missing critical directories
      PATH: process.env.PATH?.includes('/usr/local/bin')
        ? process.env.PATH
        : `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`
    };

    serverProcess = spawn(serverPath, ['8000'], { //todo temp until we fix
      stdio: ['ignore', 'pipe', 'pipe'],
      env: serverEnv,
      cwd: serverDir,  // Set working directory explicitly
      detached: false  // Ensure process is attached to parent
    });

    // Check if the process actually started
    if (!serverProcess || !serverProcess.pid) {
      debugLog('[Server] ERROR: Failed to get process ID - server may not have started');
    } else {
      debugLog(`[Server] Started with PID: ${serverProcess.pid}`);
    }

    // Log server stdout
    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      debugLog(`[Server stdout] ${output}`);
    });

    // Log server stderr
    serverProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      debugLog(`[Server stderr] ${output}`);
    });

    // Handle server exit
    serverProcess.on('exit', (code, signal) => {
      debugLog(`[Server] Process exited with code ${code} and signal ${signal}`);
      serverProcess = null;
    });

    // Handle server errors
    serverProcess.on('error', (error) => {
      debugLog(`[Server] Failed to start: ${error.message}`);
      debugLog(`[Server] Error details: ${JSON.stringify(error)}`);
      serverProcess = null;
    });

    // Test if the server is accessible after a short delay
    setTimeout(async () => {
      try {
        const http = require('http');
        http.get('http://localhost:8001/health', (res) => {
          debugLog(`[Server] Health check response code: ${res.statusCode}`);
        }).on('error', (err) => {
          debugLog(`[Server] Health check failed: ${err.message}`);
        });
      } catch (error) {
        debugLog(`[Server] Health check error: ${error}`);
      }
    }, 2000);

  } catch (error) {
    debugLog(`[Server] Error during server startup: ${error}`);
    debugLog(`[Server] Stack trace: ${error.stack}`);
  }

  // Keep log open for a moment then close
  setTimeout(() => logStream.end(), 5000);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: 'hiddenInset',
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
      mainWindow.hide() // THIS IS THE FINAL THING THAT ACTUALLY WORKED?????????
      // mainWindow.minimize(); // THIS IS ANNOYING IT CAUSES VISUAL ANMIATION
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
    directory: fileWatchManager.getWatchedDirectory()
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
app.whenReady().then(async () => {
  // Hide dock icon on macOS when running tests to prevent focus stealing
  if (process.env.MINIMIZE_TEST === '1' && process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Start the Python server before creating window
  await startServer();

  createWindow();
});

app.on('window-all-closed', () => {
  // Clean up server process
  if (serverProcess) {
    console.log('[Server] Shutting down server...');
    try {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    } catch (error) {
      console.error('[Server] Error killing server:', error);
    }
  }

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

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Restart server if it's not running (macOS dock click after window close)
    if (!serverProcess) {
      console.log('[App] Reactivating - restarting server...');
      await startServer();
    }
    createWindow();
  }
});