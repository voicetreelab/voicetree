import { app } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import pty from 'node-pty';

interface NodeMetadata {
  filePath?: string;
  extraEnv?: Record<string, string>;
  initialCommand?: string;
}

interface TerminalSpawnResult {
  success: boolean;
  terminalId: string;
  error?: string;
}

interface TerminalOperationResult {
  success: boolean;
  error?: string;
}

/**
 * Deep module for managing PTY terminals in the Electron app.
 *
 * Public API:
 * - spawn(sender, nodeMetadata, getWatchedDirectory, getToolsDirectory)
 * - write(terminalId, data)
 * - resize(terminalId, cols, rows)
 * - kill(terminalId)
 * - cleanupForWindow(windowId)
 * - cleanup()
 *
 * Hides:
 * - PTY process lifecycle
 * - Terminal-to-window tracking
 * - Environment variable injection
 * - Shell selection logic
 * - Error terminal handling
 */
export default class TerminalManager {
  private terminals = new Map<string, any>();
  private terminalToWindow = new Map<string, number>();

  /**
   * Spawn a new PTY terminal with optional node metadata for environment variables
   */
  async spawn(
    sender: Electron.WebContents,
    nodeMetadata: NodeMetadata | undefined,
    getWatchedDirectory: () => string | null,
    getToolsDirectory: () => string
  ): Promise<TerminalSpawnResult> {
    try {
      const terminalId = `term-${Date.now()}`;

      // Determine shell based on platform
      const shell = process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/bash';

      // Don't use login shell flag because:
      // 1. fix-path already fixed the PATH in main.ts
      // 2. Login shells reset environment, overwriting our custom env vars
      const shellArgs: string[] = [];

      // Use Application Support tools directory (created during app setup)
      // Fall back to home directory if tools directory doesn't exist
      let cwd = getToolsDirectory();
      try {
        await fs.access(cwd);
      } catch {
        console.log('[Terminal] Tools directory not found, falling back to home directory');
        cwd = process.env.HOME || process.cwd();
      }

      // Build custom environment with node metadata
      const customEnv = this.buildEnvironment(nodeMetadata, getWatchedDirectory);

      console.log(`Spawning PTY with shell: ${shell} in directory: ${cwd}`);
      console.log(`[TerminalManager] OBSIDIAN_VAULT_PATH in customEnv: ${customEnv.OBSIDIAN_VAULT_PATH}`);
      console.log(`[TerminalManager] OBSIDIAN_SOURCE_NOTE in customEnv: ${customEnv.OBSIDIAN_SOURCE_NOTE}`);
      if (nodeMetadata) {
        console.log(`Node metadata:`, nodeMetadata);
      }

      // Create PTY instance
      // PATH is already fixed by fix-path in main.ts
      // Use standard terminal dimensions (80×24) - close to actual frontend size
      // Frontend will resize to actual dimensions after FitAddon calculates them
      // CRITICAL: Don't use massive dimensions (800×1600) as resize triggers clear screen
      const ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 160,
        cwd: cwd,
        env: customEnv
      });

      // Store the PTY process
      this.terminals.set(terminalId, ptyProcess);

      // Track terminal ownership for cleanup when window closes
      this.terminalToWindow.set(terminalId, sender.id);

      // Write initial command if provided (without newline, so it's not executed)
      if (nodeMetadata?.initialCommand) {
        console.log(`[TerminalManager] Writing initial command: ${nodeMetadata.initialCommand}`);
        // Wait a bit for shell prompt to appear before writing
        setTimeout(() => {
          ptyProcess.write(nodeMetadata.initialCommand);
        }, 200);
      }

      // Handle PTY data
      ptyProcess.onData((data: string) => {
        // console.log(`[TerminalManager] onData called for ${terminalId}, data length: ${data.length}`);
        // console.log(`[TerminalManager] sender.id: ${sender.id}, sender.isDestroyed: ${sender.isDestroyed()}`);
        try {
          sender.send('terminal:data', terminalId, data);
          // console.log(`[TerminalManager] Successfully sent data to renderer`);
        } catch (error) {
          console.error(`Failed to send terminal data for ${terminalId}:`, error);
        }
      });

      // Handle PTY exit
      ptyProcess.onExit((exitInfo: { exitCode: number }) => {
        try {
          sender.send('terminal:exit', terminalId, exitInfo.exitCode);
        } catch (error) {
          console.error(`Failed to send terminal exit for ${terminalId}:`, error);
        }
        this.terminals.delete(terminalId);
        this.terminalToWindow.delete(terminalId);
      });

