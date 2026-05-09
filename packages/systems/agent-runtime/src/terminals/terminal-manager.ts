import { promises as fs } from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import pty, { type IPty } from 'node-pty';
import {getTerminalId} from '../types';
import {recordTerminalSpawn, markTerminalExited, clearTerminalRecords, updateTerminalPromptDetected} from './terminal-registry';
import {startPromptDetection, feedPromptDetector, stopPromptDetection} from '../lifecycle/prompt-runner';
import type {TerminalData} from '../types';
import {captureOutput, clearBuffer, clearAllBuffers} from './terminal-output-buffer';
import {loadSettings} from '@vt/app-config/settings';
import type {VTSettings} from '@vt/graph-model/settings';
import {closeHeadlessAgent, cleanupHeadlessAgents} from '../headless/headlessAgentManager';
import {getRuntimeProjectRoot} from '../runtime/graph-bridge';
import {getRuntimeEnv, getRuntimeTrace} from '../runtime/runtime-config';

/**
 * Convert a numeric signal (as reported by node-pty on Unix) into the
 * canonical SIG* name. Returns null if the signal is unknown to this OS.
 *
 * node-pty reports `signal` as a number on exit when the process was
 * terminated by a signal. We need the name for `classifyExit`.
 */
function signalNumberToName(signalNumber: number): string | null {
    if (!signalNumber) return null;
    const map: Record<string, number> = os.constants.signals as unknown as Record<string, number>;
    for (const name of Object.keys(map)) {
        if (map[name] === signalNumber) return name;
    }
    return null;
}

/** Cached Windows shell path. Prefer pwsh.exe (PS7+) over powershell.exe (PS5) */
let cachedWindowsShell: string | undefined;
function getWindowsShell(
    probePwsh: () => void = (): void => {
        execFileSync('pwsh.exe', ['-Version'], { stdio: 'ignore', timeout: 3000 });
    },
): string {
    if (cachedWindowsShell) return cachedWindowsShell;
    try {
        probePwsh();
        cachedWindowsShell = 'pwsh.exe';
    } catch {
        cachedWindowsShell = 'powershell.exe';
    }
    return cachedWindowsShell;
}

