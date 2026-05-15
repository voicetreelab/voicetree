/**
 * Headless Agent Manager — background child_process agents with no PTY/xterm.js.
 *
 * Functional edge module: module-level Maps for state, exported functions.
 * Headless agents communicate via MCP tools (create_graph, search_nodes) over HTTP.
 * stdout + stderr are captured into a combined ring buffer (8KB) for diagnostics
 * and surfaced via read_terminal_output MCP tool and badge hover tooltip.
 */

import {spawn, type ChildProcess} from 'child_process'
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {TerminalId} from '../terminals/terminal-registry/types'
import {
    markTerminalExited,
    recordTerminalSpawn,
    getTerminalRecords,
    incrementAuditRetryCount,
    reconcileTmuxTerminalRegistry,
    removeTerminalFromRegistry,
    type TerminalRecord,
    type TmuxReconciliationResult,
} from '../terminals/terminal-registry'
import type {TerminalData} from '../terminals/terminal-registry/types'
import {runStopHooks} from '../hooks/stopGateHookRunner'
import {getRuntimeGraph} from '../runtime/graph-bridge'
import {detectCliType} from '../spawn/headlessCli'
import {captureOutput, getOutput} from '../terminals/terminal-output-buffer'
import {createSession, hasSession, killSession, pipePaneToFile, sendKeys} from '../terminals/tmux-session-manager'
import {shellQuote} from '../util/shellQuote.ts'
import {
    buildResumeCommand,
    handleAgentExit,
    type HeadlessLifecycleState,
} from './headlessAgentLifecycle'

// ─── State (functional edge pattern: module-level Maps) ──────────────────────

const headlessProcesses: Map<TerminalId, ChildProcess> = new Map()
const tmuxHeadlessSessions: Map<TerminalId, TmuxHeadlessSession> = new Map()
const tmuxLogReadOffsets: Map<TerminalId, number> = new Map()
/** Combined stdout+stderr ring buffer per agent. Persists after exit for hover tooltip / read_terminal_output. */
const lastOutputByTerminal: Map<TerminalId, string> = new Map()
const OUTPUT_RING_SIZE: number = 8000
const TMUX_EXIT_POLL_MS: number = 1000

type PtyBackend = 'node-pty' | 'tmux'

type TmuxHeadlessSession = {
    readonly logPath: string
    readonly metadataPath: string
    readonly pollTimer: ReturnType<typeof setInterval> | null
}

type TmuxTerminalMetadata = {
    readonly name: string
    readonly status: 'running' | 'exited'
    readonly pid: number
    readonly session: string
    readonly startedAt: string
    readonly endedAt?: string
    readonly exitCode?: number | null
    readonly logFile: string
    readonly terminalData: TerminalData
}

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
    readonly getGraph: typeof getRuntimeGraph
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
    getGraph: getRuntimeGraph,
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

function resolveTmuxPaths(terminalId: TerminalId, env: Record<string, string>): {readonly logPath: string; readonly metadataPath: string} {
    const vaultPath: string | undefined = env.VOICETREE_VAULT_PATH
    if (!vaultPath) {
        throw new Error(`Cannot spawn tmux-backed headless agent ${terminalId}: VOICETREE_VAULT_PATH is missing`)
    }
    const terminalDir: string = join(vaultPath, '.voicetree', 'terminals')
    mkdirSync(terminalDir, {recursive: true})
    return {
        logPath: join(terminalDir, `${terminalId}.log`),
        metadataPath: join(terminalDir, `${terminalId}.json`),
    }
}

function writeTmuxMetadata(path: string, metadata: TmuxTerminalMetadata): void {
    writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

function readTmuxMetadata(path: string): TmuxTerminalMetadata | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as TmuxTerminalMetadata
    } catch {
        return null
    }
}

function buildTmuxCommand(command: string, cwd: string | undefined): string {
    return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command
}

function clearTmuxPoll(terminalId: TerminalId): void {
    const session: TmuxHeadlessSession | undefined = tmuxHeadlessSessions.get(terminalId)
    if (session?.pollTimer) {
        clearInterval(session.pollTimer)
        tmuxHeadlessSessions.set(terminalId, {...session, pollTimer: null})
    }
}

