/**
 * Find nodes created by an agent via agent_name matching.
 * Returns nodeId and title pairs for MCP tool responses.
 *
 * Uses getNodesByAgentName from @vt/graph-model/pure/graph for the core matching logic.
 * Filters by file birthtime >= spawnedAt to avoid name-collision with
 * previous agents that had the same recycled name.
 */

import {readFileSync, statSync} from 'fs'
import type {Graph, GraphNode} from '@vt/graph-model/graph'
import {getNodesByAgentName} from '@vt/graph-model/graph'
import {getNodeTitle, parseMarkdownToGraphNode} from '@vt/graph-model/markdown'

function nodeAgentNameFromDisk(node: GraphNode, graph: Graph): string | undefined {
    try {
        const content: string = readFileSync(node.absoluteFilePathIsID, 'utf8')
        return parseMarkdownToGraphNode(content, node.absoluteFilePathIsID, graph)
            .nodeUIMetadata.additionalYAMLProps['agent_name']
    } catch {
        return undefined
    }
}

function getNodesByAgentNameWithDiskFallback(graph: Graph, agentName: string): readonly GraphNode[] {
    const matchedNodes: readonly GraphNode[] = getNodesByAgentName(graph, agentName)
    if (matchedNodes.length > 0) return matchedNodes

    return Object.values(graph.nodes).filter(
        (node: GraphNode) => nodeAgentNameFromDisk(node, graph) === agentName
    )
}

function nodeWasCreatedAfterSpawn(node: GraphNode, spawnedAt: number): boolean {
    try {
        return statSync(node.absoluteFilePathIsID).birthtimeMs >= spawnedAt
    } catch {
        return true // file missing or race — include rather than silently drop
    }
}

export function getNewNodesForAgent(
    graph: Graph,
    agentName: string | undefined,
    spawnedAt: number
): Array<{nodeId: string; title: string}> {
    if (!agentName) return []

    const nodes: readonly GraphNode[] = getNodesByAgentNameWithDiskFallback(graph, agentName)
    return nodes
        .filter((node: GraphNode) => nodeWasCreatedAfterSpawn(node, spawnedAt))
        .map((node: GraphNode) => ({
            nodeId: node.absoluteFilePathIsID,
            title: getNodeTitle(node)
        }))
}

export function getNewNodesForAgentIdentities(
    graph: Graph,
    agentNames: readonly (string | undefined)[],
    spawnedAt: number
): Array<{nodeId: string; title: string}> {
    const identities: readonly string[] = [...new Set(agentNames.filter((name): name is string => typeof name === 'string' && name.length > 0))]
    const nodesById: Map<string, {nodeId: string; title: string}> = new Map()
    for (const agentName of identities) {
        for (const node of getNewNodesForAgent(graph, agentName, spawnedAt)) {
            nodesById.set(node.nodeId, node)
        }
    }

    // After a hard Electron crash the in-memory node index is gone and the
    // terminal record is reconstructed from tmux metadata. If the recovered
    // timestamp is newer than the graph files, keep the durable agent_name tag
    // as the fallback source of truth.
    if (nodesById.size === 0 && identities.length > 0 && spawnedAt > 0) {
        for (const agentName of identities) {
            for (const node of getNewNodesForAgent(graph, agentName, 0)) {
                nodesById.set(node.nodeId, node)
            }
        }
    }

    return [...nodesById.values()]
}
