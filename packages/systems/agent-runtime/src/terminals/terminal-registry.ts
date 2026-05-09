import * as O from 'fp-ts/lib/Option.js'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {sendTextToTerminal} from '../inject/send-text-to-terminal'
import {getRuntimeGraph} from '../runtime/graph-bridge'

import type {TerminalData} from '../types';
import {loadSettings} from '@vt/app-config/settings';
import {clearBudget} from './global-budget-registry'
import {classifyExit} from '../lifecycle/exit'
import type {TerminalLifecycle, TerminalKillReason} from '../lifecycle/types'
import {runIdleStopGateAudit} from './terminal-registry-audit'
import {notifyAgentOfUnseenNodes} from './terminal-registry-notifications'
import {
    STOP_HOOK_DELAY_MS,
    hasActiveChildren,
    idleSinceByTerminal,
    listeners,
    notificationStateByTerminal,
    pendingNotificationTimeouts,
    pendingTerminals,
    terminalRecords,
    type PendingTerminal,
    type RegistryListener,
    type TerminalRecord,
    type TerminalRegistryClock,
    type TerminalRegistryRuntime,
    type TerminalRegistryTimers,
} from './terminal-registry-state'
export type {TerminalRecord, TerminalStatus} from './terminal-registry-state'

export function subscribeToRegistry(listener: RegistryListener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

function notifyRegistrySubscribers(): void {
    if (listeners.size === 0) return
    const snapshot: TerminalRecord[] = getTerminalRecords()
    for (const listener of listeners) listener(snapshot)
}

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

    // Initialize notification tracking state for this terminal
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

/**
 * Reserve a terminalId before its PTY/process exists. Used by spawn_agent
 * to return its MCP response early while terminal prep runs in the background.
 *
 * No-op if the terminal is already registered (running) — the running record
 * wins. The pending entry is cleared on recordTerminalSpawn or
 * clearPendingTerminal (e.g. on spawn failure).
 */
export function recordTerminalPending(terminalId: string, isHeadless: boolean): void {
    if (terminalRecords.has(terminalId)) return
    if (pendingTerminals.has(terminalId)) return
    pendingTerminals.set(terminalId, { isHeadless, queuedMessages: [] })
}

export function getPendingTerminal(terminalId: string): { readonly isHeadless: boolean } | undefined {
    const pending: PendingTerminal | undefined = pendingTerminals.get(terminalId)
    return pending ? { isHeadless: pending.isHeadless } : undefined
}

/**
 * Queue a (pre-formatted) message for a pending terminal. Messages are sent
 * via sendTextToTerminal in arrival order during recordTerminalSpawn.
 *
 * Returns true if queued, false if the terminal isn't pending (caller should
 * fall through to the normal send path or surface a "not found" error).
 */
export function enqueuePendingMessage(terminalId: string, prefixedMessage: string): boolean {
    const pending: PendingTerminal | undefined = pendingTerminals.get(terminalId)
    if (!pending) return false
    pending.queuedMessages.push(prefixedMessage)
    return true
}

/**
 * Drop a pending terminal entry without draining. For use when async spawn
 * prep fails — the caller's MCP response said success, but follow-up tool
 * calls will now correctly report "Terminal not found".
 */
export function clearPendingTerminal(terminalId: string): void {
    pendingTerminals.delete(terminalId)
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
    timers: TerminalRegistryTimers = { setTimeout, clearTimeout },
): void {
    // Clear any existing pending timeout for this terminal
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

function cancelPendingNotification(
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
    runtime: TerminalRegistryRuntime = {
        now: Date.now,
        setTimeout,
        clearTimeout,
        logger: { info: console.log, error: console.error },
    },
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }

    // Detect transition to idle (isDone: false -> true)
    const wasNotDone: boolean = !record.terminalData.isDone

    // The UI lifecycle is *not* derived from heuristic silence: a 5s pause in
    // PTY output is not a reliable "agent finished" signal for Claude Code or
    // Codex (they have natural multi-second pauses while thinking or running
    // tools), and showing the green ✓ during such a pause is the false-positive
    // the user sees. So:
    //   - isDone=true  → keep current lifecycle (don't surface 'idle').
    //   - isDone=false → mirror to 'active' (output resumed).
    // Sticky terminal states (completed/errored) and awaiting_input are
    // preserved; exit/awaiting wins over heuristic activity flips.
    //
    // Orchestrator standby exception: if the terminal has active children, an
    // isDone=true poller signal means the parent has gone quiet because it's
    // waiting on its sub-agents (e.g. inside wait_for_agents). Surface that as
    // 'idle' (orange standby) so the parent stops spinning amber and the user
    // sees that it's blocked on children — not on user input (which would be
    // BLUE) and not still working (amber spinner).
    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    const lifecycle: TerminalLifecycle = (() => {
        if (currentLifecycle === 'completed' || currentLifecycle === 'errored' || currentLifecycle === 'awaiting_input') {
            return currentLifecycle
        }
        if (isDone && hasActiveChildren(terminalRecords.values(), terminalId)) {
            return 'idle'
        }
        return isDone ? currentLifecycle : 'active'
    })()

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isDone, lifecycle}
    })
    notifyRegistrySubscribers()

    if (wasNotDone && isDone) {
        // Record when idle started — shared source of truth for wait_for_agents and notification hook
        idleSinceByTerminal.set(terminalId, runtime.now())
        // Agent just became idle — wait 30s to confirm it's sustained before firing hooks
        wait_for_agent_to_still_be_done_after_n_seconds(terminalId, STOP_HOOK_DELAY_MS, (tid, rec) => {
            // Stop gate audit: check if idle agent addressed all outgoing workflow obligations
            void runIdleStopGateAudit(tid, rec, {
                records: getTerminalRecords(),
                graph: getRuntimeGraph(),
                incrementAuditRetryCount,
                logger: runtime.logger,
            })

            // Unseen nodes notification (optional, settings-gated)
            void loadSettings()
                .then((settings: import('@vt/graph-model/settings').VTSettings) => {
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
        }, {
            setTimeout: runtime.setTimeout,
            clearTimeout: runtime.clearTimeout,
        })
    } else if (!isDone) {
        // Agent became active again — clear idle timestamp and cancel any pending notification
        idleSinceByTerminal.delete(terminalId)
        cancelPendingNotification(terminalId, { clearTimeout: runtime.clearTimeout })
    }
}

export function updateTerminalMinimized(terminalId: string, isMinimized: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isMinimized}
    })
    notifyRegistrySubscribers()
}