function markTmuxMetadataExited(terminalId: TerminalId, exitCode: number | null = null): void {
    const session: TmuxHeadlessSession | undefined = tmuxHeadlessSessions.get(terminalId)
    if (!session) return
    const existing: TmuxTerminalMetadata | null = readTmuxMetadata(session.metadataPath)
    if (!existing || existing.status === 'exited') return
    writeTmuxMetadata(session.metadataPath, {
        ...existing,
        status: 'exited',
        exitCode,
        endedAt: new Date().toISOString(),
    })
}

function startTmuxExitPoll(terminalId: TerminalId, deps: HeadlessAgentDeps): ReturnType<typeof setInterval> {
    return setInterval(() => {
        void (async (): Promise<void> => {
            try {
                if (await hasSession(terminalId)) return
                clearTmuxPoll(terminalId)
                markTmuxMetadataExited(terminalId, null)
                deps.markTerminalExited(terminalId, null)
            } catch (error) {
                deps.writeLog({level: 'error', message: `[headlessAgentManager] tmux exit poll failed for ${terminalId}:`, error})
            }
        })()
    }, TMUX_EXIT_POLL_MS)
}

// Creates a tmux session running `command`, sets up log capture, persists
// metadata, registers in terminal-registry, and starts the exit poll. Used
// by both the headless spawn path (Phase 2: command = agent CLI) and the
// Electron interactive IPC path (Phase 4 fix: command = user shell). The
// caller decides what `command` is; this function is shape-agnostic.
export async function spawnTmuxBackedTerminal(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): Promise<{readonly pid: number}> {
    const paths: {readonly logPath: string; readonly metadataPath: string} = resolveTmuxPaths(terminalId, env)
    const startedAt: string = new Date().toISOString()
    const created: {readonly pid: number} = await createSession(
        terminalId,
        buildTmuxCommand(command, resolveSpawnCwd(cwd, deps.getHomeDir(), deps.getCurrentDirectory())),
        env,
    )

    await pipePaneToFile(terminalId, paths.logPath)
    writeTmuxMetadata(paths.metadataPath, {
        name: terminalId,
        status: 'running',
        pid: created.pid,
        session: terminalId,
        startedAt,
        logFile: paths.logPath,
        terminalData,
    })

    const pollTimer: ReturnType<typeof setInterval> = startTmuxExitPoll(terminalId, deps)
    tmuxHeadlessSessions.set(terminalId, {...paths, pollTimer})
    deps.recordTerminalSpawn(terminalId, terminalData)
    deps.writeLog({level: 'info', message: `[headlessAgentManager] Spawned tmux-backed terminal ${terminalId} (pid=${created.pid}) cwd=${cwd ?? 'HOME'} headless=${terminalData.isHeadless}`})
    return created
}

function readTmuxHeadlessOutput(terminalId: TerminalId): string {
    const session: TmuxHeadlessSession | undefined = tmuxHeadlessSessions.get(terminalId)
    if (!session || !existsSync(session.logPath)) return getOutput(terminalId) ?? ''

    const fileSize: number = statSync(session.logPath).size
    const previousOffset: number = tmuxLogReadOffsets.get(terminalId) ?? 0
    const offset: number = previousOffset > fileSize ? 0 : previousOffset
    const raw: string = readFileSync(session.logPath, 'utf8')
    const unread: string = raw.slice(offset)
    if (unread.length > 0) {
        captureOutput(terminalId, unread)
        tmuxLogReadOffsets.set(terminalId, raw.length)
    }
    return getOutput(terminalId) ?? ''
}

const headlessLifecycleState: HeadlessLifecycleState = {
    headlessProcesses,
    lastOutputByTerminal,
    outputRingSize: OUTPUT_RING_SIZE,
    appendRingBuffer,
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
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
    ptyBackend: PtyBackend = 'node-pty',
): void {
    if (ptyBackend === 'tmux') {
        void spawnTmuxBackedTerminal(terminalId, terminalData, command, cwd, env, deps).catch((error: unknown) => {
            deps.writeLog({level: 'error', message: `[headlessAgentManager] Failed to spawn tmux-backed headless agent ${terminalId}:`, error})
            deps.markTerminalExited(terminalId, null)
        })
        return
    }

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

    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code, deps, headlessLifecycleState))

    // Note: output buffer intentionally preserved after exit for hover tooltip / read_terminal_output
    // Registry record intentionally preserved after exit so wait_for_agents monitor
    // can still find and report on this agent. Cleanup happens via close_agent.
}

export {buildResumeCommand}

/**
 * Kill a headless agent process (SIGTERM).
 * Returns true if the process existed and was signalled, false otherwise.
 */
