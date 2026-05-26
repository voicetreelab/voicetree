import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {TerminalRecord, TerminalStatus} from '@vt/vt-daemon-protocol'

// `TerminalRecord` / `TerminalStatus` are canonically owned by
// `@vt/vt-daemon-protocol` (BF-376 outbound). Re-export so existing
// in-package consumers (queries, reconciliation, the registry barrel)
// keep their import path. The runtime state (the Maps, listeners,
// timers, helper accessors below) stays here.
export type {TerminalRecord, TerminalStatus}

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
