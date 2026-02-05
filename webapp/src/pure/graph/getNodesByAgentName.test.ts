import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {getNodesByAgentName} from './getNodesByAgentName'
import type {Graph, GraphNode} from '@/pure/graph'

function createMockNode(nodeId: string, agentName?: string): GraphNode {
    const additionalYAMLProps: Map<string, string> = new Map()
    if (agentName) {
        additionalYAMLProps.set('agent_name', agentName)
    }
    return {
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: 'test content',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps
        }
    }
}

function createMockGraph(nodes: GraphNode[]): Graph {
    const nodesRecord: Record<string, GraphNode> = {}
    for (const node of nodes) {
        nodesRecord[node.absoluteFilePathIsID] = node
    }
    return {
        nodes: nodesRecord,
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

describe('getNodesByAgentName', () => {
    it('returns nodes matching the agent name', () => {
        const node1: GraphNode = createMockNode('node-1.md', 'agent-alpha')
        const node2: GraphNode = createMockNode('node-2.md', 'agent-alpha')
        const node3: GraphNode = createMockNode('node-3.md', 'agent-beta')
        const graph: Graph = createMockGraph([node1, node2, node3])

        const result: readonly GraphNode[] = getNodesByAgentName(graph, 'agent-alpha')

        expect(result).toHaveLength(2)
        expect(result.map(n => n.absoluteFilePathIsID)).toContain('node-1.md')
        expect(result.map(n => n.absoluteFilePathIsID)).toContain('node-2.md')
    })

    it('returns empty array when no nodes match', () => {
        const node1: GraphNode = createMockNode('node-1.md', 'agent-alpha')
        const graph: Graph = createMockGraph([node1])

        const result: readonly GraphNode[] = getNodesByAgentName(graph, 'agent-gamma')

        expect(result).toHaveLength(0)
    })

    it('returns empty array for empty graph', () => {
        const graph: Graph = createMockGraph([])

        const result: readonly GraphNode[] = getNodesByAgentName(graph, 'any-agent')

        expect(result).toHaveLength(0)
    })

    it('excludes nodes without agent_name', () => {
        const node1: GraphNode = createMockNode('node-1.md', 'agent-alpha')
        const node2: GraphNode = createMockNode('node-2.md') // no agent_name
        const graph: Graph = createMockGraph([node1, node2])

        const result: readonly GraphNode[] = getNodesByAgentName(graph, 'agent-alpha')

        expect(result).toHaveLength(1)
        expect(result[0].absoluteFilePathIsID).toBe('node-1.md')
    })

    it('is case-sensitive for agent name matching', () => {
        const node1: GraphNode = createMockNode('node-1.md', 'Agent-Alpha')
        const graph: Graph = createMockGraph([node1])

        const resultLower: readonly GraphNode[] = getNodesByAgentName(graph, 'agent-alpha')
        const resultUpper: readonly GraphNode[] = getNodesByAgentName(graph, 'Agent-Alpha')

        expect(resultLower).toHaveLength(0)
        expect(resultUpper).toHaveLength(1)
    })
})
