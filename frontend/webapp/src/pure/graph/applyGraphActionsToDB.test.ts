import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apply_graph_deltas_to_db } from '@/shell/edge/main/graph/graphActionsToDBEffects'
import type { DeleteNode, Env, UpsertNodeDelta, GraphNode, FSWriteEffect, GraphDelta, Graph } from '@/pure/graph/index'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { tmpdir } from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { markdownToTitle } from '@/pure/graph/markdown-parsing/markdown-to-title'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/loadGraphFromDisk'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce'

describe('apply_graph_deltas_to_db', () => {
  const testVaultPath: string = path.join(tmpdir(), 'test-vault-apply-deltas-to-db')

  // Mock environment for testing
  const testEnv: Env = {
    watchedDirectory: testVaultPath
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
  const createTestNode: (nodeId: string, content: string) => GraphNode = (nodeId: string, content: string): GraphNode => {
    return {
      relativeFilePathIsID: nodeId,
      contentWithoutYamlOrLinks: content,
      outgoingEdges: [],
      nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: new Map(),
        isContextNode: false
      }
    }
  }

  describe('UpsertNode (Create)', () => {
    it('should create a new node file on disk', async () => {
      const newNode: GraphNode = createTestNode('node-1', '# New Node\n\nThis is content')
      const action: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: newNode,
        previousNode: O.none
      }

      // Create effect (pure - no execution)
      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])

      // Execute effect with environment
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Verify file was written to disk
      const filePath: string = path.join(testVaultPath, 'node-1.md')
      const fileExists: boolean = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(true)

      // Verify file content (frontmatter includes isContextNode but NOT title - title is derived from markdown)
      const fileContent: string = await fs.readFile(filePath, 'utf-8')
      expect(fileContent).toBe('---\nisContextNode: false\n---\n# New Node\n\nThis is content')

      // Verify we can load it back from disk
      const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(testVaultPath), O.none)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(loadResult)) throw new Error('Expected Right')
      const graph: Graph = loadResult.right
      // Node IDs include .md extension when loaded from disk
      expect(graph.nodes['node-1.md']).toBeDefined()
      // parseMarkdownToGraphNode strips YAML frontmatter from contentWithoutYamlOrLinks
      expect(graph.nodes['node-1.md'].contentWithoutYamlOrLinks).toBe('# New Node\n\nThis is content')
    })

    it('should extract title from markdown header', async () => {
      const newNode: GraphNode = createTestNode('node-2', '# My Title\n\nContent here')
      const action: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: newNode,
        previousNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Load from disk and verify title
      const loadResult2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(testVaultPath), O.none)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(loadResult2)) throw new Error('Expected Right')
      const graph: Graph = loadResult2.right
      // Node IDs include .md extension when loaded from disk
      // Title is derived from Markdown content (single source of truth)
      const title: string = markdownToTitle(graph.nodes['node-2.md'].contentWithoutYamlOrLinks, graph.nodes['node-2.md'].relativeFilePathIsID)
      expect(title).toBe('My Title')
    })

    it('should use filename-based title when content is empty', async () => {
      const newNode: GraphNode = createTestNode('node-3', '') // Empty content triggers filename fallback
      const action: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: newNode,
        previousNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Load from disk and verify title
      const loadResult3: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(testVaultPath), O.none)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(loadResult3)) throw new Error('Expected Right')
      const graph: Graph = loadResult3.right
      // Node IDs include .md extension when loaded from disk
      // When content is empty, fromNodeToMarkdownContent writes '---\n---\n' (empty frontmatter)
      // parseMarkdownToGraphNode strips the frontmatter, leaving empty content
      // markdownToTitle falls back to filename when content is empty
      // Title is derived from Markdown content (single source of truth)
      const title: string = markdownToTitle(graph.nodes['node-3.md'].contentWithoutYamlOrLinks, graph.nodes['node-3.md'].relativeFilePathIsID)
      // Empty content falls back to filename-based title
      expect(title).toBe('node 3')
    })

    it('should return the deltas that were applied', async () => {
      const newNode: GraphNode = createTestNode('node-4', '# Test')
      const action: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: newNode,
        previousNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

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
      const initialNode: GraphNode = createTestNode('node-update-1', '# Old Title\n\nOld content')
      const createAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: initialNode,
        previousNode: O.none
      }
      await apply_graph_deltas_to_db([createAction])(testEnv)()

      // Then update it
      const updatedNode: GraphNode = createTestNode('node-update-1', '# Updated Title\n\nNew content')
      const updateAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode,
        previousNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([updateAction])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Verify file was updated on disk (frontmatter includes isContextNode but NOT title - title is derived from markdown)
      const filePath: string = path.join(testVaultPath, 'node-update-1.md')
      const fileContent: string = await fs.readFile(filePath, 'utf-8')
      expect(fileContent).toBe('---\nisContextNode: false\n---\n# Updated Title\n\nNew content')

      // Load from disk and verify
      const loadResult4: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(testVaultPath), O.none)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(loadResult4)) throw new Error('Expected Right')
      const graph: Graph = loadResult4.right
      // Node IDs include .md extension when loaded from disk
      // parseMarkdownToGraphNode strips YAML frontmatter from contentWithoutYamlOrLinks
      expect(graph.nodes['node-update-1.md'].contentWithoutYamlOrLinks).toBe('# Updated Title\n\nNew content')
      // Title is derived from Markdown content (single source of truth)
      const title: string = markdownToTitle(graph.nodes['node-update-1.md'].contentWithoutYamlOrLinks, graph.nodes['node-update-1.md'].relativeFilePathIsID)
      expect(title).toBe('Updated Title')
    })

    it('should preserve node relativeFilePathIsID when updating', async () => {
      // First create a file
      const initialNode: GraphNode = createTestNode('node-update-2', '# Original')
      await apply_graph_deltas_to_db([{
        type: 'UpsertNode',
        nodeToUpsert: initialNode,
        previousNode: O.none
      }])(testEnv)()

      // Then update it
      const updatedNode: GraphNode = createTestNode('node-update-2', '# Updated')
      const updateAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: updatedNode,
        previousNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([updateAction])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Load from disk and verify ID is preserved
      const loadResult5: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(testVaultPath), O.none)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(loadResult5)) throw new Error('Expected Right')
      const graph: Graph = loadResult5.right
      // Node IDs include .md extension when loaded from disk
      expect(graph.nodes['node-update-2.md'].relativeFilePathIsID).toBe('node-update-2.md')
    })
  })

  describe('DeleteNode', () => {
    it('should remove a node file from disk', async () => {
      // First create the file
      const node: GraphNode = createTestNode('node-delete-1', '# Test')
      await apply_graph_deltas_to_db([{
        type: 'UpsertNode',
        nodeToUpsert: node,
        previousNode: O.none
      }])(testEnv)()

      // Verify it exists
      const filePathBefore: string = path.join(testVaultPath, 'node-delete-1.md')
      const existsBefore: boolean = await fs.access(filePathBefore).then(() => true).catch(() => false)
      expect(existsBefore).toBe(true)

      // Delete it
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-delete-1',
        deletedNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)

      // Verify file was removed from disk
      const existsAfter: boolean = await fs.access(filePathBefore).then(() => true).catch(() => false)
      expect(existsAfter).toBe(false)

      // Verify it's not in the graph when loaded from disk
      const loadResult6: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(testVaultPath), O.none)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(loadResult6)) throw new Error('Expected Right')
      const graph: Graph = loadResult6.right
      // Node IDs include .md extension when loaded from disk
      expect(graph.nodes['node-delete-1.md']).toBeUndefined()
    })

    it('should fail when deleting non-existent file (fail fast)', async () => {
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'non-existent',
        deletedNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      // Fail fast - deleting non-existent file should fail
      expect(E.isLeft(result)).toBe(true)
      if (E.isLeft(result)) {
        expect(result.left.message).toContain('ENOENT')
      }
    })

    it('should return the deltas that were applied', async () => {
      // First create the file
      const node: GraphNode = createTestNode('node-delete-2', '# Test')
      await apply_graph_deltas_to_db([{
        type: 'UpsertNode',
        nodeToUpsert: node,
        previousNode: O.none
      }])(testEnv)()

      // Delete it
      const action: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-delete-2',
        deletedNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])
      const result: E.Either<Error, GraphDelta> = await effect(testEnv)()

      expect(E.isRight(result)).toBe(true)
      if (E.isRight(result)) {
        // Should return the deltas that were applied
        expect(result.right).toEqual([action])
      }
    })
  })

  describe('Function signature and structure', () => {
    it('should return FSWriteEffect (ReaderTaskEither)', () => {
      const newNode: GraphNode = createTestNode('test', '# Test')
      const action: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: newNode,
        previousNode: O.none
      }

      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])

      // Should be a function (Reader)
      expect(typeof effect).toBe('function')
    })

    it('should handle both action types', () => {
      const upsertAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: createTestNode('node-2', '# New'),
        previousNode: O.none
      }

      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node-1',
        deletedNode: O.none
      }

      // Both should return valid effects without throwing
      expect(() => apply_graph_deltas_to_db([upsertAction])).not.toThrow()
      expect(() => apply_graph_deltas_to_db([deleteAction])).not.toThrow()
    })

    it('should use Reader pattern (environment provided at execution)', async () => {
      // Create two separate vault directories
      const vault1Path: string = path.join(tmpdir(), 'test-vault-reader-1')
      const vault2Path: string = path.join(tmpdir(), 'test-vault-reader-2')
      await fs.mkdir(vault1Path, { recursive: true })
      await fs.mkdir(vault2Path, { recursive: true })

      // Test with different environments
      const env1: Env = {
        watchedDirectory: vault1Path
      }

      const env2: Env = {
        watchedDirectory: vault2Path
      }

      const newNode: GraphNode = createTestNode('test', '# Test')
      const action: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: newNode,
        previousNode: O.none
      }

      // Same effect, different environments
      const effect: FSWriteEffect<GraphDelta> = apply_graph_deltas_to_db([action])

      // Can execute with different environments
      const result1: E.Either<Error, GraphDelta> = await effect(env1)()
      const result2: E.Either<Error, GraphDelta> = await effect(env2)()

      // Both should succeed
      expect(E.isRight(result1)).toBe(true)
      expect(E.isRight(result2)).toBe(true)

      // Verify files were written to different vaults
      const file1Exists: boolean = await fs.access(path.join(vault1Path, 'test.md')).then(() => true).catch(() => false)
      const file2Exists: boolean = await fs.access(path.join(vault2Path, 'test.md')).then(() => true).catch(() => false)
      expect(file1Exists).toBe(true)
      expect(file2Exists).toBe(true)

      // Clean up
      await fs.rm(vault1Path, { recursive: true, force: true })
      await fs.rm(vault2Path, { recursive: true, force: true })
    })
  })
})
