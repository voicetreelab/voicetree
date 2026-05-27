import type {TerminalData} from './types'
import {sendTextToTerminal} from '@vt/vt-daemon/agent-runtime/inject/send-text-to-terminal.ts'
import {publishTerminalRegistryEvent} from './terminal-registry-publisher'
import {
    notificationStateByTerminal,
    pendingTerminals,
    terminalRecords,
    type PendingTerminal,
    type TerminalRecord,
    type TerminalRegistryClock,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'

const defaultTerminalRegistryClock: TerminalRegistryClock = { now: Date.now }

export function recordTerminalSpawn(
    terminalId: string,
    terminalData: TerminalData,
    clock: TerminalRegistryClock = defaultTerminalRegistryClock,
): void {
    // Capture-and-clear any pending state so the drain below is the last
    // observer of the queue (no race with concurrent enqueues that arrive
    // between the spawn-record and the drain).
    const pending: PendingTerminal | undefined = pendingTerminals.get(terminalId)
    pendingTerminals.delete(terminalId)

    const record: TerminalRecord = {
        terminalId,
        terminalData,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: clock.now()
    }
    terminalRecords.set(terminalId, record)

    notificationStateByTerminal.set(terminalId, {
        lastNotificationTime: 0,
        spawnTime: clock.now(),
        alertedNodeIds: new Set()
    })

    notifyRegistrySubscribers()
    publishTerminalRegistryEvent({type: 'terminal-registered', record})

    // Drain queued messages from the pending phase (if any). sendTextToTerminal
    // serializes per-terminal and has its own preamble delays, so it tolerates
    // being called the moment a PTY is registered.
    if (pending && pending.queuedMessages.length > 0) {
        for (const queued of pending.queuedMessages) {
            void sendTextToTerminal(terminalId, queued)
        }
    }
}
