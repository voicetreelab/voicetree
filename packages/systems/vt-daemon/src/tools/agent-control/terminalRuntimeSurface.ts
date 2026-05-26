import {agentRuntime} from '@vt/agent-runtime'
import {resolveVtBinDir} from '@vt/agent-runtime/spawn/vtPathInjection.ts'

export type {TerminalRecord, TerminalSpawnResult} from '@vt/agent-runtime'
export type TerminalManager = ReturnType<typeof agentRuntime.getTerminalManager>
export type AgentRuntimeConfig = Parameters<typeof agentRuntime.configureAgentRuntime>[0]

// MCP-owned shim around @vt/agent-runtime. The webapp (Electron main) and any
// other non-launcher shell must reach the agent runtime via this surface so
// terminal/agent operations all funnel through the daemon-owned package.
// Only daemon launchers (vt-mcpd, vt serve, and the FS-watcher bridge) may
// import @vt/agent-runtime directly — see the boundary test in
// packages/measures/src/health/coupling/system-package-coupling.test.ts.
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
    installJsonlTelemetrySink: agentRuntime.installJsonlTelemetrySink,
    killUnclaimedTmuxSession: agentRuntime.killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions: agentRuntime.listUnclaimedTmuxSessions,
    discoverRecoverableAgentSessions: agentRuntime.discoverRecoverableAgentSessions,
    resumePersistedAgentSession: agentRuntime.resumePersistedAgentSession,
    forkAgentSession: agentRuntime.forkAgentSession,
    reconcileTmuxHeadlessAgents: agentRuntime.reconcileTmuxHeadlessAgents,
    removeTerminalFromRegistry: agentRuntime.removeTerminalFromRegistry,
    resetAuditRetryCount: agentRuntime.resetAuditRetryCount,
    resolveVtBinDir,
    sendTextToTerminal: agentRuntime.sendTextToTerminal,
    shutdownTmuxServer: agentRuntime.shutdownTmuxServer,
    spawnPlainTerminal: agentRuntime.spawnPlainTerminal,
    spawnPlainTerminalWithNode: agentRuntime.spawnPlainTerminalWithNode,
    spawnTerminalWithContextNode: agentRuntime.spawnTerminalWithContextNode,
    subscribeToRegistry: agentRuntime.subscribeToRegistry,
    updateTerminalActivityState: agentRuntime.updateTerminalActivityState,
    updateTerminalAgentEvent: agentRuntime.updateTerminalAgentEvent,
    updateTerminalIsDone: agentRuntime.updateTerminalIsDone,
    updateTerminalMinimized: agentRuntime.updateTerminalMinimized,
    updateTerminalPinned: agentRuntime.updateTerminalPinned,
}
