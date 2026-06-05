import type {Graph} from '@vt/graph-model/graph'
import {sendTextToTerminal} from '@vt/vt-daemon/agent-runtime/inject/send-text-to-terminal.ts'
import {runStopHooks, type StopHookResult} from '@vt/vt-daemon/agent-runtime/hooks/stopGateHookRunner.ts'
import {requireDeclaredStatus} from '@vt/vt-daemon/agent-runtime/hooks/requireDeclaredStatus.ts'
import {hasActiveChildren} from '../terminal-registry-state.ts'
import type {
    TerminalRecord,
    TerminalRegistryLogger,
} from '../domain/session.ts'

export type IdleStopGateAuditDeps = {
    readonly records: readonly TerminalRecord[]
    readonly graph: Graph
    readonly incrementAuditRetryCount: (terminalId: string) => void
    readonly logger: TerminalRegistryLogger
}

export async function runIdleStopGateAudit(
    terminalId: string,
    record: TerminalRecord,
    deps: IdleStopGateAuditDeps,
): Promise<void> {
    if (record.auditRetryCount >= 2) return
    if (record.terminalData.isHeadless) return

    if (hasActiveChildren(deps.records, terminalId)) return

    // Two gates share one bounded nudge + retry: the agent must have declared a
    // terminal status (the finish gate), AND any configured shell stop-hooks
    // must pass. Aggregating means a single injected message and a single
    // auditRetryCount increment cover both, so the 2-retry cap is not consumed
    // twice as fast.
    const statusResult: StopHookResult = requireDeclaredStatus(record)
    const hookResult: StopHookResult = await runStopHooks(terminalId, deps.graph, deps.records)

    const failures: readonly StopHookResult[] = [statusResult, hookResult].filter((r) => !r.passed)
    if (failures.length > 0) {
        deps.incrementAuditRetryCount(terminalId)
        deps.logger.info(`[terminal-registry] Stop gate audit failed for idle agent ${terminalId} (retry ${record.auditRetryCount + 1}/2)`)
        const message: string = failures
            .map((r) => r.message)
            .filter((m): m is string => m !== undefined)
            .join('\n\n') || 'Stop gate failed'
        void sendTextToTerminal(terminalId, message)
    }
}
