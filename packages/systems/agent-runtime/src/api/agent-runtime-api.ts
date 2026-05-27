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
import { shouldFlipToActiveOnOutput } from '@vt/vt-daemon/agent-lifecycle/output-transition.ts'
import { getTierTelemetrySnapshot } from '@vt/vt-daemon/agent-lifecycle/tierTelemetry.ts'
import { installJsonlTelemetrySink } from '@vt/vt-daemon/agent-lifecycle/tierTelemetryJsonlSink.ts'
import { configureAgentRuntime, getRuntimeEnv } from '@vt/vt-daemon/runtime/runtime-config.ts'
import { spawnPlainTerminal, spawnPlainTerminalWithNode } from '@vt/vt-daemon/spawn/spawnPlainTerminal.ts'
import { spawnTerminalWithContextNode } from '@vt/vt-daemon/spawn/spawnTerminalWithContextNode.ts'
import { getOutput } from '@vt/vt-daemon/terminals/terminal-output-buffer.ts'
import { ensureTmuxAvailable } from '@vt/vt-daemon/terminals/tmux/tmux-preflight.ts'
import { ensureTmuxServer, shutdownTmuxServer } from '@vt/vt-daemon/terminals/tmux/tmux-server.ts'
import { getTerminalManager } from '@vt/vt-daemon/terminals/manager/terminal-manager-instance.ts'
import {
    attachUnclaimedTmuxSession,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
} from '@vt/vt-daemon/terminals/tmux/unclaimed-tmux.ts'
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
} from '@vt/vt-daemon/terminals/terminal-registry'
import {
    registerChild,
    tryConsumeAndSplitBudget,
} from '@vt/vt-daemon/terminals/global-budget-registry.ts'

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
