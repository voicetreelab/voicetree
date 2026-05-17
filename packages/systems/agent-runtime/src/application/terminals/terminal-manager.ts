import { promises as fs } from 'fs';
import {clearTerminalRecords} from './terminal-registry';
import type {TerminalData, TerminalId} from './terminal-registry/types';
import {getTerminalId as readTerminalId} from './terminal-registry/types';
import {clearBuffer, clearAllBuffers} from './terminal-output-buffer';
import {cleanupHeadlessAgents, spawnTmuxBackedTerminal} from '../headless/headlessAgentManager';
import {injectAgentCommandHeadful, writePromptFile} from '../headless/tmuxPromptFile';
import {
  getWindowsShell,
  resolveTerminalCwd,
  resolveTerminalShell,
  type TerminalManagerDeps,
} from './terminal-manager-spawn';
import {
  buildTmuxEnv,
  resolveHeadfulPromptInjection,
  resolvePromptFileWrite,
  resolveTmuxVaultPath,
  withResolvedTmuxVaultPath,
  type HeadfulPromptInjectionRequest,
  type PromptFileWriteRequest,
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

function writeResolvedPromptFile(request: PromptFileWriteRequest | null): string | null {
  if (!request) return null;
  return writePromptFile(request.vaultPath, request.terminalId, request.prompt);
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
      const vaultPath: string | undefined = resolveTmuxVaultPath(deps.env, initial, await resolveRuntimeWritePath());
      const promptFile: string | null = writeResolvedPromptFile(
        resolvePromptFileWrite(vaultPath, terminalId, initial.AGENT_PROMPT),
      );
      const tmuxEnv: Record<string, string> = buildTmuxEnv(initial, vaultPath, promptFile);
      const terminalDataWithVaultPath: TerminalData = {
        ...terminalData,
        initialEnvVars: withResolvedTmuxVaultPath(initial, vaultPath),
      };
      await spawnTmuxBackedTerminal(terminalId, terminalDataWithVaultPath, shell, cwd, tmuxEnv, undefined, promptFile);
      const promptInjection: HeadfulPromptInjectionRequest | null = resolveHeadfulPromptInjection(
        terminalId,
        terminalData.initialCommand,
      );
      if (promptInjection) {
        await injectAgentCommandHeadful(promptInjection);
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
