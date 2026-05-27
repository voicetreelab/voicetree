import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import type {TerminalId} from '@vt/vt-daemon-protocol'
import {getRuntimeGraph} from '@vt/vt-daemon/agent-runtime/runtime/graph-bridge.ts'
import {
    STOP_HOOK_DELAY_MS,
    terminalRecords,
    type TerminalRecord,
    type TerminalRegistryRuntime,
} from '../terminal-registry-state.ts'
import {publishTerminalRegistryEvent} from '../terminal-registry/terminal-registry-publisher.ts'
import {handleTerminalIsDone} from '../core/handleTerminalIsDone.ts'
import {notifyAgentOfUnseenNodes} from '../effects/notifyAgentOfUnseenNodes.ts'
import {runIdleStopGateAudit} from '../effects/runIdleStopGateAudit.ts'
import {runCommand} from '../effects/runCommand.ts'

const defaultTerminalRegistryRuntime: TerminalRegistryRuntime = {
    now: Date.now,
    setTimeout,
    clearTimeout,
    logger: { info: console.log, error: console.error },
}

export function updateTerminalIsDoneWorkflow(
    terminalId: string,
    isDone: boolean,
    runtime: TerminalRegistryRuntime = defaultTerminalRegistryRuntime,
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return

    const wasDone: boolean = record.terminalData.isDone
    const result = handleTerminalIsDone(record, {
        isDone,
        records: Array.from(terminalRecords.values()),
        now: runtime.now(),
        stopHookDelayMs: STOP_HOOK_DELAY_MS,
    })
    for (const command of result.commands) {
        runCommand(command, {
            timers: runtime,
            onStillDone: runIdleHooks(runtime),
        })
    }

    if (wasDone !== isDone) {
        publishTerminalRegistryEvent({
            type: 'terminal-record-changed',
            terminalId: terminalId as TerminalId,
            patch: {kind: 'done', value: isDone},
        })
    }
}

function runIdleHooks(
    runtime: TerminalRegistryRuntime,
): (terminalId: string, record: TerminalRecord) => void {
    return (tid, rec) => {
        void (async (): Promise<void> => {
            await runIdleStopGateAudit(tid, rec, {
                records: Array.from(terminalRecords.values()),
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

function incrementAuditRetryCount(terminalId: string): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, { ...record, auditRetryCount: record.auditRetryCount + 1 })
}
