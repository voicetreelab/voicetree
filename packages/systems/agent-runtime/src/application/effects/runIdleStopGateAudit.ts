import type {Graph} from '@vt/graph-model/graph'
import {sendTextToTerminal} from '@vt/vt-daemon/agents/inject/send-text-to-terminal.ts'
import {runStopHooks, type StopHookResult} from '@vt/vt-daemon/agents/hooks/stopGateHookRunner.ts'
import {hasActiveChildren} from '@vt/agent-runtime/terminals/terminal-registry-state.ts'
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

    const hookResult: StopHookResult = await runStopHooks(terminalId, deps.graph, deps.records)

    if (!hookResult.passed) {
        deps.incrementAuditRetryCount(terminalId)
        deps.logger.info(`[terminal-registry] Stop gate audit failed for idle agent ${terminalId} (retry ${record.auditRetryCount + 1}/2)`)
        void sendTextToTerminal(terminalId, hookResult.message ?? 'Stop gate hooks failed')
    }
}
