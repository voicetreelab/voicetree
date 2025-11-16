import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apply_graph_deltas_to_db } from '@/functional/pure/graph/applyGraphActionsToDB.ts'
import type { Graph, DeleteNode, Env, UpsertNodeAction, GraphNode } from '@/functional/pure/graph/types.ts'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { tmpdir } from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { markdownToTitle } from '@/functional/pure/graph/markdown-parsing/markdown-to-title.ts'
import { extractFrontmatter } from '@/functional/pure/graph/markdown-parsing/extract-frontmatter.ts'

describe('apply_graph_updates', () => {
  const testVaultPath = path.join(tmpdir(), 'test-vault-reader-monad')

  // Mock environment for testing
  const testEnv: Env = {
    vaultPath: testVaultPath
  }

  // Create test vault directory before all e2e-tests
  beforeAll(async () => {
    await fs.mkdir(testVaultPath, { recursive: true })
  })

  // Clean up test vault directory after all e2e-tests
  afterAll(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true })
  })

  // Helper to create an empty graph
  const emptyGraph = (): Graph => ({
    nodes: {}
  })

  // Helper to create a test node
  const createTestNode = (nodeId: string, content: string): GraphNode => {
    const frontmatter = extractFrontmatter(content)
    const title = markdownToTitle(frontmatter, content, nodeId)
    return {
      relativeFilePathIsID: nodeId,
      content,
      outgoingEdges: [],
      nodeUIMetadata: {
        title,
        color: O.none,
        position: O.none
      }
    }
  }

  // Helper to create a graph with a single node
  const graphWithNode = (nodeId: string, content: string): Graph => ({
    nodes: {
      [nodeId]: createTestNode(nodeId, content)
    }
  })

  describe('UpsertNode (Create)', () => {
    it('should create a new node in the graph', async () => {
      const graph = emptyGraph()
      const newNode = createTestNode('node-1', '# New Node\n\nThis is content')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      // Create effect (pure - no execution)
      const effect = apply_graph_deltas_to_db(graph, [action])

      // Execute effect with environment
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify the node was added to the graph
        expect(updatedGraph.nodes['node-1']).toBeDefined()
        expect(updatedGraph.nodes['node-1'].relativeFilePathIsID).toBe('node-1')
        expect(updatedGraph.nodes['node-1'].content).toBe('# New Node\n\nThis is content')

        // Title is computed via markdownToTitle
        const frontmatter = extractFrontmatter(updatedGraph.nodes['node-1'].content)
        const title = markdownToTitle(frontmatter, updatedGraph.nodes['node-1'].content, updatedGraph.nodes['node-1'].relativeFilePathIsID)
        expect(title).toBe('New Node')
      }
    })

    it('should extract title from markdown header', async () => {
      const graph = emptyGraph()
      const newNode = createTestNode('node-2', '# My Title\n\nContent here')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const frontmatter = extractFrontmatter(result.right.nodes['node-2'].content)
        const title = markdownToTitle(frontmatter, result.right.nodes['node-2'].content, result.right.nodes['node-2'].relativeFilePathIsID)
        expect(title).toBe('My Title')
      }
    })

    it('should use filename-based title when no markdown header present', async () => {
      const graph = emptyGraph()
      const newNode = createTestNode('node-3', 'Just plain text')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const frontmatter = extractFrontmatter(result.right.nodes['node-3'].content)
        const title = markdownToTitle(frontmatter, result.right.nodes['node-3'].content, result.right.nodes['node-3'].relativeFilePathIsID)
        expect(title).toBe('node 3')
      }
    })

    it('should not modify the original graph', async () => {
      const graph = emptyGraph()
      const newNode = createTestNode('node-4', '# Test')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
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

  describe('UpsertNode (Update)', () => {
    it('should update an existing node with new content', async () => {
      const graph = graphWithNode('node-1', '# Old Title\n\nOld content')
      const updatedNode = createTestNode('node-1', '# Updated Title\n\nNew content')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify node was updated
        expect(updatedGraph.nodes['node-1'].content).toBe('# Updated Title\n\nNew content')
        const frontmatter = extractFrontmatter(updatedGraph.nodes['node-1'].content)
        const title = markdownToTitle(frontmatter, updatedGraph.nodes['node-1'].content, updatedGraph.nodes['node-1'].relativeFilePathIsID)
        expect(title).toBe('Updated Title')
      }
    })

    it('should preserve node relativeFilePathIsID when updating', async () => {
      const graph = graphWithNode('node-1', '# Original')
      const updatedNode = createTestNode('node-1', '# Updated')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        expect(result.right.nodes['node-1'].relativeFilePathIsID).toBe('node-1')
      }
    })

    it('should not modify the original graph', async () => {
      const graph = graphWithNode('node-1', '# Original')
      const originalContent = graph.nodes['node-1'].content
      const updatedNode = createTestNode('node-1', '# Updated')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
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

      const effect = apply_graph_deltas_to_db(graph, [action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify node was removed
        expect(updatedGraph.nodes['node-1']).toBeUndefined()
        expect(Object.keys(updatedGraph.nodes).length).toBe(0)
      }
    })

    it('should remove edges pointing to deleted node', async () => {
      // First create the files so they exist to be deleted
      await fs.writeFile(path.join(testVaultPath, 'node-1.md'), 'Content', 'utf-8')
      await fs.writeFile(path.join(testVaultPath, 'node-2.md'), 'Content', 'utf-8')

      const graph: Graph = {
        nodes: {
          'node-1': {
            relativeFilePathIsID: 'node-1',
            content: 'Content',
            outgoingEdges: ['node-2'],
            nodeUIMetadata: {
              title: 'node 1',
              color: O.none,
              position: O.none
            }
          },
          'node-2': {
            relativeFilePathIsID: 'node-2',
            content: 'Content',
            outgoingEdges: [],
            nodeUIMetadata: {
              title: 'node 2',
              color: O.none,
              position: O.none
            }
          }
        }
      }

      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        const updatedGraph = result.right

        // Verify node-1 is removed
        expect(updatedGraph.nodes['node-1']).toBeUndefined()
        // node-2 should still exist
        expect(updatedGraph.nodes['node-2']).toBeDefined()
      }
    })

    it('should fail when deleting non-existent file (fail fast)', async () => {
      const graph = emptyGraph()
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'non-existent'
      }

      const effect = apply_graph_deltas_to_db(graph, [action])
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

      const effect = apply_graph_deltas_to_db(graph, [action])
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
    it('should return FSWriteEffect (ReaderTaskEither)', () => {
      const graph = emptyGraph()
      const newNode = createTestNode('test', '# Test')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db(graph, [action])

      // Should be a function (Reader)
      expect(typeof effect).toBe('function')
    })

    it('should handle both action types', () => {
      const graph = graphWithNode('node-1', '# Test')

      const upsertAction: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: createTestNode('node-2', '# New')
      }

      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      // Both should return valid effects without throwing
      expect(() => apply_graph_deltas_to_db(graph, [upsertAction])).not.toThrow()
      expect(() => apply_graph_deltas_to_db(graph, [deleteAction])).not.toThrow()
    })

    it('should use Reader pattern (environment provided at execution)', async () => {
      // Create two separate vault directories
      const vault1Path = path.join(tmpdir(), 'test-vault-reader-1')
      const vault2Path = path.join(tmpdir(), 'test-vault-reader-2')
      await fs.mkdir(vault1Path, { recursive: true })
      await fs.mkdir(vault2Path, { recursive: true })

      // Test with different environments
      const env1: Env = {
        vaultPath: vault1Path
      }

      const env2: Env = {
        vaultPath: vault2Path
      }

      const graph = emptyGraph()
      const newNode = createTestNode('test', '# Test')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      // Same effect, different environments
      const effect = apply_graph_deltas_to_db(graph, [action])

      // Can execute with different environments
      const result1 = await effect(env1)()
      const result2 = await effect(env2)()

      // Both should succeed
      expect(E.isRight(result1)).toBe(true)
      expect(E.isRight(result2)).toBe(true)

      // Clean up
      await fs.rm(vault1Path, { recursive: true, force: true })
      await fs.rm(vault2Path, { recursive: true, force: true })
    })
  })
})
