// Public API surface for @vt/voicetree-mcp.
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

export {createMcpServer, startMcpServer, getMcpPort} from '../tools/agent-control/mcp-server'
export type {McpServerHandle, StartMcpServerOptions} from '../tools/agent-control/mcp-server'
export {terminalRuntimeSurface} from '../tools/agent-control/terminalRuntimeSurface'
export type {
    AgentRuntimeConfig,
    TerminalManager,
    TerminalRecord,
    TerminalSpawnResult,
} from '../tools/agent-control/terminalRuntimeSurface'
export {findAvailablePort, isPortAvailable} from '../tools/findAvailablePort'

export {
    enableMcpJsonIntegration,
    enableMcpClientIntegrations,
    disableMcpJsonIntegration,
    enableOpencodeMcpIntegration,
    disableOpencodeMcpIntegration,
    isOpencodeAgent,
    setMcpIntegration,
    writeMcpClientConfigsToDir,
} from '../config/mcp-client-config'

export type {McpToolResponse} from '../tools/toolResponse'
export {buildJsonResponse} from '../tools/toolResponse'

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
