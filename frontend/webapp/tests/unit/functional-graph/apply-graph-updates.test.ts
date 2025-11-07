import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { apply_graph_deltas_to_db } from '../../../src/functional_graph/pure/applyGraphActionsToDB'
import { Graph, CreateNode, UpdateNode, DeleteNode, Node, Env } from '../../../src/functional_graph/pure/types'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { tmpdir } from 'os'
import path from 'path'
import { promises as fs } from 'fs'

describe('apply_graph_updates', () => {
  const testVaultPath = path.join(tmpdir(), 'test-vault-reader-monad')

  // Mock environment for testing
  const testEnv: Env = {
    vaultPath: testVaultPath,
    broadcast: vi.fn()
  }

  // Create test vault directory before all tests
  beforeAll(async () => {
    await fs.mkdir(testVaultPath, { recursive: true })
  })

  // Clean up test vault directory after all tests
  afterAll(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true })
  })

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
    it('should create a new node in the graph', async () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-1',
        content: '# New Node\n\nThis is content',
        position: O.none
      }

      // Create effect (pure - no execution)
      const effect = apply_graph_deltas_to_db(graph, action)

      // Execute effect with environment
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify the node was added to the graph
        expect(updatedGraph.nodes['node-1']).toBeDefined()
        expect(updatedGraph.nodes['node-1'].relativeFilePathIsID).toBe('node-1')
        expect(updatedGraph.nodes['node-1'].content).toBe('# New Node\n\nThis is content')
        expect(updatedGraph.nodes['node-1'].title).toBe('New Node')
      }
    })

    it('should extract title from markdown header', async () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-2',
        content: '# My Title\n\nContent here',
        position: O.none
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(result.right.nodes['node-2'].title).toBe('My Title')
      }
    })

    it('should use default title when no markdown header present', async () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-3',
        content: 'Just plain text',
        position: O.none
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(result.right.nodes['node-3'].title).toBe('Untitled')
      }
    })

    it('should not modify the original graph', async () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node-4',
        content: '# Test',
        position: O.none
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      // Original graph should be unchanged
      expect(Object.keys(graph.nodes).length).toBe(0)

      // Updated graph should have the new node
      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(Object.keys(result.right.nodes).length).toBe(1)
      }
    })
  })

  describe('UpdateNode', () => {
    it('should update an existing node with new content', async () => {
      const graph = graphWithNode('node-1', '# Old Title\n\nOld content')
      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated Title\n\nNew content'
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify node was updated
        expect(updatedGraph.nodes['node-1'].content).toBe('# Updated Title\n\nNew content')
        expect(updatedGraph.nodes['node-1'].title).toBe('Updated Title')
      }
    })

    it('should preserve node relativeFilePathIsID when updating', async () => {
      const graph = graphWithNode('node-1', '# Original')
      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated'
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(result.right.nodes['node-1'].relativeFilePathIsID).toBe('node-1')
      }
    })

    it('should throw when updating non-existent node (fail fast)', () => {
      const graph = emptyGraph()
      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'non-existent',
        content: '# Some content'
      }

      // Should throw per fail-fast design philosophy
      expect(() => apply_graph_deltas_to_db(graph, action)).toThrow('Node non-existent not found for update')
    })

    it('should not modify the original graph', async () => {
      const graph = graphWithNode('node-1', '# Original')
      const originalContent = graph.nodes['node-1'].content

      const action: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'node-1',
        content: '# Updated'
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      // Original graph should be unchanged
      expect(graph.nodes['node-1'].content).toBe(originalContent)

      // Updated graph should have new content
      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(result.right.nodes['node-1'].content).toBe('# Updated')
      }
    })
  })

  describe('DeleteNode', () => {
    it('should remove a node from the graph', async () => {
      // First create the file so it exists to be deleted
      await fs.writeFile(path.join(testVaultPath, 'node-1.md'), '# Test', 'utf-8')

      const graph = graphWithNode('node-1', '# Test')
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify node was removed
        expect(updatedGraph.nodes['node-1']).toBeUndefined()
        expect(Object.keys(updatedGraph.nodes).length).toBe(0)
      }
    })

    it('should remove node from outgoingEdges when deleted', async () => {
      // First create the files so they exist to be deleted
      await fs.writeFile(path.join(testVaultPath, 'node-1.md'), 'Content', 'utf-8')
      await fs.writeFile(path.join(testVaultPath, 'node-2.md'), 'Content', 'utf-8')

      const graph: Graph = {
        nodes: {
          'node-1': {
            relativeFilePathIsID: 'node-1',
            title: 'Node 1',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          },
          'node-2': {
            relativeFilePathIsID: 'node-2',
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

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify node-1's outgoingEdges are removed
        expect(updatedGraph.edges['node-1']).toBeUndefined()
      }
    })

    it('should fail when deleting non-existent file (fail fast)', async () => {
      const graph = emptyGraph()
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'non-existent'
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      // Fail fast - deleting non-existent file should fail
      expect(E.isLeft(result)).toBe(true)
      if (E.isLeft(result)) {
        expect(result.left.message).toContain('ENOENT')
      }
    })

    it('should not modify the original graph', async () => {
      // First create the file so it exists to be deleted
      await fs.writeFile(path.join(testVaultPath, 'node-1.md'), '# Test', 'utf-8')

      const graph = graphWithNode('node-1', '# Test')
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      const effect = apply_graph_deltas_to_db(graph, action)
      const result = await effect(testEnv)()

      // Original graph should still have the node
      expect(graph.nodes['node-1']).toBeDefined()

      // Updated graph should not have the node
      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(result.right.nodes['node-1']).toBeUndefined()
      }
    })
  })

  describe('Function signature and structure', () => {
    it('should return AppEffect (ReaderTaskEither)', () => {
      const graph = emptyGraph()
      const action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'test',
        content: '# Test',
        position: O.none
      }

      const effect = apply_graph_deltas_to_db(graph, action)

      // Should be a function (Reader)
      expect(typeof effect).toBe('function')
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

      // All should return valid effects without throwing
      expect(() => apply_graph_deltas_to_db(graph, createAction)).not.toThrow()
      expect(() => apply_graph_deltas_to_db(graph, updateAction)).not.toThrow()
      expect(() => apply_graph_deltas_to_db(graph, deleteAction)).not.toThrow()
    })

    it('should use Reader pattern (environment provided at execution)', async () => {
      // Create two separate vault directories
      const vault1Path = path.join(tmpdir(), 'test-vault-reader-1')
      const vault2Path = path.join(tmpdir(), 'test-vault-reader-2')
      await fs.mkdir(vault1Path, { recursive: true })
      await fs.mkdir(vault2Path, { recursive: true })

      try {
        // Test with different environments
        const env1: Env = {
          vaultPath: vault1Path,
          broadcast: vi.fn()
        }

        const env2: Env = {
          vaultPath: vault2Path,
          broadcast: vi.fn()
        }

        const graph = emptyGraph()
        const action: CreateNode = {
          type: 'CreateNode',
          nodeId: 'test',
          content: '# Test',
          position: O.none
        }

        // Same effect, different environments
        const effect = apply_graph_deltas_to_db(graph, action)

        // Can execute with different environments
        const result1 = await effect(env1)()
        const result2 = await effect(env2)()

        // Both should succeed
        expect(E.isRight(result1)).toBe(true)
        expect(E.isRight(result2)).toBe(true)
      } finally {
        // Clean up
        await fs.rm(vault1Path, { recursive: true, force: true })
        await fs.rm(vault2Path, { recursive: true, force: true })
      }
    })
  })
})
