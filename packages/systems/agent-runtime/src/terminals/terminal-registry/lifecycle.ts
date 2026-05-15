import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getRuntimeGraph} from '@vt/agent-runtime/runtime/graph-bridge'
import {classifyExit} from '@vt/agent-runtime/lifecycle'
import {recordTierEvent} from '@vt/agent-runtime/lifecycle'
import type {AgentEventKind, TerminalLifecycle, TerminalKillReason} from '@vt/agent-runtime/lifecycle'
import {runIdleStopGateAudit} from '../terminal-registry-audit'
import {notifyAgentOfUnseenNodes} from '../terminal-registry-notifications'
import {
    STOP_HOOK_DELAY_MS,
    hasActiveChildren,
    idleSinceByTerminal,
    pendingNotificationTimeouts,
    terminalRecords,
    type TerminalRecord,
    type TerminalRegistryRuntime,
    type TerminalRegistryTimers,
} from '../terminal-registry-state'
import {getTerminalRecords, notifyRegistrySubscribers} from './subscribers'

const defaultTerminalRegistryTimers: TerminalRegistryTimers = { setTimeout, clearTimeout }

const defaultTerminalRegistryRuntime: TerminalRegistryRuntime = {
    now: Date.now,
    setTimeout,
    clearTimeout,
    logger: { info: console.log, error: console.error },
}

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

/**
 * Wait N seconds, then check if the terminal is still idle before firing callback.
 * Cancels any pending timeout for this terminal if it becomes active again.
 */
function wait_for_agent_to_still_be_done_after_n_seconds(
    terminalId: string,
    delayMs: number,
    callback: (terminalId: string, record: TerminalRecord) => void,
    timers: TerminalRegistryTimers = defaultTerminalRegistryTimers,
): void {
    const existing: ReturnType<typeof setTimeout> | undefined = pendingNotificationTimeouts.get(terminalId)
    if (existing) timers.clearTimeout(existing)

    const timeout: ReturnType<typeof setTimeout> = timers.setTimeout(() => {
        pendingNotificationTimeouts.delete(terminalId)
        const currentRecord: TerminalRecord | undefined = terminalRecords.get(terminalId)
        if (currentRecord?.terminalData.isDone) {
            callback(terminalId, currentRecord)
        }
    }, delayMs)
    pendingNotificationTimeouts.set(terminalId, timeout)
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

function lifecycleFromDoneSignal(
    record: TerminalRecord,
    isDone: boolean,
): TerminalLifecycle {
    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    if (currentLifecycle === 'completed' || currentLifecycle === 'errored' || currentLifecycle === 'awaiting_input') {
        return currentLifecycle
    }
    if (isDone && hasActiveChildren(terminalRecords.values(), record.terminalId)) {
        return 'idle'
    }
    return isDone ? currentLifecycle : 'active'
}

function runIdleHooks(
    runtime: TerminalRegistryRuntime,
): (terminalId: string, record: TerminalRecord) => void {
    return (tid, rec) => {
        void (async (): Promise<void> => {
            await runIdleStopGateAudit(tid, rec, {
                records: getTerminalRecords(),
                graph: await getRuntimeGraph(),
                incrementAuditRetryCount,
                logger: runtime.logger,
            })
        })().catch((error: unknown) => {
            runtime.logger.error('[terminal-registry] Failed to run idle stop-gate audit:', error)
        })

        void loadSettings()
            .then((settings: VTSettings) => {
                if (settings.autoNotifyUnseenNodes) {
                    void notifyAgentOfUnseenNodes(tid, rec, {
                        now: runtime.now,
                        logger: runtime.logger,
                    })
                }
            })
            .catch((error: unknown) => {
                runtime.logger.error('[terminal-registry] Failed to load settings for unseen-node notification:', error)
            })
    }
}

export function updateTerminalIsDone(
    terminalId: string,
    isDone: boolean,
    runtime: TerminalRegistryRuntime = defaultTerminalRegistryRuntime,
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    // The UI lifecycle is not derived from heuristic silence: natural pauses
    // from Claude Code / Codex should not surface as idle unless a parent is
    // waiting on active children.
    const wasNotDone: boolean = !record.terminalData.isDone
    const lifecycle: TerminalLifecycle = lifecycleFromDoneSignal(record, isDone)

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isDone, lifecycle}
    })
    notifyRegistrySubscribers()

    if (wasNotDone && isDone) {
        idleSinceByTerminal.set(terminalId, runtime.now())
        wait_for_agent_to_still_be_done_after_n_seconds(
            terminalId,
            STOP_HOOK_DELAY_MS,
            runIdleHooks(runtime),
            {setTimeout: runtime.setTimeout, clearTimeout: runtime.clearTimeout},
        )
    } else if (!isDone) {
        idleSinceByTerminal.delete(terminalId)
        cancelPendingNotification(terminalId, { clearTimeout: runtime.clearTimeout })
    }
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
            // Tier-1 done = agent self-reported task complete (e.g. Claude Code
            // Stop hook fires at end of every turn). Treat as awaiting_input —
            // a turn ending means the agent is now blocking on the user, not
            // that the PTY has exited (that's markTerminalExited's job).
            // Orchestrators with active children still go idle.
            return orchestratorWithChildren ? 'idle' : 'awaiting_input'
    }
}

/**
 * Apply a lifecycle event from an agent hook (Claude Code, Codex) or the
 * SDK. Sole driver of `awaiting_input`. Sticky terminal states
 * (completed/errored) are preserved — exit always wins.
 */
export function updateTerminalAgentEvent(terminalId: string, kind: AgentEventKind): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    // Telemetry: every hook firing recorded regardless of whether it
    // changes the lifecycle (useful for spotting agents that fire hooks
    // VoiceTree isn't auto-installing for, or hooks that mis-fire).
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
        terminalData: {...record.terminalData, lifecycle: nextLifecycle},
    })
    notifyRegistrySubscribers()
}
