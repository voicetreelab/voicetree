import {classifyExit} from '@vt/agent-runtime/lifecycle'
import type {TerminalLifecycle, TerminalKillReason} from '@vt/agent-runtime/lifecycle'
import {updateTerminalIsDoneWorkflow} from '@vt/agent-runtime/terminals/terminalIsDoneWorkflow.ts'
import {
    hasActiveChildren,
    pendingNotificationTimeouts,
    terminalRecords,
    type TerminalRecord,
    type TerminalRegistryRuntime,
    type TerminalRegistryTimers,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'

export function incrementAuditRetryCount(terminalId: string): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, { ...record, auditRetryCount: record.auditRetryCount + 1 })
}

export function resetAuditRetryCount(terminalId: string): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record || record.auditRetryCount === 0) return
    terminalRecords.set(terminalId, { ...record, auditRetryCount: 0 })
}

export function cancelPendingNotification(
    terminalId: string,
    timers: Pick<TerminalRegistryTimers, 'clearTimeout'> = { clearTimeout },
): void {
    const existing: ReturnType<typeof setTimeout> | undefined = pendingNotificationTimeouts.get(terminalId)
    if (existing) {
        timers.clearTimeout(existing)
        pendingNotificationTimeouts.delete(terminalId)
    }
}

export function updateTerminalIsDone(
    terminalId: string,
    isDone: boolean,
    runtime?: TerminalRegistryRuntime,
): void {
    updateTerminalIsDoneWorkflow(terminalId, isDone, runtime)
}

export function markTerminalExited(
    terminalId: string,
    exitCode?: number | null,
    exitSignal?: string | null,
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    const lifecycle: TerminalLifecycle = classifyExit(
        exitCode ?? null,
        exitSignal ?? null,
        record.killReason,
    )
    terminalRecords.set(terminalId, {
        ...record,
        status: 'exited',
        exitCode: exitCode ?? null,
        exitSignal: exitSignal ?? null,
        terminalData: { ...record.terminalData, lifecycle, isDone: true },
    })
    notifyRegistrySubscribers()
}

/**
 * Record that VoiceTree itself initiated a termination (close button, /kill, etc.)
 * Must be called BEFORE the kill signal is sent so the subsequent exit event
 * classifies as `completed` rather than `errored`.
 */
export function markTerminalKillReason(terminalId: string, reason: TerminalKillReason): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, { ...record, killReason: reason })
    // No subscriber notify — this is a transient flag, not visible state.
}

function lifecycleFromPromptDetection(record: TerminalRecord, detected: boolean): TerminalLifecycle {
    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    const orchestratorWithChildren: boolean = hasActiveChildren(terminalRecords.values(), record.terminalId)

    if (detected) {
        return orchestratorWithChildren ? 'idle' : 'awaiting_input'
    }
    if (orchestratorWithChildren) {
        return 'idle'
    }
    // Clearing: fall back to 'active'. We deliberately do NOT honour the
    // heuristic `isDone` flag here — see updateTerminalIsDone for why time-
    // based silence is not a reliable "idle" signal.
    return currentLifecycle === 'active' ? currentLifecycle : 'active'
}

/**
 * Set or clear the prompt-detected flag for a terminal. Drives the
 * `awaiting_input` lifecycle state. Sticky terminal states (completed/errored)
 * are preserved — exit always wins.
 */
export function updateTerminalPromptDetected(terminalId: string, detected: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    if (currentLifecycle === 'completed' || currentLifecycle === 'errored') {
        return
    }

    const nextLifecycle: TerminalLifecycle = lifecycleFromPromptDetection(record, detected)
    if (nextLifecycle === currentLifecycle) {
        return
    }

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: { ...record.terminalData, lifecycle: nextLifecycle },
    })
    notifyRegistrySubscribers()
}
