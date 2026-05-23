import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {getTerminalRecords, type TerminalRecord} from '../terminals/terminal-registry'
import {readMetadata, type TmuxTerminalMetadata} from '../terminals/terminal-registry/terminal-metadata'
import {createTerminalData, type TerminalId} from '../terminals/terminal-registry/types'
import {
    getCurrentTmuxNamespaceHash,
    listUnclaimedTmuxSessions,
    parseVoicetreeTmuxSessionName,
    type UnclaimedTmuxSession,
} from '../terminals/tmux/unclaimed-tmux'
import {buildTmuxSessionName} from '../terminals/tmux/tmux-session-manager'
import {
    classifyRecoveryCandidates,
    detectSupportedCliFromMetadata,
    type MetadataRecord,
} from './classifier'
import os from 'node:os'
import {resolveClaudeNativeSession, defaultResolveClaudeDeps, type ResolveClaudeResult} from './resolvers/resolveClaudeNativeSession'
import {resolveCodexNativeSession, defaultResolveCodexDeps, type ResolveCodexResult} from './resolvers/resolveCodexNativeSession'
import type {RecoverableAgentSession, RecoveryClassification, ResumeCapability} from './types'

export type DiscoverRecoveryDeps = {
    readonly readVaultMetadataDir: () => Promise<readonly MetadataRecord[]>
    readonly listLiveUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSession[]>
    readonly getRegistryTerminalIds: () => ReadonlySet<string>
    readonly getCurrentNamespaceHash: () => Promise<string | null>
    readonly resolveResumeHandle: (req: ResolveRequest) => ResumeCapability | null
}

export type ResolveRequest = {
    readonly cliType: 'claude' | 'codex'
    readonly terminalId: string
    readonly vaultPath: string
    readonly taskNodePath: string
}

function sortRecords(records: readonly RecoverableAgentSession[]): readonly RecoverableAgentSession[] {
    return [...records].sort((a, b) => {
        // Claimed rows (rendered as fork-on-hover on live tabs) come last so
        // the Surviving Agents section, which filters !isClaimed, shows
        // orphans first.
        if (a.isClaimed !== b.isClaimed) return a.isClaimed ? 1 : -1
        // Orphans with a live tmux pane (Attach available) come before
        // dead-pane resume-only rows — Attach is the lower-friction action.
        if (Boolean(a.attach) !== Boolean(b.attach)) return a.attach ? -1 : 1
        return a.terminalId.localeCompare(b.terminalId)
    })
}

/**
 * Impure discovery entry point.
 *
 * Reads vault terminal metadata, live tmux state, the in-memory terminal
 * registry, and the current vault namespace hash. For each candidate record
 * targeting a supported CLI (claude/codex), runs the matching resolver against
 * disk (e.g. `~/.claude/projects/**\/*.jsonl`) to determine the resume
 * capability at discovery time. Then routes everything through the pure
 * classifier and returns the recoverable rows.
 *
 * Capabilities (`attach`, `resume`) are independent. A record can carry
 * neither, one, or both. The UI decides where to render based on `isClaimed`
 * and which capabilities are present.
 *
 * Records with neither capability and not currently claimed (e.g. dead-pane
 * agent that never wrote a transcript) are dropped — there's nothing the UI
 * could do with them.
 */
