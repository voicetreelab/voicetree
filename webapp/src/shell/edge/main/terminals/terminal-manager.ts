import { promises as fs, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import pty, { type IPty } from 'node-pty';
import type { WebContents } from 'electron';
import {getTerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import {getOTLPReceiverPort} from "@/shell/edge/main/metrics/otlp-receiver";
import {recordTerminalSpawn, markTerminalExited, clearTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {trace} from '@/shell/edge/main/tracing/trace';
import {getProjectRootWatchedDirectory} from "@/shell/edge/main/state/watch-folder-store";
import {captureOutput, clearBuffer, clearAllBuffers} from '@/shell/edge/main/terminals/terminal-output-buffer';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';
import type {VTSettings} from '@vt/graph-model/pure/settings/types';
import {closeHeadlessAgent, cleanupHeadlessAgents} from '@/shell/edge/main/terminals/headlessAgentManager';

/**
 * Write agent prompt to a temp file for shell-agnostic delivery.
 * Avoids reliance on $AGENT_PROMPT shell expansion (fails on PowerShell/WSL).
 */
function writePromptFile(terminalId: string, prompt: string): string {
    const dir: string = join(tmpdir(), 'voicetree-prompts');
    mkdirSync(dir, {recursive: true});
    const filePath: string = join(dir, `${terminalId}-prompt.txt`);
    writeFileSync(filePath, prompt, {encoding: 'utf8'});
    return filePath;
}

function toWslPath(windowsPath: string): string {
    const drive: string = windowsPath[0].toLowerCase();
    const rest: string = windowsPath.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest}`;
}

/**
 * Rewrite command to consume prompt from a file instead of $AGENT_PROMPT.
 * Handles PowerShell, WSL, and bash with appropriate syntax.
 */
function rewriteCommandForPromptFile(command: string, promptFilePath: string, shell: string): string {
    const stripped: string = command
        .replace(/\s*"\$AGENT_PROMPT"/g, '')
        .replace(/\s*'\$AGENT_PROMPT'/g, '')
        .replace(/\s*\$AGENT_PROMPT/g, '')
        .trim();

    const shellLower: string = shell.toLowerCase();
    const isWsl: boolean = shellLower.includes('wsl');
    const isPowerShell: boolean = shellLower.includes('powershell') || shellLower.includes('pwsh');

    if (isWsl) {
        const wslPath: string = toWslPath(promptFilePath);
        return `${stripped} < '${wslPath}'`;
    }
    if (isPowerShell) {
        return `Get-Content -Raw '${promptFilePath}' | ${stripped}`;
    }
    return `${stripped} < '${promptFilePath}'`;
}

/** Cached Windows shell path. Prefer pwsh.exe (PS7+) over powershell.exe (PS5) */
let cachedWindowsShell: string | undefined;
function getWindowsShell(): string {
    if (cachedWindowsShell) return cachedWindowsShell;
    try {
        execFileSync('pwsh.exe', ['-Version'], { stdio: 'ignore', timeout: 3000 });
        cachedWindowsShell = 'pwsh.exe';
    } catch {
        cachedWindowsShell = 'powershell.exe';
    }
    return cachedWindowsShell;
}

export interface TerminalSpawnResult {
  success: boolean;
  terminalId: string;
  error?: string;
}

export interface TerminalOperationResult {
  success: boolean;
  error?: string;
}

/**
 * Deep module for managing PTY terminals in the Electron app.
 *
 * Public API:
 * - spawn(sender, terminalData, getToolsDirectory)
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
  private terminals = new Map<string, IPty>();
  private terminalToWindow = new Map<string, number>();

  /**
   * Spawn a new PTY terminal with terminal data for environment variables
   */
  async spawn(
    sender: WebContents,
    terminalData: TerminalData,
    getToolsDirectory: () => string
  ): Promise<TerminalSpawnResult> {
    return trace('terminal:spawn', async () => {
    try {
      const terminalId: string = getTerminalId(terminalData);

      // Determine shell: user setting > platform default
      const settings: VTSettings = await loadSettings();
      const shell: string = settings.shell
        ?? (process.platform === 'win32' ? getWindowsShell() : process.env.SHELL ?? '/bin/bash');

      // Don't use login shell flag because:
      // 1. fix-absolutePath already fixed the PATH in main.ts
      // 2. Login shells reset environment, overwriting our custom env vars
      const shellArgs: string[] = [];

      // Use initialSpawnDirectory from terminalData if provided, otherwise fall back to tools directory
      let cwd: string = terminalData.initialSpawnDirectory ?? getToolsDirectory();
      try {
        await fs.access(cwd);
      } catch {
        //console.log('[Terminal] Spawn directory not found, falling back to home directory');
        cwd = process.env.HOME ?? process.cwd();
      }

      // Build custom environment with terminal data
      const customEnv: NodeJS.ProcessEnv = this.buildEnvironment(terminalData);

      //console.log(`Spawning PTY with shell: ${shell} in directory: ${cwd}`);
      //console.log(`Terminal data:`, terminalData);

      // Create PTY instance
      // PATH is already fixed by fix-absolutePath in main.ts
      // Use standard terminal dimensions (80×24) - close to actual frontend size
      // Frontend will resize to actual dimensions after FitAddon calculates them
      // CRITICAL: Don't use massive dimensions (800×1600) as resize triggers clear screen
      const ptyProcess: pty.IPty = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd,
        env: customEnv
      });

      // Store the PTY process
      this.terminals.set(terminalId, ptyProcess);
      recordTerminalSpawn(terminalId, terminalData);

      // Track terminal ownership for cleanup when window closes
      this.terminalToWindow.set(terminalId, sender.id);

      // Write initial command if provided (without newline, so it's not executed)
      if (terminalData.initialCommand) {
        let commandToWrite: string = terminalData.initialCommand;

        // On Windows, $AGENT_PROMPT shell expansion fails (PowerShell treats
        // it as a PS variable; WSL doesn't inherit env vars from Windows).
        // Write prompt to a file and rewrite the command to consume it via
        // stdin redirect — same approach the tmux backend uses on macOS.
        const prompt: string | undefined = terminalData.initialEnvVars?.AGENT_PROMPT;
        if (prompt && commandToWrite.includes('$AGENT_PROMPT') && process.platform === 'win32') {
          const promptFilePath: string = writePromptFile(terminalId, prompt);
          commandToWrite = rewriteCommandForPromptFile(commandToWrite, promptFilePath, shell);
        }

        const command: string = terminalData.executeCommand
          ? commandToWrite + '\r'
          : commandToWrite;
        // Wait a bit for shell prompt to appear before writing
        setTimeout(() => {
          ptyProcess.write(command);
        }, 200);
      }

      // Handle PTY data
      ptyProcess.onData((data: string) => {
        captureOutput(terminalId, data);
        try {
          sender.send('terminal:data', terminalId, data);
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
        markTerminalExited(terminalId);
        this.terminals.delete(terminalId);
        this.terminalToWindow.delete(terminalId);
        clearBuffer(terminalId);
      });

      //console.log(`[TerminalManager] Terminal ${terminalId} spawned successfully with PID: ${ptyProcess.pid}`);
      //console.log(`[TerminalManager] sender.id at spawn time: ${sender.id}, isDestroyed: ${sender.isDestroyed()}`);
      return { success: true, terminalId };
    } catch (error: unknown) {
      console.error('Failed to spawn terminal:', error);

      // Send error message to display in terminal
      const errorMessage: string = `\r\n\x1b[31mError: Failed to spawn terminal\x1b[0m\r\n${error instanceof Error ? error.message : String(error)}\r\n\r\nMake sure node-pty is properly installed and rebuilt for Electron:\r\nnpx electron-rebuild\r\n`;

      // Create a fake terminal ID for error display
      const terminalId: string = `error-${Date.now()}`;
      setTimeout(() => {
        try {
          if (!sender.isDestroyed()) {
            sender.send('terminal:data', terminalId, errorMessage);
          }
        } catch (error) {
          console.error(`Failed to send terminal error message for ${terminalId}:`, error);
        }
      }, 100);

      return { success: true, terminalId }; // Return success with error terminal
    }
    });
  }

  /**
   * Write data to a terminal
   */
  write(terminalId: string, data: string): TerminalOperationResult {
    try {
      const ptyProcess: pty.IPty | undefined = this.terminals.get(terminalId);
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
    } catch (error: unknown) {
      console.error(`Failed to write to terminal ${terminalId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Resize a terminal
   */
  resize(terminalId: string, cols: number, rows: number): TerminalOperationResult {
    try {
      // Debug: warn when terminal dimensions are unreasonably large
      if (cols > 500 || rows > 200) {
        console.warn(`[Terminal] OVERSIZED resize for ${terminalId}: ${cols}×${rows} (cols×rows). This likely indicates a sizing bug.`);
        console.trace('[Terminal] OVERSIZED resize stack trace');
      }

      const ptyProcess: pty.IPty | undefined = this.terminals.get(terminalId);
      if (!ptyProcess) {
        // Ignore resize for error terminals
        if (terminalId.startsWith('error-')) {
          return { success: true };
        }
        return { success: false, error: 'Terminal not found' };
      }

      // Resize PTY
      ptyProcess.resize(cols, rows);
      // //console.log(`Terminal ${terminalId} resized to ${cols}x${rows}`);
      return { success: true };
    } catch (error: unknown) {
      console.error(`Failed to resize terminal ${terminalId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Kill a terminal
   */
  kill(terminalId: string): TerminalOperationResult {
    try {
      // Headless agents: shared close path (handles both running + exited)
      const headlessResult: {closed: true; wasRunning: boolean} | {closed: false} = closeHeadlessAgent(terminalId as import('@/shell/edge/UI-edge/floating-windows/types').TerminalId);
      if (headlessResult.closed) {
        return { success: true };
      }

      const ptyProcess: pty.IPty | undefined = this.terminals.get(terminalId);
      if (!ptyProcess) {
        // Clean up error terminals too
        if (terminalId.startsWith('error-')) {
          this.terminals.delete(terminalId);
          markTerminalExited(terminalId);
          return { success: true };
        }
        return { success: false, error: 'Terminal not found' };
      }

      // Kill the PTY process
      ptyProcess.kill();
      markTerminalExited(terminalId);
      this.terminals.delete(terminalId);
      this.terminalToWindow.delete(terminalId);
      clearBuffer(terminalId);
      return { success: true };
    } catch (error: unknown) {
      console.error(`Failed to kill terminal ${terminalId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Clean up all terminals owned by a specific window
   */
  cleanupForWindow(windowId: number): void {
    //console.log(`Window ${windowId} closed, cleaning up terminals`);

    // Find and kill all terminals owned by this window
    for (const [terminalId, webContentsId] of this.terminalToWindow.entries()) {
      if (webContentsId === windowId) {
        //console.log(`Cleaning up terminal ${terminalId} for window ${windowId}`);
        const ptyProcess: pty.IPty | undefined = this.terminals.get(terminalId);
        if (ptyProcess && ptyProcess.kill) {
          try {
            ptyProcess.kill();
          } catch (error) {
            console.error(`Error killing terminal ${terminalId}:`, error);
          }
        }
        this.terminals.delete(terminalId);
        this.terminalToWindow.delete(terminalId);
        clearBuffer(terminalId);
      }
    }
  }

  /**
   * Clean up all terminals (called on app shutdown and folder switch)
   */
  cleanup(): void {
    // Clear the terminal registry FIRST, before killing PTYs.
    // This prevents onExit handlers from calling markTerminalExited → pushStateToRenderer,
    // which would sync stale terminals to the newly mounted renderer during project switch.
    clearTerminalRecords();

    // Kill all headless agents
    cleanupHeadlessAgents();

    for (const [id, ptyProcess] of this.terminals) {
      //console.log(`Cleaning up terminal ${id}`);
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
    clearAllBuffers();
  }

  /**
   * Build environment variables for the terminal, including terminal data
   * Note: PATH is already fixed by fix-absolutePath in main.ts
   */
  private buildEnvironment(
    terminalData: TerminalData
  ): NodeJS.ProcessEnv {
      //console.log(`[TerminalManager] process.env.OBSIDIAN_VAULT_PATH BEFORE copy: ${process.env.OBSIDIAN_VAULT_PATH}`);
      const customEnv: { [key: string]: string | undefined; TZ?: string; } = {...process.env};

      // Extra env vars (e.g., agent info)
      if (terminalData.initialEnvVars) {
          //console.log(`[TerminalManager] initialEnvVars:`, terminalData.initialEnvVars);
          if (terminalData.initialEnvVars.OBSIDIAN_VAULT_PATH) {
              //console.log(`[TerminalManager] WARNING: initialEnvVars contains OBSIDIAN_VAULT_PATH: ${terminalData.initialEnvVars.OBSIDIAN_VAULT_PATH}`);
          }
          Object.assign(customEnv, terminalData.initialEnvVars);
      }

      // Always set vault path from watched directory (which IS the vault path, no suffix)
      const vaultPath: string | null = getProjectRootWatchedDirectory();
      //console.log(`[TerminalManager] Using vault path: ${vaultPath}`);
      customEnv.OBSIDIAN_VAULT_PATH = vaultPath ?? '';
      customEnv.WATCHED_FOLDER = vaultPath ?? undefined;

      // Set node-based environment variables from attachedToContextNodeId

      // OTEL telemetry env vars - enables Claude Code to send metrics to our OTLP receiver
      const otlpPort: number | null = getOTLPReceiverPort();
      if (otlpPort) {
        customEnv.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
        customEnv.OTEL_METRICS_EXPORTER = 'otlp';
        customEnv.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
        customEnv.OTEL_EXPORTER_OTLP_ENDPOINT = `http://localhost:${otlpPort}`;
      }

      return customEnv;
  }

}
