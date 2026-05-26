import { describe, it, expect } from 'vitest'
import { createTaskNode, type TaskNodeCreationParams } from './createTaskNode'
import type { Graph, GraphNode, Edge, NodeIdAndFilePath, GraphDelta, UpsertNodeDelta } from '../..'
import { buildIncomingEdgesIndex } from '../indexes/incomingEdgesIndex'
import * as O from 'fp-ts/lib/Option.js'

const createTestNode: (id: string, edges?: readonly Edge[], content?: string) => GraphNode = (
  id: string,
  edges: readonly Edge[] = [],
  content: string = 'test content'
): GraphNode => ({
  kind: 'leaf',
  absoluteFilePathIsID: id as NodeIdAndFilePath,
  outgoingEdges: edges,
  contentWithoutYamlOrLinks: content,
  nodeUIMetadata: {
    color: O.none,
    position: O.some({ x: 0, y: 0 }),
    additionalYAMLProps: {},
    isContextNode: false
  }
})

const createGraphFromNodes: (nodes: Record<NodeIdAndFilePath, GraphNode>) => Graph = (
  nodes: Record<NodeIdAndFilePath, GraphNode>
): Graph => ({
  nodes,
  incomingEdgesIndex: buildIncomingEdgesIndex(nodes),
  nodeByBaseName: new Map(),
  unresolvedLinksIndex: new Map()
})

describe('createTaskNode', () => {
  describe('task node created with user description content', () => {
    it('should create node with user description as heading', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', []),
        '/vault/b.md': createTestNode('/vault/b.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Implement feature X',
        selectedNodeIds: ['/vault/a.md', '/vault/b.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      expect(result.length).toBe(1)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(delta.type).toBe('UpsertNode')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).toContain('# Implement feature X')
    })

    it('should create node with position O.none (resolver fills in at delta-apply time)', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Test task',
        selectedNodeIds: ['/vault/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(O.isNone(delta.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
    })
  })

  describe('task node links only to parent, not all selected nodes', () => {
    it('should only have parent edge, not edges to all selected nodes', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [], '# Node A'),
        '/vault/b.md': createTestNode('/vault/b.md', [], '# Node B'),
        '/vault/c.md': createTestNode('/vault/c.md', [], '# Node C')
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Process all nodes',
        selectedNodeIds: ['/vault/a.md', '/vault/b.md', '/vault/c.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Only the most-connected parent edge, not all selected nodes
      expect(delta.nodeToUpsert.outgoingEdges.length).toBe(1)
    })

    it('should handle single selected node with only parent edge', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/single.md': createTestNode('/vault/single.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Work on single node',
        selectedNodeIds: ['/vault/single.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toEqual(['/vault/single.md'])
    })
  })

  describe('task node links to most-connected parent', () => {
    it('should have edge to the most-connected node from selection', () => {
      // Graph: hub -> a, hub -> b, hub -> c (hub has 3 outgoing)
      // Selection: [a, b, hub] - hub should be the parent (most connected)
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/hub.md': createTestNode('/vault/hub.md', [
          { targetId: '/vault/a.md', label: '' },
          { targetId: '/vault/b.md', label: '' },
          { targetId: '/vault/c.md', label: '' }
        ]),
        '/vault/a.md': createTestNode('/vault/a.md', []),
        '/vault/b.md': createTestNode('/vault/b.md', []),
        '/vault/c.md': createTestNode('/vault/c.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task for hub selection',
        selectedNodeIds: ['/vault/a.md', '/vault/b.md', '/vault/hub.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // hub.md should be in edges (as the most-connected parent)
      expect(targetIds).toContain('/vault/hub.md')
    })

    it('should create only ONE parent edge to the most-connected node', () => {
      // a.md has 1 outgoing edge, b.md has 0 — a.md is most connected
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [{ targetId: '/vault/b.md', label: '' }]),
        '/vault/b.md': createTestNode('/vault/b.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task',
        selectedNodeIds: ['/vault/a.md', '/vault/b.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // Only the most-connected parent (a.md), not all selected nodes
      expect(targetIds).toEqual(['/vault/a.md'])
    })

    it('should use selection order for tie-breaking when finding most-connected', () => {
      // Both nodes have same edge count (0), first selected wins
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/first.md': createTestNode('/vault/first.md', []),
        '/vault/second.md': createTestNode('/vault/second.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task with tie',
        selectedNodeIds: ['/vault/first.md', '/vault/second.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Only the parent edge — first.md wins the tie
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toEqual(['/vault/first.md'])
    })
  })

  describe('parent wikilink uses basename form, not absolute path', () => {
    it('should write parent wikilink as basename without .md extension', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/subdir/parent-node.md': createTestNode('/vault/subdir/parent-node.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'A task',
        selectedNodeIds: ['/vault/subdir/parent-node.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta

      // Parent reference should be the basename, not the absolute path.
      // contentWithoutYamlOrLinks has wikilinks rewritten as [name]*, so we
      // assert on that stripped form to match the public observable contract.
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).toContain('[parent-node]*')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).not.toContain('/vault/subdir/parent-node.md')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).not.toContain('parent-node.md')
    })

    it('should still resolve the parent edge to the full node id', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/subdir/parent-node.md': createTestNode('/vault/subdir/parent-node.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'A task',
        selectedNodeIds: ['/vault/subdir/parent-node.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // Edge resolution still finds the absolute-path-keyed node via basename
      // suffix match, so the graph wiring is unchanged.
      expect(targetIds).toEqual(['/vault/subdir/parent-node.md'])
    })

  })

  describe('node ID generation', () => {
    it('should generate unique node ID in writeFolder directory', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'New task',
        selectedNodeIds: ['/vault/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault/tasks',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(delta.nodeToUpsert.absoluteFilePathIsID).toMatch(/^\/vault\/tasks\//)
      expect(delta.nodeToUpsert.absoluteFilePathIsID).toMatch(/\.md$/)
    })

    it('should return delta with previousNode as none (new node)', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'New task',
        selectedNodeIds: ['/vault/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolder: '/vault',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(O.isNone(delta.previousNode)).toBe(true)
    })
  })
})
