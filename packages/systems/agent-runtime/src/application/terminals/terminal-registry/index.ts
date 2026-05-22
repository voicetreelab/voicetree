export type {TerminalRecord, TerminalStatus} from '../terminal-registry-state'

export {
    getTerminalRecords,
    subscribeToRegistry,
} from './subscribers'

export {
    clearPendingTerminal,
    enqueuePendingMessage,
    getPendingTerminal,
    getPendingTerminals,
    recordTerminalPending,
} from './pending'

export {recordTerminalSpawn} from './spawn'

export {
    incrementAuditRetryCount,
    markTerminalExited,
    markTerminalKillReason,
    resetAuditRetryCount,
    updateTerminalAgentEvent,
    updateTerminalIsDone,
} from './lifecycle'

export {
    updateTerminalActivityState,
    updateTerminalMinimized,
    updateTerminalPinned,
} from './updates'

export {
    clearTerminalRecords,
    getExistingAgentNames,
    getHeadlessAgentsForNode,
    getIdleSince,
    getNextTerminalCountForNode,
    removeTerminalFromRegistry,
} from './queries'

export {
    reconcileTmuxTerminalRegistry,
    type TmuxReconciliationResult,
} from './reconciliation'

export {
    readMetadata,
    writeMetadata,
    type NativeRecoveryHandle,
    type TmuxTerminalMetadata,
} from './terminal-metadata'
