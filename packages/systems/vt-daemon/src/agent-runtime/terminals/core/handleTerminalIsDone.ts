import type {Command} from '../domain/command.ts'
import type {
    TerminalLifecycle,
    TerminalRecord,
    TerminalRegistrySnapshot,
} from '../domain/session.ts'

export type TerminalIsDoneInput = {
    isDone: boolean
    records: TerminalRegistrySnapshot
    now: number
    stopHookDelayMs: number
}

export type TerminalIsDoneResponse = {
    lifecycle: TerminalLifecycle
}

export function handleTerminalIsDone(
    record: TerminalRecord,
    input: TerminalIsDoneInput,
): { state: TerminalRecord; commands: Command[]; response: TerminalIsDoneResponse } {
    const wasNotDone: boolean = !record.terminalData.isDone
    const lifecycle: TerminalLifecycle = lifecycleFromDoneSignal(record, input.isDone, input.records)
    const nextRecord: TerminalRecord = {
        ...record,
        terminalData: {...record.terminalData, isDone: input.isDone, lifecycle},
    }
    const commands: Command[] = [
        {type: 'SetTerminalRecord', terminalId: record.terminalId, record: nextRecord},
        {type: 'NotifyRegistrySubscribers'},
    ]

    if (wasNotDone && input.isDone) {
        commands.push(
            {type: 'SetIdleSince', terminalId: record.terminalId, time: input.now},
            {
                type: 'ScheduleIdleHooks',
                terminalId: record.terminalId,
                record: nextRecord,
                delayMs: input.stopHookDelayMs,
            },
        )
    } else if (!input.isDone) {
        commands.push(
            {type: 'DeleteIdleSince', terminalId: record.terminalId},
            {type: 'CancelPendingNotification', terminalId: record.terminalId},
        )
    }

    return {
        state: nextRecord,
        commands,
        response: {lifecycle},
    }
}

function lifecycleFromDoneSignal(
    record: TerminalRecord,
    isDone: boolean,
    records: TerminalRegistrySnapshot,
): TerminalLifecycle {
    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    if (currentLifecycle === 'completed' || currentLifecycle === 'errored' || currentLifecycle === 'awaiting_input') {
        return currentLifecycle
    }
    if (isDone && hasActiveChildren(records, record.terminalId)) {
        return 'idle'
    }
    return isDone ? currentLifecycle : 'active'
}

function hasActiveChildren(records: TerminalRegistrySnapshot, terminalId: string): boolean {
    for (const r of records) {
        if (r.terminalData.parentTerminalId === terminalId && r.status !== 'exited') {
            return true
        }
    }
    return false
}
