import {
    closeHeadlessAgent,
    getHeadlessAgentOutput,
    isTmuxHeadlessAgent,
    reconcileTmuxHeadlessAgents,
    sendHeadlessAgentInput,
} from '../application/headless/headlessAgentManager'
import { createOnNewNodeHookDispatcher } from '../application/hooks/onNewNodeHook'
import { runStopHooks } from '../application/hooks/stopGateHookRunner'
import { getUnseenNodesForTerminal } from '../application/inject/get-unseen-nodes-for-terminal'
import { injectNodesIntoTerminal } from '../application/inject/inject-nodes-into-terminal'
import { sendTextToTerminal } from '../application/inject/send-text-to-terminal'
import { shouldFlipToActiveOnOutput } from '../application/lifecycle/output-transition'
import { getTierTelemetrySnapshot } from '../application/lifecycle/tierTelemetry'
import { installJsonlTelemetrySink } from '../application/lifecycle/tierTelemetryJsonlSink'
import { configureAgentRuntime, getRuntimeEnv } from '../application/runtime/runtime-config'
import { spawnPlainTerminal, spawnPlainTerminalWithNode } from '../application/spawn/launch/spawnPlainTerminal'
import { spawnTerminalWithContextNode } from '../application/spawn/launch/spawnTerminalWithContextNode'
import { getOutput } from '../application/terminals/terminal-output-buffer'
import { ensureTmuxAvailable } from '../application/terminals/tmux/tmux-preflight'
import { ensureTmuxServer, shutdownTmuxServer } from '../application/terminals/tmux/tmux-server'
import { getTerminalManager } from '../application/terminals/terminal-manager-instance'
import {
    attachUnclaimedTmuxSession,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
} from '../application/terminals/tmux/unclaimed-tmux'
import { discoverRecoverableAgentSessions } from '../application/recovery/discovery'
import { resumePersistedAgentSession } from '../application/recovery/resumePersistedAgentSession'
import { forkAgentSession } from '../application/recovery/forkAgentSession'
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
} from '../application/terminals/terminal-registry'
import {
    registerChild,
    tryConsumeAndSplitBudget,
} from '../application/terminals/global-budget-registry'

const dispatchOnNewNodeHooks = createOnNewNodeHookDispatcher()

export const agentRuntime = {
    attachUnclaimedTmuxSession,
    closeHeadlessAgent,
    configureAgentRuntime,
    dispatchOnNewNodeHooks,
    ensureTmuxAvailable,
    ensureTmuxServer,
    enqueuePendingMessage,
    getExistingAgentNames,
    getHeadlessAgentOutput,
    isTmuxHeadlessAgent,
    getIdleSince,
    getOutput,
    getPendingTerminal,
    getPendingTerminals,
    getRuntimeEnv,
    getTerminalManager,
    getTerminalRecords,
    getTierTelemetrySnapshot,
    getUnseenNodesForTerminal,
    installJsonlTelemetrySink,
    injectNodesIntoTerminal,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
    discoverRecoverableAgentSessions,
    resumePersistedAgentSession,
    forkAgentSession,
    registerChild,
    reconcileTmuxHeadlessAgents,
    removeTerminalFromRegistry,
    resetAuditRetryCount,
    runStopHooks,
    sendTextToTerminal,
    sendHeadlessAgentInput,
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
} as const