export function killHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited'> = defaultHeadlessAgentDeps
): boolean {
    if (tmuxHeadlessSessions.has(terminalId)) {
        clearTmuxPoll(terminalId)
        void killSession(terminalId).catch(() => undefined)
        markTmuxMetadataExited(terminalId, null)
        deps.markTerminalExited(terminalId, null)
        return true
    }

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
    const record: TerminalRecord | undefined = deps.getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    // Case 1: Running headless agent — kill process + remove from registry
    if (headlessProcesses.has(terminalId)) {
        killHeadlessAgent(terminalId, deps)
        deps.removeTerminalFromRegistry(terminalId)
        return {closed: true, wasRunning: true}
    }

    if (record?.terminalData.isHeadless && record.status === 'exited') {
        deps.removeTerminalFromRegistry(terminalId)
        tmuxHeadlessSessions.delete(terminalId as TerminalId)
        tmuxLogReadOffsets.delete(terminalId as TerminalId)
        return {closed: true, wasRunning: false}
    }

    if (tmuxHeadlessSessions.has(terminalId)) {
        killHeadlessAgent(terminalId, deps)
        deps.removeTerminalFromRegistry(terminalId)
        tmuxHeadlessSessions.delete(terminalId)
        tmuxLogReadOffsets.delete(terminalId)
        return {closed: true, wasRunning: true}
    }

    return {closed: false}
}

/**
 * Check if a terminal ID corresponds to a headless agent process.
 */
export function isHeadlessAgent(terminalId: TerminalId | string): boolean {
    return headlessProcesses.has(terminalId as TerminalId) || tmuxHeadlessSessions.has(terminalId as TerminalId)
}

export function isTmuxHeadlessAgent(terminalId: TerminalId | string): boolean {
    return tmuxHeadlessSessions.has(terminalId as TerminalId)
}

export async function sendHeadlessAgentInput(terminalId: string, text: string): Promise<{success: boolean; error?: string}> {
    if (!isTmuxHeadlessAgent(terminalId)) {
        return {success: false, error: `Headless agent "${terminalId}" is not tmux-backed`}
    }
    try {
        await sendKeys(terminalId, text)
        return {success: true}
    } catch (error) {
        return {success: false, error: error instanceof Error ? error.message : String(error)}
    }
}

/**
 * Get captured stdout+stderr output for a headless agent.
 * Returns the ring buffer contents (up to 8KB). Works for both running and exited agents.
 * Used by read_terminal_output MCP tool and badge hover tooltip.
 */
export function getHeadlessAgentOutput(terminalId: string): string {
    if (isTmuxHeadlessAgent(terminalId)) {
        return readTmuxHeadlessOutput(terminalId as TerminalId)
    }
    return lastOutputByTerminal.get(terminalId as TerminalId) ?? ''
}

/**
 * Check if we have output captured for a terminal (running or exited).
 */
export function hasHeadlessAgentOutput(terminalId: string): boolean {
    return lastOutputByTerminal.has(terminalId as TerminalId) || tmuxHeadlessSessions.has(terminalId as TerminalId)
}

export async function reconcileTmuxHeadlessAgents(
    vaultPath: string,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): Promise<TmuxReconciliationResult> {
    return reconcileTmuxTerminalRegistry(vaultPath, {
        hasSession,
        logger: {
            info: (message?: unknown, ...optionalParams: unknown[]): void =>
                deps.writeLog({level: 'info', message: String(message), error: optionalParams.length > 0 ? optionalParams : undefined}),
            error: (message?: unknown, ...optionalParams: unknown[]): void =>
                deps.writeLog({level: 'error', message: String(message), error: optionalParams.length > 0 ? optionalParams : undefined}),
        },
        onRunningSession: ({terminalId, metadataPath, metadata}) => {
            if (tmuxHeadlessSessions.has(terminalId)) return
            tmuxHeadlessSessions.set(terminalId, {
                logPath: metadata.logFile ?? join(vaultPath, '.voicetree', 'terminals', `${terminalId}.log`),
                metadataPath,
                pollTimer: startTmuxExitPoll(terminalId, deps),
            })
        },
    })
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
    for (const terminalId of tmuxHeadlessSessions.keys()) {
        clearTmuxPoll(terminalId)
        void killSession(terminalId).catch(() => undefined)
    }
    headlessProcesses.clear()
    tmuxHeadlessSessions.clear()
    tmuxLogReadOffsets.clear()
    lastOutputByTerminal.clear()
}
