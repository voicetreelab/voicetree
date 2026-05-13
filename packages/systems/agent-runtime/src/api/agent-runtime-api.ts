import { closeHeadlessAgent, getHeadlessAgentOutput } from '../headless/headlessAgentManager'
import { dispatchOnNewNodeHooks } from '../hooks/onNewNodeHook'
import { runStopHooks } from '../hooks/stopGateHookRunner'
import { getUnseenNodesForTerminal } from '../inject/get-unseen-nodes-for-terminal'
import { injectNodesIntoTerminal } from '../inject/inject-nodes-into-terminal'
import { sendTextToTerminal } from '../inject/send-text-to-terminal'
import { shouldFlipToActiveOnOutput } from '../lifecycle/output-transition'
import { configureAgentRuntime, getRuntimeUI } from '../runtime/runtime-config'
import { spawnPlainTerminal, spawnPlainTerminalWithNode } from '../spawn/spawnPlainTerminal'
import { spawnTerminalWithContextNode } from '../spawn/spawnTerminalWithContextNode'
import { getTerminalManager } from '../terminals/terminal-manager-instance'
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
} from '../terminals/terminal-registry'
import {
    registerChild,
    tryConsumeAndSplitBudget,
} from '../terminals/global-budget-registry'
import { shellQuote } from '../util/shellQuote'

export const agentRuntime = {
    closeHeadlessAgent,
    configureAgentRuntime,
    dispatchOnNewNodeHooks,
    enqueuePendingMessage,
    getExistingAgentNames,
    getHeadlessAgentOutput,
    getIdleSince,
    getPendingTerminal,
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
    shellQuote,
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
