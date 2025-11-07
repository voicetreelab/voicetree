/**
 * Integration test for applyGraphDeltaToDB
 *
 * BEHAVIOR TESTED:
 * - INPUT: GraphDelta with UpsertNode action
 * - OUTPUT: GraphNode file written to disk
 * - INPUT: GraphDelta with DeleteNode action
 * - OUTPUT: GraphNode file removed from disk
 *
 * This tests the integration of:
 * - applyGraphDeltaToDB shell function
 * - apply_graph_deltas_to_db pure core effect
 * - Filesystem write/delete operations
 *
 * Testing Strategy:
 * - Initialize vault path with example_small fixture directory
 * - Create a new node via UpsertNode delta
 * - Verify file exists on disk with correct content
 * - Delete the node via DeleteNode delta
 * - Verify file is removed from disk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyGraphDeltaToDB } from '@/functional_graph/shell/main/writePath/applyGraphDeltaToDB.ts'
import { setGraph, setVaultPath, clearVaultPath } from '@/functional_graph/shell/state/graph-store'
import type { Graph, GraphDelta, UpsertNodeAction, DeleteNode, GraphNode } from '@/functional_graph/pure/types'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import { promises as fs } from 'fs'

const EXAMPLE_SMALL_PATH = path.resolve(__dirname, '../../../../fixtures/example_small')
const TEST_NODE_ID = 'test-integration-node'
const TEST_FILE_PATH = path.join(EXAMPLE_SMALL_PATH, `${TEST_NODE_ID}.md`)

describe('applyGraphDeltaToDB - Integration Tests', () => {
  beforeEach(() => {
    // Initialize state with empty graph and example_small vault path
    setGraph({ nodes: {} })
    setVaultPath(EXAMPLE_SMALL_PATH)
  })

  afterEach(async () => {
    // Clean up test file if it exists
    try {
      await fs.unlink(TEST_FILE_PATH)
    } catch {
      // File might not exist, that's ok
    }
  })

  describe('BEHAVIOR: Apply UpsertNode delta writes file to disk', () => {
    it('should write node file to disk when UpsertNode delta is applied', async () => {
      // GIVEN: Empty graph and a UpsertNode delta
      const graph: Graph = { nodes: {} }

      const testNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        content: '# Test Integration GraphNode\n\nThis is test content for integration testing.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none
        }
      }

      const upsertAction: UpsertNodeAction = {
        type: 'UpsertNode',
        nodeToUpsert: testNode
      }

      const delta: GraphDelta = [upsertAction]

      // WHEN: Apply the delta to DB
      await applyGraphDeltaToDB(graph, delta)

      // THEN: File should exist on disk
      const fileExists = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)

      expect(fileExists).toBe(true)

      // AND: File should have correct content
      const fileContent = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('# Test Integration GraphNode')
      expect(fileContent).toContain('This is test content for integration testing.')
    })

    it('should write node file with outgoing edges as markdown links', async () => {
      // GIVEN: Graph and node with outgoing edges
      const graph: Graph = { nodes: {} }

      const testNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        content: '# GraphNode With Links\n\nThis node links to [[1_VoiceTree_Website_Development_and_Node_Display_Bug]] and [[2_VoiceTree_Node_ID_Duplication_Bug]].',
        outgoingEdges: [
          '1_VoiceTree_Website_Development_and_Node_Display_Bug',
          '2_VoiceTree_Node_ID_Duplication_Bug'
        ],
        nodeUIMetadata: {
          color: O.some('#FF5733'),
          position: O.some({ x: 100, y: 200 })
        }
      }

      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: testNode
      }]

      // WHEN: Apply the delta
      await applyGraphDeltaToDB(graph, delta)

      // THEN: File should exist with markdown links
      const fileContent = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('[[1_VoiceTree_Website_Development_and_Node_Display_Bug]]')
      expect(fileContent).toContain('[[2_VoiceTree_Node_ID_Duplication_Bug]]')

      // AND: Should have frontmatter with color and position
      expect(fileContent).toContain('---')
      expect(fileContent).toContain('color: #FF5733')
      expect(fileContent).toContain('x: 100')
      expect(fileContent).toContain('y: 200')
    })
  })

  describe('BEHAVIOR: Apply DeleteNode delta removes file from disk', () => {
    it('should delete node file from disk when DeleteNode delta is applied', async () => {
      // GIVEN: Graph and an existing file on disk
      const graph: Graph = { nodes: {} }

      // First create the file
      const testNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        content: '# GraphNode To Delete\n\nThis node will be deleted.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none
        }
      }

      const createDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: testNode
      }]

      await applyGraphDeltaToDB(graph, createDelta)

      // Verify file exists
      const fileExistsBeforeDelete = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)
      expect(fileExistsBeforeDelete).toBe(true)

      // WHEN: Apply DeleteNode delta
      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: TEST_NODE_ID
      }

      const deleteDelta: GraphDelta = [deleteAction]
      await applyGraphDeltaToDB(graph, deleteDelta)

      // THEN: File should no longer exist
      const fileExistsAfterDelete = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)

      expect(fileExistsAfterDelete).toBe(false)
    })
  })

  describe('BEHAVIOR: Apply multiple deltas in sequence', () => {
    it('should handle create -> update -> delete sequence', async () => {
      const graph: Graph = { nodes: {} }

      // STEP 1: Create node
      const createNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        content: '# Original Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none
        }
      }

      await applyGraphDeltaToDB(graph, [{
        type: 'UpsertNode',
        nodeToUpsert: createNode
      }])

      let fileContent = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('# Original Content')

      // STEP 2: Update node
      const updateNode: GraphNode = {
        ...createNode,
        content: '# Updated Content\n\nThis content has been updated.'
      }

      await applyGraphDeltaToDB(graph, [{
        type: 'UpsertNode',
        nodeToUpsert: updateNode
      }])

      fileContent = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('# Updated Content')
      expect(fileContent).toContain('This content has been updated.')

      // STEP 3: Delete node
      await applyGraphDeltaToDB(graph, [{
        type: 'DeleteNode',
        nodeId: TEST_NODE_ID
      }])

      const fileExists = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).toBe(false)
    })
  })

  describe('BEHAVIOR: Error handling', () => {
    it('should throw error if vault path is not initialized', async () => {
      // GIVEN: Vault path not set
      clearVaultPath() // Clear vault path to None

      const graph: Graph = { nodes: {} }
      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: {
          relativeFilePathIsID: TEST_NODE_ID,
          content: '# Test',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: O.none,
            position: O.none
          }
        }
      }]

      // WHEN/THEN: Should throw error about vault path
      await expect(applyGraphDeltaToDB(graph, delta))
        .rejects
        .toThrow('Vault path not initialized')
    })
  })
})
