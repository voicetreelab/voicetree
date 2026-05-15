import { closeHeadlessAgent, getHeadlessAgentOutput, isTmuxHeadlessAgent, sendHeadlessAgentInput } from '../application/headless/headlessAgentManager'
import { dispatchOnNewNodeHooks } from '../application/hooks/onNewNodeHook'
import { runStopHooks } from '../application/hooks/stopGateHookRunner'
import { getUnseenNodesForTerminal } from '../application/inject/get-unseen-nodes-for-terminal'
import { injectNodesIntoTerminal } from '../application/inject/inject-nodes-into-terminal'
import { sendTextToTerminal } from '../application/inject/send-text-to-terminal'
import { shouldFlipToActiveOnOutput } from '../application/lifecycle/output-transition'
import { configureAgentRuntime, getRuntimeUI } from '../application/runtime/runtime-config'
import { spawnPlainTerminal, spawnPlainTerminalWithNode } from '../application/spawn/spawnPlainTerminal'
import { spawnTerminalWithContextNode } from '../application/spawn/spawnTerminalWithContextNode'
import { getOutput } from '../application/terminals/terminal-output-buffer'
import { getTerminalManager } from '../application/terminals/terminal-manager-instance'
import {
    enqueuePendingMessage,
    getExistingAgentNames,
    getIdleSince,
    getPendingTerminal,
    getTerminalRecords,
    removeTerminalFromRegistry,
    resetAuditRetryCount,
    subscribeToRegistry,
    updateTerminalActivityState,
    updateTerminalIsDone,
    updateTerminalMinimized,
    updateTerminalPinned,
} from '../application/terminals/terminal-registry'
import {
    registerChild,
    tryConsumeAndSplitBudget,
} from '../application/terminals/global-budget-registry'

export const agentRuntime = {
    closeHeadlessAgent,
    configureAgentRuntime,
    dispatchOnNewNodeHooks,
    enqueuePendingMessage,
    getExistingAgentNames,
    getHeadlessAgentOutput,
    isTmuxHeadlessAgent,
    getIdleSince,
    getPendingTerminal,
    getOutput,
    getRuntimeUI,
    getTerminalManager,
    getTerminalRecords,
    getUnseenNodesForTerminal,
    injectNodesIntoTerminal,
    registerChild,
    removeTerminalFromRegistry,
    resetAuditRetryCount,
    runStopHooks,
    sendTextToTerminal,
    sendHeadlessAgentInput,
    shouldFlipToActiveOnOutput,
    spawnPlainTerminal,
    spawnPlainTerminalWithNode,
    spawnTerminalWithContextNode,
    subscribeToRegistry,
    tryConsumeAndSplitBudget,
    updateTerminalActivityState,
    updateTerminalIsDone,
    updateTerminalMinimized,
    updateTerminalPinned,
} as const
