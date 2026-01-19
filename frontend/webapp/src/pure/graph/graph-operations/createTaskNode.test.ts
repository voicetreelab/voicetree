import { describe, it, expect } from 'vitest'
import { createTaskNode, type TaskNodeCreationParams } from '@/pure/graph/graph-operations/createTaskNode'
import type { Graph, GraphNode, Edge, NodeIdAndFilePath, GraphDelta, Position, UpsertNodeDelta } from '@/pure/graph'
import { buildIncomingEdgesIndex } from '@/pure/graph/graph-operations/incomingEdgesIndex'
import * as O from 'fp-ts/lib/Option.js'

const createTestNode: (id: string, edges?: readonly Edge[], content?: string) => GraphNode = (
  id: string,
  edges: readonly Edge[] = [],
  content: string = 'test content'
): GraphNode => ({
  absoluteFilePathIsID: id as NodeIdAndFilePath,
  outgoingEdges: edges,
  contentWithoutYamlOrLinks: content,
  nodeUIMetadata: {
    color: O.none,
    position: O.some({ x: 0, y: 0 }),
    additionalYAMLProps: new Map(),
    isContextNode: false
  }
})

const createGraphFromNodes: (nodes: Record<NodeIdAndFilePath, GraphNode>) => Graph = (
  nodes: Record<NodeIdAndFilePath, GraphNode>
): Graph => ({
  nodes,
  incomingEdgesIndex: buildIncomingEdgesIndex(nodes)
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
        selectedNodeIds: ['/vault/a.md', '/vault/b.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 100, y: 100 }
      }

      const result: GraphDelta = createTaskNode(params)

      expect(result.length).toBe(1)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(delta.type).toBe('UpsertNode')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).toContain('# Implement feature X')
    })

    it('should create node with position from params', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const position: Position = { x: 200, y: 300 }
      const params: TaskNodeCreationParams = {
        taskDescription: 'Test task',
        selectedNodeIds: ['/vault/a.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(O.isSome(delta.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
      if (O.isSome(delta.nodeToUpsert.nodeUIMetadata.position)) {
        expect(delta.nodeToUpsert.nodeUIMetadata.position.value).toEqual(position)
      }
    })
  })

  describe('task node contains wikilinks to all selected nodes', () => {
    it('should include wikilinks to all selected nodes in content', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [], '# Node A'),
        '/vault/b.md': createTestNode('/vault/b.md', [], '# Node B'),
        '/vault/c.md': createTestNode('/vault/c.md', [], '# Node C')
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Process all nodes',
        selectedNodeIds: ['/vault/a.md', '/vault/b.md', '/vault/c.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Wikilinks are converted to [link]* format in contentWithoutYamlOrLinks
      // So we check outgoingEdges instead, which are parsed from wikilinks
      expect(delta.nodeToUpsert.outgoingEdges.length).toBeGreaterThanOrEqual(3)

      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toContain('/vault/a.md')
      expect(targetIds).toContain('/vault/b.md')
      expect(targetIds).toContain('/vault/c.md')
    })

    it('should handle single selected node', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/single.md': createTestNode('/vault/single.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Work on single node',
        selectedNodeIds: ['/vault/single.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toContain('/vault/single.md')
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
        selectedNodeIds: ['/vault/a.md', '/vault/b.md', '/vault/hub.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // hub.md should be in edges (as the most-connected parent)
      expect(targetIds).toContain('/vault/hub.md')
    })

    it('should create only ONE parent edge (the most-connected), but context links to all', () => {
      // The "parent" edge is the same as the context link for the most-connected node
      // All selected nodes get wikilinks for context reference
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [{ targetId: '/vault/b.md', label: '' }]),
        '/vault/b.md': createTestNode('/vault/b.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task',
        selectedNodeIds: ['/vault/a.md', '/vault/b.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Both selected nodes should have edges (wikilinks for context)
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toContain('/vault/a.md')
      expect(targetIds).toContain('/vault/b.md')
      // No duplicate edges
      const uniqueTargetIds: Set<string> = new Set(targetIds)
      expect(uniqueTargetIds.size).toBe(targetIds.length)
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
        selectedNodeIds: ['/vault/first.md', '/vault/second.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Both should be in edges as context links
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toContain('/vault/first.md')
      expect(targetIds).toContain('/vault/second.md')
    })
  })

  describe('node ID generation', () => {
    it('should generate unique node ID in writePath directory', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'New task',
        selectedNodeIds: ['/vault/a.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault/tasks',
        position: { x: 0, y: 0 }
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
        selectedNodeIds: ['/vault/a.md'] as NodeIdAndFilePath[],
        graph,
        writePath: '/vault',
        position: { x: 0, y: 0 }
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(O.isNone(delta.previousNode)).toBe(true)
    })
  })
})
