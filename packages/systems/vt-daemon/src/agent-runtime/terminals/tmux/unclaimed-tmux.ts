import path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {attachExistingTmuxBackedTerminal} from '@vt/vt-daemon/agent-runtime/headless/tmuxHeadlessRuntime.ts'
import {getRuntimeEnv} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {
    getTerminalRecords,
    type TerminalRecord,
} from '../terminal-registry'
import {
    buildTmuxNamespaceHash,
    buildTmuxSessionName,
    getSessionEnvironment,
    killSession,
    listSessions,
    type TmuxListedSession,
} from './tmux-session-manager'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '../terminal-registry/types'

export type UnclaimedTmuxClassification = 'this-project' | 'foreign-project'

export type ParsedVoicetreeTmuxSessionName = {
    readonly hash: string
    readonly terminalId: string
}

export type UnclaimedTmuxSession = {
    readonly sessionName: string
    readonly terminalId: string
    readonly hash: string
    readonly classification: UnclaimedTmuxClassification
    readonly attachable: boolean
    readonly createdAt: number
    readonly panePid: number
    readonly projectRoot?: string
    readonly contextNodePath?: string
    readonly taskNodePath?: string
}

export type AttachUnclaimedTmuxResult = {
    readonly success: boolean
    readonly terminalId?: string
    readonly terminalData?: TerminalData
    readonly error?: string
}

export type KillUnclaimedTmuxResult = {
    readonly success: boolean
    readonly error?: string
}

export type KillUnclaimedTmuxDeps = {
    readonly listUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSession[]>
    readonly killSession: (sessionName: string) => Promise<void>
}

export type AttachUnclaimedTmuxDeps = {
    readonly listUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSession[]>
    readonly getSessionEnvironment: (sessionName: string) => Promise<Record<string, string>>
    readonly attachExistingTmuxBackedTerminal: typeof attachExistingTmuxBackedTerminal
    readonly now: () => number
}

export type ListUnclaimedTmuxDeps = {
    readonly listSessions: () => Promise<readonly TmuxListedSession[]>
    readonly getSessionEnvironment: (sessionName: string) => Promise<Record<string, string>>
    readonly getTerminalRecords: () => TerminalRecord[]
    readonly getCurrentNamespaceHash: () => Promise<string | null>
}

const VT_SESSION_RE: RegExp = /^vt-([0-9a-f]{10})-(.+)$/

export function parseVoicetreeTmuxSessionName(sessionName: string): ParsedVoicetreeTmuxSessionName | null {
    const match: RegExpMatchArray | null = sessionName.match(VT_SESSION_RE)
    if (!match) return null
    return {
        hash: match[1],
        terminalId: match[2],
    }
}

async function resolveCurrentTmuxNamespace(): Promise<string | null> {
    const runtimeEnv = getRuntimeEnv()
    const projectRoot: string | null = await (runtimeEnv.getProjectRoot?.() ?? Promise.resolve(null))
    if (projectRoot) return getProjectDotVoicetreePath(projectRoot)

    return await (runtimeEnv.getWriteFolderPath?.() ?? Promise.resolve(null))
}

export async function getCurrentTmuxNamespaceHash(): Promise<string | null> {
    const namespace: string | null = await resolveCurrentTmuxNamespace()
    return namespace ? buildTmuxNamespaceHash(namespace) : null
}

async function defaultListDeps(): Promise<ListUnclaimedTmuxDeps> {
    return {
        listSessions,
        getSessionEnvironment,
        getTerminalRecords,
        getCurrentNamespaceHash: getCurrentTmuxNamespaceHash,
    }
}

async function safeSessionEnvironment(
    sessionName: string,
    deps: Pick<ListUnclaimedTmuxDeps, 'getSessionEnvironment'>,
): Promise<Record<string, string>> {
    try {
        return await deps.getSessionEnvironment(sessionName)
    } catch {
        return {}
    }
}

function registeredSessionNames(records: readonly TerminalRecord[]): Set<string> {
    const sessionNames: Set<string> = new Set()
    for (const record of records) {
        sessionNames.add(record.terminalId)
        sessionNames.add(buildTmuxSessionName(record.terminalId, record.terminalData.initialEnvVars ?? {}))
    }
    return sessionNames
}

