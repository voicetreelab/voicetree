/**
 * Internal boundary for agent runtime operations used by MCP tools.
 *
 * Keeping runtime access here gives tool modules a local API and keeps the
 * cross-package dependency surface narrow.
 */

export {
    closeHeadlessAgent,
    enqueuePendingMessage,
    getHeadlessAgentOutput,
    getIdleSince,
    getOutput,
    getPendingTerminal,
    getRuntimeUI,
    getTerminalRecords,
    registerChild,
    resetAuditRetryCount,
    runStopHooks,
    sendTextToTerminal,
    spawnTerminalWithContextNode,
    tryConsumeAndSplitBudget,
} from '@vt/agent-runtime'

export type {
    StopHookResult,
    TerminalId,
    TerminalRecord,
} from '@vt/agent-runtime'
