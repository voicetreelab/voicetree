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
