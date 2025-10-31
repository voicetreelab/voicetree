import { app } from 'electron';
import path from 'path';
import { promises as fs, createWriteStream } from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { findAvailablePort } from './port-utils';

/**
 * Deep module for managing the VoiceTree Python backend server.
 *
 * Public API:
 * - async start()
 * - stop()
 * - isRunning()
 *
 * Hides:
 * - Path resolution (packaged vs dev)
 * - Environment setup
 * - Process spawning
 * - Health checks
 * - Debug logging
 * - Server lifecycle
 */
export default class ServerManager {
  private serverProcess: ChildProcess | null = null;
  private actualPort: number | null = null;

  /**
   * Start the VoiceTree server
   * @returns The port number the server is running on
   */
  async start(): Promise<number> {
    // Create a debug log file to capture environment differences
    const debugLogPath = path.join(app.getPath('userData'), 'server-debug.log');
    const logStream = createWriteStream(debugLogPath, { flags: 'a' });

    const debugLog = (message: string) => {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ${message}\n`;
      logStream.write(logMessage);
      console.log(message);
    };

    try {
      // Find available port starting from 8001
      const port = await findAvailablePort(8001);
      this.actualPort = port;

      debugLog('=== VoiceTree Server Startup ===');
      debugLog(`[Server] Found available port: ${port}`);
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
      const serverPath = this.getServerPath(debugLog);
      if (!serverPath) {
        logStream.end();
        return;
      }

      // Make server executable on Unix systems
      await this.makeExecutable(serverPath, debugLog);

      // Get the directory where the server is located
      const serverDir = path.dirname(serverPath);
      debugLog(`[Server] Server directory: ${serverDir}`);

      // Spawn the server process
      debugLog(`[Server] Starting VoiceTree server on port ${port}...`);
      debugLog(`[Server] Spawn command: ${serverPath} ${port}`);

      const serverEnv = this.buildServerEnvironment(serverDir);

      this.serverProcess = spawn(serverPath, [port.toString()], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: serverEnv,
        cwd: serverDir,
        detached: false
      });

      // Check if the process actually started
      if (!this.serverProcess || !this.serverProcess.pid) {
        debugLog('[Server] ERROR: Failed to get process ID - server may not have started');
      } else {
        debugLog(`[Server] Started with PID: ${this.serverProcess.pid}`);
      }

      this.attachServerHandlers(this.serverProcess, debugLog);

      // Test if the server is accessible after a short delay
      this.scheduleHealthCheck(debugLog, port);

      // Keep log open for a moment then close
      this.scheduleLogClosure(logStream, debugLog);

      return port;

    } catch (error: any) {
      debugLog(`[Server] Error during server startup: ${error}`);
      debugLog(`[Server] Stack trace: ${error.stack}`);
      logStream.end();
      throw error; // Re-throw to signal startup failure
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.serverProcess) {
      console.log('[Server] Shutting down server...');
      try {
        this.serverProcess.kill('SIGTERM');
        this.serverProcess.kill('SIGKILL');
        this.serverProcess = null;
      } catch (error) {
        console.error('[Server] Error killing server:', error);
      }
    }
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.serverProcess !== null && this.serverProcess.pid !== undefined;
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number | null {
    return this.actualPort;
  }

  /**
   * Get the server executable path based on packaging mode
   */
  private getServerPath(debugLog: (message: string) => void): string | null {
    let serverPath: string;

    if (app.isPackaged) {
      // Packaged app: Use process.resourcesPath
      serverPath = path.join(process.resourcesPath, 'server', 'voicetree-server');
      debugLog(`[Server] Packaged app - using server at: ${serverPath}`);
    } else {
      // Unpackaged (development/test): Use app path to find project root
      const appPath = app.getAppPath();
      const projectRoot = path.resolve(appPath, '../..');
      serverPath = path.join(projectRoot, 'dist', 'resources', 'server', 'voicetree-server');
      debugLog(`[Server] Unpackaged app - using server at: ${serverPath}`);
    }

    return serverPath;
  }

  /**
   * Verify server exists and make it executable on Unix systems
   */
  private async makeExecutable(serverPath: string, debugLog: (message: string) => void): Promise<void> {
    // Verify the server exists in development
    if (!app.isPackaged) {
      try {
        await fs.access(serverPath);
        const stats = await fs.stat(serverPath);
        debugLog(`[Server] Server file exists, size: ${stats.size} bytes`);
      } catch (error) {
        debugLog('[Server] Server executable not found at: ' + serverPath);
        debugLog('[Server] Run build_server.sh first to build the server');
        throw error;
      }
    }

    if (process.platform !== 'win32') {
      try {
        await fs.chmod(serverPath, 0o755);
        debugLog('[Server] Made server executable');
      } catch (error) {
        debugLog(`[Server] Could not set executable permissions: ${error}`);
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
      this.serverProcess = null;
    });

    // Handle server errors
    serverProcess.on('error', (error) => {
      debugLog(`[Server] Failed to start: ${error.message}`);
      debugLog(`[Server] Error details: ${JSON.stringify(error)}`);
      this.serverProcess = null;
    });
  }

  /**
   * Schedule a health check to test if the server is accessible
   */
  private scheduleHealthCheck(debugLog: (message: string) => void, port: number): void {
    setTimeout(async () => {
      try {
        const http = require('http');
        http.get(`http://localhost:${port}/health`, (res: any) => {
          debugLog(`[Server] Health check response code: ${res.statusCode}`);
        }).on('error', (err: any) => {
          debugLog(`[Server] Health check failed: ${err.message}`);
        });
      } catch (error) {
        debugLog(`[Server] Health check error: ${error}`);
      }
    }, 2000);
  }

  /**
   * Schedule log stream closure and final log messages
   */
  private scheduleLogClosure(logStream: any, debugLog: (message: string) => void): void {
    setTimeout(() => {
      const serverLogPath = app.isPackaged
        ? path.join(process.resourcesPath, 'server', 'voicetree_server.log')
        : path.join(app.getAppPath(), '../..', 'dist', 'resources', 'server', 'voicetree_server.log');

      debugLog(`[Server] === Initial startup logs complete ===`);
      debugLog(`[Server] Full server logs available at: ${serverLogPath}`);
      logStream.end();
    }, 5000);
  }
}
