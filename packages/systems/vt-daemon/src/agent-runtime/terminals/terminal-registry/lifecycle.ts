import {classifyExit} from '@vt/vt-daemon/agent-runtime/lifecycle'
import {recordTierEvent} from '@vt/vt-daemon/agent-runtime/lifecycle'
import type {TerminalLifecycle, TerminalKillReason} from '@vt/vt-daemon/agent-runtime/lifecycle'
import {deriveTerminalInputStarted} from '../core/handleTerminalInputStarted.ts'
// Re-exported as part of the terminal-registry input surface: the tmux relay
// accumulates raw keystrokes with these before handing a completed line to
// `markTerminalInputStarted`, so it depends on this surface rather than reaching
// into the core handler module directly.
export {
    advanceTerminalInputLine,
    EMPTY_TERMINAL_INPUT_LINE_BUFFER,
    type TerminalInputLineBuffer,
} from '../core/handleTerminalInputStarted.ts'
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
import {publishTerminalRegistryEvent} from './terminal-registry-publisher'
import {type AgentStatus, MAX_STATUS_PHRASE_LENGTH, type TerminalId} from '@vt/vt-daemon-protocol'

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

export function markTerminalInputStarted(
    terminalId: string,
    inputText: string,
    nowMs: number = Date.now(),
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    const result = deriveTerminalInputStarted(record, inputText, nowMs)
    if (!result.changed) return

    terminalRecords.set(terminalId, result.record)
    notifyRegistrySubscribers()
    for (const patch of result.patches) {
        publishTerminalRegistryEvent({
            type: 'terminal-record-changed',
            terminalId: terminalId as TerminalId,
            patch,
        })
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
    // Broadcast the terminal-state transition (completed/errored) to SSE
    // consumers — `notifyRegistrySubscribers` only reaches in-daemon
    // listeners, not the renderer's cache mirror in the Electron process.
    publishTerminalRegistryEvent({
        type: 'terminal-record-changed',
        terminalId: terminalId as TerminalId,
        patch: {kind: 'lifecycle', value: lifecycle},
    })
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

function lifecycleFromAgentStatus(
    record: TerminalRecord,
    preset: AgentStatus,
): TerminalLifecycle {
    // An orchestrator with active children is waiting on those children, not on
    // the user — its awaiting_input/done preset surfaces as orange 'idle'
    // standby rather than blue 'awaiting_input' or sticky 'completed'.
    const orchestratorWithChildren: boolean = hasActiveChildren(terminalRecords.values(), record.terminalId)
    switch (preset) {
        case 'working':
            return 'active'
        case 'awaiting_input':
            return orchestratorWithChildren ? 'idle' : 'awaiting_input'
        case 'done':
            return orchestratorWithChildren ? 'idle' : 'completed'
        case 'failed':
            return 'errored'
    }
}

export type AgentStatusUpdate = {
    readonly preset?: AgentStatus
    readonly phrase?: string
}

/**
 * Apply an agent-authored status to a terminal. An agent reports this when it
 * creates a progress node (`create_graph`): a typed `preset` driving the
 * lifecycle icon, and/or a free-text `phrase` shown next to the model name in
 * the terminal tree. This is now the SOLE driver of `awaiting_input` (the CLI
 * hook adapter is gone). Sticky terminal states (completed/errored) are never
 * overridden by a preset — process exit always wins.
 *
 * Both fields are optional and independent; a single mutation + at most one
 * notify is performed, with a patch broadcast per field that actually changed.
 */
export function applyAgentStatus(terminalId: string, update: AgentStatusUpdate): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    const isSticky: boolean = currentLifecycle === 'completed' || currentLifecycle === 'errored'

    let nextLifecycle: TerminalLifecycle = currentLifecycle
    let nextReportedStatus: AgentStatus | null = record.terminalData.lastReportedStatus
    if (update.preset !== undefined && !isSticky) {
        recordTierEvent({
            ts: Date.now(),
            terminalId,
            agentTypeName: record.terminalData.agentTypeName ?? '',
            kind: update.preset,
        })
        nextLifecycle = lifecycleFromAgentStatus(record, update.preset)
        // Record what the agent *declared*, independent of the orchestrator
        // downgrade that may render done/awaiting as idle. The finish gate reads
        // this — so e.g. an orchestrator that reported `done` (lifecycle stays
        // `idle`) must still persist `done` here even though no lifecycle change
        // would otherwise be written below.
        nextReportedStatus = update.preset
    }

    const nextPhrase: string | undefined = update.phrase === undefined
        ? undefined
        : update.phrase.slice(0, MAX_STATUS_PHRASE_LENGTH)

    const lifecycleChanged: boolean = nextLifecycle !== currentLifecycle
    const phraseChanged: boolean = nextPhrase !== undefined && nextPhrase !== record.terminalData.statusPhrase
    const reportedStatusChanged: boolean = nextReportedStatus !== record.terminalData.lastReportedStatus
    if (!lifecycleChanged && !phraseChanged && !reportedStatusChanged) return

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {
            ...record.terminalData,
            ...(lifecycleChanged ? {lifecycle: nextLifecycle} : {}),
            ...(phraseChanged ? {statusPhrase: nextPhrase, statusPhraseUpdatedAt: Date.now()} : {}),
            ...(reportedStatusChanged ? {lastReportedStatus: nextReportedStatus} : {}),
        },
    })
    notifyRegistrySubscribers()
    // Status transitions never flow through the renderer poller, so they must be
    // broadcast explicitly — otherwise the sidebar freezes at its last
    // output-driven value.
    if (lifecycleChanged) {
        publishTerminalRegistryEvent({
            type: 'terminal-record-changed',
            terminalId: terminalId as TerminalId,
            patch: {kind: 'lifecycle', value: nextLifecycle},
        })
    }
    if (phraseChanged) {
        publishTerminalRegistryEvent({
            type: 'terminal-record-changed',
            terminalId: terminalId as TerminalId,
            patch: {kind: 'statusPhrase', value: nextPhrase as string},
        })
    }
}
