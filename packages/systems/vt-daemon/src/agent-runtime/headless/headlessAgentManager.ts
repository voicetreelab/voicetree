/**
 * Headless Agent Manager — public facade for tmux-backed background agents
 * and tmux-backed interactive terminals.
 *
 * Functional edge module: exported functions coordinate cohesive runtime
 * modules; impure tmux and registry details stay at the shell.
 */

import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'
import {
    cleanupTmuxHeadlessAgentsAndWait,
    cleanupTmuxHeadlessAgents,
    detachTmuxHeadlessAgents,
    getTmuxHeadlessAgentOutput,
    isTmuxHeadlessAgent as hasTmuxHeadlessRuntime,
    killTmuxHeadlessAgent,
    reconcileTmuxHeadlessAgents,
    removeTmuxHeadlessAgentState,
    sendTmuxHeadlessAgentInput,
    spawnTmuxBackedTerminal,
    spawnTmuxHeadlessAgent,
} from './tmuxHeadlessRuntime'
import {
    defaultHeadlessAgentDeps,
    type HeadlessAgentDeps,
} from './headlessAgentDeps'

export type {HeadlessAgentDeps, HeadlessLogEntry} from './headlessAgentDeps'
export {buildResumeCommand} from './headlessAgentLifecycle'
export {reconcileTmuxHeadlessAgents, spawnTmuxBackedTerminal}

export type HeadlessAgentCleanupPolicy = {
    readonly tmuxSessions: 'preserve' | 'terminate'
}

export const TERMINATE_TMUX_SESSIONS: HeadlessAgentCleanupPolicy = {
    tmuxSessions: 'terminate',
}

export const PRESERVE_TMUX_SESSIONS: HeadlessAgentCleanupPolicy = {
    tmuxSessions: 'preserve',
}

/**
 * Spawn a headless agent as a tmux session.
 * Registers in terminal-registry for status tracking, then spawns the session.
 */
export function spawnHeadlessAgent(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): void {
    spawnTmuxHeadlessAgent(terminalId, terminalData, command, cwd, env, deps)
}

/**
 * Kill a headless agent (SIGTERM via tmux).
 * Returns true if the session existed and was signalled, false otherwise.
 * Async: awaits tmux session teardown so callers observe a settled state.
 */
export async function killHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited' | 'processPid'> = defaultHeadlessAgentDeps,
): Promise<boolean> {
    return killTmuxHeadlessAgent(terminalId, deps)
}

/**
 * Close a headless agent: kill session (if running) + remove from registry.
 * Handles both running and already-exited agents.
 * Async: awaits the underlying tmux kill so the session is gone from
 * `tmux ls` by the time the response is returned to the caller.
 */
export async function closeHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited' | 'removeTerminalFromRegistry' | 'getTerminalRecords' | 'processPid'> = defaultHeadlessAgentDeps,
): Promise<{closed: true; wasRunning: boolean} | {closed: false}> {
    const record: TerminalRecord | undefined = deps.getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (record?.terminalData.isHeadless && record.status === 'exited') {
        deps.removeTerminalFromRegistry(terminalId)
        removeTmuxHeadlessAgentState(terminalId)
        return {closed: true, wasRunning: false}
    }

    if (hasTmuxHeadlessRuntime(terminalId)) {
        await killTmuxHeadlessAgent(terminalId, deps)
        deps.removeTerminalFromRegistry(terminalId)
        removeTmuxHeadlessAgentState(terminalId)
        return {closed: true, wasRunning: true}
    }

    return {closed: false}
}

/**
 * Check if a terminal ID corresponds to a headless agent session.
 */
export function isHeadlessAgent(terminalId: TerminalId | string): boolean {
    return hasTmuxHeadlessRuntime(terminalId)
}

export function isTmuxHeadlessAgent(terminalId: TerminalId | string): boolean {
    return hasTmuxHeadlessRuntime(terminalId)
}

export async function sendHeadlessAgentInput(terminalId: string, text: string): Promise<{success: boolean; error?: string}> {
    if (!isTmuxHeadlessAgent(terminalId)) {
        return {success: false, error: `Headless agent "${terminalId}" is not tmux-backed`}
    }
    return sendTmuxHeadlessAgentInput(terminalId, text)
}

/**
 * Get captured stdout+stderr output for a headless agent.
 * Returns the ring buffer contents. Works for both running and exited agents.
 */
export function getHeadlessAgentOutput(terminalId: string): string {
    return getTmuxHeadlessAgentOutput(terminalId as TerminalId)
}

/**
 * Check if we have output captured for a terminal (running or exited).
 */
export function hasHeadlessAgentOutput(terminalId: string): boolean {
    return isTmuxHeadlessAgent(terminalId)
}

/**
 * Release all in-process headless-agent state.
 *
 * `preserve` is for host process shutdown where tmux sessions must outlive the
 * host and be reconciled on relaunch. `terminate` is for explicit destructive
 * cleanup such as closing an agent or switching vaults.
 */
export function cleanupHeadlessAgents(
    policy: HeadlessAgentCleanupPolicy = TERMINATE_TMUX_SESSIONS,
): void {
    if (policy.tmuxSessions === 'preserve') {
        detachTmuxHeadlessAgents()
        return
    }
    cleanupTmuxHeadlessAgents()
}

export async function cleanupHeadlessAgentsAndWait(
    policy: HeadlessAgentCleanupPolicy = TERMINATE_TMUX_SESSIONS,
): Promise<void> {
    if (policy.tmuxSessions === 'preserve') {
        detachTmuxHeadlessAgents()
        return
    }
    await cleanupTmuxHeadlessAgentsAndWait()
}
