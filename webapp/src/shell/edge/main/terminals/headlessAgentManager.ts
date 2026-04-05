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
import {markTerminalExited, recordTerminalSpawn, getTerminalRecords, incrementAuditRetryCount, removeTerminalFromRegistry, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import {runStopHooks, type StopHookResult} from './stopGateHookRunner'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {detectCliType} from './spawnTerminalWithContextNode'

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

    const {CLAUDECODE: _cc, ...parentEnv} = process.env
    const child: ChildProcess = spawn(shell, ['-c', command], {
        cwd: cwd ?? process.env.HOME ?? process.cwd(),
        env: {...parentEnv, ...env},
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    })

    headlessProcesses.set(terminalId, child)
    recordTerminalSpawn(terminalId, terminalData)
    console.log(`[headlessAgentManager] Spawned agent ${terminalId} (pid=${child.pid}) cwd=${cwd ?? 'HOME'}`)

    // Capture stdout + stderr into a combined ring buffer
    const appendOutput: (d: Buffer) => void = (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, (prev + d.toString()).slice(-OUTPUT_RING_SIZE))
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code))
}

/**
 * Shared exit handler for both initial spawn and resumed agents.
 * Runs stop gate audit on successful exit and resumes with deficiency if needed.
 */
async function handleAgentExit(terminalId: TerminalId, code: number | null): Promise<void> {
    const output: string = lastOutputByTerminal.get(terminalId) ?? ''
    const hasOutput: boolean = output.trim().length > 0
    if (code !== 0 && code !== null) {
        console.error(`[headlessAgentManager] Agent ${terminalId} exited with code ${code}. Last output: ${output.slice(-500)}`)
    } else if (!hasOutput) {
        console.warn(`[headlessAgentManager] Agent ${terminalId} exited code=${code} with ZERO output — likely silent failure`)
    }

    // Detect missed handover: agent exited without spawning a successor
    const spawnedChildren: boolean = getTerminalRecords().some(
        r => r.terminalData.parentTerminalId === terminalId
    )
    if (hasOutput && !spawnedChildren && code === 0) {
        console.warn(`[headlessAgentManager] Agent ${terminalId} exited without spawning a successor — possible missed handover`)
    }

    markTerminalExited(terminalId, code)

    // Stop gate audit: derives SKILL.md from graph at audit time (BF-042)
    // Skip audit if agent has active (non-exited) child agents — they're still doing work.
    // The parent's obligations may depend on children completing first.
    if (code === 0 || code === null) {
        const graph: import('@vt/graph-model/pure/graph').Graph = getGraph()
        const records: readonly TerminalRecord[] = getTerminalRecords()
        const hasActiveChildren: boolean = records.some(
            (r: TerminalRecord) => r.terminalData.parentTerminalId === terminalId && r.status !== 'exited'
        )
        if (!hasActiveChildren) {
            const hookResult: StopHookResult = await runStopHooks(terminalId, graph, records)
            const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
            if (!hookResult.passed && record && record.auditRetryCount < 2) {
                resumeWithDeficiency(terminalId, record, hookResult.message ?? 'Stop gate hooks failed')
                return // Don't delete process entry — resume will re-add
            }
            if (!hookResult.passed) {
                console.warn(`[headlessAgentManager] Agent ${terminalId} FAILED audit after 2 retries`)
            }
        }
    }

    headlessProcesses.delete(terminalId)

    // Note: output buffer intentionally preserved after exit for hover tooltip / read_terminal_output
    // Registry record intentionally preserved after exit so wait_for_agents monitor
    // can still find and report on this agent. Cleanup happens via close_agent.
}

/**
 * Build CLI-specific resume command. Derives cliType and sessionId at resume time
 * from agent command string + spawn conventions (BF-042: no stored derived data).
 */
export function buildResumeCommand(cliType: 'claude' | 'codex' | 'gemini'): string {
    switch (cliType) {
        case 'claude':
            return `claude --continue -p "$RESUME_PROMPT" --dangerously-skip-permissions`
        case 'codex':
            return `codex exec resume --last -p "$RESUME_PROMPT" --full-auto`
        case 'gemini':
            return `gemini --resume latest -p "$RESUME_PROMPT" --yolo`
    }
}

/**
 * Resume an agent with a deficiency prompt after failed stop gate audit.
 * Derives cliType from initialCommand and sessionId from spawn convention (BF-042).
 */
function resumeWithDeficiency(terminalId: TerminalId, record: TerminalRecord, deficiency: string): void {
    const baseCommand: string = (record.terminalData.initialCommand ?? '').replace('"$AGENT_PROMPT"', '').replace("'$AGENT_PROMPT'", '').trim()
    const cliType: 'claude' | 'codex' | 'gemini' | null = detectCliType(baseCommand)
    if (!cliType) {
        console.warn(`[headlessAgentManager] Cannot resume agent ${terminalId}: unknown CLI type from command "${baseCommand}"`)
        return
    }
    const resumeCommand: string = buildResumeCommand(cliType)

    incrementAuditRetryCount(terminalId)

    console.log(`[headlessAgentManager] Resuming agent ${terminalId} (${cliType}, retry ${record.auditRetryCount + 1}/2) with deficiency prompt`)

    const shell: string = process.platform === 'win32'
        ? 'powershell.exe'
        : (process.env.SHELL ?? '/bin/bash')

    const {CLAUDECODE: _cc2, ...parentEnvResume} = process.env
    const child: ChildProcess = spawn(shell, ['-c', resumeCommand], {
        cwd: record.terminalData.initialSpawnDirectory ?? process.env.HOME ?? process.cwd(),
        env: { ...parentEnvResume, ...(record.terminalData.initialEnvVars ?? {}), RESUME_PROMPT: deficiency },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    })

    headlessProcesses.set(terminalId, child)

    // Wire up output capture (same ring buffer)
    const appendOutput: (d: Buffer) => void = (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, (prev + d.toString()).slice(-OUTPUT_RING_SIZE))
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    // Re-use shared exit handler (natural recursion — same audit fires again)
    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code))
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
 * Close a headless agent: kill process (if running) + remove from registry.
 * Handles both running and already-exited agents.
 * Shared path used by both UI close and MCP close_agent tool.
 */
export function closeHeadlessAgent(terminalId: TerminalId): {closed: true; wasRunning: boolean} | {closed: false} {
    // Case 1: Running headless agent — kill process + remove from registry
    if (headlessProcesses.has(terminalId)) {
        killHeadlessAgent(terminalId)
        removeTerminalFromRegistry(terminalId)
        return {closed: true, wasRunning: true}
    }

    // Case 2: Already-exited headless agent — just remove stale registry entry
    const record: TerminalRecord | undefined = getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )
    if (record?.terminalData.isHeadless && record.status === 'exited') {
        removeTerminalFromRegistry(terminalId)
        return {closed: true, wasRunning: false}
    }

    return {closed: false}
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
