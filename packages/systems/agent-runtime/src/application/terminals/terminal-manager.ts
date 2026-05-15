import { promises as fs } from 'fs';
import pty, { type IPty } from 'node-pty';
import {getTerminalId} from './terminal-registry/types';
import {recordTerminalSpawn, markTerminalExited, clearTerminalRecords} from './terminal-registry';
import type {TerminalData, TerminalId} from './terminal-registry/types';
import {getTerminalId as readTerminalId} from './terminal-registry/types';
import {clearBuffer, clearAllBuffers} from './terminal-output-buffer';
import {closeHeadlessAgent, cleanupHeadlessAgents, spawnTmuxBackedTerminal} from '../headless/headlessAgentManager';
import {injectAgentCommandHeadful, writePromptFile} from '../headless/tmuxPromptFile';
import {getRuntimeTrace} from '../runtime/runtime-config';
import {
  attachPtyProcessHandlers,
  buildTerminalEnvironment,
  formatSpawnErrorMessage,
  getWindowsShell,
  resolveTerminalCwd,
  resolveTerminalShell,
  startPromptDetectionForTerminal,
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

      startPromptDetectionForTerminal(terminalId, deps.logger);
      writeInitialCommand(terminalData, ptyProcess, deps.setTimeout);
      attachPtyProcessHandlers({
        terminalId,
        ptyProcess,
        onData,
        onExit,
        logger: deps.logger,
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

  // Tmux-backed interactive spawn. Creates a tmux session running the user
  // shell (so the relay's WS attach has something to connect to) and
  // registers in terminal-registry. The renderer panel speaks WS to the relay
  // directly — no PTY is owned by this process for tmux-backed terminals.
  //
  // Phase 6 prompt delivery: the agent prompt is written to a disk file
  // ({vault}/.voicetree/terminals/{name}-prompt.txt, mode 0600) at spawn
  // time and never crosses tmux's argv. After the shell is ready, the agent
  // command is injected via `tmux send-keys` with a short reference to the
  // prompt file (stdin redirection for claude/gemini, $(cat) for codex,
  // env-only AGENT_PROMPT_FILE fallback for other CLIs).
  // tmux server inherits PATH/HOME/SHELL/USER from the Electron main spawn
  // context; panes inherit from the server. Only AGENT_PROMPT itself is
  // dropped from the tmux env (replaced by AGENT_PROMPT_FILE pointing at
  // the on-disk file) — all other initialEnvVars ride along on tmux -e.
  async spawnTmuxBacked(opts: TerminalSpawnOpts): Promise<TerminalSpawnResult> {
    const {terminalData, getToolsDirectory} = opts;
    const deps: TerminalManagerDeps = this.deps;
    const terminalId: TerminalId = readTerminalId(terminalData);
    try {
      const shell: string = await resolveTerminalShell(deps);
      const cwd: string = await resolveTerminalCwd(terminalData, getToolsDirectory, deps);
      const initial: Record<string, string> = terminalData.initialEnvVars ?? {};
      const vaultPath: string | undefined = deps.env.VOICETREE_VAULT_PATH ?? initial.VOICETREE_VAULT_PATH;
      const agentPrompt: string | undefined = initial.AGENT_PROMPT;
      const promptFile: string | null = agentPrompt && vaultPath
        ? writePromptFile(vaultPath, terminalId, agentPrompt)
        : null;
      const tmuxEnv: Record<string, string> = {};
      for (const key of Object.keys(initial)) {
        if (key === 'AGENT_PROMPT') continue;
        const value: string = initial[key];
        if (typeof value === 'string') tmuxEnv[key] = value;
      }
      // Explicit '' override defeats OS env-inheritance leak from parent
      // electron process: simply omitting AGENT_PROMPT from the tmux -e set
      // doesn't unset values inherited via electron → tmux server → bash → node.
      tmuxEnv.AGENT_PROMPT = '';
      if (promptFile) tmuxEnv.AGENT_PROMPT_FILE = promptFile;
      // spawnTmuxBackedTerminal demands VOICETREE_VAULT_PATH in tmuxEnv to
      // resolve the log/metadata paths. IPC callers (Electron headful spawn)
      // don't always set it in initialEnvVars — fall back to the main process
      // env we already consulted above.
      if (vaultPath && !tmuxEnv.VOICETREE_VAULT_PATH) tmuxEnv.VOICETREE_VAULT_PATH = vaultPath;
      await spawnTmuxBackedTerminal(terminalId, terminalData, shell, cwd, tmuxEnv, undefined, promptFile);
      if (promptFile && terminalData.initialCommand) {
        await injectAgentCommandHeadful({terminalId, command: terminalData.initialCommand, promptFilePath: promptFile});
      }
      return {success: true, terminalId};
    } catch (error: unknown) {
      deps.logger.error(`Failed to spawn tmux-backed terminal ${terminalId}:`, error);
      return {success: false, terminalId, error: error instanceof Error ? error.message : String(error)};
    }
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
