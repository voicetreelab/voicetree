import type {TerminalData} from '../../types'
import {sendTextToTerminal} from '../../inject/send-text-to-terminal'
import {
    notificationStateByTerminal,
    pendingTerminals,
    terminalRecords,
    type PendingTerminal,
    type TerminalRegistryClock,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'

export function recordTerminalSpawn(
    terminalId: string,
    terminalData: TerminalData,
    clock: TerminalRegistryClock = { now: Date.now },
): void {
    // Capture-and-clear any pending state so the drain below is the last
    // observer of the queue (no race with concurrent enqueues that arrive
    // between the spawn-record and the drain).
    const pending: PendingTerminal | undefined = pendingTerminals.get(terminalId)
    pendingTerminals.delete(terminalId)

    terminalRecords.set(terminalId, {
        terminalId,
        terminalData,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: clock.now()
    })

    notificationStateByTerminal.set(terminalId, {
        lastNotificationTime: 0,
        spawnTime: clock.now(),
        alertedNodeIds: new Set()
    })

    notifyRegistrySubscribers()

    // Drain queued messages from the pending phase (if any). sendTextToTerminal
    // serializes per-terminal and has its own preamble delays, so it tolerates
    // being called the moment a PTY is registered.
    if (pending && pending.queuedMessages.length > 0) {
        for (const queued of pending.queuedMessages) {
            void sendTextToTerminal(terminalId, queued)
        }
    }
}