type TerminalManagerLogger = {
  error(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  trace(message?: unknown, ...optionalParams: unknown[]): void;
}

type TerminalManagerDeps = {
  access(path: string): Promise<void>;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  env: NodeJS.ProcessEnv;
  cwd(): string;
  platform: NodeJS.Platform;
  getWindowsShell(): string;
  logger: TerminalManagerLogger;
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

      // Determine shell: user setting > platform default
      const settings: VTSettings = await loadSettings();
      const shell: string = settings.shell
        ?? (deps.platform === 'win32' ? deps.getWindowsShell() : deps.env.SHELL ?? '/bin/bash');

      // Don't use login shell flag because:
      // 1. fix-absolutePath already fixed the PATH in main.ts
      // 2. Login shells reset environment, overwriting our custom env vars
      const shellArgs: string[] = [];

      // Use initialSpawnDirectory from terminalData if provided, otherwise fall back to tools directory
      let cwd: string = terminalData.initialSpawnDirectory ?? getToolsDirectory();
      try {
        await deps.access(cwd);
      } catch {
        cwd = deps.env.HOME ?? deps.cwd();
      }

      // Build custom environment with terminal data
      const customEnv: NodeJS.ProcessEnv = this.buildEnvironment(terminalData);

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

      // Tier-3 prompt detection — feeds PTY bytes through @xterm/headless,
      // emits awaiting/cleared transitions. Best-effort: if it fails to start,
      // we fall back to the inactivity heuristic without breaking the terminal.
      try {
        startPromptDetection(terminalId, {
          onStateChange: (id: string, change): void => {
            updateTerminalPromptDetected(id, change.kind === 'detected');
          },
        });
      } catch (err: unknown) {
        deps.logger.error(`[TerminalManager] Failed to start prompt detection for ${terminalId}:`, err);
      }

      // Write initial command if provided (without newline, so it's not executed)
      if (terminalData.initialCommand) {
        const command: string = terminalData.executeCommand
          ? terminalData.initialCommand + '\r'
          : terminalData.initialCommand;
        // Wait a bit for shell prompt to appear before writing
        deps.setTimeout(() => {
          ptyProcess.write(command);
        }, 200);
      }

      // Handle PTY data
      ptyProcess.onData((data: string) => {
        captureOutput(terminalId, data);
        onData(terminalId, data);
        // Feed prompt detector — fire-and-forget; the runner handles the
        // rest asynchronously. Errors are logged but don't propagate.
        feedPromptDetector(terminalId, data).catch((err: unknown) => {
          deps.logger.error(`[TerminalManager] Prompt-detector feed failed for ${terminalId}:`, err);
        });
      });

      // Handle PTY exit
      ptyProcess.onExit((exitInfo: { exitCode: number; signal?: number }) => {
        const signalName: string | null = exitInfo.signal !== undefined
          ? signalNumberToName(exitInfo.signal)
          : null;
        onExit(terminalId, exitInfo.exitCode, signalName);
        markTerminalExited(terminalId, exitInfo.exitCode, signalName);
        stopPromptDetection(terminalId);
        this.terminals.delete(terminalId);
        clearBuffer(terminalId);
      });

      return { success: true, terminalId };
    } catch (error: unknown) {
      deps.logger.error('Failed to spawn terminal. shell=', terminalData.initialSpawnDirectory, 'cwd=', terminalData.initialSpawnDirectory, 'error=', error);

      const detail: string = error instanceof Error ? error.message : String(error);
      // posix_spawnp failures from node-pty are usually one of:
      //   - shell path doesn't exist or isn't executable (settings.shell)
      //   - the spawn cwd was deleted between fs.access() check and pty.spawn()
      //   - native module ABI mismatch (NODE_MODULE_VERSION)
      // The canned "rebuild for Electron" hint covers the third; the others
      // need the actual error message to diagnose, so we surface it verbatim.
      const errorMessage: string =
        `\r\n\x1b[31mError: Failed to spawn terminal\x1b[0m\r\n${detail}\r\n\r\n` +
        `If this is a NODE_MODULE_VERSION mismatch, rebuild native modules:\r\n` +
        `  scripts/rebuild-native.sh\r\n\r\n` +
        `Otherwise, check your shell setting (settings.shell) and that the spawn directory exists.\r\n`;

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
      const headlessResult: {closed: true; wasRunning: boolean} | {closed: false} = closeHeadlessAgent(terminalId as import('../types').TerminalId);
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

  /**
   * Build environment variables for the terminal, including terminal data
   * Note: PATH is already fixed by fix-absolutePath in main.ts
   */
  private buildEnvironment(
    terminalData: TerminalData
  ): NodeJS.ProcessEnv {
      const customEnv: { [key: string]: string | undefined; TZ?: string; } = {...this.deps.env};

      // Extra env vars (e.g., agent info)
      if (terminalData.initialEnvVars) {
          Object.assign(customEnv, terminalData.initialEnvVars);
      }

      // Always set vault path from watched directory (which IS the vault path, no suffix)
      const runtimeEnv = getRuntimeEnv();
      const vaultPath: string | null = runtimeEnv.getProjectRootWatchedDirectory
        ? runtimeEnv.getProjectRootWatchedDirectory()
        : getRuntimeProjectRoot();
      customEnv.OBSIDIAN_VAULT_PATH = vaultPath ?? '';
      customEnv.WATCHED_FOLDER = vaultPath ?? undefined;

      // Set node-based environment variables from attachedToContextNodeId

      // OTEL telemetry env vars - enables Claude Code to send metrics to our OTLP receiver
      const otlpPort: number | null = runtimeEnv.getOTLPReceiverPort?.() ?? null;
      if (otlpPort) {
        customEnv.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
        customEnv.OTEL_METRICS_EXPORTER = 'otlp';
        customEnv.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
        customEnv.OTEL_EXPORTER_OTLP_ENDPOINT = `http://localhost:${otlpPort}`;
      }

      return customEnv;
  }

}
