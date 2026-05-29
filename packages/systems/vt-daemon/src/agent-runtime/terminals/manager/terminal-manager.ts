import { promises as fs } from 'fs';
import {clearTerminalRecords} from '../terminal-registry';
import type {TerminalData, TerminalId} from '../terminal-registry/types';
import {getTerminalId as readTerminalId} from '../terminal-registry/types';
import {clearBuffer, clearAllBuffers} from '../terminal-output-buffer';
import {
  cleanupHeadlessAgentsAndWait,
  cleanupHeadlessAgents,
  TERMINATE_TMUX_SESSIONS,
  type HeadlessAgentCleanupPolicy,
  spawnTmuxBackedTerminal,
} from '@vt/vt-daemon/agent-runtime/headless/headlessAgentManager.ts';
import {injectAgentCommandHeadful, writePromptFile} from '@vt/vt-daemon/agent-runtime/headless/tmuxPromptFile.ts';
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
  resolveTmuxProjectPath,
  withResolvedTmuxProjectPath,
  type HeadfulPromptInjectionRequest,
  type PromptFileWriteRequest,
} from '../tmux/tmuxSpawnPlanning';
import {getRuntimeEnv} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts';
import type {TerminalSpawnResult} from '@vt/vt-daemon-protocol'

// `TerminalSpawnResult` / `TerminalOperationResult` are canonically owned by
// `@vt/vt-daemon-protocol` (BF-376 outbound). Re-export so the existing
// `@vt/agent-runtime` deep paths and per-name re-exports in the public
// barrel keep working without each consumer rewriting its imports today.
export type {
    TerminalSpawnResult,
    TerminalOperationResult,
} from '@vt/vt-daemon-protocol'

export interface TerminalSpawnOpts {
  terminalData: TerminalData;
  getToolsDirectory: () => string;
  onData: (terminalId: string, data: string) => void;
  onExit: (terminalId: string, exitCode: number, signal?: string | null) => void;
}

export type TerminalCleanupPolicy = HeadlessAgentCleanupPolicy;

function writeResolvedPromptFile(request: PromptFileWriteRequest | null): string | null {
  if (!request) return null;
  return writePromptFile(request.projectRoot, request.terminalId, request.prompt);
}

async function resolveRuntimeProjectRoot(): Promise<string | null> {
  try {
    return await (getRuntimeEnv().getProjectRoot?.() ?? Promise.resolve(null));
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
 * - cleanup(policy): release runtime state and optionally terminate tmux sessions
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
  // ({project}/.voicetree/terminals/{name}-prompt.txt, mode 0600) at spawn
  // time as an auxiliary delivery path. After the shell is ready, the agent
  // command is injected via `tmux send-keys` exactly as configured. The
  // original AGENT_PROMPT env var is kept so existing
  // agent commands like `claude "$AGENT_PROMPT"` and custom agents continue to
  // receive the prompt through their configured interface.
  // tmux server inherits PATH/HOME/SHELL/USER from the Electron main spawn
  // context; panes inherit from the server.
  async spawnTmuxBacked(opts: TerminalSpawnOpts): Promise<TerminalSpawnResult> {
    const {terminalData, getToolsDirectory} = opts;
    const deps: TerminalManagerDeps = this.deps;
    const terminalId: TerminalId = readTerminalId(terminalData);
    try {
      const shell: string = await resolveTerminalShell(deps);
      const cwd: string = await resolveTerminalCwd(terminalData, getToolsDirectory, deps);
      const initial: Record<string, string> = terminalData.initialEnvVars ?? {};
      const projectRoot: string | undefined = resolveTmuxProjectPath(deps.env, initial, await resolveRuntimeProjectRoot());
      const promptFile: string | null = writeResolvedPromptFile(
        resolvePromptFileWrite(projectRoot, terminalId, initial.AGENT_PROMPT),
      );
      const tmuxEnv: Record<string, string> = buildTmuxEnv(initial, projectRoot, promptFile);
      const terminalDataWithProjectPath: TerminalData = {
        ...terminalData,
        initialEnvVars: withResolvedTmuxProjectPath(initial, projectRoot),
      };
      await spawnTmuxBackedTerminal(terminalId, terminalDataWithProjectPath, shell, cwd, tmuxEnv, undefined, promptFile);
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
   * Clean up all terminal runtime state.
   *
   * Use `preserve` when the host process is quitting and tmux sessions should
   * survive for reconciliation on relaunch. Use `terminate` for explicit
   * destructive cleanup such as project switching.
   * Records are cleared first so subscriber notifications don't fire after
   * the renderer is torn down; then headless runtime state and ring buffers
   * are cleared according to the policy.
   */
  cleanup(policy: TerminalCleanupPolicy = TERMINATE_TMUX_SESSIONS): void {
    clearTerminalRecords();
    cleanupHeadlessAgents(policy);
    clearAllBuffers();
  }

  async cleanupAndWait(policy: TerminalCleanupPolicy = TERMINATE_TMUX_SESSIONS): Promise<void> {
    clearTerminalRecords();
    await cleanupHeadlessAgentsAndWait(policy);
    clearAllBuffers();
  }
}
