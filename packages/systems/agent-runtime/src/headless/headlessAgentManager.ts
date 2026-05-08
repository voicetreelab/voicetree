/**
 * Headless Agent Manager — background child_process agents with no PTY/xterm.js.
 *
 * Functional edge module: module-level Maps for state, exported functions.
 * Headless agents communicate via MCP tools (create_graph, search_nodes) over HTTP.
 * stdout + stderr are captured into a combined ring buffer (8KB) for diagnostics
 * and surfaced via read_terminal_output MCP tool and badge hover tooltip.
 */

import {spawn, type ChildProcess} from 'child_process'
import type {TerminalId} from '../types'
import {markTerminalExited, recordTerminalSpawn, getTerminalRecords, incrementAuditRetryCount, removeTerminalFromRegistry, type TerminalRecord} from '../terminals/terminal-registry'
import type {TerminalData} from '../types'
import {runStopHooks, type StopHookResult} from '../hooks/stopGateHookRunner'
import {detectCliType} from '../spawn/spawnTerminalWithContextNode'
import {graphDbState} from '../graph-db-boundary'

// ─── State (functional edge pattern: module-level Maps) ──────────────────────

const headlessProcesses: Map<TerminalId, ChildProcess> = new Map()
/** Combined stdout+stderr ring buffer per agent. Persists after exit for hover tooltip / read_terminal_output. */
const lastOutputByTerminal: Map<TerminalId, string> = new Map()
const OUTPUT_RING_SIZE: number = 8000

export type HeadlessLogEntry = {
    readonly level: 'info' | 'warn' | 'error'
    readonly message: string
    readonly error?: unknown
}

export type HeadlessAgentDeps = {
    readonly getPlatform: () => NodeJS.Platform
    readonly getShellEnv: () => string | undefined
    readonly getHomeDir: () => string | undefined
    readonly getCurrentDirectory: () => string
    readonly getProcessEnv: () => NodeJS.ProcessEnv
    readonly spawnProcess: typeof spawn
    readonly writeLog: (entry: HeadlessLogEntry) => void
    readonly recordTerminalSpawn: typeof recordTerminalSpawn
    readonly markTerminalExited: typeof markTerminalExited
    readonly getTerminalRecords: typeof getTerminalRecords
    readonly incrementAuditRetryCount: typeof incrementAuditRetryCount
    readonly removeTerminalFromRegistry: typeof removeTerminalFromRegistry
    readonly runStopHooks: typeof runStopHooks
    readonly getGraph: typeof graphDbState.getGraph
    readonly detectCliType: typeof detectCliType
}

function writeHeadlessLog(entry: HeadlessLogEntry): void {
    if (entry.level === 'error') {
        entry.error === undefined ? console.error(entry.message) : console.error(entry.message, entry.error)
    } else if (entry.level === 'warn') {
        console.warn(entry.message)
    } else {
        console.log(entry.message)
    }
}

const defaultHeadlessAgentDeps: HeadlessAgentDeps = {
    getPlatform: (): NodeJS.Platform => process.platform,
    getShellEnv: (): string | undefined => process.env.SHELL,
    getHomeDir: (): string | undefined => process.env.HOME,
    getCurrentDirectory: (): string => process.cwd(),
    getProcessEnv: (): NodeJS.ProcessEnv => process.env,
    spawnProcess: spawn,
    writeLog: writeHeadlessLog,
    recordTerminalSpawn,
    markTerminalExited,
    getTerminalRecords,
    incrementAuditRetryCount,
    removeTerminalFromRegistry,
    runStopHooks,
    getGraph: graphDbState.getGraph,
    detectCliType
}

function resolveHeadlessShell(platform: NodeJS.Platform, shellEnv: string | undefined): string {
    return platform === 'win32' ? 'powershell.exe' : (shellEnv ?? '/bin/bash')
}

function envWithoutClaudeCode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const {CLAUDECODE: _cc, ...parentEnv} = env
    return parentEnv
}

function resolveSpawnCwd(cwd: string | undefined, homeDir: string | undefined, currentDirectory: string): string {
    return cwd ?? homeDir ?? currentDirectory
}

function appendRingBuffer(previous: string, chunk: Buffer, size: number): string {
    return (previous + chunk.toString()).slice(-size)
}

function hasActiveChildren(terminalId: TerminalId, records: readonly TerminalRecord[]): boolean {
    return records.some(
        (r: TerminalRecord) => r.terminalData.parentTerminalId === terminalId && r.status !== 'exited'
    )
}

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
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps
): void {
    const shell: string = resolveHeadlessShell(deps.getPlatform(), deps.getShellEnv())
    const parentEnv: NodeJS.ProcessEnv = envWithoutClaudeCode(deps.getProcessEnv())

    const child: ChildProcess = deps.spawnProcess(shell, ['-c', command], {
        cwd: resolveSpawnCwd(cwd, deps.getHomeDir(), deps.getCurrentDirectory()),
        env: {...parentEnv, ...env},
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    })

    headlessProcesses.set(terminalId, child)
    deps.recordTerminalSpawn(terminalId, terminalData)
    deps.writeLog({ level: 'info', message: `[headlessAgentManager] Spawned agent ${terminalId} (pid=${child.pid}) cwd=${cwd ?? 'HOME'}` })

    // Capture stdout + stderr into a combined ring buffer
    const appendOutput: (d: Buffer) => void = (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, appendRingBuffer(prev, d, OUTPUT_RING_SIZE))
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code, deps))
}

/**
 * Shared exit handler for both initial spawn and resumed agents.
 * Runs stop gate audit on successful exit and resumes with deficiency if needed.
 */
