// Public API surface for @vt/voicetree-mcp.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through
// this barrel or via the stable internal subpaths declared in
// package.json#exports.

export {configureMcpServer, getLiveStateBridge, getSearchBridge} from './mcp-config'
export type {
    McpServerConfig,
    LiveStateBridge,
    SearchBridge,
    AskQueryResponse,
    SearchSimilarResult,
} from './mcp-config'

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
} from './mcp-client-config'

export type {McpToolResponse} from './types'
export {buildJsonResponse} from './types'

export {
    registerAgentNodes,
    getAgentNodes,
    clearAgentNodes,
    type AgentNodeEntry,
} from './agentNodeIndex'

export {
    startMonitor,
    cancelMonitor,
    registerChildIfMonitored,
    isTerminalIdAlreadyMonitoredForCaller,
    getPendingAgentNamesForCaller,
} from './agent-completion-monitor'

export {isAgentComplete, getAgentStatus, NO_PROGRESS_TIMEOUT_MS} from './isAgentComplete'
export type {AgentStatus} from './isAgentComplete'
export {buildCompletionMessage, type AgentResult} from './buildCompletionMessage'
export {getNewNodesForAgent} from './getNewNodesForAgent'

export {spawnAgentTool, type SpawnAgentParams} from './spawnAgentTool'
export {listAgentsTool} from './listAgentsTool'
export {waitForAgentsTool, type WaitForAgentsParams} from './waitForAgentsTool'
export {getUnseenNodesNearbyTool, type GetUnseenNodesNearbyParams} from './getUnseenNodesNearbyTool'
export {sendMessageTool, type SendMessageParams} from './sendMessageTool'
export {closeAgentTool, type CloseAgentParams} from './closeAgentTool'
export {readTerminalOutputTool, type ReadTerminalOutputParams} from './readTerminalOutputTool'
export {searchNodesTool, type SearchNodesParams} from './searchNodesTool'
export {
    createGraphTool,
    type CreateGraphParams,
    type CreateGraphNodeInput,
} from './createGraphTool'
export {graphStructureTool, type GraphStructureParams} from './graphStructureTool'
export {
    dispatchLiveCommandTool,
    type DispatchLiveCommandParams,
    type DispatchLiveCommandResult,
} from './dispatchLiveCommandTool'
export {getLiveStateTool, getLiveState} from './getLiveStateTool'
