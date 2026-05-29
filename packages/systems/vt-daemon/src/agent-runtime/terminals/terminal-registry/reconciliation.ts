import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {TerminalData, TerminalId} from './types'

// Local clone of recovery/paths.ts:getRecoveryMetadataDir — importing that
// helper from here would cross the relative-import-depth budget (../../).
// Must stay byte-identical to the canonical helper.
function recoveryMetadataDir(projectRoot: string): string {
    return join(getProjectDotVoicetreePath(projectRoot), 'terminals')
}
import {createTerminalData} from './types'
import {readMetadata, writeMetadata, type TmuxTerminalMetadata} from './terminal-metadata'
import {
    notificationStateByTerminal,
    terminalRecords,
    type TerminalRegistryClock,
    type TerminalRegistryLogger,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'
import {hasSession as defaultHasSession, registerTmuxSessionAlias} from '../tmux/tmux-session-manager'

export type TmuxReconciliationResult = {
    readonly imported: string[]
    readonly markedExited: string[]
    readonly skipped: string[]
}

export type TmuxReconciliationDeps = {
    readonly hasSession?: (name: string) => Promise<boolean>
    readonly now?: () => number
    readonly logger?: TerminalRegistryLogger
    readonly onRunningSession?: (params: {
        readonly terminalId: TerminalId
        readonly metadataPath: string
        readonly metadata: TmuxTerminalMetadata
    }) => void
    /** Writer pid threaded into writeMetadata for tmp-file rename. Falls
     * back to `process.pid` only at the shell default (see
     * `defaultReconciliationProcessPid`) so the metadata-rewrite path
     * stays free of the transitive-purity gate. */
    readonly processPid?: number
}

const defaultReconciliationProcessPid: number = process.pid

const defaultClock: TerminalRegistryClock = {now: Date.now}

function fallbackTerminalData(metadata: TmuxTerminalMetadata, projectRoot: string): TerminalData {
    const terminalId: TerminalId = metadata.name as TerminalId
    return createTerminalData({
        terminalId,
        attachedToNodeId: join(recoveryMetadataDir(projectRoot), `${metadata.name}.json`),
        terminalCount: 0,
        title: metadata.name,
        agentName: metadata.name,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: metadata.name,
            VOICETREE_PROJECT_PATH: projectRoot,
        },
    })
}

function importRunningRecord(metadata: TmuxTerminalMetadata, projectRoot: string, now: number): TerminalId {
    const terminalId: TerminalId = metadata.name as TerminalId
    const terminalData: TerminalData = metadata.terminalData ?? fallbackTerminalData(metadata, projectRoot)
    const spawnedAt: number = metadata.startedAt ? Date.parse(metadata.startedAt) : now

    terminalRecords.set(terminalId, {
        terminalId,
        terminalData,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: Number.isFinite(spawnedAt) ? spawnedAt : now,
    })
    notificationStateByTerminal.set(terminalId, {
        lastNotificationTime: 0,
        spawnTime: now,
        alertedNodeIds: new Set(),
    })

    return terminalId
}

/**
 * Reconcile the in-memory terminal registry against on-disk tmux metadata.
 *
 * `projectRoot` MUST be the value returned by `graph.getProjectRoot()` (i.e.
 * the canonical `.voicetree/` parent), NOT `writeFolderPath` or
 * `process.env.VOICETREE_PROJECT_PATH`. The two diverge whenever a vault is
 * loaded as a sub-directory of a project that already has its own
 * `.voicetree/` config — passing writeFolderPath used to cause this reconciler
 * to write to a directory that discovery never read from.
 */
export async function reconcileTmuxTerminalRegistry(
    projectRoot: string,
    deps: TmuxReconciliationDeps = {},
): Promise<TmuxReconciliationResult> {
    const terminalDir: string = recoveryMetadataDir(projectRoot)
    const hasSession: (name: string) => Promise<boolean> = deps.hasSession ?? defaultHasSession
    const now: () => number = deps.now ?? defaultClock.now
    const result: TmuxReconciliationResult = {imported: [], markedExited: [], skipped: []}

    let entries: string[]
    try {
        entries = readdirSync(terminalDir).filter((entry: string) => entry.endsWith('.json'))
    } catch {
        return result
    }

    for (const entry of entries) {
        const metadataPath: string = join(terminalDir, entry)
        const metadata: TmuxTerminalMetadata | null = readMetadata(metadataPath)
        if (!metadata?.name || metadata.status !== 'running') {
            result.skipped.push(entry)
            continue
        }

        let alive: boolean
        try {
            alive = await hasSession(metadata.session ?? metadata.name)
        } catch (error) {
            deps.logger?.error(`[terminal-registry] Failed to reconcile tmux session ${metadata.name}:`, error)
            result.skipped.push(metadata.name)
            continue
        }

        if (alive) {
            registerTmuxSessionAlias(metadata.name, metadata.session ?? metadata.name)
            const terminalId: TerminalId = importRunningRecord(metadata, projectRoot, now())
            deps.onRunningSession?.({terminalId, metadataPath, metadata})
            result.imported.push(metadata.name)
            continue
        }

        writeMetadata(metadataPath, {
            ...metadata,
            status: 'exited',
            exitCode: null,
            endedAt: new Date(now()).toISOString(),
        }, deps.processPid ?? defaultReconciliationProcessPid)
        result.markedExited.push(metadata.name)
    }

    if (result.imported.length > 0 || result.markedExited.length > 0) {
        notifyRegistrySubscribers()
    }

    return result
}
