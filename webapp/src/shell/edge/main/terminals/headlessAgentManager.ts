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
import {markTerminalExited, recordTerminalSpawn, getTerminalRecords, updateStopGateFields, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import {runStopGateAudit, buildDeficiencyPrompt, type AuditResult} from './stopGateAudit'

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
    console.log(`[headlessAgentManager] Spawned agent ${terminalId} (pid=${child.pid}) cwd=${cwd ?? 'HOME'}`)

    // Capture stdout + stderr into a combined ring buffer
    const appendOutput: (d: Buffer) => void = (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, (prev + d.toString()).slice(-OUTPUT_RING_SIZE))
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    child.on('exit', (code: number | null) => handleAgentExit(terminalId, code))
}

/**
 * Shared exit handler for both initial spawn and resumed agents.
 * Runs stop gate audit on successful exit and resumes with deficiency if needed.
 */
function handleAgentExit(terminalId: TerminalId, code: number | null): void {
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

    // Stop gate audit: check SKILL.md outgoing edges on successful exit
    if (code === 0 || code === null) {
        const record: TerminalRecord | undefined = getTerminalRecords().find(r => r.terminalId === terminalId)
        if (record && shouldRunAudit(record)) {
            const auditResult: AuditResult = runStopGateAudit(terminalId, record.skillPath!)
            if (!auditResult.passed && record.auditRetryCount < 3) {
                resumeWithDeficiency(terminalId, record, auditResult)
                return // Don't delete process entry — resume will re-add
            }
            if (!auditResult.passed) {
                console.warn(`[headlessAgentManager] Agent ${terminalId} FAILED audit after 3 retries`)
            }
        }
    }

    headlessProcesses.delete(terminalId)
    // Note: output buffer intentionally preserved after exit for hover tooltip / read_terminal_output
    // Registry record intentionally preserved after exit so wait_for_agents monitor
    // can still find and report on this agent. Cleanup happens via close_agent.
}

/**
 * Build the CLI-specific resume command for a failed stop gate audit.
 * Claude: --resume with pre-assigned session ID
 * Codex: exec resume --last (most recent session)
 * Gemini: --resume latest
 */
/**
 * Determine whether the stop gate audit should run for a given terminal record.
 * Claude requires a pre-assigned sessionId; Codex/Gemini can always resume (--last / latest).
 * Returns false if no skillPath, no cliType, or Claude without sessionId.
 */
export function shouldRunAudit(record: Pick<TerminalRecord, 'skillPath' | 'cliType' | 'sessionId'>): boolean {
    if (!record.skillPath || !record.cliType) return false
    if (record.cliType === 'claude') return !!record.sessionId
    return true
}

export function buildResumeCommand(record: TerminalRecord, deficiency: string): string {
    const escapedDeficiency: string = deficiency.replace(/"/g, '\\"')
    switch (record.cliType) {
        case 'claude':
            return `claude --resume "${record.sessionId}" -p "${escapedDeficiency}" --dangerously-skip-permissions`
        case 'codex':
            return `codex exec resume --last "${escapedDeficiency}" --full-auto`
        case 'gemini':
            return `gemini --resume latest -p "${escapedDeficiency}" --yolo`
        default:
            throw new Error(`[headlessAgentManager] Cannot resume: unsupported CLI type "${record.cliType}"`)
    }
}

/**
 * Resume an agent with a deficiency prompt after failed stop gate audit.
 * Supports Claude (--resume sessionId), Codex (exec resume --last), and Gemini (--resume latest).
 */
function resumeWithDeficiency(terminalId: TerminalId, record: TerminalRecord, auditResult: AuditResult): void {
    const deficiency: string = buildDeficiencyPrompt(auditResult)
    const resumeCommand: string = buildResumeCommand(record, deficiency)

    updateStopGateFields(terminalId, { auditRetryCount: record.auditRetryCount + 1 })

    console.log(`[headlessAgentManager] Resuming agent ${terminalId} (${record.cliType}, retry ${record.auditRetryCount + 1}/3) with deficiency prompt`)

    const shell: string = process.platform === 'win32'
        ? 'powershell.exe'
        : (process.env.SHELL ?? '/bin/bash')

    const child: ChildProcess = spawn(shell, ['-c', resumeCommand], {
        cwd: record.terminalData.initialSpawnDirectory ?? process.env.HOME ?? process.cwd(),
        env: { ...process.env, ...(record.terminalData.initialEnvVars ?? {}) },
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
    child.on('exit', (code: number | null) => handleAgentExit(terminalId, code))
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
