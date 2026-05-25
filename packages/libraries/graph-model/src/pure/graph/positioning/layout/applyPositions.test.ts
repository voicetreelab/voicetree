import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { applyPositions } from './applyPositions'
import { SPAWN_RADIUS } from '../placement/angularPositionSeeding'
import type { Graph, GraphNode, NodeIdAndFilePath, Position } from '../..'
import { createGraph, createEmptyGraph } from '../../construction/createGraph'

describe('applyPositions', () => {
  describe('simple cases', () => {
    it('should handle empty graph', () => {
      const emptyGraph: Graph = createEmptyGraph()
      const result: Graph = applyPositions(emptyGraph)
      expect(result.nodes).toEqual({})
    })

    it('should position single root node at origin radius', () => {
      const graph: Graph = createGraph({
        'root.md': createNode('root.md', [])
      })

      const result: Graph = applyPositions(graph)
      const rootNode: GraphNode = result.nodes['root.md']

      expect(O.isSome(rootNode?.nodeUIMetadata.position)).toBe(true)
      if (O.isSome(rootNode?.nodeUIMetadata.position)) {
        const pos: Position = rootNode.nodeUIMetadata.position.value
        // Single root should be positioned at SPAWN_RADIUS from positioning origin at origin
        const distance: number = Math.sqrt(pos.x * pos.x + pos.y * pos.y)
        expect(distance).toBeCloseTo(SPAWN_RADIUS, 1)
      }
    })

    it('should position parent and child without overlap', () => {
      const graph: Graph = createGraph({
        'parent.md': createNode('parent.md', ['child.md']),
        'child.md': createNode('child.md', [])
      })

      const result: Graph = applyPositions(graph)

      // Both should have positions
      expect(O.isSome(result.nodes['parent.md']?.nodeUIMetadata.position)).toBe(true)
      expect(O.isSome(result.nodes['child.md']?.nodeUIMetadata.position)).toBe(true)

      // Should not be at the same position
      const parentPos: Position | undefined = O.toUndefined(result.nodes['parent.md']?.nodeUIMetadata.position)
      const childPos: Position | undefined = O.toUndefined(result.nodes['child.md']?.nodeUIMetadata.position)
      expect(parentPos).not.toEqual(childPos)
    })
  })

  describe('edge cases', () => {
    it('should handle graph with multiple root nodes', () => {
      const graph: Graph = createGraph({
        'root1.md': createNode('root1.md', ['child1.md']),
        'root2.md': createNode('root2.md', ['child2.md']),
        'child1.md': createNode('child1.md', []),
        'child2.md': createNode('child2.md', [])
      })

      const result: Graph = applyPositions(graph)

      // All nodes should have positions
      Object.values(result.nodes).forEach(node => {
        expect(O.isSome(node.nodeUIMetadata.position)).toBe(true)
      })

      // Root nodes should be at different positions
      const root1Pos: Position | undefined = O.toUndefined(result.nodes['root1.md']?.nodeUIMetadata.position)
      const root2Pos: Position | undefined = O.toUndefined(result.nodes['root2.md']?.nodeUIMetadata.position)
      expect(root1Pos).not.toEqual(root2Pos)
    })

    it('should handle deep tree (10 levels)', () => {
      const graph: Graph = generateDeepTree(10)
      const result: Graph = applyPositions(graph)

      // All nodes should have positions
      Object.values(result.nodes).forEach(node => {
        expect(O.isSome(node.nodeUIMetadata.position)).toBe(true)
      })
    })
  })

})

/**
 * Create a graph node with no position
 */
function createNode(id: NodeIdAndFilePath, outgoingEdges: readonly NodeIdAndFilePath[]): GraphNode {
  return {
    kind: 'leaf',
    absoluteFilePathIsID: id,
    outgoingEdges: outgoingEdges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `# ${id}\n\nContent for ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  }
}

/**
 * Generate a deep tree with specified depth (one child per node)
 */
function generateDeepTree(depth: number): Graph {
  const nodes: Record<NodeIdAndFilePath, GraphNode> = {}

  for (let i: number = 0; i < depth; i++) {
    const nodeId: string = `node_${i}.md`
    const childId: string | undefined = i < depth - 1 ? `node_${i + 1}.md` : undefined
    nodes[nodeId] = createNode(nodeId, childId ? [childId] : [])
  }

  return createGraph(nodes)
}
