import { describe, it, expect } from 'vitest'
import { createTaskNode, type TaskNodeCreationParams } from './createTaskNode'
import type { Graph, GraphNode, Edge, NodeIdAndFilePath, GraphDelta, UpsertNodeDelta } from '../..'
import { buildIncomingEdgesIndex } from '../indexes/incomingEdgesIndex'
import { buildNodeByBaseNameIndex } from '../indexes/linkResolutionIndexes'
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
  nodeByBaseName: buildNodeByBaseNameIndex(nodes),
  unresolvedLinksIndex: new Map()
})

describe('createTaskNode', () => {
  describe('task node created with user description content', () => {
    it('should create node with user description as heading', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', []),
        '/project/b.md': createTestNode('/project/b.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Implement feature X',
        selectedNodeIds: ['/project/a.md', '/project/b.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      expect(result.length).toBe(1)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(delta.type).toBe('UpsertNode')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).toContain('# Implement feature X')
    })

    it('should create node with position O.none (resolver fills in at delta-apply time)', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Test task',
        selectedNodeIds: ['/project/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(O.isNone(delta.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
    })
  })

  describe('task node links only to parent, not all selected nodes', () => {
    it('should only have parent edge, not edges to all selected nodes', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [], '# Node A'),
        '/project/b.md': createTestNode('/project/b.md', [], '# Node B'),
        '/project/c.md': createTestNode('/project/c.md', [], '# Node C')
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Process all nodes',
        selectedNodeIds: ['/project/a.md', '/project/b.md', '/project/c.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Only the most-connected parent edge, not all selected nodes
      expect(delta.nodeToUpsert.outgoingEdges.length).toBe(1)
    })

    it('should handle single selected node with only parent edge', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/single.md': createTestNode('/project/single.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Work on single node',
        selectedNodeIds: ['/project/single.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toEqual(['/project/single.md'])
    })
  })

  describe('task node links to most-connected parent', () => {
    it('should have edge to the most-connected node from selection', () => {
      // Graph: hub -> a, hub -> b, hub -> c (hub has 3 outgoing)
      // Selection: [a, b, hub] - hub should be the parent (most connected)
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/hub.md': createTestNode('/project/hub.md', [
          { targetId: '/project/a.md', label: '' },
          { targetId: '/project/b.md', label: '' },
          { targetId: '/project/c.md', label: '' }
        ]),
        '/project/a.md': createTestNode('/project/a.md', []),
        '/project/b.md': createTestNode('/project/b.md', []),
        '/project/c.md': createTestNode('/project/c.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task for hub selection',
        selectedNodeIds: ['/project/a.md', '/project/b.md', '/project/hub.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // hub.md should be in edges (as the most-connected parent)
      expect(targetIds).toContain('/project/hub.md')
    })

    it('should create only ONE parent edge to the most-connected node', () => {
      // a.md has 1 outgoing edge, b.md has 0 — a.md is most connected
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [{ targetId: '/project/b.md', label: '' }]),
        '/project/b.md': createTestNode('/project/b.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task',
        selectedNodeIds: ['/project/a.md', '/project/b.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // Only the most-connected parent (a.md), not all selected nodes
      expect(targetIds).toEqual(['/project/a.md'])
    })

    it('should use selection order for tie-breaking when finding most-connected', () => {
      // Both nodes have same edge count (0), first selected wins
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/first.md': createTestNode('/project/first.md', []),
        '/project/second.md': createTestNode('/project/second.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'Task with tie',
        selectedNodeIds: ['/project/first.md', '/project/second.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      // Only the parent edge — first.md wins the tie
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      expect(targetIds).toEqual(['/project/first.md'])
    })
  })

  describe('parent wikilink uses basename form, not absolute path', () => {
    it('should write parent wikilink as basename without .md extension', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/subdir/parent-node.md': createTestNode('/project/subdir/parent-node.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'A task',
        selectedNodeIds: ['/project/subdir/parent-node.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project'
      }

      const result: GraphDelta = createTaskNode(params)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta

      // Parent reference should be the basename, not the absolute path.
      // contentWithoutYamlOrLinks has wikilinks rewritten as [name]*, so we
      // assert on that stripped form to match the public observable contract.
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).toContain('[parent-node]*')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).not.toContain('/project/subdir/parent-node.md')
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).not.toContain('parent-node.md')
    })

    it('should mark the parent line with a system-managed HTML comment so spawned children do not mimic it', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'A task',
        selectedNodeIds: ['/project/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project'
      }

      const result: GraphDelta = createTaskNode(params)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta

      // Spawned children read this content embedded in their context node.
      // The comment differentiates the daemon-written parent line from a
      // pattern children should imitate when authoring their own progress
      // nodes. Without it, children mimic `- parent [[X]]` and attach to
      // the grandparent.
      expect(delta.nodeToUpsert.contentWithoutYamlOrLinks).toContain(
        '<!-- system-managed parent edge — do not mimic this pattern in your own progress nodes -->'
      )
    })

    it('should still resolve the parent edge to the full node id', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/subdir/parent-node.md': createTestNode('/project/subdir/parent-node.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'A task',
        selectedNodeIds: ['/project/subdir/parent-node.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project'
      }

      const result: GraphDelta = createTaskNode(params)
      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      const targetIds: readonly string[] = delta.nodeToUpsert.outgoingEdges.map(e => e.targetId)
      // Edge resolution still finds the absolute-path-keyed node via basename
      // suffix match, so the graph wiring is unchanged.
      expect(targetIds).toEqual(['/project/subdir/parent-node.md'])
    })

  })

  describe('node ID generation', () => {
    it('should generate unique node ID in writeFolderPath directory', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'New task',
        selectedNodeIds: ['/project/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project/tasks',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(delta.nodeToUpsert.absoluteFilePathIsID).toMatch(/^\/project\/tasks\//)
      expect(delta.nodeToUpsert.absoluteFilePathIsID).toMatch(/\.md$/)
    })

    it('should return delta with previousNode as none (new node)', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const params: TaskNodeCreationParams = {
        taskDescription: 'New task',
        selectedNodeIds: ['/project/a.md'] as readonly NodeIdAndFilePath[],
        graph,
        writeFolderPath: '/project',
      }

      const result: GraphDelta = createTaskNode(params)

      const delta: UpsertNodeDelta = result[0] as UpsertNodeDelta
      expect(O.isNone(delta.previousNode)).toBe(true)
    })
  })
})
