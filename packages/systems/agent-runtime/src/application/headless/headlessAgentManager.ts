/**
 * Headless Agent Manager — public facade for background child_process agents
 * and tmux-backed terminals.
 *
 * Functional edge module: exported functions coordinate cohesive runtime
 * modules; impure process, tmux, and registry details stay at the shell.
 */

import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {TerminalRecord} from '../terminals/terminal-registry'
import {
    cleanupNodeBackedHeadlessAgents,
    getNodeBackedHeadlessAgentOutput,
    hasNodeBackedHeadlessAgentOutput,
    isNodeBackedHeadlessAgent,
    killNodeBackedHeadlessAgent,
    spawnNodeBackedHeadlessAgent,
} from './nodeHeadlessRuntime'
import {
    cleanupTmuxHeadlessAgents,
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

type PtyBackend = 'node-pty' | 'tmux'

export type {HeadlessAgentDeps, HeadlessLogEntry} from './headlessAgentDeps'
export {buildResumeCommand} from './headlessAgentLifecycle'
export {reconcileTmuxHeadlessAgents, spawnTmuxBackedTerminal}

/**
 * Spawn a headless agent as a background process.
 * Registers in terminal-registry for status tracking, then spawns the process.
 */
export function spawnHeadlessAgent(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
    ptyBackend: PtyBackend = 'node-pty',
): void {
    if (ptyBackend === 'tmux') {
        spawnTmuxHeadlessAgent(terminalId, terminalData, command, cwd, env, deps)
        return
    }

    spawnNodeBackedHeadlessAgent(terminalId, terminalData, command, cwd, env, deps)
}

/**
 * Kill a headless agent process (SIGTERM).
 * Returns true if the process existed and was signalled, false otherwise.
 */
export function killHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited'> = defaultHeadlessAgentDeps,
): boolean {
    if (killTmuxHeadlessAgent(terminalId, deps)) return true
    return killNodeBackedHeadlessAgent(terminalId, deps)
}

/**
 * Close a headless agent: kill process (if running) + remove from registry.
 * Handles both running and already-exited agents.
 */
export function closeHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited' | 'removeTerminalFromRegistry' | 'getTerminalRecords'> = defaultHeadlessAgentDeps,
): {closed: true; wasRunning: boolean} | {closed: false} {
    const record: TerminalRecord | undefined = deps.getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (isNodeBackedHeadlessAgent(terminalId)) {
        killNodeBackedHeadlessAgent(terminalId, deps)
        deps.removeTerminalFromRegistry(terminalId)
        return {closed: true, wasRunning: true}
    }

    if (record?.terminalData.isHeadless && record.status === 'exited') {
        deps.removeTerminalFromRegistry(terminalId)
        removeTmuxHeadlessAgentState(terminalId)
        return {closed: true, wasRunning: false}
    }

    if (hasTmuxHeadlessRuntime(terminalId)) {
        killTmuxHeadlessAgent(terminalId, deps)
        deps.removeTerminalFromRegistry(terminalId)
        removeTmuxHeadlessAgentState(terminalId)
        return {closed: true, wasRunning: true}
    }

    return {closed: false}
}

/**
 * Check if a terminal ID corresponds to a headless agent process.
 */
export function isHeadlessAgent(terminalId: TerminalId | string): boolean {
    return isNodeBackedHeadlessAgent(terminalId) || hasTmuxHeadlessRuntime(terminalId)
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
    if (isTmuxHeadlessAgent(terminalId)) {
        return getTmuxHeadlessAgentOutput(terminalId as TerminalId)
    }
    return getNodeBackedHeadlessAgentOutput(terminalId)
}

/**
 * Check if we have output captured for a terminal (running or exited).
 */
export function hasHeadlessAgentOutput(terminalId: string): boolean {
    return hasNodeBackedHeadlessAgentOutput(terminalId) || isTmuxHeadlessAgent(terminalId)
}

/**
 * Kill all headless agents. Called on app shutdown / folder switch.
 */
export function cleanupHeadlessAgents(
    deps: Pick<HeadlessAgentDeps, 'writeLog'> = defaultHeadlessAgentDeps,
): void {
    cleanupNodeBackedHeadlessAgents(deps)
    cleanupTmuxHeadlessAgents()
}