export async function discoverRecoverableAgentSessions(
    deps?: DiscoverRecoveryDeps,
): Promise<readonly RecoverableAgentSession[]> {
    const resolvedDeps: DiscoverRecoveryDeps = deps ?? defaultDiscoverRecoveryDeps()
    const [metadataRecords, liveUnclaimed, currentNamespaceHash] = await Promise.all([
        resolvedDeps.readVaultMetadataDir(),
        resolvedDeps.listLiveUnclaimedTmuxSessions(),
        resolvedDeps.getCurrentNamespaceHash(),
    ])
    const registryTerminalIds: ReadonlySet<string> = resolvedDeps.getRegistryTerminalIds()
    const liveTmuxSessionsByName: ReadonlyMap<string, UnclaimedTmuxSession> = new Map(
        liveUnclaimed.map((session) => [session.sessionName, session]),
    )
    const resumeHandleByTerminalId: ReadonlyMap<string, ResumeCapability> = resolveResumeHandlesForMetadata(
        metadataRecords,
        currentNamespaceHash,
        resolvedDeps.resolveResumeHandle,
    )
    const classifications: readonly RecoveryClassification[] = classifyRecoveryCandidates({
        metadataRecords,
        liveTmuxSessionsByName,
        registryTerminalIds,
        currentNamespaceHash,
        resumeHandleByTerminalId,
    })
    const recoverable: RecoverableAgentSession[] = []
    const surfacedTerminalIds: Set<string> = new Set()
    for (const classification of classifications) {
        if (classification.kind !== 'recoverable') continue
        const row: RecoverableAgentSession = classification.record
        // Surface only rows the UI can act on. Claimed rows always surface
        // (fork-on-hover applies). Unclaimed rows need at least one capability.
        if (!row.isClaimed && !row.attach && !row.resume) continue
        recoverable.push(row)
        surfacedTerminalIds.add(row.terminalId)
    }
    // Surface live unclaimed tmux sessions that have no matching metadata
    // file. Pre-OpenSpec listUnclaimedTmuxSessions behavior: a tmux session
    // can outlive its metadata (deleted vault, app crash before writeMetadata,
    // manual `tmux new-session`) but still be attachable. These rows carry
    // only the `attach` capability — no metadataPath, no terminalData beyond
    // what the session itself provides.
    for (const session of liveUnclaimed) {
        if (surfacedTerminalIds.has(session.terminalId)) continue
        recoverable.push(metadataLessAttachableRow(session))
    }
    return sortRecords(recoverable)
}

function metadataLessAttachableRow(session: UnclaimedTmuxSession): RecoverableAgentSession {
    const terminalId: TerminalId = session.terminalId as TerminalId
    const attachedToNodeId: string = session.contextNodePath ?? `tmux-session:${session.sessionName}`
    return {
        terminalId,
        agentName: session.agentName ?? session.terminalId,
        metadataPath: '',
        terminalData: createTerminalData({
            terminalId,
            attachedToNodeId,
            terminalCount: 0,
            title: session.agentName ?? session.terminalId,
            agentName: session.agentName ?? session.terminalId,
            initialEnvVars: {
                ...(session.vaultPath ? {VOICETREE_VAULT_PATH: session.vaultPath} : {}),
                ...(session.contextNodePath ? {CONTEXT_NODE_PATH: session.contextNodePath} : {}),
                ...(session.taskNodePath ? {TASK_NODE_PATH: session.taskNodePath} : {}),
            },
        }),
        isClaimed: false,
        attach: {session},
    }
}

function resolveResumeHandlesForMetadata(
    metadataRecords: readonly MetadataRecord[],
    currentNamespaceHash: string | null,
    resolveResumeHandle: (req: ResolveRequest) => ResumeCapability | null,
): ReadonlyMap<string, ResumeCapability> {
    const out: Map<string, ResumeCapability> = new Map()
    for (const record of metadataRecords) {
        const data: unknown = record.data
        if (typeof data !== 'object' || data === null) continue
        const obj = data as Record<string, unknown>
        if (typeof obj.name !== 'string' || !obj.name) continue
        if (obj.status !== 'running' && obj.status !== 'exited') continue
        const metadata = data as TmuxTerminalMetadata
        // Skip foreign vaults early — no point resolving handles we won't surface.
        if (currentNamespaceHash !== null) {
            const sessionName: string = metadata.session
                ?? buildTmuxSessionName(metadata.name, metadata.terminalData?.initialEnvVars ?? {})
            const namespaceHash: string | null = parseVoicetreeTmuxSessionName(sessionName)?.hash ?? null
            if (namespaceHash !== null && namespaceHash !== currentNamespaceHash) continue
        }
        const cliType: 'claude' | 'codex' | null = detectSupportedCliFromMetadata(metadata)
        if (!cliType) continue
        const vaultPath: string | undefined = metadata.terminalData?.initialEnvVars?.VOICETREE_VAULT_PATH
        if (!vaultPath) continue
        const taskNodePath: string = metadata.terminalData?.initialEnvVars?.TASK_NODE_PATH ?? ''
        const handle: ResumeCapability | null = resolveResumeHandle({
            cliType,
            terminalId: metadata.name,
            vaultPath,
            taskNodePath,
        })
        if (handle) out.set(metadata.name, handle)
    }
    return out
}

