/**
 * Find nodes created by an agent via agent_name matching.
 * Returns nodeId and title pairs for MCP tool responses.
 *
 * Uses getNodesByAgentName from @/pure/graph for the core matching logic.
 */

import type {Graph, GraphNode} from '@/pure/graph'
import {getNodesByAgentName} from '@/pure/graph'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'

export function getNewNodesForAgent(
    graph: Graph,
    agentName: string | undefined
): Array<{nodeId: string; title: string}> {
    if (!agentName) return []

    const nodes: readonly GraphNode[] = getNodesByAgentName(graph, agentName)
    return nodes.map((node: GraphNode) => ({
        nodeId: node.absoluteFilePathIsID,
        title: getNodeTitle(node)
    }))
}
