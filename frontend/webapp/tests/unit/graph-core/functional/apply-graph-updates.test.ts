import { describe, it, expect } from 'vitest'
import { apply_graph_updates } from '../../../../src/graph-core/functional/apply-graph-updates'
import { Graph, CreateNode, UpdateNode, DeleteNode, GraphNode } from '../../../../src/graph-core/functional/types'
import * as O from 'fp-ts/Option'
import { tmpdir } from 'os'
import path from 'path'

describe('apply_graph_updates', () => {
  // Mock vault path for testing
  const testVaultPath = path.join(tmpdir(), 'test-vault')

  // Create the curried function with test vault path
  const applyUpdate = apply_graph_updates(testVaultPath)

  // Helper to create an empty graph
  const emptyGraph = (): Graph => ({
    nodes: {},
    edges: {}
  })

  // Helper to create a graph with a single node
  const graphWithNode = (nodeId: string, content: string): Graph => ({
    nodes: {
      [nodeId]: {
        id: nodeId,
        title: 'Test Node',
        content,
        summary: 'Test summary',
        color: O.none
      }
    },
    edges: {}
  })

  describe('CreateNode', () => {
    it('should create a new node in the graph', () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-1',
        content: '# New Node\n\nThis is content',
        position: O.none
      }

      const [updatedGraph, dbEffect] = applyUpdate(graph, action)

      // Verify the node was added to the graph
      expect(updatedGraph.nodes['node-1']).toBeDefined()
      expect(updatedGraph.nodes['node-1'].id).toBe('node-1')
      expect(updatedGraph.nodes['node-1'].content).toBe('# New Node\n\nThis is content')
      expect(updatedGraph.nodes['node-1'].title).toBe('New Node')

      // Verify DB effect is returned
      expect(typeof dbEffect).toBe('function')
    })

    it('should extract title from markdown header', () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-2',
        content: '# My Title\n\nContent here',
        position: O.none
      }

      const [updatedGraph] = applyUpdate(graph, action)

      expect(updatedGraph.nodes['node-2'].title).toBe('My Title')
    })

    it('should use default title when no markdown header present', () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-3',
        content: 'Just plain text',
        position: O.none
      }

      const [updatedGraph] = applyUpdate(graph, action)

      expect(updatedGraph.nodes['node-3'].title).toBe('Untitled')
    })

    it('should not modify the original graph', () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-4',
        content: '# Test',
        position: O.none
      }

      const [updatedGraph] = applyUpdate(graph, action)

      // Original graph should be unchanged
      expect(Object.keys(graph.nodes).length).toBe(0)
      // Updated graph should have the new node
      expect(Object.keys(updatedGraph.nodes).length).toBe(1)
    })
  })

  describe('UpdateNode', () => {
    it('should update an existing node with new content', () => {
      const graph = graphWithNode('node-1', '# Old Title\n\nOld content')
      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated Title\n\nNew content'
      }

      const [updatedGraph, dbEffect] = applyUpdate(graph, action)

      // Verify node was updated
      expect(updatedGraph.nodes['node-1'].content).toBe('# Updated Title\n\nNew content')
      expect(updatedGraph.nodes['node-1'].title).toBe('Updated Title')

      // Verify DB effect is returned
      expect(typeof dbEffect).toBe('function')
    })

    it('should preserve node id when updating', () => {
      const graph = graphWithNode('node-1', '# Original')
      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated'
      }

      const [updatedGraph] = applyUpdate(graph, action)

      expect(updatedGraph.nodes['node-1'].id).toBe('node-1')
    })

    it('should throw when updating non-existent node (fail fast)', () => {
      const graph = emptyGraph()
      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'non-existent',
        content: '# Some content'
      }

      // Should throw per fail-fast design philosophy
      expect(() => applyUpdate(graph, action)).toThrow('Node non-existent not found for update')
    })

    it('should not modify the original graph', () => {
      const graph = graphWithNode('node-1', '# Original')
      const originalContent = graph.nodes['node-1'].content

      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated'
      }

      const [updatedGraph] = applyUpdate(graph, action)

      // Original graph should be unchanged
      expect(graph.nodes['node-1'].content).toBe(originalContent)
      // Updated graph should have new content
      expect(updatedGraph.nodes['node-1'].content).toBe('# Updated')
    })
  })

  describe('DeleteNode', () => {
    it('should remove a node from the graph', () => {
      const graph = graphWithNode('node-1', '# Test')
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      const [updatedGraph, dbEffect] = applyUpdate(graph, action)

      // Verify node was removed
      expect(updatedGraph.nodes['node-1']).toBeUndefined()
      expect(Object.keys(updatedGraph.nodes).length).toBe(0)

      // Verify DB effect is returned
      expect(typeof dbEffect).toBe('function')
    })

    it('should remove node from edges when deleted', () => {
      const graph: Graph = {
        nodes: {
          'node-1': {
            id: 'node-1',
            title: 'Node 1',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          },
          'node-2': {
            id: 'node-2',
            title: 'Node 2',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          }
        },
        edges: {
          'node-1': ['node-2'],
          'node-2': []
        }
      }

      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      const [updatedGraph] = applyUpdate(graph, action)

      // Verify node-1's edges are removed
      expect(updatedGraph.edges['node-1']).toBeUndefined()
      // TODO: Also verify edges FROM other nodes TO node-1 are removed
    })

    it('should handle deleting non-existent node gracefully', () => {
      const graph = emptyGraph()
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'non-existent'
      }

      // Should not throw
      const [updatedGraph, dbEffect] = applyUpdate(graph, action)

      expect(typeof dbEffect).toBe('function')
      expect(Object.keys(updatedGraph.nodes).length).toBe(0)
    })

    it('should not modify the original graph', () => {
      const graph = graphWithNode('node-1', '# Test')
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      const [updatedGraph] = applyUpdate(graph, action)

      // Original graph should still have the node
      expect(graph.nodes['node-1']).toBeDefined()
      // Updated graph should not have the node
      expect(updatedGraph.nodes['node-1']).toBeUndefined()
    })
  })

  describe('Function signature and structure', () => {
    it('should return a tuple of [Graph, DBIO]', () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'test',
        content: '# Test',
        position: O.none
      }

      const result = applyUpdate(graph, action)

      // Should be an array with 2 elements
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)

      const [updatedGraph, dbEffect] = result

      // First element should be a Graph
      expect(updatedGraph).toHaveProperty('nodes')
      expect(updatedGraph).toHaveProperty('edges')

      // Second element should be a function (IO effect)
      expect(typeof dbEffect).toBe('function')
    })

    it('should handle all three action types', () => {
      const graph = graphWithNode('node-1', '# Test')

      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-2',
        content: '# New',
        position: O.none
      }

      const updateAction: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated'
      }

      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      // All should return valid results without throwing
      expect(() => applyUpdate(graph, createAction)).not.toThrow()
      expect(() => applyUpdate(graph, updateAction)).not.toThrow()
      expect(() => applyUpdate(graph, deleteAction)).not.toThrow()
    })

    it('should curry vaultPath correctly', () => {
      // Test that currying works
      const vaultPath = '/test/vault'
      const curriedApply = apply_graph_updates(vaultPath)
      expect(typeof curriedApply).toBe('function')

      // Test that the curried function returns proper results
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'test',
        content: '# Test',
        position: O.none
      }

      const [updatedGraph, dbEffect] = curriedApply(graph, action)
      expect(updatedGraph).toHaveProperty('nodes')
      expect(typeof dbEffect).toBe('function')
    })
  })
})
