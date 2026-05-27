import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import type {TerminalData, TerminalId} from './types'
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
        attachedToNodeId: `${projectRoot}/.voicetree/terminals/${metadata.name}.json`,
        terminalCount: 0,
        title: metadata.name,
        agentName: metadata.name,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: metadata.name,
            VOICETREE_VAULT_PATH: projectRoot,
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

export async function reconcileTmuxTerminalRegistry(
    projectRoot: string,
    deps: TmuxReconciliationDeps = {},
): Promise<TmuxReconciliationResult> {
    const terminalDir: string = join(projectRoot, '.voicetree', 'terminals')
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
