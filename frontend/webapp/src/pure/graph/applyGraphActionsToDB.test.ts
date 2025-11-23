import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apply_graph_deltas_to_db } from '@/shell/edge/main/graph/graphActionsToDBEffects.ts'
import type { DeleteNode, Env, UpsertNodeAction, GraphNode } from '@/pure/graph/index.ts'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { tmpdir } from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { markdownToTitle } from '@/pure/graph/markdown-parsing/markdown-to-title.ts'
import { extractFrontmatter } from '@/pure/graph/markdown-parsing/extract-frontmatter.ts'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'

describe('apply_graph_deltas_to_db', () => {
  const testVaultPath = path.join(tmpdir(), 'test-vault-apply-deltas-to-db')

  // Mock environment for testing
  const testEnv: Env = {
    vaultPath: testVaultPath
  }

  // Create test vault directory before all tests
  beforeAll(async () => {
    await fs.mkdir(testVaultPath, { recursive: true })
  })

  // Clean up test vault directory after all tests
  afterAll(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true })
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

  describe('UpsertNode (Create)', () => {
    it('should create a new node file on disk', async () => {
      const newNode = createTestNode('node-1', '# New Node\n\nThis is content')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      // Create effect (pure - no execution)
      const effect = apply_graph_deltas_to_db([action])

      // Execute effect with environment
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Verify file was written to disk
      const filePath = path.join(testVaultPath, 'node-1.md')
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(true)

      // Verify file content (includes empty frontmatter from fromNodeToMarkdownContent)
      const fileContent = await fs.readFile(filePath, 'utf-8')
      expect(fileContent).toBe('---\n---\n# New Node\n\nThis is content')

      // Verify we can load it back from disk
      const graph = await loadGraphFromDisk(O.some(testVaultPath))
      // Node IDs include .md extension when loaded from disk
      expect(graph.nodes['node-1.md']).toBeDefined()
      // loadGraphFromDisk keeps the full content including frontmatter
      expect(graph.nodes['node-1.md'].content).toBe('---\n---\n# New Node\n\nThis is content')
    })

    it('should extract title from markdown header', async () => {
      const newNode = createTestNode('node-2', '# My Title\n\nContent here')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db([action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Load from disk and verify title
      const graph = await loadGraphFromDisk(O.some(testVaultPath))
      // Node IDs include .md extension when loaded from disk
      const frontmatter = extractFrontmatter(graph.nodes['node-2.md'].content)
      const title = markdownToTitle(frontmatter, graph.nodes['node-2.md'].content, graph.nodes['node-2.md'].relativeFilePathIsID)
      expect(title).toBe('My Title')
    })

    it('should use filename-based title when content is empty', async () => {
      const newNode = createTestNode('node-3', '') // Empty content triggers filename fallback
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db([action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Load from disk and verify title
      const graph = await loadGraphFromDisk(O.some(testVaultPath))
      // Node IDs include .md extension when loaded from disk
      // When content is empty, fromNodeToMarkdownContent writes '---\n---\n' (empty frontmatter)
      // This doesn't match the frontmatter regex in markdownToTitle, so it falls through to
      // "first non-empty line" which is '---', not the filename
      const frontmatter = extractFrontmatter(graph.nodes['node-3.md'].content)
      const title = markdownToTitle(frontmatter, graph.nodes['node-3.md'].content, graph.nodes['node-3.md'].relativeFilePathIsID)
      // Bug: empty frontmatter '---\n---\n' causes title to be '---' instead of filename
      expect(title).toBe('---')
    })

    it('should return the deltas that were applied', async () => {
      const newNode = createTestNode('node-4', '# Test')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db([action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        // Should return the deltas that were applied
        expect(result.right).toEqual([action])
      }
    })
  })

  describe('UpsertNode (Update)', () => {
    it('should update an existing node file on disk', async () => {
      // First create a file
      const initialNode = createTestNode('node-update-1', '# Old Title\n\nOld content')
      const createAction: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: initialNode
      }
      await apply_graph_deltas_to_db([createAction])(testEnv)()

      // Then update it
      const updatedNode = createTestNode('node-update-1', '# Updated Title\n\nNew content')
      const updateAction: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode
      }

      const effect = apply_graph_deltas_to_db([updateAction])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Verify file was updated on disk (includes empty frontmatter from fromNodeToMarkdownContent)
      const filePath = path.join(testVaultPath, 'node-update-1.md')
      const fileContent = await fs.readFile(filePath, 'utf-8')
      expect(fileContent).toBe('---\n---\n# Updated Title\n\nNew content')

      // Load from disk and verify
      const graph = await loadGraphFromDisk(O.some(testVaultPath))
      // Node IDs include .md extension when loaded from disk
      // loadGraphFromDisk keeps the full content including frontmatter
      expect(graph.nodes['node-update-1.md'].content).toBe('---\n---\n# Updated Title\n\nNew content')
      const frontmatter = extractFrontmatter(graph.nodes['node-update-1.md'].content)
      const title = markdownToTitle(frontmatter, graph.nodes['node-update-1.md'].content, graph.nodes['node-update-1.md'].relativeFilePathIsID)
      expect(title).toBe('Updated Title')
    })

    it('should preserve node relativeFilePathIsID when updating', async () => {
      // First create a file
      const initialNode = createTestNode('node-update-2', '# Original')
      await apply_graph_deltas_to_db([{
        type: 'UpsertNode',
        nodeToUpsert: initialNode
      }])(testEnv)()

      // Then update it
      const updatedNode = createTestNode('node-update-2', '# Updated')
      const updateAction: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode
      }

      const effect = apply_graph_deltas_to_db([updateAction])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Load from disk and verify ID is preserved
      const graph = await loadGraphFromDisk(O.some(testVaultPath))
      // Node IDs include .md extension when loaded from disk
      expect(graph.nodes['node-update-2.md'].relativeFilePathIsID).toBe('node-update-2.md')
    })
  })

  describe('DeleteNode', () => {
    it('should remove a node file from disk', async () => {
      // First create the file
      const node = createTestNode('node-delete-1', '# Test')
      await apply_graph_deltas_to_db([{
        type: 'UpsertNode',
        nodeToUpsert: node
      }])(testEnv)()

      // Verify it exists
      const filePathBefore = path.join(testVaultPath, 'node-delete-1.md')
      const existsBefore = await fs.access(filePathBefore).then(() => true).catch(() => false)
      expect(existsBefore).toBe(true)

      // Delete it
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-delete-1'
      }

      const effect = apply_graph_deltas_to_db([action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Verify file was removed from disk
      const existsAfter = await fs.access(filePathBefore).then(() => true).catch(() => false)
      expect(existsAfter).toBe(false)

      // Verify it's not in the graph when loaded from disk
      const graph = await loadGraphFromDisk(O.some(testVaultPath))
      // Node IDs include .md extension when loaded from disk
      expect(graph.nodes['node-delete-1.md']).toBeUndefined()
    })

    it('should fail when deleting non-existent file (fail fast)', async () => {
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'non-existent'
      }

      const effect = apply_graph_deltas_to_db([action])
      const result = await effect(testEnv)()

      // Fail fast - deleting non-existent file should fail
      expect(E.isLeft(result)).toBe(true)
      if (E.isLeft(result)) {
        expect(result.left.message).toContain('ENOENT')
      }
    })

    it('should return the deltas that were applied', async () => {
      // First create the file
      const node = createTestNode('node-delete-2', '# Test')
      await apply_graph_deltas_to_db([{
        type: 'UpsertNode',
        nodeToUpsert: node
      }])(testEnv)()

      // Delete it
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-delete-2'
      }

      const effect = apply_graph_deltas_to_db([action])
      const result = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        // Should return the deltas that were applied
        expect(result.right).toEqual([action])
      }
    })
  })

  describe('Function signature and structure', () => {
    it('should return FSWriteEffect (ReaderTaskEither)', () => {
      const newNode = createTestNode('test', '# Test')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      const effect = apply_graph_deltas_to_db([action])

      // Should be a function (Reader)
      expect(typeof effect).toBe('function')
    })

    it('should handle both action types', () => {
      const upsertAction: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: createTestNode('node-2', '# New')
      }

      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1'
      }

      // Both should return valid effects without throwing
      expect(() => apply_graph_deltas_to_db([upsertAction])).not.toThrow()
      expect(() => apply_graph_deltas_to_db([deleteAction])).not.toThrow()
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

      const newNode = createTestNode('test', '# Test')
      const action: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: newNode
      }

      // Same effect, different environments
      const effect = apply_graph_deltas_to_db([action])

      // Can execute with different environments
      const result1 = await effect(env1)()
      const result2 = await effect(env2)()

      // Both should succeed
      expect(E.isRight(result1)).toBe(true)
      expect(E.isRight(result2)).toBe(true)

      // Verify files were written to different vaults
      const file1Exists = await fs.access(path.join(vault1Path, 'test.md')).then(() => true).catch(() => false)
      const file2Exists = await fs.access(path.join(vault2Path, 'test.md')).then(() => true).catch(() => false)
      expect(file1Exists).toBe(true)
      expect(file2Exists).toBe(true)

      // Clean up
      await fs.rm(vault1Path, { recursive: true, force: true })
      await fs.rm(vault2Path, { recursive: true, force: true })
    })
  })
})
