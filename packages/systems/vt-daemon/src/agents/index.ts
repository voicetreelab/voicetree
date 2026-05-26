// Public API surface for @vt/vt-daemon.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through
// this barrel or via the stable internal subpaths declared in
// package.json#exports.

export {configureMcpServer, getLiveStateBridge, getSearchBridge} from '../config/mcp-config'
export type {
    McpServerConfig,
    LiveStateBridge,
    SearchBridge,
    AskQueryResponse,
    SearchSimilarResult,
} from '../config/mcp-config'

export {startHttpDaemonServer, isAuthorized, buildAccessLogLine} from '../transport/httpServer'
export type {
    HttpDaemonServerHandle,
    StartHttpDaemonOptions,
    ToolCatalog,
    ToolHandler,
    HookHandler,
    HookHandlerInvocation,
    AccessLogger,
} from '../transport/httpServer'
export {buildDefaultToolCatalog} from '../transport/toolCatalog'
export {TOOL_CATALOG, CatalogValidationError, type CatalogEntry, type CatalogHandler} from '../tools/catalog'
export {
    createEventSubscriptionHub,
    ALLOWED_TOPICS,
    type EventSubscriptionHub,
    type TopicName,
    type Subscriber,
    type SubscriberHandle,
    type SubscribeRequest,
    type PublishedEvent,
} from '../transport/eventSubscriptionHub'
export {handleHookEventRequest, resolveHookEventName, type HookHandlerResponse, type HookHandlerInput} from '../hooks/hookEventHandler'
export {startVaultStateWatcher, type VaultStateWatcherHandle, type StartVaultStateWatcherOptions} from '../transport/vaultStateWatcher'
export {terminalRuntimeSurface} from '../tools/agent-control/terminalRuntimeSurface'
export type {
    AgentRuntimeConfig,
    TerminalManager,
    TerminalRecord,
    TerminalSpawnResult,
} from '../tools/agent-control/terminalRuntimeSurface'
export {findAvailablePort, isPortAvailable} from '../tools/findAvailablePort'

export {stripStaleVoicetreeMcpEntries} from '../config/mcp-client-config'
export {writeVaultAgentDiscoveryFile} from '../config/vaultAgentDiscoveryFile'

export type {McpToolResponse} from '../tools/toolResponse'
export {buildJsonResponse} from '../tools/toolResponse'

export {
    startMonitor,
    cancelMonitor,
    registerChildIfMonitored,
    isTerminalIdAlreadyMonitoredForCaller,
    getPendingAgentNamesForCaller,
} from './agent-completion-monitor'

export {spawnAgentTool, type SpawnAgentParams} from '../tools/agent-control/spawnAgentTool'
export {listAgentsTool} from '../tools/agent-control/listAgentsTool'
export {waitForAgentsTool, type WaitForAgentsParams} from '../tools/agent-control/waitForAgentsTool'
export {getUnseenNodesNearbyTool, type GetUnseenNodesNearbyParams} from '../tools/agent-control/getUnseenNodesNearbyTool'
export {sendMessageTool, type SendMessageParams} from '../tools/agent-control/sendMessageTool'
export {closeAgentTool, type CloseAgentParams} from '../tools/agent-control/closeAgentTool'
export {readTerminalOutputTool, type ReadTerminalOutputParams} from '../tools/agent-control/readTerminalOutputTool'
export {searchNodesTool, type SearchNodesParams} from '../tools/graph/searchNodesTool'
export {
    createGraphTool,
    type CreateGraphParams,
    type CreateGraphNodeInput,
} from '../create-graph/createGraphTool'
export {graphStructureTool, type GraphStructureParams} from '../tools/graph/graphStructureTool'
export {
    dispatchLiveCommand,
    dispatchLiveCommandTool,
    type DispatchLiveCommandParams,
    type DispatchLiveCommandResult,
} from '../tools/live/dispatchLiveCommandTool'
export {getLiveStateTool, getLiveState} from '../tools/live/getLiveStateTool'

export {setCurrentVault, getCurrentVault, peekCurrentVault} from '../state/currentVault'
export {
    getCurrentSessionState,
    applyCommandToSessionState,
    persistPositionsToGraphd,
    __resetSessionStateForTests,
} from '../state/sessionStateStore'
export {serializeState} from '../state/serializeState'
