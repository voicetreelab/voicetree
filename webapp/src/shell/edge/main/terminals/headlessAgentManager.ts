/**
 * Headless Agent Manager — background child_process agents with no PTY/xterm.js.
 *
 * Functional edge module: module-level Maps for state, exported functions.
 * Headless agents communicate via MCP tools (create_graph, search_nodes) over HTTP.
 * stdout + stderr are captured into a combined ring buffer (8KB) for diagnostics
 * and surfaced via read_terminal_output MCP tool and badge hover tooltip.
 */

import {spawn, type ChildProcess} from 'child_process'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import {markTerminalExited, recordTerminalSpawn} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// ─── State (functional edge pattern: module-level Maps) ──────────────────────

const headlessProcesses: Map<TerminalId, ChildProcess> = new Map()
/** Combined stdout+stderr ring buffer per agent. Persists after exit for hover tooltip / read_terminal_output. */
const lastOutputByTerminal: Map<TerminalId, string> = new Map()

const OUTPUT_RING_SIZE: number = 8000

// ─── Public API (3 functions) ────────────────────────────────────────────────

/**
 * Spawn a headless agent as a background child_process.
 * Registers in terminal-registry for status tracking, then spawns the process.
 *
 * @param terminalId  - Unique terminal identifier (same as agentName)
 * @param terminalData - Full terminal data (for registry tracking)
 * @param command     - Shell command to execute (e.g., `claude -p "$AGENT_PROMPT" ...`)
 * @param cwd         - Working directory for the process
 * @param env         - Environment variables (merged with process.env)
 */
export function spawnHeadlessAgent(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>
): void {
    const shell: string = process.platform === 'win32'
        ? 'powershell.exe'
        : (process.env.SHELL ?? '/bin/bash')

    const child: ChildProcess = spawn(shell, ['-c', command], {
        cwd: cwd ?? process.env.HOME ?? process.cwd(),
        env: {...process.env, ...env},
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    })

    headlessProcesses.set(terminalId, child)
    recordTerminalSpawn(terminalId, terminalData)

    // Capture stdout + stderr into a combined ring buffer
    const appendOutput: (d: Buffer) => void = (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, (prev + d.toString()).slice(-OUTPUT_RING_SIZE))
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    child.on('exit', (code: number | null) => {
        if (code !== 0 && code !== null) {
            const output: string = lastOutputByTerminal.get(terminalId) ?? ''
            console.error(`[headlessAgentManager] Agent ${terminalId} exited with code ${code}. Last output: ${output.slice(-500)}`)
        }
        markTerminalExited(terminalId)
        headlessProcesses.delete(terminalId)
        // Note: output buffer intentionally preserved after exit for hover tooltip / read_terminal_output
    })
}

/**
 * Kill a headless agent process (SIGTERM).
 * Returns true if the process existed and was signalled, false otherwise.
 */
export function killHeadlessAgent(terminalId: TerminalId): boolean {
    const child: ChildProcess | undefined = headlessProcesses.get(terminalId)
    if (!child) return false

    child.kill('SIGTERM')
    markTerminalExited(terminalId)
    headlessProcesses.delete(terminalId)
    // Note: output buffer intentionally preserved after kill for hover tooltip / read_terminal_output
    return true
}

/**
 * Check if a terminal ID corresponds to a headless agent process.
 */
export function isHeadlessAgent(terminalId: TerminalId | string): boolean {
    return headlessProcesses.has(terminalId as TerminalId)
}

/**
 * Get captured stdout+stderr output for a headless agent.
 * Returns the ring buffer contents (up to 8KB). Works for both running and exited agents.
 * Used by read_terminal_output MCP tool and badge hover tooltip.
 */
export function getHeadlessAgentOutput(terminalId: string): string {
    return lastOutputByTerminal.get(terminalId as TerminalId) ?? ''
}

/**
 * Check if we have output captured for a terminal (running or exited).
 */
export function hasHeadlessAgentOutput(terminalId: string): boolean {
    return lastOutputByTerminal.has(terminalId as TerminalId)
}

/**
 * Kill all headless agents. Called on app shutdown / folder switch.
 */
export function cleanupHeadlessAgents(): void {
    for (const [terminalId, child] of headlessProcesses) {
        try {
            child.kill('SIGTERM')
        } catch (e) {
            console.error(`[headlessAgentManager] Error killing headless agent ${terminalId}:`, e)
        }
    }
    headlessProcesses.clear()
    lastOutputByTerminal.clear()
}
