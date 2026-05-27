// Public API surface for @vt/vt-daemon.
// Both Electron (webapp) and the standalone vtd binary consume runtime
// functionality through this barrel or via the stable internal subpaths
// declared in package.json#exports.

export {configureMcpServer, getSearchBridge} from '../config/mcp-config'
export type {
    AskQueryResponse,
    GraphBridge,
    McpServerConfig,
    SearchBridge,
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
export {
    encodeSseBlock as encodeAgentEventsSseBlock,
    matchAgentEventsPath,
    parseSinceQuery,
    projectHubEventToEnvelope,
    type AgentEventEnvelope,
    type AgentEventsGapEnvelope,
    type AgentEventsFrame,
} from '../transport/agentEventsSse'
export {handleHookEventRequest, resolveHookEventName, type HookHandlerResponse, type HookHandlerInput} from '../hooks/hookEventHandler'
export {terminalRuntimeSurface} from '../tools/agent-control/terminalRuntimeSurface'
export type {
    AgentRuntimeConfig,
    TerminalManager,
    TerminalRecord,
    TerminalSpawnResult,
} from '../tools/agent-control/terminalRuntimeSurface'
export {findAvailablePort, isPortAvailable} from '../tools/findAvailablePort'

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
} from '../tools/dispatchLiveCommandTool'
export {getLiveStateTool, getLiveState} from '../tools/getLiveStateTool'

export {setCurrentVault, getCurrentVault, peekCurrentVault} from '../state/currentVault'
export {
    getCurrentSessionState,
    applyCommandToSessionState,
    persistPositionsToGraphd,
    __resetSessionStateForTests,
} from '../state/sessionStateStore'
export {serializeState} from '../state/serializeState'

export {
    startOtlpReceiver,
    stopOtlpReceiver,
    OTLP_BASE_PORT,
    OTLP_MAX_PORT_ATTEMPTS,
} from '../observability/otlpReceiver'
export {
    appendTokenMetrics,
    getSessions,
    AGENT_METRICS_FILENAME,
    type SessionMetric,
    type TokenMetrics,
    type AgentMetricsData,
} from '../observability/agentMetricsStore'
export {
    readOtlpPortFile,
    writeOtlpPortFile,
    removeOtlpPortFile,
    otlpPortFilePath,
    OTLP_PORT_FILENAME,
} from '../lifecycle/otlpPortFile'

// Re-export agent-runtime API surface that internal vt-daemon RPC routes,
// the vtd binary, integration tests, and external shells (webapp main,
// perf measures, e2e tests) consume. Slice D consolidation: @vt/agent-runtime
// has been retired — all symbols live in @vt/vt-daemon.
export {
    clearTerminalRecords,
    getIdleSince,
    getTerminalRecords,
    recordTerminalSpawn,
    resetAuditRetryCount,
    updateTerminalIsDone,
} from '../terminals/terminal-registry'
export {createTerminalData} from '../terminals/terminal-registry/types'
export type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
export {configureAgentRuntime} from './runtime/runtime-config'
export {terminalRuntimeSurface as agentRuntime} from '../tools/agent-control/terminalRuntimeSurface'
