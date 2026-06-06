import {classifyExit} from '@vt/vt-daemon/agent-runtime/lifecycle'
import {recordTierEvent} from '@vt/vt-daemon/agent-runtime/lifecycle'
import type {TerminalLifecycle, TerminalKillReason} from '@vt/vt-daemon/agent-runtime/lifecycle'
import {updateTerminalIsDoneWorkflow} from '../workflows/terminalIsDone.ts'
import {
    pendingNotificationTimeouts,
    terminalRecords,
    type TerminalRecord,
    type TerminalRegistryRuntime,
    type TerminalRegistryTimers,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'
import {publishTerminalRegistryEvent} from './terminal-registry-publisher'
import {STATUS_PHRASE_MAX_LEN, type AgentStatusPreset, type TerminalId} from '@vt/vt-daemon-protocol'

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

export type AgentStatusDeclaration = {
    readonly statusPreset: AgentStatusPreset | undefined
    readonly liveStatus: string | undefined
}

/** Trim a free-text status phrase to the wire cap, collapsing surrounding whitespace. */
function normalizeLiveStatus(phrase: string | undefined): string | undefined {
    if (phrase === undefined) return undefined
    const trimmed: string = phrase.trim()
    if (trimmed === '') return undefined
    return trimmed.length > STATUS_PHRASE_MAX_LEN ? trimmed.slice(0, STATUS_PHRASE_MAX_LEN) : trimmed
}

/**
 * Apply an agent-declared status (preset + live phrase) recorded when the
 * agent creates a progress node via `create_graph`. This is the sole source
 * of `statusPreset` / `liveStatus`. Independent of `lifecycle` (pure PTY/exit
 * liveness) — both surface together in the sidebar. Sticky terminal lifecycle
 * states do not block status updates; an exited agent can still carry a final
 * `done` preset.
 */
export function updateTerminalStatus(terminalId: string, declaration: AgentStatusDeclaration): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    const statusPreset: AgentStatusPreset | undefined = declaration.statusPreset
    const liveStatus: string | undefined = normalizeLiveStatus(declaration.liveStatus)
    if (statusPreset === undefined && liveStatus === undefined) return

    const statusUpdatedAt: number = Date.now()

    if (statusPreset !== undefined) {
        recordTierEvent({
            ts: statusUpdatedAt,
            terminalId,
            agentTypeName: record.terminalData.agentTypeName ?? '',
            kind: statusPreset,
        })
    }

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, statusPreset, liveStatus, statusUpdatedAt},
    })
    notifyRegistrySubscribers()
    // Status transitions never flow through the renderer's output poller, so
    // they must be broadcast explicitly — otherwise the sidebar glyph + phrase
    // stay frozen at their last value.
    publishTerminalRegistryEvent({
        type: 'terminal-record-changed',
        terminalId: terminalId as TerminalId,
        patch: {kind: 'status', value: {statusPreset, liveStatus, statusUpdatedAt}},
    })
}