      console.log(`[TerminalManager] Terminal ${terminalId} spawned successfully with PID: ${ptyProcess.pid}`);
      console.log(`[TerminalManager] sender.id at spawn time: ${sender.id}, isDestroyed: ${sender.isDestroyed()}`);
      return { success: true, terminalId };
    } catch (error: any) {
      console.error('Failed to spawn terminal:', error);

      // Send error message to display in terminal
      const errorMessage = `\r\n\x1b[31mError: Failed to spawn terminal\x1b[0m\r\n${error.message}\r\n\r\nMake sure node-pty is properly installed and rebuilt for Electron:\r\nnpx electron-rebuild\r\n`;

      // Create a fake terminal ID for error display
      const terminalId = `error-${Date.now()}`;
      setTimeout(() => {
        sender.send('terminal:data', terminalId, errorMessage);
      }, 100);

      return { success: true, terminalId }; // Return success with error terminal
    }
  }

  /**
   * Write data to a terminal
   */
  write(terminalId: string, data: string): TerminalOperationResult {
    try {
      const ptyProcess = this.terminals.get(terminalId);
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
    } catch (error: any) {
      console.error(`Failed to write to terminal ${terminalId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Resize a terminal
   */
  resize(terminalId: string, cols: number, rows: number): TerminalOperationResult {
    try {
      const ptyProcess = this.terminals.get(terminalId);
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
    } catch (error: any) {
      console.error(`Failed to resize terminal ${terminalId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Kill a terminal
   */
  kill(terminalId: string): TerminalOperationResult {
    try {
      const ptyProcess = this.terminals.get(terminalId);
      if (!ptyProcess) {
        // Clean up error terminals too
        if (terminalId.startsWith('error-')) {
          this.terminals.delete(terminalId);
          return { success: true };
        }
        return { success: false, error: 'Terminal not found' };
      }

      // Kill the PTY process
      ptyProcess.kill();
      this.terminals.delete(terminalId);
      this.terminalToWindow.delete(terminalId);
      return { success: true };
    } catch (error: any) {
      console.error(`Failed to kill terminal ${terminalId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up all terminals owned by a specific window
   */
  cleanupForWindow(windowId: number): void {
    console.log(`Window ${windowId} closed, cleaning up terminals`);

    // Find and kill all terminals owned by this window
    for (const [terminalId, webContentsId] of this.terminalToWindow.entries()) {
      if (webContentsId === windowId) {
        console.log(`Cleaning up terminal ${terminalId} for window ${windowId}`);
        const ptyProcess = this.terminals.get(terminalId);
        if (ptyProcess && ptyProcess.kill) {
          try {
            ptyProcess.kill();
          } catch (error) {
            console.error(`Error killing terminal ${terminalId}:`, error);
          }
        }
        this.terminals.delete(terminalId);
        this.terminalToWindow.delete(terminalId);
      }
    }
  }

  /**
   * Clean up all terminals (called on app shutdown)
   */
  cleanup(): void {
    for (const [id, ptyProcess] of this.terminals) {
      console.log(`Cleaning up terminal ${id}`);
      try {
        if (!id.startsWith('error-') && ptyProcess.kill) {
          ptyProcess.kill();
        }
      } catch (e) {
        console.error(`Error killing terminal ${id}:`, e);
      }
    }
    this.terminals.clear();
    this.terminalToWindow.clear();
  }

  /**
   * Build environment variables for the terminal, including node metadata
   * Note: PATH is already fixed by fix-path in main.ts
   */
  private buildEnvironment(
    nodeMetadata: NodeMetadata | undefined,
    getWatchedDirectory: () => string | null
  ): NodeJS.ProcessEnv {
    console.log(`[TerminalManager] process.env.OBSIDIAN_VAULT_PATH BEFORE copy: ${process.env.OBSIDIAN_VAULT_PATH}`);
    const customEnv = { ...process.env };

    // Extra env vars (e.g., agent info)
    if (nodeMetadata?.extraEnv) {
    console.log(`[TerminalManager] extraEnv:`, nodeMetadata.extraEnv);
    if (nodeMetadata.extraEnv.OBSIDIAN_VAULT_PATH) {
      console.log(`[TerminalManager] WARNING: extraEnv contains OBSIDIAN_VAULT_PATH: ${nodeMetadata.extraEnv.OBSIDIAN_VAULT_PATH}`);
    }
    Object.assign(customEnv, nodeMetadata.extraEnv);
    }

    // Always set vault path from watched directory
    const watchedDir = getWatchedDirectory();
    const vaultPath = watchedDir || process.cwd();
    console.log(`[TerminalManager] getWatchedDirectory() returned: ${watchedDir}`);
    console.log(`[TerminalManager] Using vault path: ${vaultPath}`);
    customEnv.OBSIDIAN_VAULT_PATH = vaultPath;

    if (nodeMetadata) {
      // Set node-based environment variables
      if (nodeMetadata.filePath) {

        // Convert absolute path to relative path from vault root if needed
        let relativePath = nodeMetadata.filePath;
        if (path.isAbsolute(nodeMetadata.filePath)) {
          // If filePath is absolute, make it relative to vault path
          relativePath = path.relative(vaultPath, nodeMetadata.filePath);
        }

        // OBSIDIAN_SOURCE_NOTE is the relative path from vault root (e.g., "2025-10-03/23_Commitment.md" or "14_File.md")
        customEnv.OBSIDIAN_SOURCE_NOTE = relativePath;

        // OBSIDIAN_SOURCE_DIR is just the directory part (e.g., "2025-10-03" or ".")
        customEnv.OBSIDIAN_SOURCE_DIR = path.dirname(relativePath);

        // OBSIDIAN_SOURCE_NAME is the filename with extension (e.g., "23_Commitment.md")
        customEnv.OBSIDIAN_SOURCE_NAME = path.basename(relativePath);

        // OBSIDIAN_SOURCE_BASENAME is filename without extension (e.g., "23_Commitment")
        const ext = path.extname(relativePath);
        customEnv.OBSIDIAN_SOURCE_BASENAME = path.basename(relativePath, ext);
      }


    }

    return customEnv;
  }
}