export function updateTerminalPinned(terminalId: string, isPinned: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isPinned}
    })
    notifyRegistrySubscribers()
}

/**
 * Update activity state (lastOutputTime, activityCount) in the registry.
 * Does NOT push to renderer - activity updates happen frequently and
 * should not trigger full re-renders. Renderer tracks this locally.
 */
export function updateTerminalActivityState(
    terminalId: string,
    updates: Partial<Pick<TerminalData, 'lastOutputTime' | 'activityCount'>>
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, ...updates}
    })
    // NOTE: No notifyRegistrySubscribers() - activity updates are high frequency
    // and should not trigger full re-renders. Renderer updates local state directly.
}

export function markTerminalExited(
    terminalId: string,
    exitCode?: number | null,
    exitSignal?: string | null,
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
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
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, { ...record, killReason: reason })
    // No subscriber notify — this is a transient flag, not visible state.
}

/**
 * Set or clear the prompt-detected flag for a terminal. Drives the
 * `awaiting_input` lifecycle state. Sticky terminal states (completed/errored)
 * are preserved — exit always wins.
 *
 * Called by the Tier-3 prompt-runner; will also be called by the Tier-1
 * Claude Code hook server in Phase 4.
 */
export function updateTerminalPromptDetected(terminalId: string, detected: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    const currentLifecycle: TerminalLifecycle = record.terminalData.lifecycle
    if (currentLifecycle === 'completed' || currentLifecycle === 'errored') {
        return // Sticky — exit wins.
    }

    // Orchestrator standby: if the terminal has active children, route prompt
    // detection through 'idle' instead of 'awaiting_input'. The Tier-3 detector
    // can match a stale numbered-choice frame from a prior permission box that
    // is still in the visible buffer while the parent quietly waits inside
    // wait_for_agents. Treating the parent as awaiting user input there is
    // wrong — by definition it's waiting on its children. When detection
    // clears, we also stay in 'idle' (not flip to 'active' spinner) for as
    // long as children are running.
    const orchestratorWithChildren: boolean = hasActiveChildren(terminalRecords.values(), terminalId)

    let nextLifecycle: TerminalLifecycle
    if (detected) {
        nextLifecycle = orchestratorWithChildren ? 'idle' : 'awaiting_input'
    } else if (orchestratorWithChildren) {
        nextLifecycle = 'idle'
    } else {
        // Clearing: fall back to 'active'. We deliberately do NOT honour the
        // heuristic `isDone` flag here — see updateTerminalIsDone for why time-
        // based silence is not a reliable "idle" signal.
        nextLifecycle = 'active'
    }

    if (nextLifecycle === currentLifecycle) {
        return // No change — skip notify.
    }

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: { ...record.terminalData, lifecycle: nextLifecycle },
    })
    notifyRegistrySubscribers()
}

