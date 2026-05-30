import {resolveVtBinDir} from '@vt/vt-daemon/agent-runtime/spawn/injection/vtPathInjection.ts'
import {
    closeHeadlessAgent,
    getHeadlessAgentOutput,
    reconcileTmuxHeadlessAgents,
} from '@vt/vt-daemon/agent-runtime/headless/headlessAgentManager.ts'
import {createOnNewNodeHookDispatcher} from '@vt/vt-daemon/agent-runtime/hooks/onNewNodeHook.ts'
import {getUnseenNodesForTerminal} from '@vt/vt-daemon/agent-runtime/inject/get-unseen-nodes-for-terminal.ts'
import {injectNodesIntoTerminal} from '@vt/vt-daemon/agent-runtime/inject/inject-nodes-into-terminal.ts'
import {sendTextToTerminal} from '@vt/vt-daemon/agent-runtime/inject/send-text-to-terminal.ts'
import {discoverRecoverableAgentSessions} from '@vt/vt-daemon/agent-runtime/recovery/discovery.ts'
import {resumePersistedAgentSession} from '@vt/vt-daemon/agent-runtime/recovery/resumePersistedAgentSession.ts'
import {forkAgentSession} from '@vt/vt-daemon/agent-runtime/recovery/forkAgentSession.ts'
import {migrateLegacyTerminalDir} from '@vt/vt-daemon/agent-runtime/recovery/migrate-legacy-terminal-dir.ts'
import {removePersistedAgentRecord} from '@vt/vt-daemon/agent-runtime/recovery/removePersistedAgentRecord.ts'
import {
    attachUnclaimedTmuxSession,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
} from '@vt/vt-daemon/agent-runtime/terminals/tmux/unclaimed-tmux.ts'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {ensureTmuxAvailable} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-preflight.ts'
import {ensureTmuxServer, shutdownTmuxServer} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-server.ts'
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
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {getTerminalManager} from '@vt/vt-daemon/agent-runtime/terminals/manager/terminal-manager-instance.ts'
import {installJsonlTelemetrySink} from '@vt/vt-daemon/agent-runtime/lifecycle/tierTelemetryJsonlSink.ts'
import {registerChild, tryConsumeAndSplitBudget} from '@vt/vt-daemon/agent-runtime/terminals/global-budget-registry.ts'
import {getOutput} from '@vt/vt-daemon/agent-runtime/terminals/terminal-output-buffer.ts'
import {getTierTelemetrySnapshot} from '@vt/vt-daemon/agent-runtime/lifecycle/tierTelemetry.ts'
import {shouldFlipToActiveOnOutput} from '@vt/vt-daemon/agent-runtime/lifecycle/output-transition.ts'
import {runStopHooks} from '@vt/vt-daemon/agent-runtime/hooks/stopGateHookRunner.ts'
import {getRuntimeEnv} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {spawnPlainTerminal, spawnPlainTerminalWithNode} from '@vt/vt-daemon/agent-runtime/spawn/spawnPlainTerminal.ts'
import {spawnTerminalWithContextNode} from '@vt/vt-daemon/agent-runtime/spawn/spawnTerminalWithContextNode.ts'

export type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
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
    migrateLegacyTerminalDir,
    removePersistedAgentRecord,
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
