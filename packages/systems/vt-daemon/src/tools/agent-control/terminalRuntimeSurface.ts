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
import {
    attachUnclaimedTmuxSession,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
} from '@vt/vt-daemon/terminals/tmux/unclaimed-tmux.ts'
import {configureAgentRuntime} from '@vt/vt-daemon/runtime/runtime-config.ts'
import {ensureTmuxAvailable} from '@vt/vt-daemon/terminals/tmux/tmux-preflight.ts'
import {ensureTmuxServer, shutdownTmuxServer} from '@vt/vt-daemon/terminals/tmux/tmux-server.ts'
import {
    enqueuePendingMessage,
    getExistingAgentNames,
    getIdleSince,
    getPendingTerminal,
    getPendingTerminals,
    getTerminalRecords,
    removeTerminalFromRegistry,
    resetAuditRetryCount,
    subscribeToRegistry,
    updateTerminalActivityState,
    updateTerminalAgentEvent,
    updateTerminalIsDone,
    updateTerminalMinimized,
    updateTerminalPinned,
} from '@vt/vt-daemon/terminals/terminal-registry'
import {getTerminalManager} from '@vt/vt-daemon/terminals/manager/terminal-manager-instance.ts'
import {installJsonlTelemetrySink} from '@vt/vt-daemon/agent-lifecycle/tierTelemetryJsonlSink.ts'
import {registerChild, tryConsumeAndSplitBudget} from '@vt/vt-daemon/terminals/global-budget-registry.ts'
import {getOutput} from '@vt/vt-daemon/terminals/terminal-output-buffer.ts'
import {getTierTelemetrySnapshot} from '@vt/vt-daemon/agent-lifecycle/tierTelemetry.ts'
import {shouldFlipToActiveOnOutput} from '@vt/vt-daemon/agent-lifecycle/output-transition.ts'
import {runStopHooks} from '@vt/vt-daemon/agents/hooks/stopGateHookRunner.ts'
import {getRuntimeEnv} from '@vt/vt-daemon/runtime/runtime-config.ts'
import {spawnPlainTerminal, spawnPlainTerminalWithNode} from '@vt/vt-daemon/spawn/spawnPlainTerminal.ts'
import {spawnTerminalWithContextNode} from '@vt/vt-daemon/spawn/spawnTerminalWithContextNode.ts'

export type {TerminalRecord} from '@vt/vt-daemon/terminals/terminal-registry'
export type {TerminalSpawnResult} from '@vt/vt-daemon-protocol'
export type TerminalManager = ReturnType<typeof getTerminalManager>
export type AgentRuntimeConfig = Parameters<typeof configureAgentRuntime>[0]

const dispatchOnNewNodeHooks = createOnNewNodeHookDispatcher()

// Daemon-owned surface aggregating the absorbed agent-runtime primitives.
// Slices A/B/C all live inside @vt/vt-daemon now; this is the single in-tree
// entry point that the daemon's own RPC routes, tools, and bin/vtd consume.
// External shells (webapp, perf measures, e2e tests) also reach the runtime
// via this surface, re-exported from @vt/vt-daemon's main barrel.
export const terminalRuntimeSurface = {
    attachUnclaimedTmuxSession,
    closeHeadlessAgent,
    configureAgentRuntime,
    dispatchOnNewNodeHooks,
    enqueuePendingMessage,
    ensureTmuxAvailable,
    ensureTmuxServer,
    getExistingAgentNames,
    getHeadlessAgentOutput,
    getIdleSince,
    getOutput,
    getPendingTerminal,
    getPendingTerminals,
    getRuntimeEnv,
    getTerminalManager,
    getTerminalRecords,
    getTierTelemetrySnapshot,
    getUnseenNodesForTerminal,
    injectNodesIntoTerminal,
    installJsonlTelemetrySink,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
    discoverRecoverableAgentSessions,
    resumePersistedAgentSession,
    forkAgentSession,
    reconcileTmuxHeadlessAgents,
    registerChild,
    removeTerminalFromRegistry,
    resetAuditRetryCount,
    resolveVtBinDir,
    runStopHooks,
    sendTextToTerminal,
    shouldFlipToActiveOnOutput,
    shutdownTmuxServer,
    spawnPlainTerminal,
    spawnPlainTerminalWithNode,
    spawnTerminalWithContextNode,
    subscribeToRegistry,
    tryConsumeAndSplitBudget,
    updateTerminalActivityState,
    updateTerminalAgentEvent,
    updateTerminalIsDone,
    updateTerminalMinimized,
    updateTerminalPinned,
}
