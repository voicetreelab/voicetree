import type {Graph, GraphNode} from '@/pure/graph'

/**
 * Find all nodes in a graph that were created by a specific agent.
 * Matches nodes where nodeUIMetadata.additionalYAMLProps['agent_name'] === agentName.
 *
 * This is used for:
 * - Blue dotted edges from terminal to created nodes (applyGraphDeltaToUI)
 * - Tracking agent progress (list_agents, wait_for_agents MCP tools)
 */
export function getNodesByAgentName(
    graph: Graph,
    agentName: string
): readonly GraphNode[] {
    const result: GraphNode[] = []
    for (const node of Object.values(graph.nodes)) {
        const nodeAgentName: string | undefined = node.nodeUIMetadata.additionalYAMLProps.get('agent_name')
        if (nodeAgentName === agentName) {
            result.push(node)
        }
    }
    return result
}
