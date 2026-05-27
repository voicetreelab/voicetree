import { shouldFlipToActiveOnOutput } from '../application/lifecycle/output-transition'
import { getTierTelemetrySnapshot } from '../application/lifecycle/tierTelemetry'
import { installJsonlTelemetrySink } from '../application/lifecycle/tierTelemetryJsonlSink'
import { configureAgentRuntime, getRuntimeEnv } from '../application/runtime/runtime-config'
import { spawnPlainTerminal, spawnPlainTerminalWithNode } from '../application/spawn/spawnPlainTerminal'
import { spawnTerminalWithContextNode } from '../application/spawn/spawnTerminalWithContextNode'
import { getOutput } from '../application/terminals/terminal-output-buffer'
import { ensureTmuxAvailable } from '../application/terminals/tmux/tmux-preflight'
import { ensureTmuxServer, shutdownTmuxServer } from '../application/terminals/tmux/tmux-server'
import { getTerminalManager } from '../application/terminals/terminal-manager-instance'
import {
    attachUnclaimedTmuxSession,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
} from '../application/terminals/tmux/unclaimed-tmux'
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

// Slice C (completion, recovery, headless, hooks, inject) has been absorbed
// into @vt/vt-daemon. Reach those symbols via `@vt/vt-daemon/agents/...`
// directly — they're no longer part of this facade.

export const agentRuntime = {
    attachUnclaimedTmuxSession,
    configureAgentRuntime,
    ensureTmuxAvailable,
    ensureTmuxServer,
    enqueuePendingMessage,
    getExistingAgentNames,
    getIdleSince,
    getOutput,
    getPendingTerminal,
    getPendingTerminals,
    getRuntimeEnv,
    getTerminalManager,
    getTerminalRecords,
    getTierTelemetrySnapshot,
    installJsonlTelemetrySink,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
    registerChild,
    removeTerminalFromRegistry,
    resetAuditRetryCount,
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