export async function listUnclaimedTmuxSessions(
    deps: ListUnclaimedTmuxDeps | null = null,
): Promise<readonly UnclaimedTmuxSession[]> {
    const resolvedDeps: ListUnclaimedTmuxDeps = deps ?? await defaultListDeps()
    const currentHash: string | null = await resolvedDeps.getCurrentNamespaceHash()
    const terminalRecords: TerminalRecord[] = resolvedDeps.getTerminalRecords()
    const registeredIds: Set<string> = new Set(
        terminalRecords.map((record: TerminalRecord) => record.terminalId),
    )
    const claimedSessionNames: Set<string> = registeredSessionNames(terminalRecords)
    const sessions: readonly TmuxListedSession[] = await resolvedDeps.listSessions()
    const unclaimed: UnclaimedTmuxSession[] = []

    for (const session of sessions) {
        const parsed: ParsedVoicetreeTmuxSessionName | null = parseVoicetreeTmuxSessionName(session.sessionName)
        if (!parsed || claimedSessionNames.has(session.sessionName)) continue

        const env: Record<string, string> = await safeSessionEnvironment(session.sessionName, resolvedDeps)
        const terminalId: string = env.VOICETREE_TERMINAL_ID || parsed.terminalId
        if (registeredIds.has(terminalId)) continue

        const classification: UnclaimedTmuxClassification = currentHash && parsed.hash === currentHash
            ? 'this-project'
            : 'foreign-project'
        unclaimed.push({
            sessionName: session.sessionName,
            terminalId,
            hash: parsed.hash,
            classification,
            attachable: classification === 'this-project',
            createdAt: session.createdAtSeconds * 1000,
            panePid: session.panePid,
            projectRoot: env.VOICETREE_PROJECT_PATH,
            contextNodePath: env.CONTEXT_NODE_PATH,
            taskNodePath: env.TASK_NODE_PATH,
        })
    }

    return unclaimed.sort((a: UnclaimedTmuxSession, b: UnclaimedTmuxSession) => b.createdAt - a.createdAt)
}

function fallbackTerminalData(terminalId: string, env: Record<string, string>): TerminalData | null {
    const contextNodePath: string | undefined = env.CONTEXT_NODE_PATH ?? env.TASK_NODE_PATH
    if (!contextNodePath) return null
    return createTerminalData({
        terminalId: terminalId as TerminalId,
        attachedToNodeId: contextNodePath as NodeIdAndFilePath,
        terminalCount: 0,
        title: env.AGENT_NAME ?? terminalId,
        anchoredToNodeId: env.TASK_NODE_PATH as NodeIdAndFilePath | undefined,
        initialEnvVars: env,
        initialSpawnDirectory: env.PWD,
        isPinned: true,
        parentTerminalId: null,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
    })
}

function normalizeAttachedTerminalData(
    terminalId: string,
    terminalData: TerminalData,
    env: Record<string, string>,
    now: number,
): TerminalData {
    return {
        ...terminalData,
        terminalId: terminalId as TerminalId,
        initialEnvVars: {...(terminalData.initialEnvVars ?? {}), ...env},
        parentTerminalId: null,
        isDone: false,
        lifecycle: 'idle',
        lastOutputTime: now,
        activityCount: 0,
        isMinimized: false,
    }
}

function defaultAttachDeps(): AttachUnclaimedTmuxDeps {
    return {
        listUnclaimedTmuxSessions,
        getSessionEnvironment,
        attachExistingTmuxBackedTerminal,
        now: Date.now,
    }
}

export async function attachUnclaimedTmuxSession(
    sessionName: string,
    deps: AttachUnclaimedTmuxDeps = defaultAttachDeps(),
): Promise<AttachUnclaimedTmuxResult> {
    try {
        const parsed: ParsedVoicetreeTmuxSessionName | null = parseVoicetreeTmuxSessionName(sessionName)
        if (!parsed) return {success: false, error: 'Only Voicetree tmux sessions can be attached'}

        const unclaimed: readonly UnclaimedTmuxSession[] = await deps.listUnclaimedTmuxSessions()
        const target: UnclaimedTmuxSession | undefined = unclaimed.find(
            (session: UnclaimedTmuxSession) => session.sessionName === sessionName,
        )
        if (!target) return {success: false, error: 'Tmux session is already claimed or no longer exists'}
        if (!target.attachable) return {success: false, error: 'Foreign-project tmux sessions cannot be attached'}

        const env: Record<string, string> = await safeSessionEnvironment(sessionName, deps)
        const terminalId: string = target.terminalId || env.VOICETREE_TERMINAL_ID || parsed.terminalId
        const terminalData: TerminalData | null = fallbackTerminalData(terminalId, env)
        if (!terminalData) {
            return {success: false, error: 'Cannot attach session without a context path'}
        }

        const attachedData: TerminalData = normalizeAttachedTerminalData(terminalId, terminalData, env, deps.now())
        await deps.attachExistingTmuxBackedTerminal(
            terminalId as TerminalId,
            attachedData,
            sessionName,
            attachedData.initialEnvVars ?? env,
        )
        return {success: true, terminalId, terminalData: attachedData}
    } catch (error) {
        return {success: false, error: error instanceof Error ? error.message : String(error)}
    }
}

export async function killUnclaimedTmuxSession(
    sessionName: string,
    deps: KillUnclaimedTmuxDeps = {listUnclaimedTmuxSessions, killSession},
): Promise<KillUnclaimedTmuxResult> {
    try {
        if (!parseVoicetreeTmuxSessionName(sessionName)) {
            return {success: false, error: 'Only Voicetree tmux sessions can be killed here'}
        }
        const unclaimed: readonly UnclaimedTmuxSession[] = await deps.listUnclaimedTmuxSessions()
        if (!unclaimed.some((session: UnclaimedTmuxSession): boolean => session.sessionName === sessionName)) {
            return {success: false, error: 'Tmux session is already claimed or no longer exists'}
        }
        await deps.killSession(sessionName)
        return {success: true}
    } catch (error) {
        return {success: false, error: error instanceof Error ? error.message : String(error)}
    }
}