async function handleAgentExit(
    terminalId: TerminalId,
    code: number | null,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps
): Promise<void> {
    const output: string = lastOutputByTerminal.get(terminalId) ?? ''
    const hasOutput: boolean = output.trim().length > 0
    if (code !== 0 && code !== null) {
        deps.writeLog({ level: 'error', message: `[headlessAgentManager] Agent ${terminalId} exited with code ${code}. Last output: ${output.slice(-500)}` })
    } else if (!hasOutput) {
        deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} exited code=${code} with ZERO output — likely silent failure` })
    }

    // Detect missed handover: agent exited without spawning a successor
    const spawnedChildren: boolean = deps.getTerminalRecords().some(
        r => r.terminalData.parentTerminalId === terminalId
    )
    if (hasOutput && !spawnedChildren && code === 0) {
        deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} exited without spawning a successor — possible missed handover` })
    }

    deps.markTerminalExited(terminalId, code)

    // Stop gate audit: derives SKILL.md from graph at audit time (BF-042)
    // Skip audit if agent has active (non-exited) child agents — they're still doing work.
    // The parent's obligations may depend on children completing first.
    if (code === 0 || code === null) {
        const graph: import('@vt/graph-model/graph').Graph = deps.getGraph()
        const records: readonly TerminalRecord[] = deps.getTerminalRecords()
        if (!hasActiveChildren(terminalId, records)) {
            const hookResult: StopHookResult = await deps.runStopHooks(terminalId, graph, records)
            const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
            if (!hookResult.passed && record && record.auditRetryCount < 2) {
                resumeWithDeficiency(terminalId, record, hookResult.message ?? 'Stop gate hooks failed', deps)
                return // Don't delete process entry — resume will re-add
            }
            if (!hookResult.passed) {
                deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} FAILED audit after 2 retries` })
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
function resumeWithDeficiency(
    terminalId: TerminalId,
    record: TerminalRecord,
    deficiency: string,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps
): void {
    const baseCommand: string = (record.terminalData.initialCommand ?? '').replace('"$AGENT_PROMPT"', '').replace("'$AGENT_PROMPT'", '').trim()
    const cliType: 'claude' | 'codex' | 'gemini' | null = deps.detectCliType(baseCommand)
    if (!cliType) {
        deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Cannot resume agent ${terminalId}: unknown CLI type from command "${baseCommand}"` })
        return
    }
    const resumeCommand: string = buildResumeCommand(cliType)

    deps.incrementAuditRetryCount(terminalId)

    deps.writeLog({ level: 'info', message: `[headlessAgentManager] Resuming agent ${terminalId} (${cliType}, retry ${record.auditRetryCount + 1}/2) with deficiency prompt` })

    const shell: string = resolveHeadlessShell(deps.getPlatform(), deps.getShellEnv())
    const parentEnvResume: NodeJS.ProcessEnv = envWithoutClaudeCode(deps.getProcessEnv())

    const child: ChildProcess = deps.spawnProcess(shell, ['-c', resumeCommand], {
        cwd: resolveSpawnCwd(record.terminalData.initialSpawnDirectory, deps.getHomeDir(), deps.getCurrentDirectory()),
        env: { ...parentEnvResume, ...(record.terminalData.initialEnvVars ?? {}), RESUME_PROMPT: deficiency },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    })

    headlessProcesses.set(terminalId, child)

    // Wire up output capture (same ring buffer)
    const appendOutput: (d: Buffer) => void = (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, appendRingBuffer(prev, d, OUTPUT_RING_SIZE))
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    // Re-use shared exit handler (natural recursion — same audit fires again)
    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code, deps))
}

/**
 * Kill a headless agent process (SIGTERM).
 * Returns true if the process existed and was signalled, false otherwise.
 */
export function killHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited'> = defaultHeadlessAgentDeps
): boolean {
    const child: ChildProcess | undefined = headlessProcesses.get(terminalId)
    if (!child) return false

    child.kill('SIGTERM')
    deps.markTerminalExited(terminalId)
    headlessProcesses.delete(terminalId)
    // Note: output buffer intentionally preserved after kill for hover tooltip / read_terminal_output
    return true
}

/**
 * Close a headless agent: kill process (if running) + remove from registry.
 * Handles both running and already-exited agents.
 * Shared path used by both UI close and MCP close_agent tool.
 */
export function closeHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited' | 'removeTerminalFromRegistry' | 'getTerminalRecords'> = defaultHeadlessAgentDeps
): {closed: true; wasRunning: boolean} | {closed: false} {
    // Case 1: Running headless agent — kill process + remove from registry
    if (headlessProcesses.has(terminalId)) {
        killHeadlessAgent(terminalId, deps)
        deps.removeTerminalFromRegistry(terminalId)
        return {closed: true, wasRunning: true}
    }

    // Case 2: Already-exited headless agent — just remove stale registry entry
    const record: TerminalRecord | undefined = deps.getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )
    if (record?.terminalData.isHeadless && record.status === 'exited') {
        deps.removeTerminalFromRegistry(terminalId)
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
export function cleanupHeadlessAgents(
    deps: Pick<HeadlessAgentDeps, 'writeLog'> = defaultHeadlessAgentDeps
): void {
    for (const [terminalId, child] of headlessProcesses) {
        try {
            child.kill('SIGTERM')
        } catch (e) {
            deps.writeLog({ level: 'error', message: `[headlessAgentManager] Error killing headless agent ${terminalId}:`, error: e })
        }
    }
    headlessProcesses.clear()
    lastOutputByTerminal.clear()
}
