// Tool catalog for the UDS JSON-RPC dispatcher.
//
// 7b dispatches directly to the existing tool functions that today live next
// to mcp-server.ts. 7f lifts the catalog into a proper module and deletes the
// HTTP MCP server. Keeping this map minimal here avoids pre-empting that lift.

import type {McpToolResponse} from '../tools/toolResponse'
import {spawnAgentTool} from '../tools/agent-control/spawnAgentTool'
import {listAgentsTool} from '../tools/agent-control/listAgentsTool'
import {waitForAgentsTool} from '../tools/agent-control/waitForAgentsTool'
import {getUnseenNodesNearbyTool} from '../tools/agent-control/getUnseenNodesNearbyTool'
import {sendMessageTool} from '../tools/agent-control/sendMessageTool'
import {closeAgentTool} from '../tools/agent-control/closeAgentTool'
import {readTerminalOutputTool} from '../tools/agent-control/readTerminalOutputTool'
import {createGraphTool} from '../create-graph/createGraphTool'
import {graphStructureTool} from '../tools/graph/graphStructureTool'
import {searchNodesTool} from '../tools/graph/searchNodesTool'
import {dispatchLiveCommandTool} from '../tools/live/dispatchLiveCommandTool'
import {getLiveStateTool} from '../tools/live/getLiveStateTool'

import type {ToolHandler, ToolCatalog} from './udsServer'

function adapt<P>(fn: (params: P) => Promise<McpToolResponse> | McpToolResponse): ToolHandler {
    return async (args: Record<string, unknown>): Promise<McpToolResponse> => fn(args as P)
}

export function buildDefaultToolCatalog(): ToolCatalog {
    const entries: Array<[string, ToolHandler]> = [
        ['spawn_agent', adapt(spawnAgentTool)],
        ['list_agents', adapt(listAgentsTool)],
        ['wait_for_agents', adapt(waitForAgentsTool)],
        ['get_unseen_nodes_nearby', adapt(getUnseenNodesNearbyTool)],
        ['send_message', adapt(sendMessageTool)],
        ['close_agent', adapt(closeAgentTool)],
        ['read_terminal_output', adapt(readTerminalOutputTool)],
        ['create_graph', adapt(createGraphTool)],
        ['graph_structure', adapt(graphStructureTool)],
        ['search_nodes', adapt(searchNodesTool)],
        ['vt_dispatch_live_command', adapt(dispatchLiveCommandTool)],
        ['vt_get_live_state', adapt(getLiveStateTool)],
    ]
    return new Map(entries)
}
