import {existsSync, mkdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import type {TerminalData, TerminalId} from '@vt/agent-runtime/terminals/terminal-registry/types.ts'
import type {TmuxReconciliationResult} from '@vt/agent-runtime/terminals/terminal-registry/index.ts'
import {readMetadata, writeMetadata, type TmuxTerminalMetadata} from '@vt/agent-runtime/terminals/terminal-registry/terminal-metadata.ts'
import {
    captureOutput,
    getOutput,
} from '@vt/agent-runtime/terminals/terminal-output-buffer.ts'
import {
    createSession,
    getPanePid,
    hasSession,
    killSession,
    pipePaneToFile,
    buildTmuxSessionName,
    registerTmuxSessionAlias,
    sendKeys,
} from '@vt/agent-runtime/terminals/tmux/tmux-session-manager.ts'
import {reconcileTmuxTerminalRegistry} from '@vt/agent-runtime/terminals/terminal-registry/index.ts'
import {shellQuote} from '@vt/agent-runtime/util/shellQuote.ts'
import {applyPromptFileToHeadlessSpawn, deletePromptFile, deletePromptFileByPath} from './tmuxPromptFile'
import {
    defaultHeadlessAgentDeps,
    resolveSpawnCwd,
    type HeadlessAgentDeps,
} from './headlessAgentDeps'

const TMUX_EXIT_POLL_MS: number = 1000

type TmuxHeadlessSession = {
    readonly sessionName: string
    readonly logPath: string
    readonly metadataPath: string
    readonly exitCodePath: string
    readonly promptFilePath: string | null
    readonly pollTimer: ReturnType<typeof setInterval> | null
}

type TmuxHeadlessState = {
    readonly sessions: Map<TerminalId, TmuxHeadlessSession>
    readonly logReadOffsets: Map<TerminalId, number>
}

const tmuxHeadlessState: TmuxHeadlessState = {
    sessions: new Map(),
    logReadOffsets: new Map(),
}

function resolveTmuxPaths(terminalId: TerminalId, env: Record<string, string>): {
    readonly logPath: string
    readonly metadataPath: string
    readonly exitCodePath: string
} {
    const projectRoot: string | undefined = env.VOICETREE_VAULT_PATH
    if (!projectRoot) {
        throw new Error(`Cannot spawn tmux-backed headless agent ${terminalId}: VOICETREE_VAULT_PATH is missing`)
    }
    const terminalDir: string = join(projectRoot, '.voicetree', 'terminals')
    mkdirSync(terminalDir, {recursive: true})
    return {
        logPath: join(terminalDir, `${terminalId}.log`),
        metadataPath: join(terminalDir, `${terminalId}.json`),
        exitCodePath: join(terminalDir, `${terminalId}.exitcode`),
    }
}

function buildTmuxCommand(command: string, cwd: string | undefined): string {
    return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command
}

function captureExitCode(command: string, exitCodePath: string): string {
    const script: string = `${command}; code=$?; printf '%s' "$code" > ${shellQuote(exitCodePath)}; exit "$code"`
    return `bash -lc ${shellQuote(script)}`
}

function readExitCode(path: string): number | null {
    try {
        const value: number = Number(readFileSync(path, 'utf8').trim())
        return Number.isInteger(value) ? value : null
    } catch {
        return null
    }
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
    const existing: TmuxTerminalMetadata | null = readMetadata(session.metadataPath)
    if (!existing || existing.status === 'exited') return
    writeMetadata(session.metadataPath, {
        ...existing,
        status: 'exited',
        exitCode,
        endedAt: new Date().toISOString(),
    })
}

function startTmuxExitPoll(terminalId: TerminalId, sessionName: string, deps: HeadlessAgentDeps): ReturnType<typeof setInterval> {
    return setInterval(() => {
        void (async (): Promise<void> => {
            try {
                if (await hasSession(sessionName)) return
                clearTmuxPoll(terminalId)
                const session: TmuxHeadlessSession | undefined = tmuxHeadlessState.sessions.get(terminalId)
                const exitCode: number | null = session ? readExitCode(session.exitCodePath) : null
                markTmuxMetadataExited(terminalId, exitCode)
                deps.markTerminalExited(terminalId, exitCode)
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
    const paths = resolveTmuxPaths(terminalId, env)
    const sessionName: string = buildTmuxSessionName(terminalId, env)
    registerTmuxSessionAlias(terminalId, sessionName)
    const sessionExists: boolean = await hasSession(sessionName)
    const startedAt: string = new Date().toISOString()
    const tmuxCommand: string = buildTmuxCommand(command, resolveSpawnCwd(cwd, deps.getHomeDir(), deps.getCurrentDirectory()))
    const created: {readonly pid: number} = sessionExists
        ? {pid: await getPanePid(sessionName)}
        : await createSession(
            terminalId,
            terminalData.isHeadless ? captureExitCode(tmuxCommand, paths.exitCodePath) : tmuxCommand,
            env,
        )

    await pipePaneToFile(sessionName, paths.logPath)
    const existingMeta: TmuxTerminalMetadata | null = sessionExists ? readMetadata(paths.metadataPath) : null
    writeMetadata(paths.metadataPath, {
        name: terminalId,
        status: 'running',
        pid: created.pid,
        session: sessionName,
        startedAt: existingMeta?.startedAt ?? startedAt,
        logFile: paths.logPath,
        exitCodeFile: paths.exitCodePath,
        terminalData,
    })

    clearTmuxPoll(terminalId)
    const pollTimer: ReturnType<typeof setInterval> = startTmuxExitPoll(terminalId, sessionName, deps)
    tmuxHeadlessState.sessions.set(terminalId, {...paths, sessionName, promptFilePath, pollTimer})
    deps.recordTerminalSpawn(terminalId, terminalData)
    deps.writeLog({level: 'info', message: `[headlessAgentManager] ${sessionExists ? 'Rebound to existing' : 'Spawned'} tmux-backed terminal ${terminalId} (pid=${created.pid}) cwd=${cwd ?? 'HOME'} headless=${terminalData.isHeadless}`})
    return created
}

export async function attachExistingTmuxBackedTerminal(
    terminalId: TerminalId,
    terminalData: TerminalData,
    sessionName: string,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): Promise<{readonly pid: number}> {
    const paths = resolveTmuxPaths(terminalId, env)
    registerTmuxSessionAlias(terminalId, sessionName)
    if (!(await hasSession(sessionName))) {
        throw new Error(`Cannot attach ${terminalId}: tmux session ${sessionName} no longer exists`)
    }

    const pid: number = await getPanePid(sessionName)
    await pipePaneToFile(sessionName, paths.logPath)
    const existingMeta: TmuxTerminalMetadata | null = readMetadata(paths.metadataPath)
    writeMetadata(paths.metadataPath, {
        name: terminalId,
        status: 'running',
        pid,
        session: sessionName,
        startedAt: existingMeta?.startedAt ?? new Date().toISOString(),
        logFile: paths.logPath,
        exitCodeFile: paths.exitCodePath,
        terminalData,
    })

    clearTmuxPoll(terminalId)
    const pollTimer: ReturnType<typeof setInterval> = startTmuxExitPoll(terminalId, sessionName, deps)
    tmuxHeadlessState.sessions.set(terminalId, {...paths, sessionName, promptFilePath: null, pollTimer})
    deps.recordTerminalSpawn(terminalId, terminalData)
    deps.writeLog({level: 'info', message: `[headlessAgentManager] Attached existing tmux-backed terminal ${terminalId} (pid=${pid}) session=${sessionName}`})
    return {pid}
}

export function spawnTmuxHeadlessAgent(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): void {
    const projectRoot: string | undefined = env.VOICETREE_VAULT_PATH
    const plan = projectRoot
        ? applyPromptFileToHeadlessSpawn({projectRoot, terminalId, command, env})
        : {command, env, promptFilePath: null}
    void spawnTmuxBackedTerminal(terminalId, terminalData, plan.command, cwd, plan.env, deps, plan.promptFilePath).catch((error: unknown) => {
        deps.writeLog({level: 'error', message: `[headlessAgentManager] Failed to spawn tmux-backed headless agent ${terminalId}:`, error})
        deps.markTerminalExited(terminalId, null)
        if (plan.promptFilePath) deletePromptFile(projectRoot, terminalId)
    })
}

export async function killTmuxHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited'> = defaultHeadlessAgentDeps,
): Promise<boolean> {
    const tmuxSession: TmuxHeadlessSession | undefined = tmuxHeadlessState.sessions.get(terminalId)
    if (!tmuxSession) return false

    clearTmuxPoll(terminalId)
    // Await tmux teardown so callers observe a settled state: the session is
    // gone from `tmux ls` by the time we return. Fire-and-forget here caused
    // close-then-assert races in tests and a transient window where production
    // callers (RPC closeHeadlessAgent, closeAgentTool) could hand control back
    // to the client while the session was still alive.
    await killSession(tmuxSession.sessionName).catch(() => undefined)
    markTmuxMetadataExited(terminalId, null)
    deletePromptFileByPath(tmuxSession.promptFilePath)
    deps.markTerminalExited(terminalId, null)
    return true
}

export function removeTmuxHeadlessAgentState(terminalId: TerminalId): void {
    tmuxHeadlessState.sessions.delete(terminalId)
    tmuxHeadlessState.logReadOffsets.delete(terminalId)
}

export function detachTmuxHeadlessAgents(): void {
    for (const terminalId of [...tmuxHeadlessState.sessions.keys()]) {
        clearTmuxPoll(terminalId)
    }
    tmuxHeadlessState.sessions.clear()
    tmuxHeadlessState.logReadOffsets.clear()
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
    projectRoot: string,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): Promise<TmuxReconciliationResult> {
    return reconcileTmuxTerminalRegistry(projectRoot, {
        hasSession,
        logger: {
            info: (message?: unknown, ...optionalParams: unknown[]): void =>
                deps.writeLog({level: 'info', message: String(message), error: optionalParams.length > 0 ? optionalParams : undefined}),
            error: (message?: unknown, ...optionalParams: unknown[]): void =>
                deps.writeLog({level: 'error', message: String(message), error: optionalParams.length > 0 ? optionalParams : undefined}),
        },
        onRunningSession: ({terminalId, metadataPath, metadata}) => {
            if (tmuxHeadlessState.sessions.has(terminalId)) return
            const sessionName: string = metadata.session ?? terminalId
            registerTmuxSessionAlias(terminalId, sessionName)
            tmuxHeadlessState.sessions.set(terminalId, {
                sessionName,
                logPath: metadata.logFile ?? join(projectRoot, '.voicetree', 'terminals', `${terminalId}.log`),
                metadataPath,
                exitCodePath: metadata.exitCodeFile ?? join(projectRoot, '.voicetree', 'terminals', `${terminalId}.exitcode`),
                promptFilePath: join(projectRoot, '.voicetree', 'terminals', `${terminalId}-prompt.txt`),
                pollTimer: startTmuxExitPoll(terminalId, sessionName, deps),
            })
        },
    })
}

export function cleanupTmuxHeadlessAgents(): void {
    for (const [terminalId, session] of tmuxHeadlessState.sessions.entries()) {
        clearTmuxPoll(terminalId)
        void killSession(session.sessionName).catch(() => undefined)
    }
    tmuxHeadlessState.sessions.clear()
    tmuxHeadlessState.logReadOffsets.clear()
}

export async function cleanupTmuxHeadlessAgentsAndWait(): Promise<void> {
    const sessions: readonly [TerminalId, TmuxHeadlessSession][] = [...tmuxHeadlessState.sessions.entries()]
    for (const [terminalId] of sessions) {
        clearTmuxPoll(terminalId)
    }
    await Promise.all(sessions.map(([, session]: [TerminalId, TmuxHeadlessSession]) =>
        killSession(session.sessionName).catch(() => undefined)
    ))
    tmuxHeadlessState.sessions.clear()
    tmuxHeadlessState.logReadOffsets.clear()
}
