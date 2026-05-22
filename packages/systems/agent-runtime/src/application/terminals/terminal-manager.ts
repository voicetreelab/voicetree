import { promises as fs } from 'fs';
import {clearTerminalRecords} from './terminal-registry';
import type {TerminalData, TerminalId} from './terminal-registry/types';
import {getTerminalId as readTerminalId} from './terminal-registry/types';
import {clearBuffer, clearAllBuffers} from './terminal-output-buffer';
import {cleanupHeadlessAgents, spawnTmuxBackedTerminal} from '../headless/headlessAgentManager';
import {applyPromptFileToTmuxSpawn, injectAgentCommandHeadful} from '../headless/tmuxPromptFile';
import {
  getWindowsShell,
  resolveTerminalCwd,
  resolveTerminalShell,
  type TerminalManagerDeps,
} from './terminal-manager-spawn';
import {
  resolveTmuxVaultPath,
  withResolvedTmuxVaultPath,
  withVoicetreeVaultPath,
} from './tmuxSpawnPlanning';
import {getRuntimeEnv} from '../runtime/runtime-config';

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

async function resolveRuntimeWritePath(): Promise<string | null> {
  try {
    return await (getRuntimeEnv().getWritePath?.() ?? Promise.resolve(null));
  } catch {
    return null;
  }
}

/**
 * Deep module for managing tmux-backed terminals.
 *
 * Public API:
 * - spawnTmuxBacked(opts): create a tmux session and inject the agent prompt
 * - cleanupForWindow(terminalIds): drop output buffers when a window closes
 * - cleanup(): teardown all sessions + buffers on app shutdown / folder switch
 *
 * The legacy node-pty surface (spawn/write/resize/kill via an in-process PTY
 * map) has been deleted. Interactive terminals run inside tmux; the renderer
 * speaks WebSocket to the relay for input/output. Text injection from
 * non-renderer callers flows through `sendTextToTerminal` (tmux send-keys).
 */
export class TerminalManager {
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

  // Tmux-backed interactive spawn. Creates a tmux session running the user
  // shell (so the relay's WS attach has something to connect to) and
  // registers in terminal-registry. The renderer panel speaks WS to the relay
  // directly — no PTY is owned by this process.
  //
  // Phase 6 prompt delivery: the agent prompt is written to a disk file
  // ({vault}/.voicetree/terminals/{name}-prompt.txt, mode 0600) at spawn
  // time via `applyPromptFileToTmuxSpawn` and never crosses tmux's argv.
  // AGENT_PROMPT is dropped from the tmux -e env vector (replaced by an
  // AGENT_PROMPT_FILE pointer) — without this, multi-KB prompts piled into
  // tmux's command-protocol buffer overflow on macOS (`command too long`).
  // After the shell is ready, the initialCommand is injected via
  // `tmux send-keys`. The primitive CLI-rewrites it (stdin redirect for
  // claude/gemini, $(cat) for codex, stripped for unknown CLIs which must
  // read AGENT_PROMPT_FILE from env) so the shell consumes the on-disk
  // prompt instead of expanding `$AGENT_PROMPT`.
  // tmux server inherits PATH/HOME/SHELL/USER from the Electron main spawn
  // context; panes inherit from the server. Apart from AGENT_PROMPT itself,
  // all other initialEnvVars ride along on tmux -e.
  async spawnTmuxBacked(opts: TerminalSpawnOpts): Promise<TerminalSpawnResult> {
    const {terminalData, getToolsDirectory} = opts;
    const deps: TerminalManagerDeps = this.deps;
    const terminalId: TerminalId = readTerminalId(terminalData);
    try {
      const shell: string = await resolveTerminalShell(deps);
      const cwd: string = await resolveTerminalCwd(terminalData, getToolsDirectory, deps);
      const initial: Record<string, string> = terminalData.initialEnvVars ?? {};
      const vaultPath: string | undefined = resolveTmuxVaultPath(deps.env, initial, await resolveRuntimeWritePath());
      const plan = vaultPath
        ? applyPromptFileToTmuxSpawn({
            vaultPath,
            terminalId,
            command: terminalData.initialCommand ?? '',
            env: initial,
          })
        : {command: terminalData.initialCommand ?? '', env: initial, promptFilePath: null};
      const tmuxEnv: Record<string, string> = withVoicetreeVaultPath(plan.env, vaultPath);
      const terminalDataWithVaultPath: TerminalData = {
        ...terminalData,
        initialEnvVars: withResolvedTmuxVaultPath(initial, vaultPath),
      };
      await spawnTmuxBackedTerminal(terminalId, terminalDataWithVaultPath, shell, cwd, tmuxEnv, undefined, plan.promptFilePath);
      if (terminalData.initialCommand) {
        await injectAgentCommandHeadful({terminalId, command: plan.command});
      }
      return {success: true, terminalId};
    } catch (error: unknown) {
      deps.logger.error(`Failed to spawn tmux-backed terminal ${terminalId}:`, error);
      return {success: false, terminalId, error: error instanceof Error ? error.message : String(error)};
    }
  }

  /**
   * Drop output buffers for window-close cleanup.
   * The tmux sessions themselves are not killed — closing the window only
   * detaches the renderer; the agent keeps running and can be re-attached.
   */
  cleanupForWindow(terminalIds: readonly string[]): void {
    for (const terminalId of terminalIds) {
      clearBuffer(terminalId);
    }
  }

  /**
   * Clean up all terminals on app shutdown / folder switch.
   * Records are cleared first so subscriber notifications don't fire after
   * the renderer is torn down; then tmux sessions are killed and ring
   * buffers cleared.
   */
  cleanup(): void {
    clearTerminalRecords();
    cleanupHeadlessAgents();
    clearAllBuffers();
  }
}
