import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {TerminalData} from '../types'
import type {TerminalKillReason} from '../lifecycle/types'

export type TerminalStatus = 'running' | 'exited'

export type TerminalRecord = {
    terminalId: string
    terminalData: TerminalData
    status: TerminalStatus
    exitCode: number | null
    exitSignal: string | null
    // Set by VoiceTree before issuing a kill signal so the subsequent exit event
    // classifies as `completed` rather than `errored`.
    killReason: TerminalKillReason | null
    // Stop gate (BF-024): genuinely stateful — tracks resume attempts across agent restarts
    auditRetryCount: number
    spawnedAt: number
}

export type PendingTerminal = {
    isHeadless: boolean
    queuedMessages: string[]
}

export type UnseenNodesNotificationState = {
    lastNotificationTime: number
    spawnTime: number
    alertedNodeIds: Set<NodeIdAndFilePath>
}

export type TerminalRegistryLogger = {
    info(message?: unknown, ...optionalParams: unknown[]): void
    error(message?: unknown, ...optionalParams: unknown[]): void
}

export type TerminalRegistryClock = {
    now(): number
}

export type TerminalRegistryTimers = {
    setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
    clearTimeout(timeout: ReturnType<typeof setTimeout>): void
}

export type TerminalRegistryRuntime = TerminalRegistryClock & TerminalRegistryTimers & {
    logger: TerminalRegistryLogger
}

export type RegistryListener = (records: TerminalRecord[]) => void

export const NOTIFICATION_COOLDOWN_MS: number = 5 * 60 * 1000
export const STOP_HOOK_DELAY_MS: number = 30 * 1000

export const terminalRecords: Map<string, TerminalRecord> = new Map()
export const pendingTerminals: Map<string, PendingTerminal> = new Map()
export const notificationStateByTerminal: Map<string, UnseenNodesNotificationState> = new Map()
export const pendingNotificationTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
export const idleSinceByTerminal: Map<string, number> = new Map()
export const listeners: Set<RegistryListener> = new Set()

export function hasActiveChildren(records: Iterable<TerminalRecord>, terminalId: string): boolean {
    for (const r of records) {
        if (r.terminalData.parentTerminalId === terminalId && r.status !== 'exited') {
            return true
        }
    }
    return false
}
