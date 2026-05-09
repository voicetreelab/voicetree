// Public API surface for @vt/voicetree-mcp.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through
// this barrel or via the stable internal subpaths declared in
// package.json#exports.

export {configureMcpServer, getLiveStateBridge, getSearchBridge} from './config/mcp-config'
export type {
    McpServerConfig,
    LiveStateBridge,
    SearchBridge,
    AskQueryResponse,
    SearchSimilarResult,
} from './config/mcp-config'

export {createMcpServer, startMcpServer, getMcpPort} from './mcp-server'
export type {McpServerHandle, StartMcpServerOptions} from './mcp-server'
export {findAvailablePort, isPortAvailable} from './util/findAvailablePort'

export {
    enableMcpJsonIntegration,
    disableMcpJsonIntegration,
    isMcpIntegrationEnabled,
    enableOpencodeMcpIntegration,
    disableOpencodeMcpIntegration,
    isOpencodeAgent,
    setMcpIntegration,
} from './config/mcp-client-config'

export type {McpToolResponse} from './core/types'
export {buildJsonResponse} from './core/types'

export {
    registerAgentNodes,
    getAgentNodes,
    clearAgentNodes,
    type AgentNodeEntry,
} from './agents/agentNodeIndex'

export {
    startMonitor,
    cancelMonitor,
    registerChildIfMonitored,
    isTerminalIdAlreadyMonitoredForCaller,
    getPendingAgentNamesForCaller,
} from './agents/agent-completion-monitor'

export {isAgentComplete, getAgentStatus, NO_PROGRESS_TIMEOUT_MS} from './agents/isAgentComplete'
export type {AgentStatus} from './agents/isAgentComplete'
export {buildCompletionMessage, type AgentResult} from './agents/buildCompletionMessage'
export {getNewNodesForAgent} from './agents/getNewNodesForAgent'

export {spawnAgentTool, type SpawnAgentParams} from './tools/agent-control/spawnAgentTool'
export {listAgentsTool} from './tools/agent-control/listAgentsTool'
export {waitForAgentsTool, type WaitForAgentsParams} from './tools/agent-control/waitForAgentsTool'
export {getUnseenNodesNearbyTool, type GetUnseenNodesNearbyParams} from './tools/agent-control/getUnseenNodesNearbyTool'
export {sendMessageTool, type SendMessageParams} from './tools/agent-control/sendMessageTool'
export {closeAgentTool, type CloseAgentParams} from './tools/agent-control/closeAgentTool'
export {readTerminalOutputTool, type ReadTerminalOutputParams} from './tools/agent-control/readTerminalOutputTool'
export {searchNodesTool, type SearchNodesParams} from './tools/graph/searchNodesTool'
export {
    createGraphTool,
    type CreateGraphParams,
    type CreateGraphNodeInput,
} from './create-graph/createGraphTool'
export {syncMcpGraphDbServerState} from './config/mcp-graph-bridge'
export {graphStructureTool, type GraphStructureParams} from './tools/graph/graphStructureTool'
export {
    dispatchLiveCommand,
    dispatchLiveCommandTool,
    type DispatchLiveCommandParams,
    type DispatchLiveCommandResult,
} from './tools/live/dispatchLiveCommandTool'
export {getLiveStateTool, getLiveState} from './tools/live/getLiveStateTool'
