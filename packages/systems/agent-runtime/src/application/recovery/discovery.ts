import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {getTerminalRecords, type TerminalRecord} from '../terminals/terminal-registry'
import {
    getCurrentTmuxNamespaceHash,
    listUnclaimedTmuxSessions,
    type UnclaimedTmuxSession,
} from '../terminals/tmux/unclaimed-tmux'
import {listSessions, type TmuxListedSession} from '../terminals/tmux/tmux-session-manager'
import {classifyRecoveryCandidates, type MetadataRecord} from './classifier'
import type {RecoverableAgentSession, RecoveryClassification} from './types'

export type DiscoverRecoveryDeps = {
    readonly readVaultMetadataDir: () => Promise<readonly MetadataRecord[]>
    readonly listLiveTmuxSessionNames: () => Promise<ReadonlySet<string>>
    readonly listLiveUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSession[]>
    readonly getRegistryTerminalIds: () => ReadonlySet<string>
    readonly getCurrentNamespaceHash: () => Promise<string | null>
}

function toActionable(
    classification: RecoveryClassification,
    liveByName: ReadonlyMap<string, UnclaimedTmuxSession>,
): RecoverableAgentSession | null {
    if (classification.kind === 'attachable-live-tmux') {
        const session = liveByName.get(classification.sessionName)
        return session ? {kind: 'attachable-tmux', session} : null
    }
    if (classification.kind === 'resumable-missing-tmux') {
        return {
            kind: 'resumable-cli',
            terminalId: classification.terminalId,
            agentName: classification.agentName,
            cliType: classification.cliType,
            metadataPath: classification.metadataPath,
            terminalData: classification.terminalData,
            nativeSessionId: classification.nativeSessionId,
            reason: 'missing-tmux-session',
        }
    }
    return null
}

function dedupeAttachableOverResumable(
    rows: readonly RecoverableAgentSession[],
): readonly RecoverableAgentSession[] {
    const attachableTerminalIds: Set<string> = new Set()
    for (const row of rows) {
        if (row.kind === 'attachable-tmux') attachableTerminalIds.add(row.session.terminalId)
    }
    return rows.filter((row) => {
        if (row.kind !== 'resumable-cli') return true
        return !attachableTerminalIds.has(row.terminalId)
    })
}

function sortRecoveryRows(rows: readonly RecoverableAgentSession[]): readonly RecoverableAgentSession[] {
    const attachable: RecoverableAgentSession[] = []
    const resumable: RecoverableAgentSession[] = []
    for (const row of rows) {
        if (row.kind === 'attachable-tmux') attachable.push(row)
        else resumable.push(row)
    }
    attachable.sort((a, b) => {
        if (a.kind !== 'attachable-tmux' || b.kind !== 'attachable-tmux') return 0
        return b.session.createdAt - a.session.createdAt
    })
    resumable.sort((a, b) => {
        if (a.kind !== 'resumable-cli' || b.kind !== 'resumable-cli') return 0
        return a.metadataPath.localeCompare(b.metadataPath)
    })
    return [...attachable, ...resumable]
}

/**
 * Impure discovery entry point.
 *
 * Reads vault terminal metadata, live tmux state, the in-memory terminal registry,
 * and the current vault namespace hash. Runs them through the pure Phase 1 classifier
 * and returns only the actionable rows (`attachable-tmux` for live unclaimed panes,
 * `resumable-cli` for dead-pane records with a deterministic native session handle).
 *
 * Non-actionable diagnostics (`exited`, `claimed`, `foreign-vault`, `missing-native-handle`,
 * `unsupported-cli`, `invalid`) are dropped so the UI only sees rows it can act on.
 */
export async function discoverRecoverableAgentSessions(
    deps?: DiscoverRecoveryDeps,
): Promise<readonly RecoverableAgentSession[]> {
    const resolvedDeps: DiscoverRecoveryDeps = deps ?? defaultDiscoverRecoveryDeps()
    const [metadataRecords, liveTmuxSessionNames, liveUnclaimed, currentNamespaceHash] = await Promise.all([
        resolvedDeps.readVaultMetadataDir(),
        resolvedDeps.listLiveTmuxSessionNames(),
        resolvedDeps.listLiveUnclaimedTmuxSessions(),
        resolvedDeps.getCurrentNamespaceHash(),
    ])
    const registryTerminalIds: ReadonlySet<string> = resolvedDeps.getRegistryTerminalIds()
    const liveByName: ReadonlyMap<string, UnclaimedTmuxSession> = new Map(
        liveUnclaimed.map((session) => [session.sessionName, session]),
    )
    const classifications: readonly RecoveryClassification[] = classifyRecoveryCandidates({
        metadataRecords,
        liveTmuxSessionNames,
        registryTerminalIds,
        currentNamespaceHash,
    })
    const actionable: RecoverableAgentSession[] = []
    const sessionsFromMetadata: Set<string> = new Set()
    for (const classification of classifications) {
        const row: RecoverableAgentSession | null = toActionable(classification, liveByName)
        if (row) {
            actionable.push(row)
            if (row.kind === 'attachable-tmux') sessionsFromMetadata.add(row.session.sessionName)
        }
    }
    // Surface live unclaimed sessions that have no matching metadata file.
    // This preserves the pre-OpenSpec listUnclaimedTmuxSessions behavior:
    // a tmux session can outlive its metadata (deleted vault, app crash
    // before writeMetadata, manual `tmux new-session` for testing) but
    // remain attachable. Without this, the sidebar would only show sessions
    // we have on-disk metadata for.
    for (const session of liveUnclaimed) {
        if (!sessionsFromMetadata.has(session.sessionName)) {
            actionable.push({kind: 'attachable-tmux', session})
        }
    }
    return sortRecoveryRows(dedupeAttachableOverResumable(actionable))
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

export function defaultDiscoverRecoveryDeps(): DiscoverRecoveryDeps {
    return {
        readVaultMetadataDir: async (): Promise<readonly MetadataRecord[]> => {
            const dir: string | null = await resolveCurrentVaultMetadataDir()
            return dir ? readMetadataDir(dir) : []
        },
        listLiveTmuxSessionNames: async (): Promise<ReadonlySet<string>> => {
            const sessions: readonly TmuxListedSession[] = await listSessions()
            return new Set(sessions.map((session) => session.sessionName))
        },
        listLiveUnclaimedTmuxSessions: (): Promise<readonly UnclaimedTmuxSession[]> => listUnclaimedTmuxSessions(),
        getRegistryTerminalIds: (): ReadonlySet<string> => {
            const records: readonly TerminalRecord[] = getTerminalRecords()
            return new Set(records.map((record) => record.terminalId))
        },
        getCurrentNamespaceHash: (): Promise<string | null> => getCurrentTmuxNamespaceHash(),
    }
}
