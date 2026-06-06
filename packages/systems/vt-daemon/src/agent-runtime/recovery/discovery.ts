import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {getRuntimeEnv} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {getTerminalRecords, type TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'
import {readMetadata, type TmuxTerminalMetadata} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-metadata.ts'
import {createTerminalData, type TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {
    getCurrentTmuxNamespaceHash,
    listUnclaimedTmuxSessions,
    parseVoicetreeTmuxSessionName,
    type UnclaimedTmuxSession,
} from '@vt/vt-daemon/agent-runtime/terminals/tmux/unclaimed-tmux.ts'
import {buildTmuxSessionName} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-session-manager.ts'
import {
    classifyRecoveryCandidates,
    detectSupportedCliFromMetadata,
    type MetadataRecord,
} from './classifier'
import {getRecoveryHorizonMs, isoToMsOrZero} from './horizon'
import {getRecoveryMetadataDir} from './paths'
import type {RecoverableAgentSession, RecoveryClassification, ResumeCapability} from './types'

export type DiscoverRecoveryDeps = {
    readonly readProjectMetadataDir: () => Promise<readonly MetadataRecord[]>
    readonly listLiveUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSession[]>
    readonly getRegistryTerminalIds: () => ReadonlySet<string>
    readonly getCurrentNamespaceHash: () => Promise<string | null>
}

/**
 * Optional knobs for `discoverRecoverableAgentSessions`. Tests pass
 * `now` to make horizon assertions deterministic; the renderer's "show
 * older" link passes `horizonMs: null` to disable the cutoff entirely.
 */
export type DiscoverRecoveryOptions = {
    readonly horizonMs?: number | null
    readonly now?: () => number
}

/**
 * Group ordering on the Surviving Agents list. Lower tier renders first.
 *
 * - 0: live tmux attachable — Attach is the lowest-friction action.
 * - 1: resume-only (no attach, still running on disk) — dead pane that the
 *   CLI may be able to resume via its native session id.
 * - 2: recently closed (status exited or killed) — Resume may still work but
 *   the agent is no longer live; sorts last so live work stays at the top.
 */
function rowTier(row: RecoverableAgentSession): 0 | 1 | 2 {
    if (row.attach) return 0
    if (row.status === 'running') return 1
    return 2
}

function recencyKey(row: RecoverableAgentSession): number {
    return row.closedAt ?? isoToMsOrZero(row.startedAt)
}

function sortRecords(records: readonly RecoverableAgentSession[]): readonly RecoverableAgentSession[] {
    return [...records].sort((a, b) => {
        // Claimed rows go to the live tab strip; keep them last so the
        // Surviving Agents view (which filters !isClaimed) sees orphans first.
        if (a.isClaimed !== b.isClaimed) return a.isClaimed ? 1 : -1
        const tierDelta: number = rowTier(a) - rowTier(b)
        if (tierDelta !== 0) return tierDelta
        const recencyDelta: number = recencyKey(b) - recencyKey(a)
        if (recencyDelta !== 0) return recencyDelta
        return a.terminalId.localeCompare(b.terminalId)
    })
}

function applyHorizon(
    records: readonly RecoverableAgentSession[],
    horizonMs: number | null,
    now: number,
): readonly RecoverableAgentSession[] {
    if (horizonMs === null || horizonMs <= 0) return records
    const cutoff: number = now - horizonMs
    return records.filter((row: RecoverableAgentSession): boolean => {
        // Still-running rows are never time-gated; only closed rows expire.
        if (row.status === 'running') return true
        const key: number = recencyKey(row)
        if (key === 0) return true  // unknown age — surface rather than silently hide
        return key >= cutoff
    })
}

/**
 * Impure discovery entry point.
 *
 * Reads project terminal metadata, live tmux state, the in-memory terminal
 * registry, and the current project namespace hash. Decides resume capability
 * from terminal JSON: a record carries `resume` when it has persisted
 * `recovery.native` or when its `initialCommand` parses to a supported CLI
 * (`claude`/`codex`) and the record has a `VOICETREE_PROJECT_PATH`. Discovery
 * does not scan provider stores; missing native ids are resolved lazily inside
 * `resumePersistedAgentSession` / `forkAgentSession` at click time.
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
    opts: DiscoverRecoveryOptions = {},
): Promise<readonly RecoverableAgentSession[]> {
    const resolvedDeps: DiscoverRecoveryDeps = deps ?? defaultDiscoverRecoveryDeps()
    const [metadataRecords, liveUnclaimed, currentNamespaceHash] = await Promise.all([
        resolvedDeps.readProjectMetadataDir(),
        resolvedDeps.listLiveUnclaimedTmuxSessions(),
        resolvedDeps.getCurrentNamespaceHash(),
    ])
    const registryTerminalIds: ReadonlySet<string> = resolvedDeps.getRegistryTerminalIds()
    const liveTmuxSessionsByName: ReadonlyMap<string, UnclaimedTmuxSession> = new Map(
        liveUnclaimed.map((session) => [session.sessionName, session]),
    )
    const resumeHandleByTerminalId: ReadonlyMap<string, ResumeCapability> =
        detectResumeCapabilitiesFromMetadata(metadataRecords, currentNamespaceHash)
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
        // (fork-on-hover applies). Unclaimed rows need at least one capability
        // OR a closed lifecycle (exited/killed records are surfaced for their
        // history value — the user can review or delete them).
        if (!row.isClaimed && !row.attach && !row.resume && row.status === 'running') continue
        recoverable.push(row)
        surfacedTerminalIds.add(row.terminalId)
    }
    // Surface live unclaimed tmux sessions that have no matching metadata
    // file. Pre-OpenSpec listUnclaimedTmuxSessions behavior: a tmux session
    // can outlive its metadata (deleted project, app crash before writeMetadata,
    // manual `tmux new-session`) but still be attachable. These rows carry
    // only the `attach` capability — no metadataPath, no terminalData beyond
    // what the session itself provides.
    for (const session of liveUnclaimed) {
        if (surfacedTerminalIds.has(session.terminalId)) continue
        recoverable.push(metadataLessAttachableRow(session))
    }
    const horizonMs: number | null = opts.horizonMs === undefined ? getRecoveryHorizonMs() : opts.horizonMs
    const now: number = (opts.now ?? Date.now)()
    const withinHorizon: readonly RecoverableAgentSession[] = applyHorizon(recoverable, horizonMs, now)
    return sortRecords(withinHorizon)
}

function metadataLessAttachableRow(session: UnclaimedTmuxSession): RecoverableAgentSession {
    const terminalId: TerminalId = session.terminalId as TerminalId
    const attachedToNodeId: string = session.contextNodePath ?? `tmux-session:${session.sessionName}`
    const title: string = session.terminalId
    return {
        terminalId,
        metadataPath: '',
        terminalData: createTerminalData({
            terminalId,
            attachedToNodeId,
            terminalCount: 0,
            title,
            initialEnvVars: {
                ...(session.projectRoot ? {VOICETREE_PROJECT_PATH: session.projectRoot} : {}),
                ...(session.contextNodePath ? {CONTEXT_NODE_PATH: session.contextNodePath} : {}),
                ...(session.taskNodePath ? {TASK_NODE_PATH: session.taskNodePath} : {}),
            },
        }),
        isClaimed: false,
        status: 'running',
        attach: {session},
    }
}

/**
 * Decide resume capability for each metadata record from terminal JSON.
 *
 * Surfaces a persisted native session id when the record already has
 * `recovery.native`, otherwise surfaces `{cliType}` when the record targets a
 * supported CLI and carries the minimum env (`VOICETREE_PROJECT_PATH`) required
 * for the resolver to run later at click time. No filesystem IO, no transcript
 * scans — this runs on every 10s poll and must stay cheap.
 *
 * The actual native session id lookup (which can touch ~1 GB of
 * `~/.claude/projects/**\/*.jsonl`) is deferred to
 * `resolveNativeSession` invoked by `resumePersistedAgentSession` /
 * `forkAgentSession`.
 */
function detectResumeCapabilitiesFromMetadata(
    metadataRecords: readonly MetadataRecord[],
    currentNamespaceHash: string | null,
): ReadonlyMap<string, ResumeCapability> {
    const out: Map<string, ResumeCapability> = new Map()
    for (const record of metadataRecords) {
        const data: unknown = record.data
        if (typeof data !== 'object' || data === null) continue
        const obj = data as Record<string, unknown>
        if (typeof obj.name !== 'string' || !obj.name) continue
        if (obj.status !== 'running' && obj.status !== 'exited' && obj.status !== 'killed') continue
        const metadata = data as TmuxTerminalMetadata
        // Skip foreign projects early — won't be surfaced anyway.
        if (currentNamespaceHash !== null) {
            const sessionName: string = metadata.session
                ?? buildTmuxSessionName(metadata.name, metadata.terminalData?.initialEnvVars ?? {})
            const namespaceHash: string | null = parseVoicetreeTmuxSessionName(sessionName)?.hash ?? null
            if (namespaceHash !== null && namespaceHash !== currentNamespaceHash) continue
        }
        const native = metadata.recovery?.native
        const cliType: 'claude' | 'codex' | null = native?.cli ?? detectSupportedCliFromMetadata(metadata)
        if (!cliType) continue
        const projectRoot: string | undefined = metadata.terminalData?.initialEnvVars?.VOICETREE_PROJECT_PATH
        if (!projectRoot) continue
        out.set(metadata.name, {
            cliType,
            ...(native?.sessionId ? {nativeSessionId: native.sessionId} : {}),
            ...(native?.providerStorePath ? {providerStorePath: native.providerStorePath} : {}),
        })
    }
    return out
}

async function resolveCurrentProjectMetadataDir(): Promise<string | null> {
    // Canonical location is always `<projectRoot>/.voicetree/terminals/`.
    // `writeFolderPath` is intentionally NOT consulted: the historical
    // writeFolderPath-based fallback wrote to the wrong place (no `.voicetree`
    // prefix) and masked the projectRoot/writeFolderPath divergence bug.
    const projectRoot: string | null = await (getRuntimeEnv().getProjectRoot?.() ?? Promise.resolve(null))
    return projectRoot ? getRecoveryMetadataDir(projectRoot) : null
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

export function defaultDiscoverRecoveryDeps(): DiscoverRecoveryDeps {
    return {
        readProjectMetadataDir: async (): Promise<readonly MetadataRecord[]> => {
            const dir: string | null = await resolveCurrentProjectMetadataDir()
            return dir ? readMetadataDir(dir) : []
        },
        listLiveUnclaimedTmuxSessions: (): Promise<readonly UnclaimedTmuxSession[]> => listUnclaimedTmuxSessions(),
        getRegistryTerminalIds: (): ReadonlySet<string> => {
            const records: readonly TerminalRecord[] = getTerminalRecords()
            return new Set(records.map((record) => record.terminalId))
        },
        getCurrentNamespaceHash: (): Promise<string | null> => getCurrentTmuxNamespaceHash(),
    }
}

// Re-export for convenience: callers building custom deps that still want to
// share the on-disk metadata reader.
export {readMetadata}
