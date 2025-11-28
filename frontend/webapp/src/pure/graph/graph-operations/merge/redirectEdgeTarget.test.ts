import { describe, it, expect } from 'vitest'
import { redirectEdgeTarget } from '@/pure/graph/graph-operations/merge/redirectEdgeTarget'
import type { GraphNode, Edge, NodeIdAndFilePath } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create a minimal GraphNode
function createNode(
  id: NodeIdAndFilePath,
  outgoingEdges: readonly Edge[] = [],
  content = ''
): GraphNode {
  return {
    relativeFilePathIsID: id,
    outgoingEdges,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map()
    }
  }
}

// Helper to create an edge
function createEdge(targetId: NodeIdAndFilePath, label = ''): Edge {
  return { targetId, label }
}

describe('redirectEdgeTarget', () => {
  it('should redirect single edge with matching target', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('old-target.md', 'points to old')
    ])

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result.outgoingEdges).toEqual([
      { targetId: 'new-target.md', label: 'points to old' }
    ])
  })

  it('should redirect only matching edge when multiple edges exist', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('keep-this.md', 'unchanged'),
      createEdge('old-target.md', 'redirect this'),
      createEdge('keep-that.md', 'also unchanged')
    ])

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result.outgoingEdges).toEqual([
      { targetId: 'keep-this.md', label: 'unchanged' },
      { targetId: 'new-target.md', label: 'redirect this' },
      { targetId: 'keep-that.md', label: 'also unchanged' }
    ])
  })

  it('should return node unchanged when no matching edges', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('other.md', 'no match')
    ])

    const result: GraphNode = redirectEdgeTarget(node, 'non-existent.md', 'new-target.md')

    expect(result).toEqual(node)
    expect(result.outgoingEdges).toEqual(node.outgoingEdges)
  })

  it('should redirect all edges to same target', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('old-target.md', 'first link'),
      createEdge('old-target.md', 'second link'),
      createEdge('other.md', 'different target')
    ])

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result.outgoingEdges).toEqual([
      { targetId: 'new-target.md', label: 'first link' },
      { targetId: 'new-target.md', label: 'second link' },
      { targetId: 'other.md', label: 'different target' }
    ])
  })

  it('should preserve edge label after redirect', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('old-target.md', 'important relationship')
    ])

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result.outgoingEdges[0].label).toBe('important relationship')
  })

  it('should preserve other node properties unchanged', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('old-target.md', 'link')
    ], '# My Content\n\nSome text')

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result.relativeFilePathIsID).toBe('node.md')
    expect(result.contentWithoutYamlOrLinks).toBe('# My Content\n\nSome text')
    expect(result.nodeUIMetadata).toEqual(node.nodeUIMetadata)
  })

  it('should return node unchanged when no edges exist', () => {
    const node: GraphNode = createNode('node.md', [])

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result).toEqual(node)
    expect(result.outgoingEdges).toEqual([])
  })

  it('should handle empty label edges', () => {
    const node: GraphNode = createNode('node.md', [
      createEdge('old-target.md', '')
    ])

    const result: GraphNode = redirectEdgeTarget(node, 'old-target.md', 'new-target.md')

    expect(result.outgoingEdges).toEqual([
      { targetId: 'new-target.md', label: '' }
    ])
  })
})
