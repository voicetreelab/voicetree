import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { applyPositions } from '@/functional_graph/pure/positioning/applyPositions'
import type { Graph, GraphNode, NodeId, Position } from '@/functional_graph/pure/types'

describe('applyPositions', () => {
  describe('simple cases', () => {
    it('should handle empty graph', () => {
      const emptyGraph: Graph = { nodes: {} }
      const result = applyPositions(emptyGraph)
      expect(result.nodes).toEqual({})
    })

    it('should position single root node at origin radius', () => {
      const graph: Graph = {
        nodes: {
          'root.md': createNode('root.md', [])
        }
      }

      const result = applyPositions(graph)
      const rootNode = result.nodes['root.md']

      expect(O.isSome(rootNode?.nodeUIMetadata.position)).toBe(true)
      if (O.isSome(rootNode?.nodeUIMetadata.position)) {
        const pos = rootNode.nodeUIMetadata.position.value
        // Single root should be positioned at (200, 0) based on ROOT_SPAWN_RADIUS
        const distance = Math.sqrt(pos.x * pos.x + pos.y * pos.y)
        expect(distance).toBeCloseTo(200, 1)
      }
    })

    it('should position parent and child without overlap', () => {
      const graph: Graph = {
        nodes: {
          'parent.md': createNode('parent.md', ['child.md']),
          'child.md': createNode('child.md', [])
        }
      }

      const result = applyPositions(graph)

      // Both should have positions
      expect(O.isSome(result.nodes['parent.md']?.nodeUIMetadata.position)).toBe(true)
      expect(O.isSome(result.nodes['child.md']?.nodeUIMetadata.position)).toBe(true)

      // Should not be at the same position
      const parentPos = O.toUndefined(result.nodes['parent.md']?.nodeUIMetadata.position)
      const childPos = O.toUndefined(result.nodes['child.md']?.nodeUIMetadata.position)
      expect(parentPos).not.toEqual(childPos)
    })
  })

  describe('random n-ary tree with 100 nodes', () => {
    it('should position all nodes without edge overlaps', () => {
      // Generate random n-ary tree with 100 nodes
      const graph = generateRandomNAryTree(100, 6)

      // Verify initial state: all positions are None
      Object.values(graph.nodes).forEach(node => {
        expect(O.isNone(node.nodeUIMetadata.position)).toBe(true)
      })

      // Apply positions
      const result = applyPositions(graph)

      // Assertion 1: All nodes should now have positions
      const nodesWithPositions = Object.values(result.nodes).filter(node =>
        O.isSome(node.nodeUIMetadata.position)
      )
      expect(nodesWithPositions.length).toBe(Object.keys(result.nodes).length)

      // Assertion 2: No edges should overlap
      const edges = extractEdges(result)
      const overlaps = findOverlappingEdges(edges)

      if (overlaps.length > 0) {
        console.log('Found overlapping edges:', overlaps)
      }
      expect(overlaps.length).toBe(0)
    })

    it('should produce deterministic output for same input', () => {
      const graph = generateRandomNAryTree(50, 4)

      const result1 = applyPositions(graph)
      const result2 = applyPositions(graph)

      // Should produce identical positions
      Object.keys(result1.nodes).forEach(nodeId => {
        const pos1 = result1.nodes[nodeId]?.nodeUIMetadata.position
        const pos2 = result2.nodes[nodeId]?.nodeUIMetadata.position

        expect(O.isSome(pos1)).toBe(O.isSome(pos2))
        if (O.isSome(pos1) && O.isSome(pos2)) {
          expect(pos1.value).toEqual(pos2.value)
        }
      })
    })
  })

  describe('edge cases', () => {
    it('should handle graph with multiple root nodes', () => {
      const graph: Graph = {
        nodes: {
          'root1.md': createNode('root1.md', ['child1.md']),
          'root2.md': createNode('root2.md', ['child2.md']),
          'child1.md': createNode('child1.md', []),
          'child2.md': createNode('child2.md', [])
        }
      }

      const result = applyPositions(graph)

      // All nodes should have positions
      Object.values(result.nodes).forEach(node => {
        expect(O.isSome(node.nodeUIMetadata.position)).toBe(true)
      })

      // Root nodes should be at different positions
      const root1Pos = O.toUndefined(result.nodes['root1.md']?.nodeUIMetadata.position)
      const root2Pos = O.toUndefined(result.nodes['root2.md']?.nodeUIMetadata.position)
      expect(root1Pos).not.toEqual(root2Pos)
    })

    it('should handle deep tree (10 levels)', () => {
      const graph = generateDeepTree(10)
      const result = applyPositions(graph)

      // All nodes should have positions
      Object.values(result.nodes).forEach(node => {
        expect(O.isSome(node.nodeUIMetadata.position)).toBe(true)
      })
    })

    it('should preserve existing positions', () => {
      const existingPosition: Position = { x: 100, y: 100 }
      const graph: Graph = {
        nodes: {
          'root.md': {
            ...createNode('root.md', ['child.md']),
            nodeUIMetadata: {
              color: O.none,
              position: O.some(existingPosition)
            }
          },
          'child.md': createNode('child.md', [])
        }
      }

      const result = applyPositions(graph)

      // Root should keep its position
      const rootPos = result.nodes['root.md']?.nodeUIMetadata.position
      expect(O.isSome(rootPos)).toBe(true)
      if (O.isSome(rootPos)) {
        expect(rootPos.value).toEqual(existingPosition)
      }

      // Child should get a new position
      expect(O.isSome(result.nodes['child.md']?.nodeUIMetadata.position)).toBe(true)
    })
  })
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a graph node with no position
 */
function createNode(id: NodeId, outgoingEdges: readonly NodeId[]): GraphNode {
  return {
    relativeFilePathIsID: id,
    outgoingEdges,
    content: `# ${id}\n\nContent for ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none
    }
  }
}

/**
 * Generate a random n-ary tree with the specified number of nodes.
 * Each node has 0 to maxChildren children.
 */
function generateRandomNAryTree(nodeCount: number, maxChildren: number): Graph {
  if (nodeCount <= 0) {
    return { nodes: {} }
  }

  const nodes: Record<NodeId, GraphNode> = {}
  const nodeIds: NodeId[] = []

  // Create root node
  const rootId = 'node_0.md'
  nodeIds.push(rootId)
  nodes[rootId] = createNode(rootId, [])

  // Track which nodes can still have children added
  const availableParents = [rootId]
  let nextNodeIndex = 1

  // Build tree breadth-first
  while (nextNodeIndex < nodeCount && availableParents.length > 0) {
    const parentId = availableParents.shift()!
    const parent = nodes[parentId]

    // Random number of children (0 to maxChildren)
    const childCount = Math.floor(Math.random() * (maxChildren + 1))

    const children: NodeId[] = []
    for (let i = 0; i < childCount && nextNodeIndex < nodeCount; i++) {
      const childId = `node_${nextNodeIndex}.md`
      nodeIds.push(childId)
      nodes[childId] = createNode(childId, [])
      children.push(childId)
      availableParents.push(childId)
      nextNodeIndex++
    }

    // Update parent's outgoing edges
    if (children.length > 0) {
      nodes[parentId] = {
        ...parent,
        outgoingEdges: children
      }
    }
  }

  return { nodes }
}

/**
 * Generate a deep tree with specified depth (one child per node)
 */
function generateDeepTree(depth: number): Graph {
  const nodes: Record<NodeId, GraphNode> = {}

  for (let i = 0; i < depth; i++) {
    const nodeId = `node_${i}.md`
    const childId = i < depth - 1 ? `node_${i + 1}.md` : undefined
    nodes[nodeId] = createNode(nodeId, childId ? [childId] : [])
  }

  return { nodes }
}

// ============================================================================
// Edge Overlap Detection
// ============================================================================

interface Edge {
  readonly from: Position
  readonly to: Position
  readonly id: string
}

/**
 * Extract all edges from the graph with their positions
 */
function extractEdges(graph: Graph): readonly Edge[] {
  const edges: Edge[] = []

  Object.values(graph.nodes).forEach(node => {
    const fromPos = O.toUndefined(node.nodeUIMetadata.position)
    if (!fromPos) return

    node.outgoingEdges.forEach(childId => {
      const childNode = graph.nodes[childId]
      const toPos = O.toUndefined(childNode?.nodeUIMetadata.position)
      if (!toPos) return

      edges.push({
        from: fromPos,
        to: toPos,
        id: `${node.relativeFilePathIsID}->${childId}`
      })
    })
  })

  return edges
}

/**
 * Find all pairs of overlapping edges
 */
function findOverlappingEdges(edges: readonly Edge[]): readonly [Edge, Edge][] {
  const overlaps: [Edge, Edge][] = []

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const edge1 = edges[i]
      const edge2 = edges[j]

      // Skip if edges share a vertex (they're allowed to touch at endpoints)
      if (shareVertex(edge1, edge2)) {
        continue
      }

      if (segmentsIntersect(edge1.from, edge1.to, edge2.from, edge2.to)) {
        overlaps.push([edge1, edge2])
      }
    }
  }

  return overlaps
}

/**
 * Check if two edges share a vertex
 */
function shareVertex(edge1: Edge, edge2: Edge): boolean {
  return (
    positionsEqual(edge1.from, edge2.from) ||
    positionsEqual(edge1.from, edge2.to) ||
    positionsEqual(edge1.to, edge2.from) ||
    positionsEqual(edge1.to, edge2.to)
  )
}

/**
 * Check if two positions are equal (with small epsilon for floating point)
 */
function positionsEqual(p1: Position, p2: Position): boolean {
  const epsilon = 0.001
  return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon
}

/**
 * Check if two line segments intersect (excluding endpoints)
 * Uses the cross product method
 */
function segmentsIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const d1 = direction(p3, p4, p1)
  const d2 = direction(p3, p4, p2)
  const d3 = direction(p1, p2, p3)
  const d4 = direction(p1, p2, p4)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Check for collinear cases (edges on same line)
  if (d1 === 0 && onSegment(p3, p4, p1)) return true
  if (d2 === 0 && onSegment(p3, p4, p2)) return true
  if (d3 === 0 && onSegment(p1, p2, p3)) return true
  if (d4 === 0 && onSegment(p1, p2, p4)) return true

  return false
}

/**
 * Calculate the direction of point p3 relative to line segment p1->p2
 * Returns: positive if p3 is left of the line, negative if right, 0 if collinear
 */
function direction(p1: Position, p2: Position, p3: Position): number {
  return (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x)
}

/**
 * Check if point p lies on line segment p1->p2 (assuming collinear)
 */
function onSegment(p1: Position, p2: Position, p: Position): boolean {
  return (
    p.x <= Math.max(p1.x, p2.x) &&
    p.x >= Math.min(p1.x, p2.x) &&
    p.y <= Math.max(p1.y, p2.y) &&
    p.y >= Math.min(p1.y, p2.y)
  )
}
