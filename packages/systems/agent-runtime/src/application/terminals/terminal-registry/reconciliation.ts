import {randomUUID} from 'node:crypto'
import {readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {TerminalData, TerminalId} from './types'
import {createTerminalData} from './types'
import {
    notificationStateByTerminal,
    terminalRecords,
    type TerminalRegistryClock,
    type TerminalRegistryLogger,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'
import {hasSession as defaultHasSession, registerTmuxSessionAlias} from '../tmux-session-manager'

type TmuxTerminalMetadata = {
    readonly name: string
    readonly status: 'running' | 'exited'
    readonly pid?: number
    readonly session?: string
    readonly startedAt?: string
    readonly endedAt?: string
    readonly exitCode?: number | null
    readonly exitCodeFile?: string
    readonly logFile?: string
    readonly terminalData?: TerminalData
}

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
}

const defaultClock: TerminalRegistryClock = {now: Date.now}

function readMetadata(path: string): TmuxTerminalMetadata | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as TmuxTerminalMetadata
    } catch {
        return null
    }
}

function writeMetadata(path: string, metadata: TmuxTerminalMetadata): void {
    const tempPath: string = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    renameSync(tempPath, path)
}

function fallbackTerminalData(metadata: TmuxTerminalMetadata, vaultPath: string): TerminalData {
    const terminalId: TerminalId = metadata.name as TerminalId
    return createTerminalData({
        terminalId,
        attachedToNodeId: `${vaultPath}/.voicetree/terminals/${metadata.name}.json`,
        terminalCount: 0,
        title: metadata.name,
        agentName: metadata.name,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: metadata.name,
            VOICETREE_VAULT_PATH: vaultPath,
        },
    })
}

function importRunningRecord(metadata: TmuxTerminalMetadata, vaultPath: string, now: number): TerminalId {
    const terminalId: TerminalId = metadata.name as TerminalId
    const terminalData: TerminalData = metadata.terminalData ?? fallbackTerminalData(metadata, vaultPath)
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
    vaultPath: string,
    deps: TmuxReconciliationDeps = {},
): Promise<TmuxReconciliationResult> {
    const terminalDir: string = join(vaultPath, '.voicetree', 'terminals')
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
            const terminalId: TerminalId = importRunningRecord(metadata, vaultPath, now())
            deps.onRunningSession?.({terminalId, metadataPath, metadata})
            result.imported.push(metadata.name)
            continue
        }

        writeMetadata(metadataPath, {
            ...metadata,
            status: 'exited',
            exitCode: null,
            endedAt: new Date(now()).toISOString(),
        })
        result.markedExited.push(metadata.name)
    }

    if (result.imported.length > 0 || result.markedExited.length > 0) {
        notifyRegistrySubscribers()
    }

    return result
}
