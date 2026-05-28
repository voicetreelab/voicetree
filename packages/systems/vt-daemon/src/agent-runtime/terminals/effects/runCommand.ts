import type {Command} from '../domain/command.ts'
import type {TerminalRecord, TerminalRegistryTimers} from '../domain/session.ts'
import {
    idleSinceByTerminal,
    pendingNotificationTimeouts,
    terminalRecords,
} from '../terminal-registry-state.ts'
import {notifyRegistrySubscribers} from '../terminal-registry/subscribers.ts'

export type RunCommandDeps = {
    timers: TerminalRegistryTimers
    onStillDone: (terminalId: string, record: TerminalRecord) => void
}

export function runCommand(command: Command, deps: RunCommandDeps): void {
    switch (command.type) {
        case 'SetTerminalRecord':
            terminalRecords.set(command.terminalId, command.record)
            return
        case 'NotifyRegistrySubscribers':
            notifyRegistrySubscribers()
            return
        case 'SetIdleSince':
            idleSinceByTerminal.set(command.terminalId, command.time)
            return
        case 'DeleteIdleSince':
            idleSinceByTerminal.delete(command.terminalId)
            return
        case 'ScheduleIdleHooks': {
            const existing: ReturnType<typeof setTimeout> | undefined = pendingNotificationTimeouts.get(command.terminalId)
            if (existing) deps.timers.clearTimeout(existing)

            const timeout: ReturnType<typeof setTimeout> = deps.timers.setTimeout(() => {
                pendingNotificationTimeouts.delete(command.terminalId)
                const currentRecord: TerminalRecord | undefined = terminalRecords.get(command.terminalId)
                if (currentRecord?.terminalData.isDone) {
                    deps.onStillDone(command.terminalId, currentRecord)
                }
            }, command.delayMs)
            pendingNotificationTimeouts.set(command.terminalId, timeout)
            return
        }
        case 'CancelPendingNotification': {
            const existing: ReturnType<typeof setTimeout> | undefined = pendingNotificationTimeouts.get(command.terminalId)
            if (existing) {
                deps.timers.clearTimeout(existing)
                pendingNotificationTimeouts.delete(command.terminalId)
            }
            return
        }
        default: {
            const _exhaustive: never = command
            return _exhaustive
        }
    }
}
