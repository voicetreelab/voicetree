import {agentRuntime} from '@vt/agent-runtime'

export type {TerminalRecord, TerminalSpawnResult} from '@vt/agent-runtime'
export type TerminalManager = ReturnType<typeof agentRuntime.getTerminalManager>
export type AgentRuntimeConfig = Parameters<typeof agentRuntime.configureAgentRuntime>[0]

export const terminalRuntimeSurface = {
    attachUnclaimedTmuxSession: agentRuntime.attachUnclaimedTmuxSession,
    closeHeadlessAgent: agentRuntime.closeHeadlessAgent,
    configureAgentRuntime: agentRuntime.configureAgentRuntime,
    dispatchOnNewNodeHooks: agentRuntime.dispatchOnNewNodeHooks,
    ensureTmuxAvailable: agentRuntime.ensureTmuxAvailable,
    ensureTmuxServer: agentRuntime.ensureTmuxServer,
    getExistingAgentNames: agentRuntime.getExistingAgentNames,
    getHeadlessAgentOutput: agentRuntime.getHeadlessAgentOutput,
    getTerminalManager: agentRuntime.getTerminalManager,
    getTerminalRecords: agentRuntime.getTerminalRecords,
    getUnseenNodesForTerminal: agentRuntime.getUnseenNodesForTerminal,
    injectNodesIntoTerminal: agentRuntime.injectNodesIntoTerminal,
    killUnclaimedTmuxSession: agentRuntime.killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions: agentRuntime.listUnclaimedTmuxSessions,
    discoverRecoverableAgentSessions: agentRuntime.discoverRecoverableAgentSessions,
    resumePersistedAgentSession: agentRuntime.resumePersistedAgentSession,
    forkAgentSession: agentRuntime.forkAgentSession,
    migrateLegacyTerminalDir: agentRuntime.migrateLegacyTerminalDir,
    removePersistedAgentRecord: agentRuntime.removePersistedAgentRecord,
    reconcileTmuxHeadlessAgents: agentRuntime.reconcileTmuxHeadlessAgents,
    removeTerminalFromRegistry: agentRuntime.removeTerminalFromRegistry,
    resetAuditRetryCount: agentRuntime.resetAuditRetryCount,
    sendTextToTerminal: agentRuntime.sendTextToTerminal,
    shutdownTmuxServer: agentRuntime.shutdownTmuxServer,
    spawnPlainTerminal: agentRuntime.spawnPlainTerminal,
    spawnPlainTerminalWithNode: agentRuntime.spawnPlainTerminalWithNode,
    spawnTerminalWithContextNode: agentRuntime.spawnTerminalWithContextNode,
    subscribeToRegistry: agentRuntime.subscribeToRegistry,
    updateTerminalActivityState: agentRuntime.updateTerminalActivityState,
    updateTerminalIsDone: agentRuntime.updateTerminalIsDone,
    updateTerminalMinimized: agentRuntime.updateTerminalMinimized,
    updateTerminalPinned: agentRuntime.updateTerminalPinned,
}
