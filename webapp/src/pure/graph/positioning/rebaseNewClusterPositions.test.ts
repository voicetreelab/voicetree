import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import { rebaseNewClusterPositions } from './rebaseNewClusterPositions'

function createNodeWithPosition(id: string, position: O.Option<Position>): GraphNode {
    return {
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: '',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position,
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
}

function makeGraph(nodes: readonly GraphNode[]): Graph {
    const record: Record<string, GraphNode> = nodes.reduce(
        (acc: Record<string, GraphNode>, n: GraphNode): Record<string, GraphNode> => ({
            ...acc,
            [n.absoluteFilePathIsID]: n,
        }),
        {},
    )
    return createGraph(record)
}

function getPos(graph: Graph, id: string): Position {
    const node: GraphNode = graph.nodes[id]
    return (node.nodeUIMetadata.position as O.Some<Position>).value
}

describe('rebaseNewClusterPositions', () => {
    it('translates far-apart new cluster near existing nodes', () => {
        const existing: readonly GraphNode[] = [
            createNodeWithPosition('a', O.some({ x: 0, y: 0 })),
            createNodeWithPosition('b', O.some({ x: 100, y: 0 })),
        ]
        const newNodes: readonly GraphNode[] = [
            createNodeWithPosition('c', O.some({ x: 50000, y: 50000 })),
            createNodeWithPosition('d', O.some({ x: 50100, y: 50000 })),
        ]
        const graph: Graph = makeGraph([...existing, ...newNodes])

        const result: Graph = rebaseNewClusterPositions(
            graph,
            ['a', 'b'],
            ['c', 'd'],
        )

        const posC: Position = getPos(result, 'c')
        const posD: Position = getPos(result, 'd')

        // New cluster should be to the right of existing (maxX=100, + 500 gap + halfWidth=50)
        // Target centroid X = 100 + 500 + 50 = 650
        // Original centroid X = 50050, offset = 650 - 50050 = -49400
        expect(posC.x).toBeCloseTo(600, 0)
        expect(posD.x).toBeCloseTo(700, 0)
        // Y should be centered on existing centroid (0)
        expect(posC.y).toBeCloseTo(0, 0)
        expect(posD.y).toBeCloseTo(0, 0)
    })

    it('scales down oversized new cluster then translates', () => {
        const existing: readonly GraphNode[] = [
            createNodeWithPosition('a', O.some({ x: 0, y: 0 })),
        ]
        // New cluster is 20,000 wide (oversized) and far away
        const newNodes: readonly GraphNode[] = [
            createNodeWithPosition('c', O.some({ x: 100000, y: 0 })),
            createNodeWithPosition('d', O.some({ x: 120000, y: 0 })),
        ]
        const graph: Graph = makeGraph([...existing, ...newNodes])

        const result: Graph = rebaseNewClusterPositions(
            graph,
            ['a'],
            ['c', 'd'],
        )

        const posC: Position = getPos(result, 'c')
        const posD: Position = getPos(result, 'd')

        // After scaling: scaleFactor = 10000/20000 = 0.5
        // centroid = (110000, 0)
        // c scaled: 110000 + (100000-110000)*0.5 = 110000 - 5000 = 105000
        // d scaled: 110000 + (120000-110000)*0.5 = 110000 + 5000 = 115000
        // Scaled bbox width = 10000, halfWidth = 5000
        // Scaled centroid = (110000, 0) - still far from existing (0,0)
        // Translation: targetX = 0 + 500 + 5000 = 5500
        // offsetX = 5500 - 110000 = -104500
        // c final: 105000 - 104500 = 500
        // d final: 115000 - 104500 = 10500
        expect(posC.x).toBeCloseTo(500, 0)
        expect(posD.x).toBeCloseTo(10500, 0)
        expect(posC.y).toBeCloseTo(0, 0)
        expect(posD.y).toBeCloseTo(0, 0)
    })

    it('returns graph unchanged when clusters are close', () => {
        const existing: readonly GraphNode[] = [
            createNodeWithPosition('a', O.some({ x: 0, y: 0 })),
        ]
        const newNodes: readonly GraphNode[] = [
            createNodeWithPosition('c', O.some({ x: 200, y: 200 })),
        ]
        const graph: Graph = makeGraph([...existing, ...newNodes])

        const result: Graph = rebaseNewClusterPositions(
            graph,
            ['a'],
            ['c'],
        )

        // Distance ~283, well under 5000 threshold
        expect(result).toBe(graph)
    })

    it('returns graph unchanged on first load (no existing nodes)', () => {
        const newNodes: readonly GraphNode[] = [
            createNodeWithPosition('a', O.some({ x: 50000, y: 50000 })),
        ]
        const graph: Graph = makeGraph(newNodes)

        const result: Graph = rebaseNewClusterPositions(
            graph,
            [],
            ['a'],
        )

        expect(result).toBe(graph)
    })

    it('only rebases positioned new nodes, ignores unpositioned', () => {
        const existing: readonly GraphNode[] = [
            createNodeWithPosition('a', O.some({ x: 0, y: 0 })),
        ]
        const newNodes: readonly GraphNode[] = [
            createNodeWithPosition('c', O.some({ x: 50000, y: 0 })),
            createNodeWithPosition('d', O.none), // no position
        ]
        const graph: Graph = makeGraph([...existing, ...newNodes])

        const result: Graph = rebaseNewClusterPositions(
            graph,
            ['a'],
            ['c', 'd'],
        )

        // c should be translated
        const posC: Position = getPos(result, 'c')
        // targetX = 0 + 500 + 0 = 500 (halfWidth=0 since single node, width=0)
        expect(posC.x).toBeCloseTo(500, 0)
        expect(posC.y).toBeCloseTo(0, 0)

        // d should remain unpositioned
        expect(O.isNone(result.nodes['d'].nodeUIMetadata.position)).toBe(true)
    })

    it('skips when no new nodes have positions', () => {
        const existing: readonly GraphNode[] = [
            createNodeWithPosition('a', O.some({ x: 0, y: 0 })),
        ]
        const newNodes: readonly GraphNode[] = [
            createNodeWithPosition('c', O.none),
            createNodeWithPosition('d', O.none),
        ]
        const graph: Graph = makeGraph([...existing, ...newNodes])

        const result: Graph = rebaseNewClusterPositions(
            graph,
            ['a'],
            ['c', 'd'],
        )

        expect(result).toBe(graph)
    })
})
