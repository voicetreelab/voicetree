/**
 * Find nodes created by an agent via agent_name matching.
 * Returns nodeId and title pairs for MCP tool responses.
 *
 * Uses getNodesByAgentName from @vt/graph-model/pure/graph for the core matching logic.
 * Filters by file birthtime >= spawnedAt to avoid name-collision with
 * previous agents that had the same recycled name.
 */

import {statSync} from 'fs'
import type {Graph, GraphNode} from '@vt/graph-model/pure/graph'
import {getNodesByAgentName} from '@vt/graph-model/pure/graph'
import {getNodeTitle} from '@vt/graph-model/pure/graph/markdown-parsing'

export function getNewNodesForAgent(
    graph: Graph,
    agentName: string | undefined,
    spawnedAt: number
): Array<{nodeId: string; title: string}> {
    if (!agentName) return []

    const nodes: readonly GraphNode[] = getNodesByAgentName(graph, agentName)
    return nodes
        .filter((node: GraphNode) => {
            try {
                return statSync(node.absoluteFilePathIsID).birthtimeMs >= spawnedAt
            } catch {
                return true // file missing or race — include rather than silently drop
            }
        })
        .map((node: GraphNode) => ({
            nodeId: node.absoluteFilePathIsID,
            title: getNodeTitle(node)
        }))
}
