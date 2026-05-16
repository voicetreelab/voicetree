import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {TmuxReconciliationResult} from '../terminals/terminal-registry'
import {
    captureOutput,
    getOutput,
} from '../terminals/terminal-output-buffer'
import {
    createSession,
    getPanePid,
    hasSession,
    killSession,
    pipePaneToFile,
    sendKeys,
} from '../terminals/tmux-session-manager'
import {reconcileTmuxTerminalRegistry} from '../terminals/terminal-registry'
import {shellQuote} from '../util/shellQuote.ts'
import {applyPromptFileToHeadlessSpawn, deletePromptFile, deletePromptFileByPath} from './tmuxPromptFile'
import {
    defaultHeadlessAgentDeps,
    resolveSpawnCwd,
    type HeadlessAgentDeps,
} from './headlessAgentDeps'

const TMUX_EXIT_POLL_MS: number = 1000

type TmuxHeadlessSession = {
    readonly logPath: string
    readonly metadataPath: string
    readonly promptFilePath: string | null
    readonly pollTimer: ReturnType<typeof setInterval> | null
}

type TmuxHeadlessState = {
    readonly sessions: Map<TerminalId, TmuxHeadlessSession>
    readonly logReadOffsets: Map<TerminalId, number>
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

const tmuxHeadlessState: TmuxHeadlessState = {
    sessions: new Map(),
    logReadOffsets: new Map(),
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
    const session: TmuxHeadlessSession | undefined = tmuxHeadlessState.sessions.get(terminalId)
    if (session?.pollTimer) {
        clearInterval(session.pollTimer)
        tmuxHeadlessState.sessions.set(terminalId, {...session, pollTimer: null})
    }
}

function markTmuxMetadataExited(terminalId: TerminalId, exitCode: number | null = null): void {
    const session: TmuxHeadlessSession | undefined = tmuxHeadlessState.sessions.get(terminalId)
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

export async function spawnTmuxBackedTerminal(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
    promptFilePath: string | null = null,
): Promise<{readonly pid: number}> {
    const paths: {readonly logPath: string; readonly metadataPath: string} = resolveTmuxPaths(terminalId, env)
    const sessionExists: boolean = await hasSession(terminalId)
    const startedAt: string = new Date().toISOString()
    const created: {readonly pid: number} = sessionExists
        ? {pid: await getPanePid(terminalId)}
        : await createSession(
            terminalId,
            buildTmuxCommand(command, resolveSpawnCwd(cwd, deps.getHomeDir(), deps.getCurrentDirectory())),
            env,
        )

    await pipePaneToFile(terminalId, paths.logPath)
    const existingMeta: TmuxTerminalMetadata | null = sessionExists ? readTmuxMetadata(paths.metadataPath) : null
    writeTmuxMetadata(paths.metadataPath, {
        name: terminalId,
        status: 'running',
        pid: created.pid,
        session: terminalId,
        startedAt: existingMeta?.startedAt ?? startedAt,
        logFile: paths.logPath,
        terminalData,
    })

    clearTmuxPoll(terminalId)
    const pollTimer: ReturnType<typeof setInterval> = startTmuxExitPoll(terminalId, deps)
    tmuxHeadlessState.sessions.set(terminalId, {...paths, promptFilePath, pollTimer})
    deps.recordTerminalSpawn(terminalId, terminalData)
    deps.writeLog({level: 'info', message: `[headlessAgentManager] ${sessionExists ? 'Rebound to existing' : 'Spawned'} tmux-backed terminal ${terminalId} (pid=${created.pid}) cwd=${cwd ?? 'HOME'} headless=${terminalData.isHeadless}`})
    return created
}

export function spawnTmuxHeadlessAgent(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): void {
    const vaultPath: string | undefined = env.VOICETREE_VAULT_PATH
    const plan = vaultPath
        ? applyPromptFileToHeadlessSpawn({vaultPath, terminalId, command, env})
        : {command, env, promptFilePath: null}
    void spawnTmuxBackedTerminal(terminalId, terminalData, plan.command, cwd, plan.env, deps, plan.promptFilePath).catch((error: unknown) => {
        deps.writeLog({level: 'error', message: `[headlessAgentManager] Failed to spawn tmux-backed headless agent ${terminalId}:`, error})
        deps.markTerminalExited(terminalId, null)
        if (plan.promptFilePath && vaultPath) deletePromptFile(vaultPath, terminalId)
    })
}

export function killTmuxHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited'> = defaultHeadlessAgentDeps,
): boolean {
    const tmuxSession: TmuxHeadlessSession | undefined = tmuxHeadlessState.sessions.get(terminalId)
    if (!tmuxSession) return false

    clearTmuxPoll(terminalId)
    void killSession(terminalId).catch(() => undefined)
    markTmuxMetadataExited(terminalId, null)
    deletePromptFileByPath(tmuxSession.promptFilePath)
    deps.markTerminalExited(terminalId, null)
    return true
}

export function removeTmuxHeadlessAgentState(terminalId: TerminalId): void {
    tmuxHeadlessState.sessions.delete(terminalId)
    tmuxHeadlessState.logReadOffsets.delete(terminalId)
}

export function isTmuxHeadlessAgent(terminalId: TerminalId | string): boolean {
    return tmuxHeadlessState.sessions.has(terminalId as TerminalId)
}

export async function sendTmuxHeadlessAgentInput(terminalId: string, text: string): Promise<{success: boolean; error?: string}> {
    try {
        await sendKeys(terminalId, text)
        return {success: true}
    } catch (error) {
        return {success: false, error: error instanceof Error ? error.message : String(error)}
    }
}

export function getTmuxHeadlessAgentOutput(terminalId: TerminalId): string {
    const session: TmuxHeadlessSession | undefined = tmuxHeadlessState.sessions.get(terminalId)
    if (!session || !existsSync(session.logPath)) return getOutput(terminalId) ?? ''

    const fileSize: number = statSync(session.logPath).size
    const previousOffset: number = tmuxHeadlessState.logReadOffsets.get(terminalId) ?? 0
    const offset: number = previousOffset > fileSize ? 0 : previousOffset
    const raw: string = readFileSync(session.logPath, 'utf8')
    const unread: string = raw.slice(offset)
    if (unread.length > 0) {
        captureOutput(terminalId, unread)
        tmuxHeadlessState.logReadOffsets.set(terminalId, raw.length)
    }
    return getOutput(terminalId) ?? ''
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
            if (tmuxHeadlessState.sessions.has(terminalId)) return
            tmuxHeadlessState.sessions.set(terminalId, {
                logPath: metadata.logFile ?? join(vaultPath, '.voicetree', 'terminals', `${terminalId}.log`),
                metadataPath,
                promptFilePath: join(vaultPath, '.voicetree', 'terminals', `${terminalId}-prompt.txt`),
                pollTimer: startTmuxExitPoll(terminalId, deps),
            })
        },
    })
}

export function cleanupTmuxHeadlessAgents(): void {
    for (const terminalId of tmuxHeadlessState.sessions.keys()) {
        clearTmuxPoll(terminalId)
        void killSession(terminalId).catch(() => undefined)
    }
    tmuxHeadlessState.sessions.clear()
    tmuxHeadlessState.logReadOffsets.clear()
}
