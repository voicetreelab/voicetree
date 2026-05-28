/* eslint-disable functional/no-let */
/* eslint-disable functional/no-loop-statements */
import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { applyPositions } from './applyPositions'
import { SPAWN_RADIUS } from '../placement/angularPositionSeeding'
import { componentsOverlap, type ComponentSubgraph } from './packComponents'
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

  describe('disconnected components must not overlap (initial-load tangle bug)', () => {
    // Bug: on first folder load (no positions.json), applyPositions seeds
    // positions via angular spawning around a ghost root at the origin. With
    // multiple disconnected roots each having children, all components cluster
    // around (0,0) and overlap visually. The renderer trusts these positions
    // verbatim on initial hydration, producing the "insane crazy state" the
    // user sees until they press Tidy Layout. The fix: applyPositions must
    // separate overlapping disconnected components before returning.

    function multiComponentGraph(numComponents: number, childrenPerRoot: number): Graph {
      const nodes: Record<string, GraphNode> = {}
      for (let c: number = 0; c < numComponents; c++) {
        const rootId: string = `root_${c}.md`
        const childIds: readonly string[] = Array.from(
          { length: childrenPerRoot },
          (_: unknown, i: number): string => `c${c}_child_${i}.md`,
        )
        nodes[rootId] = createNode(rootId, childIds)
        for (const childId of childIds) {
          nodes[childId] = createNode(childId, [])
        }
      }
      return createGraph(nodes)
    }

    function buildComponentSubgraphs(graph: Graph, numComponents: number): readonly ComponentSubgraph[] {
      const memberWidth: number = 250
      const memberHeight: number = 100
      const buckets: Record<number, GraphNode[]> = {}
      for (const [id, node] of Object.entries(graph.nodes)) {
        const compIdx: number = id.startsWith('root_')
          ? parseInt(id.slice('root_'.length).replace(/\.md$/, ''), 10)
          : parseInt(id.slice(1, id.indexOf('_')), 10)
        if (!Number.isFinite(compIdx)) continue
        buckets[compIdx] ??= []
        buckets[compIdx].push(node)
      }
      const result: ComponentSubgraph[] = []
      for (let c: number = 0; c < numComponents; c++) {
        const members: readonly GraphNode[] = buckets[c] ?? []
        result.push({
          nodes: members.map(m => {
            const pos: Position | undefined = O.toUndefined(m.nodeUIMetadata.position)
            return { x: pos?.x ?? 0, y: pos?.y ?? 0, width: memberWidth, height: memberHeight }
          }),
          edges: [],
        })
      }
      return result
    }

    it('two disconnected stars with many children must not overlap', () => {
      // Two roots each with 6 children — angular seeding from a ghost root at
      // origin places these stars at adjacent quadrants where their bbox
      // halos collide.
      const graph: Graph = multiComponentGraph(2, 6)
      const positioned: Graph = applyPositions(graph)
      const subgraphs: readonly ComponentSubgraph[] = buildComponentSubgraphs(positioned, 2)
      expect(componentsOverlap(subgraphs)).toBe(false)
    })

    it('eight disconnected stars (real-folder shape) must not overlap', () => {
      // Reproduces the real "insane state" the user sees: many disconnected
      // roots, each with several children, all radially seeded around origin
      // and overlapping until Tidy Layout is pressed.
      const graph: Graph = multiComponentGraph(8, 6)
      const positioned: Graph = applyPositions(graph)
      const subgraphs: readonly ComponentSubgraph[] = buildComponentSubgraphs(positioned, 8)
      expect(componentsOverlap(subgraphs)).toBe(false)
    })

    it('preserves pre-existing positions on already-positioned nodes', () => {
      // Component separation must not move nodes that already have a saved
      // position (e.g., from positions.json). Only the freshly-seeded nodes
      // get shifted as part of their component.
      const graph: Graph = createGraph({
        'pinned_root.md': {
          ...createNode('pinned_root.md', ['pinned_child.md']),
          nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 10000, y: 10000 }),
            additionalYAMLProps: {},
            isContextNode: false,
          },
        },
        'pinned_child.md': {
          ...createNode('pinned_child.md', []),
          nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 10500, y: 10000 }),
            additionalYAMLProps: {},
            isContextNode: false,
          },
        },
        // A second component with no positions — applyPositions seeds it.
        'fresh_root.md': createNode('fresh_root.md', ['fresh_child.md']),
        'fresh_child.md': createNode('fresh_child.md', []),
      })

      const positioned: Graph = applyPositions(graph)

      const pinnedRootPos: Position | undefined = O.toUndefined(
        positioned.nodes['pinned_root.md']?.nodeUIMetadata.position,
      )
      const pinnedChildPos: Position | undefined = O.toUndefined(
        positioned.nodes['pinned_child.md']?.nodeUIMetadata.position,
      )
      expect(pinnedRootPos).toEqual({ x: 10000, y: 10000 })
      expect(pinnedChildPos).toEqual({ x: 10500, y: 10000 })
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
      additionalYAMLProps: {},
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
