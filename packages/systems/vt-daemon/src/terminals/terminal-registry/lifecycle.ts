import {classifyExit} from '@vt/vt-daemon/agent-lifecycle'
import {recordTierEvent} from '@vt/vt-daemon/agent-lifecycle'
import type {AgentEventKind, TerminalLifecycle, TerminalKillReason} from '@vt/vt-daemon/agent-lifecycle'
import {updateTerminalIsDoneWorkflow} from '../workflows/terminalIsDone.ts'
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

function lifecycleFromAgentEvent(
    record: TerminalRecord,
    kind: AgentEventKind,
): TerminalLifecycle {
    const orchestratorWithChildren: boolean = hasActiveChildren(terminalRecords.values(), record.terminalId)
    switch (kind) {
        case 'awaiting':
            return orchestratorWithChildren ? 'idle' : 'awaiting_input'
        case 'working':
            return 'active'
        case 'done':
            // Tier-1 done = agent self-reported task complete (for example,
            // Claude Code Stop fires at turn end). Treat it as awaiting user
            // input unless this terminal is currently orchestrating children.
            return orchestratorWithChildren ? 'idle' : 'awaiting_input'
    }
}

/**
 * Apply a lifecycle event from an agent hook (Claude Code, Codex) or SDK.
 * This is the sole driver of `awaiting_input`; sticky terminal states are
 * preserved because exit always wins.
 */
export function updateTerminalAgentEvent(terminalId: string, kind: AgentEventKind): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    recordTierEvent({
        ts: Date.now(),
        terminalId,
        agentTypeName: record.terminalData.agentTypeName ?? '',
        kind,
    })

    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    if (currentLifecycle === 'completed' || currentLifecycle === 'errored') {
        return
    }

    const nextLifecycle: TerminalLifecycle = lifecycleFromAgentEvent(record, kind)
    if (nextLifecycle === currentLifecycle) {
        return
    }

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: { ...record.terminalData, lifecycle: nextLifecycle },
    })
    notifyRegistrySubscribers()
}
