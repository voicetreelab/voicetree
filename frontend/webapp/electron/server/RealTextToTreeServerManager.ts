import { app, BrowserWindow } from 'electron';
import path from 'path';
import { promises as fs, createWriteStream } from 'fs';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { findAvailablePort } from '../port-utils';
import type { ITextToTreeServerManager } from './ITextToTreeServerManager';

/**
 * Manages the Python TextToTreeServer backend process.
 * Spawns voicetree-server binary and monitors its lifecycle.
 *
 * TextToTreeServer: Converts text input (voice or typed) into a markdown tree structure.
 */
export class RealTextToTreeServerManager implements ITextToTreeServerManager {
  private serverProcess: ChildProcess | null = null;
  private actualPort: number | null = null;
  private logStream: any = null;

  async start(): Promise<number> {
    // Add timeout wrapper
    const timeoutPromise = new Promise<number>((_, reject) => {
      setTimeout(() => {
        reject(new Error('[RealTextToTreeServer] Timeout: server failed to start within 30 seconds'));
      }, 30000);
    });

    const startPromise = this.startInternal();

    return Promise.race([startPromise, timeoutPromise]);
  }

  private async startInternal(): Promise<number> {
    // Create a debug log file to capture environment differences
    const debugLogPath = path.join(app.getPath('userData'), 'server-debug.log');
    this.logStream = createWriteStream(debugLogPath, { flags: 'a' });

    const debugLog = (message: string) => {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ${message}\n`;
      this.logStream.write(logMessage);
      console.log(message);
    };

    try {
      // Find available port starting from 8001
      const port = await findAvailablePort(8001);
      this.actualPort = port;

      debugLog('=== VoiceTree Server Startup ===');
      debugLog(`[TextToTreeServer] Found available port: ${port}`);
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
      this.logStream.write(`Full environment:\n${JSON.stringify(process.env, null, 2)}\n`);

      // Determine server path based on whether app is packaged
      const serverPath = this.getServerPath(debugLog);

      // Verify server exists
      await this.verifyServerExists(serverPath, debugLog);

      // Make server executable on Unix systems
      await this.makeExecutable(serverPath, debugLog);

      // Get the directory where the server is located
      const serverDir = path.dirname(serverPath);
      debugLog(`[TextToTreeServer] Server directory: ${serverDir}`);

      // Spawn the server process
      debugLog(`[TextToTreeServer] Starting VoiceTree server on port ${port}...`);
      debugLog(`[TextToTreeServer] Spawn command: ${serverPath} ${port}`);

      const serverEnv = this.buildServerEnvironment(serverDir);

      this.serverProcess = spawn(serverPath, [port.toString()], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: serverEnv,
        cwd: serverDir,
        detached: false
      });

      // Check if the process actually started
      if (!this.serverProcess || !this.serverProcess.pid) {
        debugLog('[TextToTreeServer] ERROR: Failed to get process ID - server may not have started');
      } else {
        debugLog(`[TextToTreeServer] Started with PID: ${this.serverProcess.pid}`);
      }

      this.attachServerHandlers(this.serverProcess, debugLog);

      // Test if the server is accessible after a short delay
      this.scheduleHealthCheck(debugLog, port);

      return port;

    } catch (error: any) {
      debugLog(`[TextToTreeServer] Error during server startup: ${error}`);
      debugLog(`[TextToTreeServer] Stack trace: ${error.stack}`);
      this.logStream?.end();
      throw error; // Re-throw to signal startup failure
    }
  }

  stop(): void {
    if (this.serverProcess) {
      console.log('[TextToTreeServer] Shutting down server...');
      try {
        this.serverProcess.kill('SIGTERM');
        this.serverProcess.kill('SIGKILL');
        this.serverProcess = null;
      } catch (error) {
        console.error('[TextToTreeServer] Error killing server:', error);
      }
    }

    // Close the log stream if it's open
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    this.actualPort = null;
  }

  isRunning(): boolean {
    return this.serverProcess !== null && this.serverProcess.pid !== undefined;
  }

  getPort(): number | null {
    return this.actualPort;
  }

  /**
   * Get the server executable path based on packaging mode
   */
  private getServerPath(debugLog: (message: string) => void): string {
    let serverPath: string;

    if (app.isPackaged) {
      // Packaged app: Use process.resourcesPath
      serverPath = path.join(process.resourcesPath, 'server', 'voicetree-server');
      debugLog(`[TextToTreeServer] Packaged app - using server at: ${serverPath}`);
    } else {
      // Unpackaged (development): Use app path to find project root
      const appPath = app.getAppPath();
      const projectRoot = path.resolve(appPath, '../..');
      serverPath = path.join(projectRoot, 'dist', 'resources', 'server', 'voicetree-server');
      debugLog(`[TextToTreeServer] Unpackaged app - using server at: ${serverPath}`);
    }

    return serverPath;
  }

  /**
   * Verify server exists, fail fast if not
   */
  private async verifyServerExists(serverPath: string, debugLog: (message: string) => void): Promise<void> {
    try {
      await fs.access(serverPath);
      const stats = await fs.stat(serverPath);
      debugLog(`[TextToTreeServer] Server file exists, size: ${stats.size} bytes`);
    } catch (error) {
      debugLog('[TextToTreeServer] Server executable not found at: ' + serverPath);
      debugLog('[TextToTreeServer] Run build_server.sh first to build the server');
      throw new Error(`Server executable not found at ${serverPath}`);
    }
  }

  /**
   * Make server executable on Unix systems
   */
  private async makeExecutable(serverPath: string, debugLog: (message: string) => void): Promise<void> {
    if (process.platform !== 'win32') {
      try {
        await fs.chmod(serverPath, 0o755);
        debugLog('[TextToTreeServer] Made server executable');
      } catch (error) {
        debugLog(`[TextToTreeServer] Could not set executable permissions: ${error}`);
      }
    }
  }

  /**
   * Build environment variables for the server process
   */
  private buildServerEnvironment(serverDir: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      // Ensure the server knows where to create files
      VOICETREE_DATA_DIR: serverDir,
      // Add minimal PATH if it's missing critical directories
      PATH: process.env.PATH?.includes('/usr/local/bin')
        ? process.env.PATH
        : `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`
    };
  }

  /**
   * Attach stdout, stderr, and exit handlers to the server process
   */
  private attachServerHandlers(serverProcess: ChildProcess, debugLog: (message: string) => void): void {
    // Helper to send logs to all renderer windows
    const sendToRenderer = (message: string) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('backend-log', message);
      });
    };

    // Log server stdout
    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      debugLog(`[Server stdout] ${output}`);
      sendToRenderer(output);
    });

    // Log server stderr
    serverProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      debugLog(`[Server stderr] ${output}`);
      sendToRenderer(output);
    });

    // Handle server exit
    serverProcess.on('exit', (code, signal) => {
      const message = `[TextToTreeServer] Process exited with code ${code} and signal ${signal}`;
      debugLog(message);
      sendToRenderer(message);
      this.serverProcess = null;
    });

    // Handle server errors
    serverProcess.on('error', (error) => {
      debugLog(`[TextToTreeServer] Failed to start: ${error.message}`);
      debugLog(`[TextToTreeServer] Error details: ${JSON.stringify(error)}`);
      sendToRenderer(`[TextToTreeServer] Error: ${error.message}`);
      this.serverProcess = null;
    });
  }

  /**
   * Schedule a health check to test if the server is accessible
   */
  private scheduleHealthCheck(debugLog: (message: string) => void, port: number): void {
    setTimeout(async () => {
      try {
        http.get(`http://localhost:${port}/health`, (res) => {
          debugLog(`[TextToTreeServer] Health check response code: ${res.statusCode}`);
        }).on('error', (err: any) => {
          debugLog(`[TextToTreeServer] Health check failed: ${err.message}`);
        });
      } catch (error) {
        debugLog(`[TextToTreeServer] Health check error: ${error}`);
      }
    }, 2000);
  }
}
