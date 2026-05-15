import {closeHeadlessAgent, getHeadlessAgentOutput} from '@vt/agent-runtime/headless/headlessAgentManager.ts'
import {dispatchOnNewNodeHooks} from '@vt/agent-runtime/hooks/onNewNodeHook.ts'
import {runStopHooks} from '@vt/agent-runtime/hooks/stopGateHookRunner.ts'
import {getUnseenNodesForTerminal} from '@vt/agent-runtime/inject/get-unseen-nodes-for-terminal.ts'
import {injectNodesIntoTerminal} from '@vt/agent-runtime/inject/inject-nodes-into-terminal.ts'
import {sendTextToTerminal} from '@vt/agent-runtime/inject/send-text-to-terminal.ts'
import {shouldFlipToActiveOnOutput} from '@vt/agent-runtime/lifecycle/output-transition'
import {spawnPlainTerminal, spawnPlainTerminalWithNode} from '@vt/agent-runtime/spawn/spawnPlainTerminal.ts'
import {spawnTerminalWithContextNode} from '@vt/agent-runtime/spawn/spawnTerminalWithContextNode.ts'
import {getOutput} from '@vt/agent-runtime/terminals/terminal-output-buffer.ts'
import {getTerminalManager} from '@vt/agent-runtime/terminals/terminal-manager-instance.ts'
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
} from '@vt/agent-runtime/terminals/terminal-registry/index.ts'
import {
    registerChild,
    tryConsumeAndSplitBudget,
} from '@vt/agent-runtime/terminals/global-budget-registry.ts'
import {handleAgentRuntimeApi} from '../core/handleAgentRuntimeApi.ts'

export function agentRuntimeApiWorkflow<const RuntimeConfig extends {
    configureAgentRuntime: unknown
    getRuntimeUI: unknown
}>(runtimeConfig: RuntimeConfig) {
    return handleAgentRuntimeApi({
        closeHeadlessAgent,
        configureAgentRuntime: runtimeConfig.configureAgentRuntime,
        dispatchOnNewNodeHooks,
        enqueuePendingMessage,
        getExistingAgentNames,
        getHeadlessAgentOutput,
        getIdleSince,
        getPendingTerminal,
        getOutput,
        getRuntimeUI: runtimeConfig.getRuntimeUI,
        getTerminalManager,
        getTerminalRecords,
        getUnseenNodesForTerminal,
        injectNodesIntoTerminal,
        registerChild,
        removeTerminalFromRegistry,
        resetAuditRetryCount,
        runStopHooks,
        sendTextToTerminal,
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
    }).response
}
