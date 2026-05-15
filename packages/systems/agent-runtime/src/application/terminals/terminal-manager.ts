import { promises as fs } from 'fs';
import pty, { type IPty } from 'node-pty';
import {getTerminalId} from './terminal-registry/types';
import {recordTerminalSpawn, markTerminalExited, clearTerminalRecords} from './terminal-registry';
import type {TerminalData} from './terminal-registry/types';
import {clearBuffer, clearAllBuffers} from './terminal-output-buffer';
import {closeHeadlessAgent, cleanupHeadlessAgents} from '../headless/headlessAgentManager';
import {getRuntimeTrace} from '../runtime/runtime-config';
import {
  attachPtyProcessHandlers,
  buildTerminalEnvironment,
  formatSpawnErrorMessage,
  getWindowsShell,
  resolveTerminalCwd,
  resolveTerminalShell,
  writeInitialCommand,
  type TerminalManagerDeps,
} from './terminal-manager-spawn';

export interface TerminalSpawnResult {
  success: boolean;
  terminalId: string;
  error?: string;
}

export interface TerminalOperationResult {
  success: boolean;
  error?: string;
}

export interface TerminalSpawnOpts {
  terminalData: TerminalData;
  getToolsDirectory: () => string;
  onData: (terminalId: string, data: string) => void;
  onExit: (terminalId: string, exitCode: number, signal?: string | null) => void;
}

/**
 * Deep module for managing PTY terminals.
 *
 * Public API:
 * - spawn({ terminalData, getToolsDirectory, onData, onExit })
 * - write(terminalId, data)
 * - resize(terminalId, cols, rows)
 * - kill(terminalId)
 * - cleanupForWindow(terminalIds)
 * - cleanup()
 *
 * Hides:
 * - PTY process lifecycle
 * - Environment variable injection
 * - Shell selection logic
 * - Error terminal handling
 */
export class TerminalManager {
  private terminals = new Map<string, IPty>();

  constructor(private readonly deps: TerminalManagerDeps = {
    access: (p: string): Promise<void> => fs.access(p),
    now: Date.now,
    setTimeout,
    env: process.env,
    cwd: (): string => process.cwd(),
    platform: process.platform,
    getWindowsShell,
    logger: { error: console.error, warn: console.warn, trace: console.trace },
  }) {}

  async spawn(opts: TerminalSpawnOpts): Promise<TerminalSpawnResult> {
    const { terminalData, getToolsDirectory, onData, onExit } = opts;
    const deps: TerminalManagerDeps = this.deps;
    return getRuntimeTrace()('terminal:spawn', async () => {
    try {
      const terminalId: string = getTerminalId(terminalData);

      const shell: string = await resolveTerminalShell(deps);

      // Don't use login shell flag because:
      // 1. fix-absolutePath already fixed the PATH in main.ts
      // 2. Login shells reset environment, overwriting our custom env vars
      const shellArgs: string[] = [];

      const cwd: string = await resolveTerminalCwd(terminalData, getToolsDirectory, deps);

      const customEnv: NodeJS.ProcessEnv = buildTerminalEnvironment(terminalData, deps);

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

      writeInitialCommand(terminalData, ptyProcess, deps.setTimeout);
      attachPtyProcessHandlers({
        terminalId,
        ptyProcess,
        onData,
        onExit,
        releaseTerminal: () => { this.terminals.delete(terminalId); },
      });

      return { success: true, terminalId };
    } catch (error: unknown) {
      deps.logger.error('Failed to spawn terminal. shell=', terminalData.initialSpawnDirectory, 'cwd=', terminalData.initialSpawnDirectory, 'error=', error);

      const errorMessage: string = formatSpawnErrorMessage(error);

      // Create a fake terminal ID for error display
      const terminalId: string = `error-${deps.now()}`;
      // Delay so the renderer has time to mount the terminal before receiving data
      deps.setTimeout(() => onData(terminalId, errorMessage), 100);

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
      this.deps.logger.error(`Failed to write to terminal ${terminalId}:`, error);
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
        this.deps.logger.warn(`[Terminal] OVERSIZED resize for ${terminalId}: ${cols}×${rows} (cols×rows). This likely indicates a sizing bug.`);
        this.deps.logger.trace('[Terminal] OVERSIZED resize stack trace');
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
      return { success: true };
    } catch (error: unknown) {
      this.deps.logger.error(`Failed to resize terminal ${terminalId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Kill a terminal
   */
  kill(terminalId: string): TerminalOperationResult {
    try {
      // Headless agents: shared close path (handles both running + exited)
      const headlessResult: {closed: true; wasRunning: boolean} | {closed: false} = closeHeadlessAgent(terminalId as import('./terminal-registry/types').TerminalId);
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
      clearBuffer(terminalId);
      return { success: true };
    } catch (error: unknown) {
      this.deps.logger.error(`Failed to kill terminal ${terminalId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Bulk-kill terminals without firing markTerminalExited.
   * Intended for window-close cleanup, where the registry's renderer push
   * would target a destroyed renderer anyway.
   */
  cleanupForWindow(terminalIds: readonly string[]): void {
    for (const terminalId of terminalIds) {
      const ptyProcess: pty.IPty | undefined = this.terminals.get(terminalId);
      if (ptyProcess && ptyProcess.kill) {
        try {
          ptyProcess.kill();
        } catch (error) {
          this.deps.logger.error(`Error killing terminal ${terminalId}:`, error);
        }
      }
      this.terminals.delete(terminalId);
      clearBuffer(terminalId);
    }
  }

  /**
   * Clean up all terminals (called on app shutdown and folder switch)
   */
  cleanup(): void {
    // Clear the terminal registry FIRST, before killing PTYs.
    // This prevents onExit handlers from calling markTerminalExited → registry subscribers,
    // which would sync stale terminals to the newly mounted renderer during project switch.
    clearTerminalRecords();

    // Kill all headless agents
    cleanupHeadlessAgents();

    for (const [id, ptyProcess] of this.terminals) {
      try {
        if (!id.startsWith('error-') && ptyProcess.kill) {
          ptyProcess.kill();
        }
      } catch (e) {
        this.deps.logger.error(`Error killing terminal ${id}:`, e);
      }
    }
    this.terminals.clear();
    clearAllBuffers();
  }

}