async function resolveCurrentVaultMetadataDir(): Promise<string | null> {
    const runtimeEnv = getRuntimeEnv()
    const projectRoot: string | null = await (runtimeEnv.getProjectRootWatchedDirectory?.() ?? Promise.resolve(null))
    if (projectRoot) return path.join(projectRoot, '.voicetree', 'terminals')
    const writePath: string | null = await (runtimeEnv.getWritePath?.() ?? Promise.resolve(null))
    return writePath ? path.join(writePath, 'terminals') : null
}

function readMetadataDir(dir: string): readonly MetadataRecord[] {
    let entries: readonly string[]
    try {
        entries = readdirSync(dir)
    } catch {
        return []
    }
    const records: MetadataRecord[] = []
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        const filePath: string = path.join(dir, entry)
        try {
            const stat = statSync(filePath)
            if (!stat.isFile()) continue
            const raw: string = readFileSync(filePath, 'utf8')
            records.push({path: filePath, data: JSON.parse(raw) as unknown})
        } catch {
            // Skip files that fail to read or parse; classifier handles invalid shapes too.
        }
    }
    return records
}

/**
 * Resolve a Claude/Codex native session id by scanning the on-disk transcript
 * store. The store roots can be overridden via env vars, useful for tests
 * (point at a temp dir) and for users with non-default Claude/Codex configs:
 *
 * - `VOICETREE_CLAUDE_PROJECTS_DIR`  → defaults to `~/.claude/projects`
 * - `VOICETREE_CODEX_STATE_DB`       → defaults to `~/.codex/state_5.sqlite`
 */
function defaultResolveResumeHandle(req: ResolveRequest): ResumeCapability | null {
    if (req.cliType === 'claude') {
        const claudeProjectsRoot: string = process.env.VOICETREE_CLAUDE_PROJECTS_DIR
            ?? path.join(os.homedir(), '.claude', 'projects')
        const result: ResolveClaudeResult = resolveClaudeNativeSession(
            {terminalId: req.terminalId, vaultPath: req.vaultPath, taskNodePath: req.taskNodePath},
            defaultResolveClaudeDeps(claudeProjectsRoot),
        )
        if (result.kind !== 'found') return null
        return {cliType: 'claude', nativeSessionId: result.sessionId}
    }
    const codexDbPath: string = process.env.VOICETREE_CODEX_STATE_DB
        ?? path.join(os.homedir(), '.codex', 'state_5.sqlite')
    const result: ResolveCodexResult = resolveCodexNativeSession(
        {terminalId: req.terminalId, vaultPath: req.vaultPath, taskNodePath: req.taskNodePath},
        defaultResolveCodexDeps(codexDbPath),
    )
    if (result.kind !== 'found') return null
    return {cliType: 'codex', nativeSessionId: result.sessionId}
}

export function defaultDiscoverRecoveryDeps(): DiscoverRecoveryDeps {
    return {
        readVaultMetadataDir: async (): Promise<readonly MetadataRecord[]> => {
            const dir: string | null = await resolveCurrentVaultMetadataDir()
            return dir ? readMetadataDir(dir) : []
        },
        listLiveUnclaimedTmuxSessions: (): Promise<readonly UnclaimedTmuxSession[]> => listUnclaimedTmuxSessions(),
        getRegistryTerminalIds: (): ReadonlySet<string> => {
            const records: readonly TerminalRecord[] = getTerminalRecords()
            return new Set(records.map((record) => record.terminalId))
        },
        getCurrentNamespaceHash: (): Promise<string | null> => getCurrentTmuxNamespaceHash(),
        resolveResumeHandle: defaultResolveResumeHandle,
    }
}

// Re-export for convenience: callers building custom deps that still want to
// share the on-disk metadata reader.
export {readMetadata}
