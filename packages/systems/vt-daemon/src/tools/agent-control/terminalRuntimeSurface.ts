import {agentRuntime} from '@vt/agent-runtime'
import {resolveVtBinDir} from '@vt/vt-daemon/spawn/vtPathInjection.ts'
import {
    closeHeadlessAgent,
    getHeadlessAgentOutput,
    reconcileTmuxHeadlessAgents,
} from '@vt/vt-daemon/agents/headless/headlessAgentManager.ts'
import {createOnNewNodeHookDispatcher} from '@vt/vt-daemon/agents/hooks/onNewNodeHook.ts'
import {getUnseenNodesForTerminal} from '@vt/vt-daemon/agents/inject/get-unseen-nodes-for-terminal.ts'
import {injectNodesIntoTerminal} from '@vt/vt-daemon/agents/inject/inject-nodes-into-terminal.ts'
import {sendTextToTerminal} from '@vt/vt-daemon/agents/inject/send-text-to-terminal.ts'
import {discoverRecoverableAgentSessions} from '@vt/vt-daemon/agents/recovery/discovery.ts'
import {resumePersistedAgentSession} from '@vt/vt-daemon/agents/recovery/resumePersistedAgentSession.ts'
import {forkAgentSession} from '@vt/vt-daemon/agents/recovery/forkAgentSession.ts'

export type {TerminalRecord, TerminalSpawnResult} from '@vt/agent-runtime'
export type TerminalManager = ReturnType<typeof agentRuntime.getTerminalManager>
export type AgentRuntimeConfig = Parameters<typeof agentRuntime.configureAgentRuntime>[0]

const dispatchOnNewNodeHooks = createOnNewNodeHookDispatcher()

// Daemon-owned surface mixing the agent-runtime facade (slice A/B: terminals,
// spawn, runtime, lifecycle) with locally-absorbed slice-C primitives
// (completion/recovery/headless/hooks/inject). The webapp (Electron main) and
// any other non-launcher shell must reach the agent runtime via this surface
// so terminal/agent operations all funnel through the daemon-owned package.
// Only daemon launchers (the vtd binary, vt serve, and the FS-watcher bridge) may
// import @vt/agent-runtime directly — see the boundary test in
// packages/measures/src/health/coupling/system-package-coupling.test.ts.
export const terminalRuntimeSurface = {
    attachUnclaimedTmuxSession: agentRuntime.attachUnclaimedTmuxSession,
    closeHeadlessAgent,
    configureAgentRuntime: agentRuntime.configureAgentRuntime,
    dispatchOnNewNodeHooks,
    ensureTmuxAvailable: agentRuntime.ensureTmuxAvailable,
    ensureTmuxServer: agentRuntime.ensureTmuxServer,
    getExistingAgentNames: agentRuntime.getExistingAgentNames,
    getHeadlessAgentOutput,
    getTerminalManager: agentRuntime.getTerminalManager,
    getTerminalRecords: agentRuntime.getTerminalRecords,
    getUnseenNodesForTerminal,
    injectNodesIntoTerminal,
    installJsonlTelemetrySink: agentRuntime.installJsonlTelemetrySink,
    killUnclaimedTmuxSession: agentRuntime.killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions: agentRuntime.listUnclaimedTmuxSessions,
    discoverRecoverableAgentSessions,
    resumePersistedAgentSession,
    forkAgentSession,
    reconcileTmuxHeadlessAgents,
    removeTerminalFromRegistry: agentRuntime.removeTerminalFromRegistry,
    resetAuditRetryCount: agentRuntime.resetAuditRetryCount,
    resolveVtBinDir,
    sendTextToTerminal,
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