/**
 * Remove a terminal from the registry.
 * Called when terminal is closed from UI.
 * Phase 3: Ensures main registry stays in sync when renderer closes terminals.
 */
export function removeTerminalFromRegistry(terminalId: string): void {
    if (terminalRecords.has(terminalId)) {
        terminalRecords.delete(terminalId)
        // Clean up notification tracking state
        notificationStateByTerminal.delete(terminalId)
        idleSinceByTerminal.delete(terminalId)
        cancelPendingNotification(terminalId)
        // Clean up budget entry if this was a root terminal
        clearBudget(terminalId)
        notifyRegistrySubscribers()
    }
}

export function getTerminalRecords(): TerminalRecord[] {
    return Array.from(terminalRecords.values())
}

/**
 * Get all existing agent names from the terminal registry.
 * Used for collision detection when spawning new terminals.
 *
 * Includes both running terminals and pending reservations so that two
 * concurrent spawns can't pick the same name in the window between
 * recordTerminalPending and recordTerminalSpawn.
 */
export function getExistingAgentNames(): Set<string> {
    const records: TerminalRecord[] = getTerminalRecords();
    const names: Set<string> = new Set(records.map((r: TerminalRecord) => r.terminalData.agentName));
    for (const pendingId of pendingTerminals.keys()) {
        names.add(pendingId);
    }
    return names;
}

export function clearTerminalRecords(
    timers: Pick<TerminalRegistryTimers, 'clearTimeout'> = { clearTimeout },
): void {
    // Cancel all pending notification timeouts
    for (const timeout of pendingNotificationTimeouts.values()) {
        timers.clearTimeout(timeout)
    }
    pendingNotificationTimeouts.clear()
    terminalRecords.clear()
    pendingTerminals.clear()
    notificationStateByTerminal.clear()
    idleSinceByTerminal.clear()
}

export function getIdleSince(terminalId: string): number | null {
    return idleSinceByTerminal.get(terminalId) ?? null
}

/**
 * Get all headless agent records anchored to a given node.
 * Used by badge UI to render status badges on task node cards.
 */
export function getHeadlessAgentsForNode(nodeId: NodeIdAndFilePath): TerminalRecord[] {
    return getTerminalRecords().filter((r: TerminalRecord) =>
        r.terminalData.isHeadless &&
        O.isSome(r.terminalData.anchoredToNodeId) &&
        r.terminalData.anchoredToNodeId.value === nodeId
    )
}

export function getNextTerminalCountForNode(nodeId: NodeIdAndFilePath): number {
    let maxCount: number = -1
    for (const record of terminalRecords.values()) {
        if (record.terminalData.attachedToContextNodeId === nodeId) {
            maxCount = Math.max(maxCount, record.terminalData.terminalCount)
        }
    }
    return maxCount + 1
}
